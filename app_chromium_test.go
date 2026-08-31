package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"legionAgentGUI/internal/chromium"
)

// TestInstallRefusesWhenABrowserIsAlreadyThere：已经有浏览器时不重装——重装意味着
// 再下 150MB，而它当下什么问题也不解决。
//
// 这条同时钉住 BundledChromiumPath 与 InstallBundledChromium 用的是**同一个**判断：
// 界面按前者决定要不要提示，后者按同一个事实决定要不要干活；两者若各判各的，就会
// 出现「界面说要装，装的时候说已经有了」。
//
// 测试造出「已经有了」这一侧，因为另一侧会真的联网取脚本并执行安装——第一版正是
// 那么写的：在这台没有内置浏览器的机器上，它会去 GitHub 取脚本、跑起来下 150MB。
// 测试不该做这种事。
func TestInstallRefusesWhenABrowserIsAlreadyThere(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	candidate := filepath.Clean(filepath.Join(filepath.Dir(exe), chromium.RelativePaths()[0]))
	if err := os.MkdirAll(filepath.Dir(candidate), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(candidate, []byte("x"), 0o755); err != nil {
		t.Fatalf("write the stand-in browser: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(candidate) })

	app := &App{}
	if got := app.BundledChromiumPath(); got != candidate {
		t.Fatalf("BundledChromiumPath() = %q，want %q", got, candidate)
	}
	err = app.InstallBundledChromium()
	if err == nil {
		t.Fatal("已经有浏览器了却仍然要装：那是再下一次 150MB")
	}
	if !strings.Contains(err.Error(), "already has a browser") {
		t.Errorf("拒绝的理由不对：%v", err)
	}
}
