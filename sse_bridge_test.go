package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// emittedEvent is one (event, data) pair captured from consumeSSE's emit hook.
type emittedEvent struct {
	event string
	data  any
}

// collectSSE runs one consumeSSE attempt against url and returns everything it
// emitted. The stream always ends in an error (the server closes the body), so
// a nil error is itself a failure worth reporting.
func collectSSE(t *testing.T, url string) []emittedEvent {
	t.Helper()
	var got []emittedEvent
	emit := func(event string, data any) {
		got = append(got, emittedEvent{event: event, data: data})
	}
	if err := consumeSSE(context.Background(), url, emit); err == nil {
		t.Fatal("consumeSSE returned nil error; want a non-nil error describing why the stream ended")
	}
	return got
}

// TestConsumeSSEEmitsApprovalEvents verifies that consumeSSE, upon receiving
// approval_pending/approval_resolved SSE frames, emits both the generic
// "agent:event" channel (unchanged prior behaviour) and the dedicated
// "agent:approval" channel the approval UI listens on. A plain "message"
// event is included to check the approval channel does not turn into a
// firehose for every event type.
func TestConsumeSSEEmitsApprovalEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		frames := []string{
			"event: approval_pending\ndata: {\"ticket_id\":\"t1\"}\n\n",
			"event: message\ndata: hello\n\n",
			"event: approval_resolved\ndata: {\"ticket_id\":\"t1\",\"decision\":\"approve\"}\n\n",
		}
		for _, f := range frames {
			fmt.Fprint(w, f)
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
	defer srv.Close()

	type emitted struct {
		event string
		data  any
	}
	var got []emitted
	emit := func(event string, data any) {
		got = append(got, emitted{event: event, data: data})
	}

	err := consumeSSE(context.Background(), srv.URL, emit)
	if err == nil {
		t.Fatal("consumeSSE returned nil error; want a non-nil error describing why the stream ended")
	}

	var approvalCount, genericCount, statusCount int
	for _, e := range got {
		switch e.event {
		case "agent:approval":
			approvalCount++
			m, ok := e.data.(map[string]any)
			if !ok {
				t.Fatalf("agent:approval data not a map: %#v", e.data)
			}
			if m["type"] != "approval_pending" && m["type"] != "approval_resolved" {
				t.Errorf("agent:approval type = %v, want approval_pending or approval_resolved", m["type"])
			}
		case "agent:event":
			genericCount++
		case "serve:sse":
			statusCount++
		default:
			t.Errorf("unexpected emitted event %q", e.event)
		}
	}
	if approvalCount != 2 {
		t.Errorf("approvalCount = %d, want 2 (approval_pending + approval_resolved)", approvalCount)
	}
	if genericCount != 3 {
		t.Errorf("genericCount = %d, want 3 (every event also hits the generic agent:event channel)", genericCount)
	}
	if statusCount != 1 {
		t.Errorf("statusCount = %d, want 1 (connection-established serve:sse status)", statusCount)
	}
}

// TestConsumeSSEEmitsTokenEvents verifies a token SSE frame (whose data is a
// RuntimeEvent JSON envelope, not bare text) is unmarshalled and re-emitted on
// the dedicated agent:token channel as a {task_id, message} object, so the GUI
// can attribute each delta to the task whose bubble it belongs to.
func TestConsumeSSEEmitsTokenEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "event: token\ndata: {\"type\":\"token\",\"task_id\":\"task-9\",\"message\":\"hi\"}\n\n")
	}))
	defer srv.Close()

	var tokenSeen bool
	emit := func(event string, data any) {
		if event == "agent:token" {
			tokenSeen = true
			m, ok := data.(map[string]any)
			if !ok {
				t.Fatalf("agent:token data not a map: %#v", data)
			}
			if m["task_id"] != "task-9" {
				t.Errorf("agent:token task_id = %v, want %q", m["task_id"], "task-9")
			}
			if m["message"] != "hi" {
				t.Errorf("agent:token message = %v, want %q", m["message"], "hi")
			}
		}
	}

	if err := consumeSSE(context.Background(), srv.URL, emit); err == nil {
		t.Fatal("consumeSSE returned nil error; want a non-nil error describing why the stream ended")
	}
	if !tokenSeen {
		t.Error("agent:token was not emitted for a token SSE event")
	}
}

// TestConsumeSSESkipsNonJSONTokenPayload verifies a token frame whose data is
// not a valid JSON envelope is skipped (fail-loud to stderr) rather than fed to
// the chat bubble as bare text: a malformed payload must not corrupt the stream.
func TestConsumeSSESkipsNonJSONTokenPayload(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "event: token\ndata: not-json\n\n")
	}))
	defer srv.Close()

	for _, e := range collectSSE(t, srv.URL) {
		if e.event == "agent:token" {
			t.Errorf("agent:token should not be emitted for a non-JSON token payload, got %#v", e.data)
		}
	}
}

