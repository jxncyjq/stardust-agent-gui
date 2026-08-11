package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// browserStreamRetryDelay paces per-session reconnect attempts, mirroring
// sseRetryDelay for the main /v1/events bridge.
const browserStreamRetryDelay = 2 * time.Second

// browserStreamMaxLine caps a single SSE data line. A screencast frame is a
// base64-encoded JPEG carried on one `data:` line, which routinely exceeds
// bufio.Scanner's default 64 KiB token limit; without a larger buffer the scan
// fails with bufio.ErrTooLong and every frame is dropped. 1 MiB comfortably
// holds a full-viewport JPEG frame.
const browserStreamMaxLine = 1024 * 1024

// BrowserStreamManager runs one Go-side SSE consumer per active browser session
// and forwards its frame/observation/progress events to React via Wails events.
//
// It exists because the React webview's fetch+ReadableStream reader cannot
// consume a long-lived text/event-stream body under WebView2 (it works in the
// jsdom unit tests but not the real runtime), so the browser-view canvas never
// received frames — the SSE request returned almost immediately and the view
// reconnected every few seconds without ever rendering. Routing the stream
// through the Go process — the same pattern the main /v1/events bridge already
// uses successfully — sidesteps the webview's streaming-fetch limitation
// entirely: Go holds the long-lived connection and pushes each event to React
// as a (buffered-once) Wails event.
type BrowserStreamManager struct {
	baseURLFn func() string
	tokenFn   func() string
	emit      func(event string, data any)

	mu     sync.Mutex
	active map[string]context.CancelFunc // sessionID -> cancel for its run goroutine
	// connected records the last connection state emitted for each session so a
	// re-subscribing view can be told the current truth via ReemitStatus. The
	// bridge emits connected=true only once per SSE connection; without this a
	// React remount that reset its local flag to false could never recover it
	// while the long-lived stream stayed open (the amber-badge bug).
	connected map[string]bool
}

// NewBrowserStreamManager builds a manager. baseURLFn/tokenFn are read on every
// (re)connect (not captured once) because ServeManager.Restart rebinds the
// embedded serve on a new port and mints a fresh token — the same reason
// StartSSEBridge takes closures rather than strings.
func NewBrowserStreamManager(baseURLFn, tokenFn func() string, emit func(event string, data any)) *BrowserStreamManager {
	return &BrowserStreamManager{
		baseURLFn: baseURLFn,
		tokenFn:   tokenFn,
		emit:      emit,
		active:    make(map[string]context.CancelFunc),
		connected: make(map[string]bool),
	}
}

// setConnectedState records (without emitting) the last connection state for a
// session. Called from the recording emit wrapper so ReemitStatus can later
// report the current truth to a re-subscribing view.
func (m *BrowserStreamManager) setConnectedState(sessionID string, c bool) {
	m.mu.Lock()
	m.connected[sessionID] = c
	m.mu.Unlock()
}

// ReemitStatus re-announces a session's current connection state on the
// browser:stream channel. A view that (re)subscribes calls this so it learns the
// live state instead of waiting for the next connect/disconnect edge, which for
// a healthy long-lived stream never comes. A blank id or unknown session reports
// not-connected (absent = false); that is the honest state, not a guess.
func (m *BrowserStreamManager) ReemitStatus(sessionID string) {
	if sessionID == "" {
		return
	}
	m.mu.Lock()
	c := m.connected[sessionID]
	m.mu.Unlock()
	m.emit("browser:stream", map[string]any{"session_id": sessionID, "connected": c})
}

// recordingEmit wraps m.emit so every browser:stream connected edge that flows
// through it also updates the recorded per-session state. run passes this to
// consumeBrowserStream (whose one-shot connected=true event thus gets recorded)
// and uses it for its own disconnected marker.
func (m *BrowserStreamManager) recordingEmit(sessionID string) func(string, any) {
	return func(event string, data any) {
		if event == "browser:stream" {
			if mp, ok := data.(map[string]any); ok {
				if c, ok := mp["connected"].(bool); ok {
					m.setConnectedState(sessionID, c)
				}
			}
		}
		m.emit(event, data)
	}
}

