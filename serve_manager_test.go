package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
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

// TestServeManagerConcurrentTokenPortNoRace exercises Port()/Token() readers
// concurrently with Start/Restart writers under -race, pinning that the
// port/token fields are mutex-guarded. Before the guard, a reader observing the
// 2-word string token mid-write was a torn read (undefined behavior); this test
// fails under `go test -race` if the synchronization regresses.
func TestServeManagerConcurrentTokenPortNoRace(t *testing.T) {
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

	var wg sync.WaitGroup
	done := make(chan struct{})

	// Readers hammer Port()/Token() while a writer restarts the service.
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-done:
					return
				default:
					_ = m.Port()
					_ = m.Token()
				}
			}
		}()
	}

	for i := 0; i < 5; i++ {
		if err := m.Restart(context.Background(), configPath); err != nil {
			close(done)
			wg.Wait()
			t.Fatalf("Restart #%d: %v", i, err)
		}
	}

	close(done)
	wg.Wait()
}