// TestConsumeSSESendsBearerToken verifies consumeSSEWithToken attaches an
// Authorization: Bearer header when a non-empty token is supplied, so the
// bridge can reach the loopback-hardened serve (which 403s unauthenticated
// requests). The server closes the stream immediately, so the returned error is
// expected and ignored; only the header the server observed is asserted.
func TestConsumeSSESendsBearerToken(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("event: ping\ndata: {}\n\n"))
	}))
	defer srv.Close()

	_ = consumeSSEWithToken(context.Background(), srv.URL, "tok-123", func(string, any) {}, nil)
	if gotAuth != "Bearer tok-123" {
		t.Fatalf("Authorization = %q, want Bearer tok-123", gotAuth)
	}
}

// TestConsumeSSEOmitsAuthWhenTokenEmpty verifies that an empty token results in
// no Authorization header at all (rather than a bare "Bearer "), matching the
// non-hardened serve where no token is required.
func TestConsumeSSEOmitsAuthWhenTokenEmpty(t *testing.T) {
	var authPresent bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, authPresent = r.Header["Authorization"]
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("event: ping\ndata: {}\n\n"))
	}))
	defer srv.Close()

	_ = consumeSSEWithToken(context.Background(), srv.URL, "", func(string, any) {}, nil)
	if authPresent {
		t.Fatal("Authorization header present, want absent when token is empty")
	}
}

// TestConsumeSSERejectsNonOKStatus verifies a non-200 response (e.g. the
// embedded service returning 404/502 mid-restart) is surfaced as an error
// rather than silently scanning an error-page body as if it were an event
// stream.
func TestConsumeSSERejectsNonOKStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not ready", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	emit := func(event string, data any) {
		t.Errorf("emit should not be called for a non-OK status, got event %q", event)
	}
	err := consumeSSE(context.Background(), srv.URL, emit)
	if err == nil {
		t.Fatal("expected an error for a non-200 status")
	}
}

// TestConsumeSSEForwardsBrowserSession verifies that browser session lifecycle
// SSE frames (browser:session_opened/closed) are forwarded on the dedicated
// "browser:session" channel the GUI browser view listens on, carrying the raw
// SSE data string for the React side to parse.
func TestConsumeSSEForwardsBrowserSession(t *testing.T) {
	frame := "event: browser:session_opened\ndata: {\"session_id\":\"sess-1\",\"url\":\"https://x\"}\n\n"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(frame))
	}))
	defer srv.Close()

	var got []emittedEvent
	emit := func(event string, data any) { got = append(got, emittedEvent{event: event, data: data}) }
	_ = consumeSSEWithToken(context.Background(), srv.URL, "", emit, nil)

	var found bool
	for _, e := range got {
		if e.event == "browser:session" {
			found = true
			m := e.data.(map[string]any)
			if m["type"] != "browser:session_opened" {
				t.Fatalf("forwarded type wrong: %v", m["type"])
			}
		}
	}
	if !found {
		t.Fatalf("browser:session not forwarded; got %+v", got)
	}
}

