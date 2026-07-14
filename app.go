package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx     context.Context
	serve   *ServeManager
	cfgPath string
	client  *http.Client
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

	return &App{
		serve:   NewServeManager(),
		cfgPath: cfgPath,
		client:  &http.Client{Transport: transport, Timeout: 120 * time.Second},
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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
// to the idle pool for reuse.
func (a *App) apiGet(path string) ([]byte, error) {
	resp, err := a.client.Get(a.BaseURL() + path)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
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

// NewSession creates a session for two-level grouping (project -> agent) and
// returns the created session object. The project is the user-defined top-level
// group; agent and company default to the single-tenant ids on the backend. The
// call goes through the Go side to reuse the pooled client and avoid CORS.
func (a *App) NewSession(project string, title string) (map[string]any, error) {
	payload, err := json.Marshal(map[string]string{
		"project":    strings.TrimSpace(project),
		"title":      strings.TrimSpace(title),
		"agent_id":   "default-agent",
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

// SubmitTask submits a prompt to the embedded service as a task and returns the
// generated task id. When sessionID is non-empty the task is attached to that
// session so the backend persists the conversation turns. images carries
// optional multimodal inputs as data-URI strings ("data:image/...;base64,...");
// it may be nil or empty for a text-only task, in which case the backend
// behaves exactly as before. The call goes through the Go side to avoid browser
// CORS preflight against the random-port local service, and uses the field names
// the backend createTaskRequest expects
// (id/input/agent_id/company_id/session_id/images).
func (a *App) SubmitTask(prompt string, sessionID string, images []string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", fmt.Errorf("prompt is required")
	}
	taskID := fmt.Sprintf("gui-task-%d", time.Now().UTC().UnixNano())
	payload, err := json.Marshal(map[string]any{
		"id":         taskID,
		"input":      prompt,
		"agent_id":   "default-agent",
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
