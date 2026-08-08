package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestServeManagerExposesToken pins that ServeManager captures the one-time
// bearer token the embedded loopback serve mints (Phase 4B hardening) and
// exposes it via Token(), so the GUI's SSE bridge and HTTP calls can attach
// Authorization: Bearer against the hardened serve. The config forces
// loopback_hardening=true so BuildService mints a token regardless of the bind
// address; the emit hook is stubbed so Start does not touch the Wails runtime
// (which requires a Wails-managed context).
func TestServeManagerExposesToken(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agent.json")
	body := `{
		"storage": {"driver": "memory"},
		"server": {"loopback_hardening": true}
	}`
	if err := os.WriteFile(configPath, []byte(body), 0o600); err != nil {
		t.Fatalf("WriteFile(%q) error = %v, want nil", configPath, err)
	}

	m := NewServeManager()
	m.emit = func(context.Context, string, ...any) {} // bypass Wails runtime
	if err := m.Start(context.Background(), configPath); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer m.Stop()

	if m.Token() == "" {
		t.Fatal("expected non-empty Token after Start (loopback hardening mints one)")
	}
	if len(m.Token()) < 32 {
		t.Fatalf("token too short: %q", m.Token())
	}
}
