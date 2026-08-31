package chromium

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

	rel := RelativePaths()[0]
	candidate := filepath.Clean(filepath.Join(dir, rel))
	if err := os.MkdirAll(filepath.Dir(candidate), 0o755); err != nil {
		t.Fatalf("mkdir for the stand-in browser: %v", err)
	}
	if err := os.WriteFile(candidate, []byte("not a real browser, but a real file"), 0o755); err != nil {
		t.Fatalf("write the stand-in browser: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(candidate) })

	if got := Path(); got != candidate {
		t.Errorf("Path() = %q, want %q:\n"+
			"a Chromium shipped inside the app is invisible, so the agent silently uses another one",
			got, candidate)
	}
}

// TestNoBundledBrowserIsANormalShape：一次不含浏览器的安装（体积敏感的分发、开发时
// 直接 wails dev）照样要能跑，退到系统探测。空是答案，不是错误。
func TestNoBundledBrowserIsANormalShape(t *testing.T) {
	if got := Path(); got != "" {
		t.Errorf("Path() = %q with nothing bundled, want empty", got)
	}
}

// TestTheBundledPathIsPlatformShaped：三个平台的包结构不同，而这正是这件事只能由
// 宿主回答的原因。这条守住「候选路径没有被写成某一个平台的形状」。
func TestTheBundledPathIsPlatformShaped(t *testing.T) {
	t.Parallel()

	paths := RelativePaths()
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
	candidate := filepath.Clean(filepath.Join(filepath.Dir(exe), RelativePaths()[0]))
	if err := os.MkdirAll(candidate, 0o755); err != nil {
		t.Fatalf("mkdir the impostor: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(candidate) })

	if got := Path(); got != "" {
		t.Errorf("Path() = %q, want empty: that path is a directory", got)
	}
}
