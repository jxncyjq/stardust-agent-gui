package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"legionAgentGUI/internal/chromium"
)

type App struct {
	ctx           context.Context
	serve         *ServeManager
	cfgPath       string
	client        *http.Client
	browserStream *BrowserStreamManager // per-session screencast SSE forwarder; nil until serve starts

	// chromiumPath 回答「现在有没有内置浏览器」。它是字段而不是直接调
	// chromium.Path()，只为一件事：让「已装时该不该拒绝安装」这条判断可测。
	// chromium.Path() 按 os.Executable() 的同级目录找，而 go test 的二进制在临时
	// 目录里——它在测试下**默认**为空，以它为前提的断言会静默跳过；测试要让它非空
	// 就得自己在测试二进制旁边放一个（TestInstallRefusesWhenABrowserIsAlreadyThere
	// 正是这么做的）。
	// NewApp 填 chromium.Path，生产路径逐字不变。
	chromiumPath func() string

	// installChromium 执行那次真正的安装。它是字段而不是直接调 chromium.Install，
	// 理由与 chromiumPath 同类但更硬：chromium.Install 会去 GitHub 取脚本并**执行
	// 它**（一次 150MB 的下载）。任何走到它的测试都会变成一个下载器，在有网络的 CI
	// 上尤其明显，而那些测试想验的其实只是「前置检查放没放行」。
	// NewApp 填 chromium.Install，生产路径逐字不变。
	installChromium func(ctx context.Context, client *http.Client, progress func(string)) error

	// emitInstall 把安装的一行送到界面（"chromium:install" 事件）。**nil 表示界面还
	// 没起来**——那时候不该开始一次没人看得到过程和结果的 150MB 安装，
	// runChromiumInstall 会直接拒绝。
	//
	// 它是字段而不是直接调 runtime.EventsEmit：那个函数要一个由 Wails 注入的 ctx，
	// 测试里给不出（拿一个普通 ctx 调它会 panic），于是「安装完成：/安装失败：」这两个
	// 与前端唯一的约定就没有任何测试跨得过去。startup 填生产实现。
	emitInstall func(line string)

	// installing 挡住「同时两次安装」。前端那个禁用的按钮不算护栏：界面一重载
	// （wails dev 热重载 / Ctrl+R）store 就回到初始态，而这边那次安装还在跑。
	installing atomic.Bool
}

func NewApp(cfgPath string) *App {
	// One shared client with a generous idle-connection pool. The UI runs
	// several concurrent pollers against the embedded service (sessions every
	// 5s, the task-result poll every 600ms, status tabs). DefaultTransport caps
	// idle conns per host at 2, so the extra pollers' connections were closed
	// instead of reused — on Windows the resulting churn piles up TIME_WAIT
	// sockets and exhausts the ephemeral port range ("bind: An invalid argument
	// was supplied"). Pooling enough idle conns keeps the sockets reused.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 100
	transport.MaxIdleConnsPerHost = 64
	transport.IdleConnTimeout = 90 * time.Second

	app := &App{
		serve:           NewServeManager(),
		cfgPath:         cfgPath,
		chromiumPath:    chromium.Path,
		installChromium: chromium.Install,
	}
	// Authenticate at the TRANSPORT, not at each call site. The serve this app
	// starts mints a one-time loopback bearer token, and every request to it
	// must carry that token — reads did, and six write call sites each did not,
	// which a real-machine walkthrough surfaced as "creating a session failed:
	// 401" the first time anybody tried to send a message. Attaching it here
	// makes the next call site correct by construction instead of by memory.
	app.client = &http.Client{
		Transport: &loopbackAuthTransport{base: transport, token: app.serve.Token, baseURL: app.BaseURL},
		Timeout:   120 * time.Second,
	}
	return app
}

// loopbackAuthTransport adds the embedded serve's bearer token to requests
// addressed to THAT SERVE, and to nothing else.
//
// Both the token and the serve's address are read PER REQUEST rather than
// captured: a Restart mints a fresh token on a fresh random port, and captured
// values would leave this transport authenticating against a serve that no
// longer exists (and comparing addresses against a dead port).
//
// The destination check is SCOPE, not a fallback for an error. This client is
// shared with chromium.Install, which fetches its install script from
// raw.githubusercontent.com: while the header went out unconditionally, the
// token was handed to a third-party public host — and that token drives the
// user's agent (list sessions, read the workspace through /v1/files, run
// tasks). "No header when we cannot prove the request is going home" is the
// safe default for a credential, not zero-value-pretending-to-be-fine; nothing
// is being swallowed here, and a genuine auth failure still surfaces as the
// serve's own 401. The same reasoning covers the two other no-header cases: a
// serve that is not running (no trustworthy address to compare against), and a
// serve that minted no token at all (a deployment with its own admin_token, or
// one not in loopback-hardening mode) — that sends no Authorization header
// rather than an empty bearer, which keeps the non-hardened path
// byte-identical to what it was.
type loopbackAuthTransport struct {
	base  http.RoundTripper
	token func() string
	// baseURL is the embedded serve's address, e.g. "http://127.0.0.1:53412".
	// Nil or empty means "no known serve", which attaches nothing.
	baseURL func() string
}

