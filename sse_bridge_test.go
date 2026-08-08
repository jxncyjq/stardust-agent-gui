package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
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

	_ = consumeSSEWithToken(context.Background(), srv.URL, "tok-123", func(string, any) {})
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

	_ = consumeSSEWithToken(context.Background(), srv.URL, "", func(string, any) {})
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
