package main

import (
	"context"
	"fmt"
	"net"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/stardust/legion-agent/serve"
)

type ServeManager struct {
	cancel  context.CancelFunc
	port    int
	running atomic.Bool
	// done is closed when the running service goroutine exits (after its final
	// serve:status emit), so Restart can wait for a full teardown before
	// starting again — preventing the old goroutine's trailing "running:false"
	// event from arriving after the new instance's "running:true".
	done chan struct{}
	// emit sends frontend events. It defaults to runtime.EventsEmit; tests
	// override it to bypass the Wails runtime (which requires a Wails context).
	emit func(ctx context.Context, event string, data ...any)
}

func NewServeManager() *ServeManager {
	return &ServeManager{emit: runtime.EventsEmit}
}

// Start launches the legion-agent HTTP service in-process.
// It picks a random port since ServeOptions.Addr is "127.0.0.1:0".
func (m *ServeManager) Start(appCtx context.Context, configPath string) error {
	ctx, cancel := context.WithCancel(context.Background())
	m.cancel = cancel

	result, err := serve.BuildService(ctx, serve.Options{
		ConfigPath: configPath,
		Addr:       "127.0.0.1:0",
	})
	if err != nil {
		cancel()
		return fmt.Errorf("build serve service: %w", err)
	}

	m.port = listenerPort(result.Listener)
	done := make(chan struct{})
	m.done = done
	m.running.Store(true)

	m.emit(appCtx, "serve:status", map[string]any{
		"running": true,
		"port":    m.port,
	})

	go func() {
		defer close(done)
		defer result.Close()
		if err := result.Service.Start(ctx); err != nil {
			m.emit(appCtx, "serve:error", map[string]any{"error": err.Error()})
		}
		m.running.Store(false)
		m.emit(appCtx, "serve:status", map[string]any{
			"running": false,
			"port":    0,
		})
	}()

	return nil
}

// Running reports whether the embedded HTTP service is currently serving.
func (m *ServeManager) Running() bool {
	return m.running.Load()
}

func (m *ServeManager) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
}

func (m *ServeManager) Port() int {
	return m.port
}

// Restart stops the running embedded service, waits for it to fully stop
// (including its trailing serve:status emit), then starts it again against
// configPath (which may point at freshly-written config). It reuses the
// serve:status event so the frontend reconnects to the new random port. A
// stop that does not complete within the timeout is reported as an error
// rather than racing a second Start against a still-running service.
func (m *ServeManager) Restart(appCtx context.Context, configPath string) error {
	// Capture the current instance's completion channel before stopping, so we
	// wait for THIS goroutine (and its trailing serve:status emit) to finish
	// before starting the replacement — otherwise a late "running:false" could
	// clobber the new instance's "running:true" in the frontend.
	prev := m.done
	m.Stop()
	if prev != nil {
		select {
		case <-prev:
		case <-time.After(5 * time.Second):
			return fmt.Errorf("serve did not stop within 5s; refusing to restart")
		}
	}
	if err := m.Start(appCtx, configPath); err != nil {
		return fmt.Errorf("restart serve with config %q: %w", configPath, err)
	}
	return nil
}

func listenerPort(l net.Listener) int {
	if l == nil {
		return 0
	}
	addr, ok := l.Addr().(*net.TCPAddr)
	if !ok {
		return 0
	}
	return addr.Port
}
