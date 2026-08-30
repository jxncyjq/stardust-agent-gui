package main

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// ServeManager 捕获的是**装配那一刻**的 token 字符串。凭证轮换之后（运维 POST
// /v1/auth/rotate，或将来的定期轮换）它就不是当前那个了，而 GUI 的每一次请求都还
// 在出示它——界面会变成「什么都 401」，而用户能看见的只有「连不上」。
//
// 修法是让 GUI 读**活的**凭证持有者（ServeResult.Tokens），而不是拷一份字符串。

func rotatingConfig(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "agent.json")
	if err := os.WriteFile(path, []byte(`{"storage": {"driver": "memory"}}`), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestTheGUIFollowsATokenRotation(t *testing.T) {
	app := startEmbeddedServe(t, rotatingConfig(t))

	before := app.serve.Token()
	if before == "" {
		t.Fatal("no token to rotate")
	}

	// Rotate through the serve's own endpoint, exactly as an operator would.
	body, status, err := app.postJSON("/v1/auth/rotate", map[string]any{})
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("rotate status = %d: %s", status, body)
	}

	if after := app.serve.Token(); after == before {
		t.Fatal("Token() still returns the burned credential; every later request will 401")
	}

	// And the GUI's own calls keep working across the rotation.
	body, status, err = app.postJSON("/v1/sessions", map[string]any{"agent_id": "default"})
	if err != nil {
		t.Fatalf("POST /v1/sessions after rotation: %v", err)
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		t.Errorf("POST /v1/sessions after rotation = %d: %s", status, body)
	}
}

// TestTheTokenIsStillReadableWhenTheServeIsDown: Token() is read by the SSE
// bridges on every reconnect, including while the serve is being restarted.
// Answering with a stale credential there would send the bridge into a retry
// loop against a server that will never accept it.
func TestTheTokenIsStillReadableWhenTheServeIsDown(t *testing.T) {
	app := startEmbeddedServe(t, rotatingConfig(t))
	app.serve.Stop()

	if got := app.serve.Token(); got != "" {
		t.Errorf("Token() = %q after Stop, want empty", got)
	}
}

var _ = context.Background
