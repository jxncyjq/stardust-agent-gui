package main

import (
	"os"
	"path/filepath"
	"testing"

	"legionAgentGUI/internal/chromium"
)

// TestTheServeOptionsCarryTheBundledBrowser 守的是**那一跳**：算得对，还得真的交出去。
//
// 这个仓已经栽过一次同形的：加固开关在服务端做好了，宿主没说要，于是每个出货的 GUI
// 都跑着一个谁都能连的 serve。少接一个字段不会报错——浏览器照常起来，用的是另一个。
func TestTheServeOptionsCarryTheBundledBrowser(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	candidate := filepath.Clean(filepath.Join(filepath.Dir(exe), chromium.RelativePaths()[0]))
	if err := os.MkdirAll(filepath.Dir(candidate), 0o755); err != nil {
		t.Fatalf("mkdir for the stand-in browser: %v", err)
	}
	if err := os.WriteFile(candidate, []byte("x"), 0o755); err != nil {
		t.Fatalf("write the stand-in browser: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(candidate) })

	opts := serveOptions("agent.json")
	if opts.BundledChromiumPath != candidate {
		t.Errorf("serve.Options.BundledChromiumPath = %q, want %q: "+
			"the path is computed and then dropped on the floor", opts.BundledChromiumPath, candidate)
	}
	// 同一组参数里的另一项，同样是「错了没症状」的那类：加固一旦丢掉，出货的 GUI
	// 就跑着一个谁都能连的 serve。
	if !opts.LoopbackHardening {
		t.Error("serve.Options.LoopbackHardening = false: the shipped GUI would run an unauthenticated serve")
	}
}