func (t *loopbackAuthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	tok := t.token()
	if tok == "" || req.Header.Get("Authorization") != "" || !t.addressesEmbeddedServe(req.URL) {
		return t.base.RoundTrip(req)
	}
	// Clone before writing: RoundTrip must not mutate the caller's request.
	cloned := req.Clone(req.Context())
	cloned.Header.Set("Authorization", "Bearer "+tok)
	return t.base.RoundTrip(cloned)
}

// addressesEmbeddedServe reports whether u is the serve this app started.
//
// The match is on host AND port, both. A looser test — "the host starts with
// 127.", say — would hand the agent's credential to every other service
// listening on this machine's loopback, which is exactly the class of mistake
// this check exists to end.
func (t *loopbackAuthTransport) addressesEmbeddedServe(u *url.URL) bool {
	if u == nil || t.baseURL == nil {
		return false
	}
	base, err := url.Parse(t.baseURL())
	if err != nil {
		return false
	}
	self := authorityOf(base)
	if self == "" {
		return false
	}
	return authorityOf(u) == self
}

// authorityOf normalizes a URL to "host:port", filling in the scheme's default
// port so that "http://127.0.0.1/x" and "http://127.0.0.1:80/x" compare equal.
// It returns "" when there is no usable address — no host, an unknown scheme
// with no explicit port, or port 0, which is what BaseURL reports while the
// serve is not listening. Callers read "" as "not the embedded serve".
func authorityOf(u *url.URL) string {
	host := u.Hostname()
	if host == "" {
		return ""
	}
	port := u.Port()
	if port == "" {
		switch u.Scheme {
		case "http":
			port = "80"
		case "https":
			port = "443"
		default:
			return ""
		}
	}
	if port == "0" {
		return ""
	}
	return host + ":" + port
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// 与 ctx 一起填：安装的输出只有这一条路能到界面，而它要的正是这个 ctx。在此之前
	// 它是 nil，runChromiumInstall 会拒绝开工（见那里的注释）。
	a.emitInstall = func(line string) { runtime.EventsEmit(ctx, "chromium:install", line) }
	// Chdir to the config dir here (a real run only), not in main(): relative
	// paths inside the config (sqlite db, persona files) must resolve against it,
	// but doing this in main() would also fire during wails binding generation
	// and move cwd away from the wails project ("wails.json not found").
	if a.cfgPath != "" {
		if dir := filepath.Dir(a.cfgPath); dir != "" {
			if err := os.Chdir(dir); err != nil {
				fmt.Fprintf(os.Stderr, "chdir to config dir %q failed: %v\n", dir, err)
			}
		}
	}
	err := a.serve.Start(ctx, a.cfgPath)
	if err != nil {
		// serve start failure is non-fatal for the window, but it must not be
		// silent: log to stderr and tell the UI so the badge can explain why it
		// is disconnected instead of looking like a mystery.
		fmt.Fprintf(os.Stderr, "serve start failed (config=%q): %v\n", a.cfgPath, err)
		runtime.EventsEmit(ctx, "serve:error", map[string]any{"error": err.Error()})
	} else {
		// baseURLFn (not a captured string) so the bridge re-reads a.BaseURL()
		// on every reconnect: SaveAll can restart the embedded service on a new
		// random port (see ServeManager.Restart), and a cached URL would leave
		// the bridge dialing the old, now-dead port forever.
		// The browser screencast stream is consumed Go-side (not by the React
		// webview's fetch reader, which cannot read a long-lived event-stream
		// body under WebView2) and forwarded to React as Wails events. The
		// manager starts/stops a per-session consumer off the browser session
		// lifecycle events the SSE bridge already sees.
		a.browserStream = NewBrowserStreamManager(a.BaseURL, a.serve.Token, func(event string, data any) {
			runtime.EventsEmit(ctx, event, data)
		})
		StartSSEBridge(ctx, ctx, a.BaseURL, a.serve.Token, a.browserStream)
	}
	a.writeStartupLog(err)
}