// Start begins forwarding the given session's stream. It is idempotent per
// session: a second Start for an already-active session is a no-op, so a
// repeated session_opened event cannot spawn duplicate consumers.
func (m *BrowserStreamManager) Start(ctx context.Context, sessionID string) {
	if sessionID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.active[sessionID]; ok {
		return
	}
	cctx, cancel := context.WithCancel(ctx)
	m.active[sessionID] = cancel
	go m.run(cctx, sessionID)
}

// Stop cancels forwarding for the given session (no-op if not running).
func (m *BrowserStreamManager) Stop(sessionID string) {
	m.mu.Lock()
	cancel, ok := m.active[sessionID]
	delete(m.active, sessionID)
	delete(m.connected, sessionID)
	m.mu.Unlock()
	if ok {
		cancel()
		// A closed session is disconnected: announce it so a view still showing
		// this session flips its badge to amber rather than keeping a stale green
		// (the run loop returns on ctx cancel without emitting a disconnect edge).
		m.emit("browser:stream", map[string]any{"session_id": sessionID, "connected": false})
	}
}

// run is the per-session reconnect loop, mirroring startSSEBridge's loop: it
// keeps a connection to the session's stream open, and on any disconnect emits
// a disconnected marker and retries after a delay until the session is stopped
// or the app context is cancelled.
func (m *BrowserStreamManager) run(ctx context.Context, sessionID string) {
	// recordingEmit records every connected edge (including consumeBrowserStream's
	// one-shot connected=true) so ReemitStatus can later report the live state.
	emit := m.recordingEmit(sessionID)
	for {
		if ctx.Err() != nil {
			return
		}
		url := fmt.Sprintf("%s/v1/browser/sessions/%s/stream", m.baseURLFn(), sessionID)
		err := consumeBrowserStream(ctx, url, m.tokenFn(), sessionID, emit)
		if ctx.Err() != nil {
			return
		}
		// Not a silent retry (fail-loud): the browser view has no other frame
		// source, so a stream that never recovers must be diagnosable rather
		// than look like a canvas that simply stays blank.
		fmt.Fprintf(os.Stderr, "browser stream bridge: %v; retrying %s in %s\n", err, url, browserStreamRetryDelay)
		emit("browser:stream", map[string]any{"session_id": sessionID, "connected": false})
		select {
		case <-ctx.Done():
			return
		case <-time.After(browserStreamRetryDelay):
		}
	}
}

// consumeBrowserStream performs one SSE connection to a browser session stream,
// emitting browser:frame / browser:observation / browser:progress Wails events
// (each carrying the session id and the raw SSE data line, which the React side
// parses) until the stream ends or ctx is cancelled. It mirrors
// consumeSSEWithToken; the browser stream uses the same event:/id:/data: line
// format. The id: line is ignored here because frames are droppable and the Go
// consumer holds a stable connection, so Last-Event-ID replay is unneeded.
//
// It always returns a non-nil error describing why the attempt ended (including
// ctx cancellation) so run() can log/retry uniformly; run() checks ctx.Err() to
// distinguish a shutdown from a real failure.
func consumeBrowserStream(ctx context.Context, url, token, sessionID string, emit func(event string, data any)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build browser stream request for %s: %w", url, err)
	}
	req.Header.Set("Accept", "text/event-stream")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("connect to %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("browser stream %s: unexpected status %d: %s", url, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	emit("browser:stream", map[string]any{"session_id": sessionID, "connected": true})

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), browserStreamMaxLine)
	var eventType string
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event:"):
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data != "" {
				switch eventType {
				case "frame":
					emit("browser:frame", map[string]any{"session_id": sessionID, "data": data})
				case "observation":
					emit("browser:observation", map[string]any{"session_id": sessionID, "data": data})
				case "progress":
					emit("browser:progress", map[string]any{"session_id": sessionID, "data": data})
				}
			}
			eventType = ""
		case line == "":
			eventType = ""
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("browser stream %s: %w", url, err)
	}
	return fmt.Errorf("browser stream %s ended", url)
}
