package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"legionAgentGUI/internal/chromium"
)

// 这两条一起钉的是「加了新入口，旧保护还在」：InstallBundledChromium 对已装直接拒绝
// （防的是误触发一次 150MB 下载），ReinstallBundledChromium 不做那道检查。
//
// 两条都不真的装：断言落在**那道前置检查**上。注入 chromiumPath 是必须的——真实的
// chromium.Path() 在 go test 下恒为空，用它写前提等于让这两条永远 skip。
func TestInstallBundledChromiumRefusesWhenOneIsPresent(t *testing.T) {
	app := NewApp("")
	app.chromiumPath = func() string { return "/opt/app/chrome" }

	err := app.InstallBundledChromium()
	if err == nil {
		t.Fatal("已经有浏览器时必须拒绝：重装意味着再下 150MB，而它当下什么问题也不解决")
	}
	if !strings.Contains(err.Error(), "already has a browser") {
		t.Errorf("拒绝的理由变了，界面按这句话判断要不要显示重装入口：%v", err)
	}
	if !strings.Contains(err.Error(), "/opt/app/chrome") {
		t.Errorf("错误里没说是哪一个，排查者无从确认它找到的是哪个浏览器：%v", err)
	}
}

// ReinstallBundledChromium 必须**绕过**那道检查。它不走到真安装：这里注入一个非空
// 路径，只要错误不是「已经有了」，就说明检查放行了。
func TestReinstallBundledChromiumSkipsThePresenceCheck(t *testing.T) {
	app := NewApp("")
	app.chromiumPath = func() string { return "/opt/app/chrome" }

	err := app.ReinstallBundledChromium()
	if err != nil && strings.Contains(err.Error(), "already has a browser") {
		t.Fatal("ReinstallBundledChromium 走了 InstallBundledChromium 的前置检查：重装入口的全部意义就是绕过它")
	}
}

// 没有浏览器时 InstallBundledChromium 也必须放行——否则「装一次」这条主路径就没了。
func TestInstallBundledChromiumProceedsWhenNoneIsPresent(t *testing.T) {
	app := NewApp("")
	app.chromiumPath = func() string { return "" }

	err := app.InstallBundledChromium()
	if err != nil && strings.Contains(err.Error(), "already has a browser") {
		t.Fatalf("没有浏览器却按「已经有了」拒绝：%v", err)
	}
}

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

	app := NewApp("")
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
