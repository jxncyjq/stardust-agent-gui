package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stardust/legion-agent/serve"
)

// TestPoolBurst simulates the several concurrent pollers the GUI runs and proves
// the shared pooled client reuses connections instead of exhausting Windows
// ephemeral ports. Gated behind LEGION_E2E=1 (starts a real service).
func TestPoolBurst(t *testing.T) {
	if os.Getenv("LEGION_E2E") != "1" {
		t.Skip("set LEGION_E2E=1 to run")
	}
	cfg := resolveConfigPath()
	abs, _ := filepath.Abs(cfg)
	_ = os.Chdir(filepath.Dir(abs))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	res, err := serve.BuildService(ctx, serve.Options{ConfigPath: filepath.Base(abs), Addr: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	defer res.Close()
	go func() { _ = res.Service.Start(ctx) }()
	port := res.Listener.Addr().(*net.TCPAddr).Port
	base := fmt.Sprintf("http://127.0.0.1:%d/healthz", port)

	app := NewApp("") // builds the pooled client under test

	const workers, perWorker = 8, 400 // 3200 requests across 8 concurrent pollers
	var failures int64
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < perWorker; i++ {
				resp, err := app.client.Get(base)
				if err != nil {
					atomic.AddInt64(&failures, 1)
					continue
				}
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
		}()
	}
	wg.Wait()
	t.Logf("3200 concurrent requests done, failures=%d", failures)
	if failures > 0 {
		t.Fatalf("had %d failures (port exhaustion / bind errors not fixed)", failures)
	}
}
