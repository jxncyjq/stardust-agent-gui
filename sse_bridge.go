package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// sseRetryDelay paces reconnect attempts. The embedded service listens on a
// random port that becomes reachable slightly after startup, and briefly
// disappears during ServeManager.Restart (config save); without a delay a
// failed dial would spin the retry loop at full CPU.
const sseRetryDelay = 2 * time.Second

// StartSSEBridge opens a persistent SSE connection to the local agent serve
// and forwards each event to React via runtime.EventsEmit. baseURLFn is
// called before every (re)connection attempt rather than captured once at
// startup: the embedded service listens on a random port
// (ServeManager.Start), and ServeManager.Restart (e.g. after a config save,
// see App.SaveAll) tears the old listener down and rebinds a new one on a
// different port. Caching the base URL at startup would leave the bridge
// silently dialing a dead port after a restart, so the caller must pass a
// closure (typically a.BaseURL) that always reads the current port.
func StartSSEBridge(ctx context.Context, appCtx context.Context, baseURLFn func() string) {
	startSSEBridge(ctx, baseURLFn, func(event string, data any) {
		runtime.EventsEmit(appCtx, event, data)
	})
}

// startSSEBridge is the testable core of StartSSEBridge. emit is injected
// (rather than calling runtime.EventsEmit directly) because the Wails runtime
// requires a live app context that tests cannot construct; production code
// goes through StartSSEBridge, which binds emit to runtime.EventsEmit.
func startSSEBridge(ctx context.Context, baseURLFn func() string, emit func(event string, data any)) {
	go func() {
		for {
			if err := ctx.Err(); err != nil {
				return
			}
			url := baseURLFn() + "/v1/events"
			err := consumeSSE(ctx, url, emit)
			if ctx.Err() != nil {
				return
			}
			// The embedded service may not be listening yet (startup race) or
			// may be mid-restart on a new port (SaveAll -> ServeManager.Restart);
			// retrying is expected. But per the fail-loud rule this must not be
			// a silent retry: SSE is the only transport for approval events, so
			// a connection that never recovers has to be diagnosable rather than
			// look like a UI that simply never receives approvals.
			fmt.Fprintf(os.Stderr, "sse bridge: %v; retrying %s in %s\n", err, url, sseRetryDelay)
			emit("serve:sse", map[string]any{"connected": false, "error": err.Error()})
			select {
			case <-ctx.Done():
				return
			case <-time.After(sseRetryDelay):
			}
		}
	}()
}

// consumeSSE performs a single SSE connection attempt against url, emitting
// each received event, and blocks until the stream ends or ctx is cancelled.
// It always returns a non-nil error describing why the attempt ended
// (including ctx cancellation) so the caller can log/retry uniformly; the
// caller is responsible for checking ctx.Err() to distinguish a shutdown from
// a real failure.
func consumeSSE(ctx context.Context, url string, emit func(event string, data any)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build SSE request for %s: %w", url, err)
	}
	req.Header.Set("Accept", "text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("connect to %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("SSE %s: unexpected status %d: %s", url, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	// Connection established: make this visible too, since a bridge that
	// silently connects and then silently disconnects is just as hard to
	// diagnose as one that never connects.
	emit("serve:sse", map[string]any{"connected": true})

	scanner := bufio.NewScanner(resp.Body)
	var eventType string
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event:"):
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if eventType != "" && data != "" {
				emit("agent:event", map[string]any{
					"type": eventType,
					"data": data,
				})
				switch eventType {
				case "runtime.token", "token":
					// Token events get a dedicated channel for the chat stream.
					emit("agent:token", data)
				case "approval_pending", "approval_resolved":
					// Approval lifecycle events get a dedicated channel so the
					// approval UI does not have to filter the generic firehose.
					emit("agent:approval", map[string]any{
						"type": eventType,
						"data": data,
					})
				}
			}
			eventType = ""
		case line == "":
			eventType = ""
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("SSE stream %s: %w", url, err)
	}
	return fmt.Errorf("SSE stream %s ended", url)
}
