package main

import (
	"bufio"
	"context"
	"encoding/json"
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
//
// tokenFn is likewise read before every (re)connection rather than captured
// once: when the loopback serve is hardened it mints a one-time bearer token
// (see ServeManager.Token), and ServeManager.Restart rebinds on a new port
// *and* mints a new token, so a token captured at startup would be rejected
// with 403 after a restart. tokenFn returning "" (non-hardened serve) means no
// Authorization header is sent.
func StartSSEBridge(ctx context.Context, appCtx context.Context, baseURLFn func() string, tokenFn func() string, browserStream *BrowserStreamManager) {
	// onBrowserSession drives the Go-side per-session frame bridge off the same
	// lifecycle events the view already reacts to: start consuming a session's
	// screencast stream when it opens, stop when it closes. Nil-safe so a build
	// without a manager keeps the plain event forwarding.
	onBrowserSession := func(eventType, sessionID string) {
		if browserStream == nil {
			return
		}
		switch eventType {
		case "browser:session_opened":
			browserStream.Start(ctx, sessionID)
		case "browser:session_closed":
			browserStream.Stop(sessionID)
		}
	}
	startSSEBridge(ctx, baseURLFn, tokenFn, func(event string, data any) {
		runtime.EventsEmit(appCtx, event, data)
	}, onBrowserSession)
}

// startSSEBridge is the testable core of StartSSEBridge. emit is injected
// (rather than calling runtime.EventsEmit directly) because the Wails runtime
// requires a live app context that tests cannot construct; production code
// goes through StartSSEBridge, which binds emit to runtime.EventsEmit.
func startSSEBridge(ctx context.Context, baseURLFn func() string, tokenFn func() string, emit func(event string, data any), onBrowserSession func(eventType, sessionID string)) {
	go func() {
		for {
			if err := ctx.Err(); err != nil {
				return
			}
			url := baseURLFn() + "/v1/events"
			// Read the token on every reconnect (not captured once): a Restart
			// rebinds on a new port and mints a fresh token, so a stale token
			// would be rejected 403 by the hardened serve.
			err := consumeSSEWithToken(ctx, url, tokenFn(), emit, onBrowserSession)
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

// consumeSSE performs a single SSE connection attempt against url without a
// bearer token. It is a thin back-compat wrapper over consumeSSEWithToken for
// callers (and tests) that target a non-hardened serve.
func consumeSSE(ctx context.Context, url string, emit func(event string, data any)) error {
	return consumeSSEWithToken(ctx, url, "", emit, nil)
}

// consumeSSEWithToken performs a single SSE connection attempt against url,
// emitting each received event, and blocks until the stream ends or ctx is
// cancelled. When token is non-empty it attaches an Authorization: Bearer
// header so the request is accepted by the loopback-hardened serve (which 403s
// unauthenticated requests); an empty token sends no Authorization header
// (non-hardened serve). It always returns a non-nil error describing why the
// attempt ended (including ctx cancellation) so the caller can log/retry
// uniformly; the caller is responsible for checking ctx.Err() to distinguish a
// shutdown from a real failure.
func consumeSSEWithToken(ctx context.Context, url, token string, emit func(event string, data any), onBrowserSession func(eventType, sessionID string)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build SSE request for %s: %w", url, err)
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
				// Plugin lifecycle events get their own channel, the way
				// approval and browser events do. Two reasons, and the second
				// is the load-bearing one:
				//
				//   - the generic channel carries ONE EVENT PER STREAMED
				//     TOKEN, and waking the plugins panel on each of those
				//     would have it refetch the whole plugin list while the
				//     model is talking;
				//   - "which types are plugin events" is a server-side
				//     contract (loader.publish's type strings), so it belongs
				//     here in the bridge rather than inside a React component.
				//
				// A prefix rather than a switch case: the six types are a
				// family (plugin/loaded, plugin/unloaded, plugin/suspended,
				// plugin/resumed, plugin/activation_failed,
				// plugin/unload_leaked), and a new sibling should reach the
				// panel without a change here.
				if strings.HasPrefix(eventType, "plugin/") {
					emit("agent:plugin", map[string]any{
						"type": eventType,
						"data": data,
					})
				}
				switch eventType {
				case "runtime.token", "token":
					// Token events get a dedicated channel for the chat stream.
					// The SSE data line is a RuntimeEvent JSON envelope (not bare
					// text): unmarshal it so the delta can be attributed to its
					// task, and re-emit the {task_id, message} pair the GUI bubble
					// reconciliation keys on. A payload that is not that envelope is
					// skipped fail-loud rather than fed to a bubble as raw JSON.
					var env struct {
						TaskID  string `json:"task_id"`
						Message string `json:"message"`
					}
					if err := json.Unmarshal([]byte(data), &env); err != nil {
						fmt.Fprintf(os.Stderr, "sse bridge: token payload not JSON (%q): %v\n", data, err)
					} else {
						emit("agent:token", map[string]any{"task_id": env.TaskID, "message": env.Message})
					}
				case "approval_pending", "approval_resolved":
					// Approval lifecycle events get a dedicated channel so the
					// approval UI does not have to filter the generic firehose.
					emit("agent:approval", map[string]any{
						"type": eventType,
						"data": data,
					})
				case "session_event":
					// 会话事件走专用频道。通用 agent:event 频道每个流式 token 一条，
					// 让轨迹订它等于模型每吐一个字就唤醒一次面板——与 approval/browser/plugin
					// 分频道的理由完全一样。
					//
					// data 原样转发（与其它专用频道一致），React 侧自己 parse。
					emit("agent:session_event", map[string]any{
						"type": eventType,
						"data": data,
					})
				case "browser:session_opened", "browser:session_closed":
					// Browser session lifecycle events get a dedicated channel so
					// the browser view can discover active sessions without filtering
					// the generic firehose. The raw SSE data string is forwarded
					// verbatim; the React side parses it.
					emit("browser:session", map[string]any{
						"type": eventType,
						"data": data,
					})
					// Drive the Go-side frame bridge off the same lifecycle: start
					// consuming this session's screencast stream when it opens, stop
					// when it closes. Parsing the session id here keeps the manager
					// transport-only; a payload without one is skipped fail-loud.
					if onBrowserSession != nil {
						var env struct {
							SessionID string `json:"session_id"`
						}
						if err := json.Unmarshal([]byte(data), &env); err != nil {
							fmt.Fprintf(os.Stderr, "sse bridge: browser session payload not JSON (%q): %v\n", data, err)
						} else if env.SessionID != "" {
							onBrowserSession(eventType, env.SessionID)
						}
					}
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
