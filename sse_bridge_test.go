package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

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

// TestConsumeSSEEmitsTokenEvents verifies the pre-existing token dedicated
// channel still fires alongside the generic channel, so the approval routing
// added in this change does not regress it.
func TestConsumeSSEEmitsTokenEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "event: runtime.token\ndata: hi\n\n")
	}))
	defer srv.Close()

	var tokenSeen bool
	emit := func(event string, data any) {
		if event == "agent:token" {
			tokenSeen = true
			if data != "hi" {
				t.Errorf("agent:token data = %v, want %q", data, "hi")
			}
		}
	}

	if err := consumeSSE(context.Background(), srv.URL, emit); err == nil {
		t.Fatal("consumeSSE returned nil error; want a non-nil error describing why the stream ended")
	}
	if !tokenSeen {
		t.Error("agent:token was not emitted for a runtime.token SSE event")
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
