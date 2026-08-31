package main

import (
	"context"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/stardust/legion-agent/serve"
)

type ServeManager struct {
	cancel context.CancelFunc
	// mu guards port and token, which are written in Start (from any caller's
	// goroutine, including Restart) and read concurrently by Port()/Token()
	// from the SSE bridge goroutine and Wails-bound getters. A Go string is a
	// 2-word (ptr+len) value, so an unsynchronized concurrent read during the
	// write is a torn read (undefined behavior), not merely a stale value.
	mu   sync.RWMutex
	port int
	// tokens is the running serve's LIVE credential holder, not a copy of the
	// string it minted at startup.
	//
	// The copy was wrong the moment credentials became rotatable: an operator
	// burning a leaked token (POST /v1/auth/rotate) would leave the GUI
	// presenting the dead one on every call, and the whole window would answer
	// 401 with nothing on screen to say why. Reading through the holder means
	// the GUI simply keeps working.
	//
	// nil = no serve running (or one that mints no token); Token() then answers
	// "", which is exactly what a caller should send in that state.
	tokens  *serve.Tokens
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

// serveOptions 是这个宿主交给 serve 的那组参数。
//
// 单独一个函数，是因为其中两项**只在装配时生效、错了没有任何症状**：加固开关关掉了
// 就是「界面能看、什么都做不了」之前的那个全开的 serve；内置浏览器路径漏了，浏览器
// 照常起来，只是用的是另一个 Chromium。两者都要能被直接断言。
func serveOptions(configPath string) serve.Options {
	return serve.Options{
		ConfigPath: configPath,
		Addr:       "127.0.0.1:0",
		// Ask for the bearer token explicitly. The serve used to INFER
		// hardening from an empty Addr ("nobody said where to listen, so this
		// must be an embedder") -- and this embedder does say, because it wants
		// a random loopback port. So every shipped GUI ran an agent that asked
		// no caller for anything: any process on the machine could list
		// sessions, read the workspace through /v1/files and run tasks. The
		// token is captured below and attached by the App's HTTP transport and
		// both SSE bridges.
		LoopbackHardening: true,
		// 这次安装自带的 Chromium（没带就是空）。配置文件说不出这个路径：它随安装
		// 位置变，只有跑起来的宿主算得出来。配置里显式指名的浏览器优先，见
		// cli.applyEmbedderBundle。
		BundledChromiumPath: bundledChromiumPath(),
	}
}

func NewServeManager() *ServeManager {
	return &ServeManager{emit: runtime.EventsEmit}
}

// Start launches the legion-agent HTTP service in-process.
// It picks a random port since ServeOptions.Addr is "127.0.0.1:0".
func (m *ServeManager) Start(appCtx context.Context, configPath string) error {
	ctx, cancel := context.WithCancel(context.Background())
	m.cancel = cancel

	result, err := serve.BuildService(ctx, serveOptions(configPath))
	if err != nil {
		cancel()
		// Reset port/token so a downed serve does not report the previous
		// run's stale values while Running() is false. Kept fail-loud: the
		// error still propagates to the caller.
		m.mu.Lock()
		m.port = 0
		m.tokens = nil
		m.mu.Unlock()
		return fmt.Errorf("build serve service: %w", err)
	}

	// Compute from the build result into locals first, then take the write lock
	// only to assign — never hold the lock across the blocking BuildService call.
	port := listenerPort(result.Listener)
	tokens := result.Tokens // live holder: survives a rotation, unlike result.Token
	m.mu.Lock()
	m.port = port
	m.tokens = tokens
	m.mu.Unlock()
	done := make(chan struct{})
	m.done = done
	m.running.Store(true)

	m.emit(appCtx, "serve:status", map[string]any{
		"running": true,
		"port":    port,
	})

	go func() {
		defer close(done)
		defer result.Close()
		if err := result.Service.Start(ctx); err != nil {
			m.emit(appCtx, "serve:error", map[string]any{"error": err.Error()})
		}
		m.running.Store(false)
		// Drop the credential with the serve that issued it: a token read after
		// the service is gone can only be presented to a server that no longer
		// exists, and the bridges read Token() on every reconnect attempt.
		m.mu.Lock()
		m.tokens = nil
		m.port = 0
		m.mu.Unlock()
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

// Stop cancels the embedded service.
//
// It drops the credential and port SYNCHRONOUSLY rather than leaving that to
// the service goroutine's own teardown: Stop returning means "this manager is
// no longer serving", and a Token() read in the window between the cancel and
// the goroutine noticing it would hand a caller a credential for a server that
// is on its way out. The goroutine clears them again on the way out, which is
// harmless — both writes say the same thing.
func (m *ServeManager) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
	m.mu.Lock()
	m.tokens = nil
	m.port = 0
	m.mu.Unlock()
}

func (m *ServeManager) Port() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.port
}

// Token returns the bearer token the embedded serve accepts RIGHT NOW, or ""
// when there is none (hardening off, or no serve running).
//
// It reads through the live holder rather than returning a captured string, so
// a rotation on the serve side is invisible to callers — which is the point:
// every call site reads this per request precisely so it never presents a
// credential that has since been burned.
func (m *ServeManager) Token() string {
	m.mu.RLock()
	tokens := m.tokens
	m.mu.RUnlock()
	return tokens.Current()
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