// writeStartupLog records the embedded-service startup outcome to a file next to
// the executable. GUI builds run under the windows subsystem with no console, so
// stderr is discarded; this file is the only way to diagnose a failed start.
func (a *App) writeStartupLog(startErr error) {
	cwd, _ := os.Getwd()
	line := fmt.Sprintf("config=%q cwd=%q running=%v port=%d", a.cfgPath, cwd, a.serve.Running(), a.serve.Port())
	if startErr != nil {
		line += " error=" + startErr.Error()
	} else {
		line += " error=<nil>"
	}
	path := "serve-startup.log"
	if exe, err := os.Executable(); err == nil {
		path = filepath.Join(filepath.Dir(exe), "serve-startup.log")
	}
	_ = os.WriteFile(path, []byte(line+"\n"), 0o644)
}

func (a *App) shutdown(_ context.Context) {
	a.serve.Stop()
}

// Port returns the port the embedded HTTP service is listening on.
func (a *App) Port() int {
	return a.serve.Port()
}

// BaseURL returns the base URL for the embedded HTTP service.
func (a *App) BaseURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", a.serve.Port())
}

// BrowserEndpoint is the handshake the frontend needs to connect itself to the
// built-in browser stream (spec §3.4): the loopback base URL plus the bearer
// token minted by the hardened serve.
type BrowserEndpoint struct {
	BaseURL string `json:"baseURL"`
	Token   string `json:"token"`
}

// GetBrowserEndpoint is a Wails binding exposed to the frontend: the React side
// uses it to open a fetch/EventSource directly against
// /v1/browser/sessions/{id}/stream (with Authorization: Bearer <token>) to watch
// the agent's browsing. Token is "" when loopback hardening is off.
func (a *App) GetBrowserEndpoint() BrowserEndpoint {
	return BrowserEndpoint{BaseURL: a.BaseURL(), Token: a.serve.Token()}
}

// ServeStatus returns the current embedded service status. The frontend calls
// this on mount to avoid missing the one-shot serve:status event emitted during
// startup (Wails events are not buffered).
func (a *App) ServeStatus() map[string]any {
	return map[string]any{
		"running": a.serve.Running(),
		"port":    a.serve.Port(),
	}
}

// apiGet is a helper for Go-side HTTP calls to the local service. It uses the
// shared pooled client and fully drains the body so the connection is returned
// to the idle pool for reuse, and it returns the body ONLY for a 2xx response.
//
// The status check is the point, not a detail. Without it every caller here
// received a 404's {"error":...} as if the service had answered normally, and
// what happened next depended on how the caller decoded it:
//
//   - the eight list callers decode into a slice, so an error OBJECT failed at
//     json.Unmarshal — an accident, and one that reported "cannot unmarshal
//     object into Go value of type []map[string]any" for what was really "the
//     service says this does not exist";
//   - GetTaskResult decodes into map[string]any, which an error body satisfies
//     without complaint: "this task does not exist" reached the UI AS a task
//     result;
//   - BrowserSessions / BrowserSessionInfo hand the raw body to the frontend,
//     so the error body impersonated session state — the address bar read
//     parsed.url off it and got undefined.
//
// The last three were live defects, not hypotheticals (P4b final review, 收口5).
// Both frontend consumers of the browser bindings already render a .catch, so
// turning these into errors puts the failure on screen instead of a blank or a
// lie. apiGetStatusChecked (app_session_events.go) exists because this helper
// did not do this; it stays as the caller that also needs the body of a failed
// response, and both truncate through truncateErrorBody.
func (a *App) apiGet(path string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, a.BaseURL()+path, nil)
	if err != nil {
		return nil, err
	}
	// Read the token per call (not captured): a Restart mints a fresh one, so a
	// cached token would be rejected 403 by the hardened serve. An empty token
	// (non-hardened serve) means no Authorization header is sent.
	if tok := a.serve.Token(); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read %s response body: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("get %s: status %d: %s", path, resp.StatusCode, truncateErrorBody(string(body)))
	}
	return body, nil
}

// ListSessions returns sessions for the default agent.
// Called by React via Wails TypeScript bindings.
func (a *App) ListSessions() ([]map[string]any, error) {
	body, err := a.apiGet("/v1/sessions?agent_id=default-agent&company_id=default-company")
	if err != nil {
		return nil, err
	}
	var result []map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// ListRuntimeEvents returns the most recent runtime events (task lifecycle,
// inference, learning, ...) for the status panel's Events tab. The call goes
// through the Go side to reuse the pooled client and avoid CORS.
func (a *App) ListRuntimeEvents() ([]map[string]any, error) {
	body, err := a.apiGet("/v1/runtime-events")
	if err != nil {
		return nil, err
	}
	var result []map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal runtime events: %w", err)
	}
	return result, nil
}

// ListTasks returns the tasks tracked by the running service for the status
// panel's Tasks tab.
func (a *App) ListTasks() ([]map[string]any, error) {
	body, err := a.apiGet("/v1/tasks")
	if err != nil {
		return nil, err
	}
	var result []map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal tasks: %w", err)
	}
	return result, nil
}