// sseServer serves one fixed set of SSE frames and closes. It is the same
// shape the approval test builds inline, extracted so the plugin tests below
// do not repeat it twice more.
func sseServer(t *testing.T, frames ...string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for _, frame := range frames {
			fmt.Fprint(w, frame)
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
}

// TestConsumeSSEEmitsPluginEventsOnTheirOwnChannel: the plugins panel refreshes
// off these, and it must not have to filter them out of the generic firehose —
// which carries one event per streamed token.
func TestConsumeSSEEmitsPluginEventsOnTheirOwnChannel(t *testing.T) {
	srv := sseServer(t,
		"event: plugin/loaded\ndata: {\"message\":\"plugin=legion-hello tools=1\"}\n\n",
		"event: plugin/unloaded\ndata: {\"message\":\"plugin=legion-hello reason=health\"}\n\n",
	)
	defer srv.Close()

	got := collectSSE(t, srv.URL)

	var plugin, generic int
	for _, e := range got {
		switch e.event {
		case "agent:plugin":
			plugin++
		case "agent:event":
			generic++
		}
	}
	if plugin != 2 {
		t.Errorf("agent:plugin emissions = %d, want 2 (one per plugin frame); got %+v", plugin, got)
	}
	// The generic channel must keep carrying them too: existing consumers
	// (the events tab) still read from it, and this must not be a move.
	if generic != 2 {
		t.Errorf("agent:event emissions = %d, want 2: the dedicated channel is an addition, not a move", generic)
	}
}

func TestConsumeSSEPluginChannelCarriesTypeAndData(t *testing.T) {
	srv := sseServer(t, "event: plugin/suspended\ndata: {\"message\":\"plugin=a unresolved=[b]\"}\n\n")
	defer srv.Close()

	for _, e := range collectSSE(t, srv.URL) {
		if e.event != "agent:plugin" {
			continue
		}
		payload, ok := e.data.(map[string]any)
		if !ok {
			t.Fatalf("agent:plugin payload = %T, want map[string]any", e.data)
		}
		if payload["type"] != "plugin/suspended" {
			t.Errorf("payload type = %v, want plugin/suspended", payload["type"])
		}
		if payload["data"] == "" || payload["data"] == nil {
			t.Errorf("payload data = %v, want the raw event body", payload["data"])
		}
		return
	}
	t.Fatal("no agent:plugin emission at all")
}

// TestConsumeSSEDoesNotPutOtherEventsOnThePluginChannel is the half that keeps
// the channel useful: a token stream emits one event per delta, and waking the
// plugins panel on each of them would make it refetch the whole plugin list
// while the model is talking.
func TestConsumeSSEDoesNotPutOtherEventsOnThePluginChannel(t *testing.T) {
	srv := sseServer(t,
		"event: runtime.token\ndata: {\"task_id\":\"t1\",\"message\":\"hel\"}\n\n",
		"event: task_completed\ndata: {\"task_id\":\"t1\"}\n\n",
		"event: pluginish\ndata: {\"message\":\"not a plugin event\"}\n\n",
	)
	defer srv.Close()

	for _, e := range collectSSE(t, srv.URL) {
		if e.event == "agent:plugin" {
			t.Errorf("agent:plugin emitted for a non-plugin frame: %+v", e)
		}
	}
}

// TestSessionEventsGetTheirOwnChannel:
// session_event 必须走专用频道。通用 agent:event 频道每个流式 token 一条，
// 轨迹订它等于模型每吐一个字就唤醒一次面板——approval/browser/plugin 都因此
// 有了专用频道（见 sse_bridge.go 里那段注释），session_event 同理。
func TestSessionEventsGetTheirOwnChannel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		frames := []string{
			"event: session_event\ndata: {\"session_id\":\"sess-1\",\"seq\":7,\"event_type\":\"tool/call\"}\n\n",
			"event: task.completed\ndata: {\"task_id\":\"task-1\"}\n\n",
		}
		for _, f := range frames {
			fmt.Fprint(w, f)
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
	defer srv.Close()

	type emitted struct {
		event string
		data  any
	}
	var got []emitted
	emit := func(event string, data any) {
		got = append(got, emitted{event: event, data: data})
	}

	if err := consumeSSE(context.Background(), srv.URL, emit); err == nil {
		t.Fatal("consumeSSE 返回了 nil error；流结束时应当带上原因")
	}

	// 1) 专用频道收到了它，data 是原始 JSON 字符串（与其它专用频道一致）。
	var dedicated []emitted
	for _, e := range got {
		if e.event == "agent:session_event" {
			dedicated = append(dedicated, e)
		}
	}
	if len(dedicated) != 1 {
		t.Fatalf("agent:session_event 收到 %d 条，要 1 条：轨迹订的就是这条频道，没有它就永远不会实时更新", len(dedicated))
	}
	payload, ok := dedicated[0].data.(map[string]any)
	if !ok {
		t.Fatalf("payload 类型 %T，要 map[string]any", dedicated[0].data)
	}
	if payload["type"] != "session_event" {
		t.Errorf("payload type = %v，要 session_event", payload["type"])
	}
	raw, ok := payload["data"].(string)
	if !ok || !strings.Contains(raw, `"seq":7`) {
		t.Errorf("payload data = %v，要原样转发含 seq 的 JSON 字符串", payload["data"])
	}

	// 2) 通用频道**也**收到了它——既有契约：agent:event 是全量的，
	//    专用频道是它的旁路而不是替代。
	generic := 0
	for _, e := range got {
		if e.event == "agent:event" {
			generic++
		}
	}
	if generic != 2 {
		t.Errorf("agent:event 收到 %d 条，要 2 条（session_event 与 task.completed 都该在全量频道里）", generic)
	}
}

// TestSessionEventsDoNotPutOtherEventsOnTheirChannel 是频道有用的另一半：
// 非 session_event 的帧（尤其是每个 delta 一条的 token 流）不得落到轨迹频道上，
// 否则专用频道就退化成了第二个 firehose。
func TestSessionEventsDoNotPutOtherEventsOnTheirChannel(t *testing.T) {
	srv := sseServer(t,
		"event: runtime.token\ndata: {\"task_id\":\"t1\",\"message\":\"hel\"}\n\n",
		"event: task_completed\ndata: {\"task_id\":\"t1\"}\n\n",
		"event: session_eventish\ndata: {\"message\":\"not a session event\"}\n\n",
	)
	defer srv.Close()

	for _, e := range collectSSE(t, srv.URL) {
		if e.event == "agent:session_event" {
			t.Errorf("agent:session_event emitted for a non-session-event frame: %+v", e)
		}
	}
}
