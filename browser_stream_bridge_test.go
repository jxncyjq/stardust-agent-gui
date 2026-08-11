package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// browserSSEServer returns an httptest server that streams the given raw SSE
// frames and then closes, mirroring the real /v1/browser/sessions/{id}/stream
// wire format (event:/id:/data: lines, blank-line separated).
func browserSSEServer(t *testing.T, frames []string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for _, f := range frames {
			_, _ = w.Write([]byte(f))
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
}

func collectBrowser(t *testing.T, url, sessionID string) []emittedEvent {
	t.Helper()
	var got []emittedEvent
	emit := func(event string, data any) {
		got = append(got, emittedEvent{event: event, data: data})
	}
	// The server closes the body after the last frame, so consumeBrowserStream
	// always ends with a non-nil "stream ended" error — expected, not a failure.
	if err := consumeBrowserStream(context.Background(), url, "", sessionID, emit); err == nil {
		t.Fatalf("consumeBrowserStream returned nil error, want stream-ended error")
	}
	return got
}

func TestConsumeBrowserStreamEmitsTypedEvents(t *testing.T) {
	srv := browserSSEServer(t, []string{
		"event: frame\nid: 1\ndata: {\"mime\":\"image/jpeg\",\"b64\":\"AAAA\"}\n\n",
		"event: observation\nid: 2\ndata: {\"elements\":[],\"text\":\"hi\"}\n\n",
		"event: progress\nid: 3\ndata: {\"action\":\"open\",\"status\":\"done\"}\n\n",
	})
	defer srv.Close()

	got := collectBrowser(t, srv.URL, "sess-1")

	var sawConnected, sawFrame, sawObs, sawProgress bool
	for _, e := range got {
		m, ok := e.data.(map[string]any)
		if !ok {
			t.Fatalf("event %q payload is not a map: %T", e.event, e.data)
		}
		if e.event != "browser:stream" && m["session_id"] != "sess-1" {
			t.Errorf("event %q missing/wrong session_id: %v", e.event, m["session_id"])
		}
		switch e.event {
		case "browser:stream":
			if m["connected"] == true {
				sawConnected = true
			}
		case "browser:frame":
			sawFrame = true
			if !strings.Contains(fmt.Sprint(m["data"]), "AAAA") {
				t.Errorf("frame data not forwarded: %v", m["data"])
			}
		case "browser:observation":
			sawObs = true
		case "browser:progress":
			sawProgress = true
		default:
			t.Errorf("unexpected event %q", e.event)
		}
	}
	if !sawConnected || !sawFrame || !sawObs || !sawProgress {
		t.Fatalf("missing events: connected=%v frame=%v obs=%v progress=%v", sawConnected, sawFrame, sawObs, sawProgress)
	}
}

// TestConsumeBrowserStreamHandlesLargeFrame guards the scanner buffer size: a
// base64 JPEG frame on a single data line exceeds bufio.Scanner's default
// 64 KiB token limit, which would otherwise drop every real frame with
// bufio.ErrTooLong.
func TestConsumeBrowserStreamHandlesLargeFrame(t *testing.T) {
	big := strings.Repeat("A", 200*1024) // 200 KiB > default 64 KiB scanner token
	srv := browserSSEServer(t, []string{
		fmt.Sprintf("event: frame\nid: 1\ndata: {\"mime\":\"image/jpeg\",\"b64\":\"%s\"}\n\n", big),
	})
	defer srv.Close()

	got := collectBrowser(t, srv.URL, "sess-1")

	var sawFrame bool
	for _, e := range got {
		if e.event == "browser:frame" {
			sawFrame = true
			m := e.data.(map[string]any)
			if !strings.Contains(fmt.Sprint(m["data"]), big) {
				t.Errorf("large frame body truncated")
			}
		}
	}
	if !sawFrame {
		t.Fatal("large frame was dropped (scanner buffer too small?)")
	}
}

// TestBrowserStreamManagerReemitStatus verifies the manager records the last
// connection state per session and ReemitStatus re-announces it. This is the
// fix for the amber-badge bug: the bridge emits connected=true only once at
// connect, so a React remount that reset connected to false could never recover
// it while the long-lived SSE stayed open. ReemitStatus lets a re-subscribing
// view learn the current truth instead of relying on the missed one-shot event.
func TestBrowserStreamManagerReemitStatus(t *testing.T) {
	var events []map[string]any
	emit := func(event string, data any) {
		if event == "browser:stream" {
			events = append(events, data.(map[string]any))
		}
	}
	m := NewBrowserStreamManager(func() string { return "" }, func() string { return "" }, emit)

	// Unknown session: re-emit reports not-connected (no guess, not connected).
	m.ReemitStatus("sess-1")
	// The run loop records a live connection via setConnectedState.
	m.setConnectedState("sess-1", true)
	m.ReemitStatus("sess-1")
	// A recorded disconnect flips it back.
	m.setConnectedState("sess-1", false)
	m.ReemitStatus("sess-1")

	got := make([]bool, 0, len(events))
	for _, e := range events {
		if e["session_id"] != "sess-1" {
			t.Fatalf("session_id = %v, want sess-1", e["session_id"])
		}
		got = append(got, e["connected"].(bool))
	}
	want := []bool{false, true, false}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("re-emitted connected sequence = %v, want %v", got, want)
	}
}

// TestBrowserStreamManagerReemitStatusEmptyNoop verifies a blank session id does
// not emit (nothing to re-announce).
func TestBrowserStreamManagerReemitStatusEmptyNoop(t *testing.T) {
	emitted := false
	m := NewBrowserStreamManager(func() string { return "" }, func() string { return "" }, func(string, any) { emitted = true })
	m.ReemitStatus("")
	if emitted {
		t.Fatalf("ReemitStatus(\"\") emitted, want no-op")
	}
}

// TestBrowserStreamManagerStartStopIdempotent verifies Start is idempotent per
// session and Stop cancels the consumer.
func TestBrowserStreamManagerStartStopIdempotent(t *testing.T) {
	srv := browserSSEServer(t, []string{"event: progress\ndata: {\"action\":\"x\",\"status\":\"y\"}\n\n"})
	defer srv.Close()
	mgr := NewBrowserStreamManager(func() string { return srv.URL }, func() string { return "" }, func(string, any) {})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.Start(ctx, "sess-1")
	mgr.Start(ctx, "sess-1") // idempotent: must not spawn a second consumer
	mgr.mu.Lock()
	n := len(mgr.active)
	mgr.mu.Unlock()
	if n != 1 {
		t.Fatalf("active consumers = %d, want 1 (Start not idempotent)", n)
	}
	mgr.Stop("sess-1")
	mgr.mu.Lock()
	n = len(mgr.active)
	mgr.mu.Unlock()
	if n != 0 {
		t.Fatalf("active consumers after Stop = %d, want 0", n)
	}
	mgr.Stop("sess-1") // no-op, must not panic
}