// ListAuditEvents returns the audit log for the status panel's Audit tab.
func (a *App) ListAuditEvents() ([]map[string]any, error) {
	body, err := a.apiGet("/v1/audit-events")
	if err != nil {
		return nil, err
	}
	var result []map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal audit events: %w", err)
	}
	return result, nil
}

// ListInbox returns the default agent's received messages for the status
// panel's Inbox tab.
func (a *App) ListInbox() ([]map[string]any, error) {
	body, err := a.apiGet("/v1/agents/default-agent/messages?company_id=default-company")
	if err != nil {
		return nil, err
	}
	var result []map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal inbox messages: %w", err)
	}
	return result, nil
}

// NewSession creates a session under the user-defined project group and returns
// the created session object. The call goes through the Go side to reuse the
// pooled client and avoid CORS.
//
// It deliberately sends no agent_id. An agent belongs to a message, not to a
// session: the agent that answers is chosen per submission and can differ
// between turns of the same session, which is why replies are labelled
// individually and the sidebar groups by project only. The previous
// "default-agent" here was a value the GUI had no basis for — the session record
// then named an agent that had never answered anything. The server applies its
// own default for the column; the GUI simply stops asserting what it does not
// know.
func (a *App) NewSession(project string, title string) (map[string]any, error) {
	payload, err := json.Marshal(map[string]string{
		"project":    strings.TrimSpace(project),
		"title":      strings.TrimSpace(title),
		"company_id": "default-company",
	})
	if err != nil {
		return nil, fmt.Errorf("marshal session request: %w", err)
	}
	resp, err := a.client.Post(a.BaseURL()+"/v1/sessions", "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read session response: %w", err)
	}
	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("create session failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var session map[string]any
	if err := json.Unmarshal(body, &session); err != nil {
		return nil, fmt.Errorf("decode session response: %w", err)
	}
	return session, nil
}

// GetSessionTurns returns the persisted conversation turns for a session in
// chronological order (oldest first), so the frontend can replay the history
// when the user switches sessions. Each turn carries role/content/created_at.
func (a *App) GetSessionTurns(sessionID string) ([]map[string]any, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	body, err := a.apiGet("/v1/sessions/" + sessionID + "/turns")
	if err != nil {
		return nil, err
	}
	var turns []map[string]any
	if err := json.Unmarshal(body, &turns); err != nil {
		return nil, fmt.Errorf("decode session turns: %w", err)
	}
	return turns, nil
}

