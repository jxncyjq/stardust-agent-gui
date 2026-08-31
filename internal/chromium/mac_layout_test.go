package chromium

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// TestTheMacCandidateMatchesWhatTheScriptInstalls 用**脚本实际造出来的形状**问一次
// 查找逻辑：.app/Contents/MacOS 里的可执行文件，浏览器在 .app/Contents/Resources/
// chromium/ 下。CI 上安装成功、运行时却说没有，差别只可能在这两者的路径拼法上。
func TestTheMacCandidateMatchesWhatTheScriptInstalls(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("这条描述的是 macOS 的包结构")
	}
	root := t.TempDir()
	macos := filepath.Join(root, "App.app", "Contents", "MacOS")
	if err := os.MkdirAll(macos, 0o755); err != nil {
		t.Fatal(err)
	}
	installed := filepath.Join(root, "App.app", "Contents", "Resources", "chromium",
		"Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")
	if err := os.MkdirAll(filepath.Dir(installed), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(installed, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	candidate := filepath.Clean(filepath.Join(macos, RelativePaths()[0]))
	if candidate != installed {
		t.Errorf("查找位置 %q 与脚本装的位置 %q 不一致", candidate, installed)
	}
}
