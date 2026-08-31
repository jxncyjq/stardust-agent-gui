package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// 「内置 Chromium」这一级此前是**死的**：server 那边 resolveChromiumBin 认得它，
// 但从来没有人填过那个字段，而 GUI 这边根本没有算过路径。打包时把浏览器放进 App
// 里也没用——运行时看不见它，照旧退到系统探测或 go-rod 下载。
//
// 这一组钉住宿主这一半：路径按平台从**可执行文件的位置**算出来，并且只在文件确实
// 存在时才给。

func TestTheBundledBrowserIsFoundNextToTheExecutable(t *testing.T) {
	// 把候选路径造在真实可执行文件旁边：这条测试问的是「算得对不对」，而
	// os.Executable() 在测试里指向 go test 编出来的那个二进制。
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	dir := filepath.Dir(exe)

	rel := bundledChromiumRelativePaths()[0]
	candidate := filepath.Clean(filepath.Join(dir, rel))
	if err := os.MkdirAll(filepath.Dir(candidate), 0o755); err != nil {
		t.Fatalf("mkdir for the stand-in browser: %v", err)
	}
	if err := os.WriteFile(candidate, []byte("not a real browser, but a real file"), 0o755); err != nil {
		t.Fatalf("write the stand-in browser: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(candidate) })

	if got := bundledChromiumPath(); got != candidate {
		t.Errorf("bundledChromiumPath() = %q, want %q:\n"+
			"a Chromium shipped inside the app is invisible, so the agent silently uses another one",
			got, candidate)
	}
}

// TestNoBundledBrowserIsANormalShape：一次不含浏览器的安装（体积敏感的分发、开发时
// 直接 wails dev）照样要能跑，退到系统探测。空是答案，不是错误。
func TestNoBundledBrowserIsANormalShape(t *testing.T) {
	if got := bundledChromiumPath(); got != "" {
		t.Errorf("bundledChromiumPath() = %q with nothing bundled, want empty", got)
	}
}

// TestTheBundledPathIsPlatformShaped：三个平台的包结构不同，而这正是这件事只能由
// 宿主回答的原因。这条守住「候选路径没有被写成某一个平台的形状」。
func TestTheBundledPathIsPlatformShaped(t *testing.T) {
	t.Parallel()

	paths := bundledChromiumRelativePaths()
	if len(paths) == 0 {
		t.Fatal("no candidate paths on this platform: the bundled tier can never be reached here")
	}
	switch runtime.GOOS {
	case "darwin":
		// .app 里可执行文件在 Contents/MacOS/，资源在 Contents/Resources/——
		// 与可执行文件同级找是 Windows 的形状，在这里永远找不到。
		if !strings.HasPrefix(paths[0], "../Resources/") {
			t.Errorf("macOS candidate %q does not look inside Contents/Resources", paths[0])
		}
	case "windows":
		if !strings.HasSuffix(paths[0], ".exe") {
			t.Errorf("Windows candidate %q is not an .exe", paths[0])
		}
	}
}

// TestADirectoryIsNotABrowser：候选路径撞上一个同名目录时不能当成找到了——那会让
// 内置这一级接管，然后在启动浏览器时才以一个莫名其妙的错误倒下。
func TestADirectoryIsNotABrowser(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	candidate := filepath.Clean(filepath.Join(filepath.Dir(exe), bundledChromiumRelativePaths()[0]))
	if err := os.MkdirAll(candidate, 0o755); err != nil {
		t.Fatalf("mkdir the impostor: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(candidate) })

	if got := bundledChromiumPath(); got != "" {
		t.Errorf("bundledChromiumPath() = %q, want empty: that path is a directory", got)
	}
}

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
	candidate := filepath.Clean(filepath.Join(filepath.Dir(exe), bundledChromiumRelativePaths()[0]))
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