// ListAgents returns the names of the configured sub-agents (the keys of the
// config's `agents` map) so the chat UI can offer them as conversation targets.
// The built-in default agent is not in this list — it is selected by submitting
// a task with agentID "default-agent" (see SubmitTask). Called by React via the
// Wails bindings.
func (a *App) ListAgents() ([]string, error) {
	body, err := a.apiGet("/v1/agents")
	if err != nil {
		return nil, err
	}
	var result struct {
		Agents []string `json:"agents"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode agents: %w", err)
	}
	return result.Agents, nil
}

// SubmitTask submits a prompt to the embedded service as a task and returns the
// generated task id. When sessionID is non-empty the task is attached to that
// session so the backend persists the conversation turns. agentID selects which
// agent handles the task: a configured sub-agent name (from ListAgents) routes
// to that agent's model/persona/tools, and an empty string falls back to the
// built-in "default-agent" so existing callers keep their behaviour. images
// carries optional multimodal inputs as data-URI strings
// ("data:image/...;base64,..."); it may be nil or empty for a text-only task.
// The call goes through the Go side to avoid browser CORS preflight against the
// random-port local service, and uses the field names the backend
// createTaskRequest expects (id/input/agent_id/company_id/session_id/images).
func (a *App) SubmitTask(prompt string, sessionID string, images []string, agentID string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", fmt.Errorf("prompt is required")
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		agentID = "default-agent"
	}
	taskID := fmt.Sprintf("gui-task-%d", time.Now().UTC().UnixNano())
	payload, err := json.Marshal(map[string]any{
		"id":         taskID,
		"input":      prompt,
		"agent_id":   agentID,
		"company_id": "default-company",
		"session_id": strings.TrimSpace(sessionID),
		"images":     images,
	})
	if err != nil {
		return "", fmt.Errorf("marshal task request: %w", err)
	}
	resp, err := a.client.Post(a.BaseURL()+"/v1/tasks", "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("submit task failed: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	// Drain the success body so the connection can be reused from the pool.
	_, _ = io.Copy(io.Discard, resp.Body)
	return taskID, nil
}

// InterruptTask cancels a running task on the embedded serve, stopping its
// tool-loop mid-flight. A non-2xx status (e.g. 404 when the task already
// finished) is returned as an error rather than silently ignored. Called by
// React via the Wails bindings.
func (a *App) InterruptTask(taskID string) error {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return fmt.Errorf("task id is required")
	}
	resp, err := a.client.Post(a.BaseURL()+"/v1/tasks/"+taskID+"/interrupt", "application/json", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("interrupt task %q failed: status %d: %s", taskID, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

// patchSession issues a PATCH /v1/sessions/{id} with the given JSON body fields
// and discards the response body so the pooled connection is reused. Only the
// provided fields are changed by the backend; a non-2xx status is reported as a
// wrapped error rather than silently ignored, per the fail-loud rule.
func (a *App) patchSession(id string, fields map[string]any) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("session id is required")
	}
	payload, err := json.Marshal(fields)
	if err != nil {
		return fmt.Errorf("marshal session patch %q: %w", id, err)
	}
	req, err := http.NewRequest(http.MethodPatch, a.BaseURL()+"/v1/sessions/"+id, strings.NewReader(string(payload)))
	if err != nil {
		return fmt.Errorf("build patch request for session %q: %w", id, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("patch session %q: %w", id, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read patch response for session %q: %w", id, err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("patch session %q failed: status %d: %s", id, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// deleteSession issues a DELETE /v1/sessions/{id}, draining the response body so
// the pooled connection is reused. A non-2xx status (including a 404 for an
// already-missing session) is surfaced as a wrapped error.
func (a *App) deleteSession(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("session id is required")
	}
	req, err := http.NewRequest(http.MethodDelete, a.BaseURL()+"/v1/sessions/"+id, nil)
	if err != nil {
		return fmt.Errorf("build delete request for session %q: %w", id, err)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("delete session %q: %w", id, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read delete response for session %q: %w", id, err)
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("delete session %q failed: status %d: %s", id, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// RenameSession changes a single session's title via PATCH. Called by React via
// the Wails bindings.
func (a *App) RenameSession(id string, title string) error {
	return a.patchSession(id, map[string]any{"title": strings.TrimSpace(title)})
}

// DeleteSession removes a single session and its conversation turns via DELETE.
// Called by React via the Wails bindings.
func (a *App) DeleteSession(id string) error {
	return a.deleteSession(id)
}

// SetSessionArchived archives or unarchives a single session via PATCH. Called
// by React via the Wails bindings.
func (a *App) SetSessionArchived(id string, archived bool) error {
	return a.patchSession(id, map[string]any{"archived": archived})
}

// SetSessionMode sets a session's working mode (manual|plan|auto) via PATCH.
// It is a thin wrapper over patchSession, mirroring RenameSession and
// SetSessionArchived. Mode validation is the server's responsibility (400 on
// an unknown value), surfaced here as the returned error. Called by React via
// the Wails bindings.
func (a *App) SetSessionMode(sessionID, mode string) error {
	return a.patchSession(sessionID, map[string]any{"mode": mode})
}

// SetSessionWorkingDir binds a session's working directory via PATCH. The
// server treats working_dir as set-once: changing an already-bound
// working_dir to a different value returns 400, surfaced here as an error the
// frontend must display (working_dir cannot be changed once bound) rather
// than swallow. Called by React via the Wails bindings.
func (a *App) SetSessionWorkingDir(sessionID, dir string) error {
	return a.patchSession(sessionID, map[string]any{"working_dir": dir})
}

// PickDirectory opens the native directory picker and returns the chosen
// absolute path. An empty string with a nil error means the user cancelled
// the dialog — a legitimate outcome, not a failure. The frontend pairs this
// with SetSessionWorkingDir. Called by React via the Wails bindings.
func (a *App) PickDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择工作目录",
	})
}

// RenameProject moves every session under oldProject to newProject. The backend
// has no project-level route, so the Go side enumerates the sessions and patches
// each one. The first failure aborts loudly and names the offending session, so
// a partial rename is reported rather than hidden.
func (a *App) RenameProject(oldProject string, newProject string) error {
	oldProject = strings.TrimSpace(oldProject)
	newProject = strings.TrimSpace(newProject)
	sessions, err := a.ListSessions()
	if err != nil {
		return fmt.Errorf("list sessions for rename project %q: %w", oldProject, err)
	}
	for _, raw := range sessions {
		if projectOf(raw) != oldProject {
			continue
		}
		id := stringField(raw, "id")
		if err := a.patchSession(id, map[string]any{"project": newProject}); err != nil {
			return fmt.Errorf("rename project %q: session %q: %w", oldProject, id, err)
		}
	}
	return nil
}

// DeleteProject removes every session under the given project (and their turns)
// by enumerating and deleting each. The first failure aborts loudly and names
// the offending session.
func (a *App) DeleteProject(project string) error {
	project = strings.TrimSpace(project)
	sessions, err := a.ListSessions()
	if err != nil {
		return fmt.Errorf("list sessions for delete project %q: %w", project, err)
	}
	for _, raw := range sessions {
		if projectOf(raw) != project {
			continue
		}
		id := stringField(raw, "id")
		if err := a.deleteSession(id); err != nil {
			return fmt.Errorf("delete project %q: session %q: %w", project, id, err)
		}
	}
	return nil
}

// SetProjectArchived archives or unarchives every session under the given
// project by patching each. The first failure aborts loudly and names the
// offending session.
func (a *App) SetProjectArchived(project string, archived bool) error {
	project = strings.TrimSpace(project)
	sessions, err := a.ListSessions()
	if err != nil {
		return fmt.Errorf("list sessions for archive project %q: %w", project, err)
	}
	for _, raw := range sessions {
		if projectOf(raw) != project {
			continue
		}
		id := stringField(raw, "id")
		if err := a.patchSession(id, map[string]any{"archived": archived}); err != nil {
			return fmt.Errorf("set archived for project %q: session %q: %w", project, id, err)
		}
	}
	return nil
}

// projectOf reads the trimmed project field from a loosely-typed session map.
func projectOf(raw map[string]any) string {
	return stringField(raw, "project")
}

// stringField reads a trimmed string value for key from a loosely-typed map,
// returning "" when the key is absent or not a string.
func stringField(raw map[string]any, key string) string {
	if v, ok := raw[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

// postJSON marshals body to JSON, POSTs it to the local service at path, and
// returns the response bytes and status code. The body is fully drained so the
// pooled connection is reused. Transport errors are wrapped; HTTP status is left
// for the caller to interpret so each binding can fail loud with context.
// BrowserTakeover toggles manual takeover for a browser session. The POST goes
// through the Go side, not a direct webview fetch: a cross-origin
// application/json POST from the webview triggers a CORS preflight that the
// random-port local serve answers with 404 (it registers no OPTIONS handler),
// so the takeover button silently did nothing. Routing through Go — the same
// reason SubmitTask does — skips the preflight entirely.
func (a *App) BrowserTakeover(sessionID string, enabled bool) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return fmt.Errorf("session id is required")
	}
	return a.browserPost("/v1/browser/sessions/"+sessionID+"/takeover", map[string]any{"enabled": enabled})
}

// BrowserInput injects a batch of input events into a taken-over session (same
// CORS-avoidance rationale as BrowserTakeover). eventsJSON is the JSON array of
// input events built by the frontend; it is embedded verbatim as the "events"
// field so the Go side stays a thin, type-agnostic forwarder rather than
// duplicating the InputEvent shape.
func (a *App) BrowserInput(sessionID string, eventsJSON string) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return fmt.Errorf("session id is required")
	}
	if !json.Valid([]byte(eventsJSON)) {
		return fmt.Errorf("events payload is not valid JSON")
	}
	return a.browserPost("/v1/browser/sessions/"+sessionID+"/input", map[string]any{"events": json.RawMessage(eventsJSON)})
}

// BrowserSetViewport sets the session's browser viewport to width×height CSS px
// so the screencast frames match the GUI panel's aspect and fill it without
// letterboxing. Routed through Go for the same CORS-avoidance reason as
// BrowserTakeover. Called (debounced) by the React browser view on mount and
// resize.
func (a *App) BrowserSetViewport(sessionID string, width int, height int) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return fmt.Errorf("session id is required")
	}
	if width <= 0 || height <= 0 {
		return fmt.Errorf("viewport width/height must be positive, got %dx%d", width, height)
	}
	return a.browserPost("/v1/browser/sessions/"+sessionID+"/viewport", map[string]any{"width": width, "height": height})
}

// BrowserNavigate drives the browser by hand: an address typed into the
// toolbar, or back/forward/reload.
//
// url and action are mutually exclusive, and an empty request is refused HERE
// rather than sent on: it would arrive as "navigate to nothing", and the serve
// answers that with a 400 the user reads as "the button is broken".
//
// Everything else — takeover required, URL policy, unknown action — is the
// serve's decision, deliberately not duplicated here: two copies of a policy
// drift, and the copy in the client is the one nobody updates.
func (a *App) BrowserNavigate(sessionID, url, action string) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return fmt.Errorf("session id is required")
	}
	url = strings.TrimSpace(url)
	action = strings.TrimSpace(action)
	if url == "" && action == "" {
		return fmt.Errorf("navigation needs either a url or an action (back, forward, reload)")
	}
	if url != "" && action != "" {
		return fmt.Errorf("navigation takes a url or an action, not both")
	}
	body := map[string]any{}
	if url != "" {
		body["url"] = url
	} else {
		body["action"] = action
	}
	return a.browserPost("/v1/browser/sessions/"+sessionID+"/navigate", body)
}

// BrowserSessions lists the browser sessions of one conversation as raw JSON.
//
// 按对话问而不是问全部：视图跟着当前对话走，把别的对话的会话摆进标签条，用户点
// 进去的是一个与眼前工作无关的页面。
func (a *App) BrowserSessions(chatSessionID string) (string, error) {
	chatSessionID = strings.TrimSpace(chatSessionID)
	path := "/v1/browser/sessions"
	if chatSessionID != "" {
		path += "?chat_session_id=" + url.QueryEscape(chatSessionID)
	}
	body, err := a.apiGet(path)
	if err != nil {
		return "", fmt.Errorf("list browser sessions: %w", err)
	}
	return string(body), nil
}

// BrowserSessionInfo returns the session's current state as raw JSON: where the
// browser is, who is driving, whether the page still exists.
//
// Raw JSON rather than a typed struct for the same reason BrowserInput takes a
// JSON string: the Go side stays a thin forwarder, and a field added on the
// serve reaches the frontend without a second declaration to keep in step.
func (a *App) BrowserSessionInfo(sessionID string) (string, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return "", fmt.Errorf("session id is required")
	}
	body, err := a.apiGet("/v1/browser/sessions/" + sessionID + "/info")
	if err != nil {
		return "", fmt.Errorf("read browser session info: %w", err)
	}
	return string(body), nil
}

// EnsureBrowserStreamStatus asks the Go-side stream bridge to re-announce the
// session's current connection state on the browser:stream Wails channel. The
// React browser view calls it on (re)mount because the bridge emits
// connected=true only once at connect; without this re-sync a remount after that
// one-shot event leaves the view's connection badge stuck amber even though the
// stream is live and frames keep arriving. No-op when the bridge is absent
// (serve failed to start) — the badge then honestly stays disconnected.
func (a *App) EnsureBrowserStreamStatus(sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || a.browserStream == nil {
		return
	}
	a.browserStream.ReemitStatus(sessionID)
}

// browserPost POSTs a JSON body to the local serve with the loopback bearer
// token (mirroring apiGet's auth), returning an error for transport failures or
// any non-2xx status so the caller (and the React button handler) can surface a
// failed takeover/input instead of swallowing it.
func (a *App) browserPost(path string, body any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal %s request: %w", path, err)
	}
	req, err := http.NewRequest(http.MethodPost, a.BaseURL()+path, strings.NewReader(string(payload)))
	if err != nil {
		return fmt.Errorf("build %s request: %w", path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	if tok := a.serve.Token(); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("post %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("post %s: status %d: %s", path, resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return nil
}

func (a *App) postJSON(path string, body map[string]any) ([]byte, int, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal request for %s: %w", path, err)
	}
	resp, err := a.client.Post(a.BaseURL()+path, "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return nil, 0, fmt.Errorf("post %s: %w", path, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response from %s: %w", path, err)
	}
	return data, resp.StatusCode, nil
}

// SendAgentMessage delivers a plain message to another agent's inbox via
// POST /v1/agents/{toAgent}/messages with type "message". summary carries the
// message text (the backend requires a non-empty summary). Called by React via
// the Wails bindings for the /send command.
func (a *App) SendAgentMessage(toAgent string, summary string) error {
	toAgent = strings.TrimSpace(toAgent)
	summary = strings.TrimSpace(summary)
	if toAgent == "" {
		return fmt.Errorf("target agent is required")
	}
	if summary == "" {
		return fmt.Errorf("message is required")
	}
	body, status, err := a.postJSON("/v1/agents/"+toAgent+"/messages", map[string]any{
		"company_id": "default-company",
		"from":       "default-agent",
		"type":       "message",
		"summary":    summary,
	})
	if err != nil {
		return err
	}
	if status != http.StatusCreated {
		return fmt.Errorf("send message to %q failed: status %d: %s", toAgent, status, strings.TrimSpace(string(body)))
	}
	return nil
}

// HandoffTask hands a task off to another agent via
// POST /v1/agents/{toAgent}/messages with type "handoff", carrying the task id
// and a summary. Called by React via the Wails bindings for the /handoff command.
func (a *App) HandoffTask(toAgent string, taskID string, summary string) error {
	toAgent = strings.TrimSpace(toAgent)
	taskID = strings.TrimSpace(taskID)
	summary = strings.TrimSpace(summary)
	if toAgent == "" {
		return fmt.Errorf("target agent is required")
	}
	if taskID == "" {
		return fmt.Errorf("task id is required")
	}
	if summary == "" {
		return fmt.Errorf("summary is required")
	}
	body, status, err := a.postJSON("/v1/agents/"+toAgent+"/messages", map[string]any{
		"company_id": "default-company",
		"from":       "default-agent",
		"task_id":    taskID,
		"type":       "handoff",
		"summary":    summary,
	})
	if err != nil {
		return err
	}
	if status != http.StatusCreated {
		return fmt.Errorf("handoff task %q to %q failed: status %d: %s", taskID, toAgent, status, strings.TrimSpace(string(body)))
	}
	return nil
}

// SkillCommand runs a skill management action (install/update/uninstall) against
// the backend's /v1/skills/* endpoints and returns a short human-readable
// summary of the result. For install/update arg is the source/name; for
// uninstall arg is the skill name. A non-200 status is reported as an error so
// the GUI can surface the backend's reason. Called by React via the Wails
// bindings for the /skill command.
func (a *App) SkillCommand(action string, arg string) (string, error) {
	action = strings.TrimSpace(strings.ToLower(action))
	arg = strings.TrimSpace(arg)
	if arg == "" {
		return "", fmt.Errorf("skill %s requires an argument", action)
	}
	var path string
	var reqBody map[string]any
	switch action {
	case "install":
		path = "/v1/skills/install"
		reqBody = map[string]any{"source": arg}
	case "update":
		path = "/v1/skills/update"
		reqBody = map[string]any{"name": arg}
	case "uninstall":
		path = "/v1/skills/uninstall"
		reqBody = map[string]any{"name": arg}
	default:
		return "", fmt.Errorf("unknown skill action %q (want install|update|uninstall)", action)
	}
	body, status, err := a.postJSON(path, reqBody)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("skill %s %q failed: status %d: %s", action, arg, status, strings.TrimSpace(string(body)))
	}
	return strings.TrimSpace(string(body)), nil
}

// GetTaskResult fetches the status and answer text for a previously submitted
// task. The answer text is empty until the task reaches a terminal state.
func (a *App) GetTaskResult(taskID string) (map[string]any, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, fmt.Errorf("task id is required")
	}
	body, err := a.apiGet("/v1/tasks/" + taskID + "/result")
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode task result: %w", err)
	}
	return result, nil
}

// ListPendingApprovals returns the pending Manual-mode approval tickets the
// server has on disk, so the UI can reconcile any approval_pending events it
// missed over the at-most-once SSE stream (or before the frontend
// subscribed). Each ticket carries ticket_id/task_id/tool_name/arguments per
// the server's GET /v1/approvals response. Called by React via the Wails
// bindings.
func (a *App) ListPendingApprovals() ([]map[string]any, error) {
	body, err := a.apiGet("/v1/approvals?status=pending")
	if err != nil {
		return nil, err
	}
	var result struct {
		Approvals []map[string]any `json:"approvals"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode pending approvals: %w", err)
	}
	return result.Approvals, nil
}

