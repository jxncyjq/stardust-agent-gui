package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// The GUI's embedded serve must be hardened whether or not the user's
// agent.json says so.
//
// TestServeManagerExposesToken (serve_manager_test.go) writes
// loopback_hardening:true into its config, so it proves the token PLUMBING and
// nothing about the deployed configuration. Real users have no such key, and
// the automatic path keyed off "the caller passed no address" — which the GUI
// never does, since it asks for 127.0.0.1:0 explicitly. Every shipped GUI ran
// an unauthenticated agent bound to loopback: any process on the machine could
// read the workspace and run tasks through it.
func guiDefaultConfig(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "agent.json")
	// Deliberately NOT setting server.loopback_hardening: this is the file a
	// user actually has.
	body := `{"storage": {"driver": "memory"}}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

// startEmbeddedServe builds the App the way main() does and starts its serve
// directly, rather than through App.startup: startup emits Wails runtime
// events, which need a Wails-managed context.
func startEmbeddedServe(t *testing.T, configPath string) *App {
	t.Helper()

	app := NewApp(configPath)
	app.serve.emit = func(context.Context, string, ...any) {}
	if err := app.serve.Start(context.Background(), configPath); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(app.serve.Stop)
	return app
}

func TestTheEmbeddedServeIsHardenedWithoutAskingTheUserToConfigureIt(t *testing.T) {
	app := startEmbeddedServe(t, guiDefaultConfig(t))

	if app.serve.Token() == "" {
		t.Error("Token is empty on a stock config: the embedded serve is open to every process on the machine")
	}
}

// TestTheHardenedServeStillAnswersTheGUIsOwnCalls: hardening that locks out
// the frontend it was added for is worse than no hardening.
//
// It goes through postJSON on purpose. apiGet sets the Authorization header at
// its own call site, so a read would pass even with the transport's auth torn
// out; the write paths carry no header of their own and rely entirely on
// loopbackAuthTransport -- which is exactly the combination that shipped as
// "creating a session failed: 401" the last time only reads were checked.
func TestTheHardenedServeStillAnswersTheGUIsOwnCalls(t *testing.T) {
	app := startEmbeddedServe(t, guiDefaultConfig(t))

	body, status, err := app.postJSON("/v1/sessions", map[string]any{"agent_id": "default"})
	if err != nil {
		t.Fatalf("POST /v1/sessions through the GUI's own client: %v", err)
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		t.Fatalf("POST /v1/sessions = %d: the GUI cannot write to its own hardened serve: %s", status, body)
	}
	var decoded any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Errorf("response is not JSON (%v): %s", err, body)
	}
}

// TestAnUnauthenticatedCallerIsRefused is the point of the exercise, checked
// against the serve the GUI actually starts.
func TestAnUnauthenticatedCallerIsRefused(t *testing.T) {
	app := startEmbeddedServe(t, guiDefaultConfig(t))

	resp, err := http.Get(app.BaseURL() + "/v1/sessions")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Errorf("close body: %v", err)
		}
	}()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("unauthenticated GET /v1/sessions = %d, want 401", resp.StatusCode)
	}
}
