package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestServeManagerRestart starts the embedded service, restarts it, and asserts
// it is running again on a (new) port. Gated behind LEGION_E2E=1 because it
// builds a real service. The emit func is overridden to a no-op so Start does
// not call the Wails runtime (which needs a Wails-managed context).
func TestServeManagerRestart(t *testing.T) {
	if os.Getenv("LEGION_E2E") != "1" {
		t.Skip("set LEGION_E2E=1 to run")
	}
	cfg := resolveConfigPath()
	if cfg == "" {
		t.Fatal("no config resolved")
	}
	abs, _ := filepath.Abs(cfg)
	if err := os.Chdir(filepath.Dir(abs)); err != nil {
		t.Fatal(err)
	}

	m := NewServeManager()
	m.emit = func(context.Context, string, ...any) {} // bypass Wails runtime
	ctx := context.Background()

	if err := m.Start(ctx, abs); err != nil {
		t.Fatalf("start: %v", err)
	}
	if !m.Running() {
		t.Fatal("not running after Start")
	}
	if err := m.Restart(ctx, abs); err != nil {
		t.Fatalf("restart: %v", err)
	}
	if !m.Running() {
		t.Fatal("not running after Restart")
	}
	t.Logf("restart ok, port=%d", m.Port())
	m.Stop()
}