// DecideApproval posts a human's approve/deny decision on a Manual-mode tool
// approval ticket via POST /v1/tasks/{taskID}/approvals/{ticketID}. decision
// must be "approve" or "deny" — the verb form the server's endpoint expects,
// distinct from the "approved"/"denied" past tense used in the
// approval_resolved SSE event. postJSON does not itself fail loud on a
// non-2xx status (it hands the status back for the caller to interpret), so
// the status is checked here: 404 means the ticket no longer exists, 409
// means it was already decided, and any other non-200 status is surfaced
// verbatim. Called by React via the Wails bindings.
func (a *App) DecideApproval(taskID, ticketID, decision string) error {
	taskID = strings.TrimSpace(taskID)
	ticketID = strings.TrimSpace(ticketID)
	decision = strings.TrimSpace(decision)
	if taskID == "" {
		return fmt.Errorf("task id is required")
	}
	if ticketID == "" {
		return fmt.Errorf("ticket id is required")
	}
	if decision == "" {
		return fmt.Errorf("decision is required")
	}
	path := "/v1/tasks/" + taskID + "/approvals/" + ticketID
	body, status, err := a.postJSON(path, map[string]any{"decision": decision})
	if err != nil {
		return err
	}
	switch status {
	case http.StatusOK:
		return nil
	case http.StatusNotFound:
		return fmt.Errorf("decide approval %q for task %q: ticket not found: %s", ticketID, taskID, strings.TrimSpace(string(body)))
	case http.StatusConflict:
		return fmt.Errorf("decide approval %q for task %q: already decided: %s", ticketID, taskID, strings.TrimSpace(string(body)))
	default:
		return fmt.Errorf("decide approval %q for task %q failed: status %d: %s", ticketID, taskID, status, strings.TrimSpace(string(body)))
	}
}
