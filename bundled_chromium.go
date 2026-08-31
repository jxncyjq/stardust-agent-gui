package main

import (
	"os"
	"path/filepath"
	"runtime"
)

// bundledChromiumRelativePaths 是「随 App 一起装的那个 Chromium」相对可执行文件的
// 位置，按平台。
//
// 三个平台的包结构不同，而这就是为什么这件事只能由**宿主**回答：配置文件说不出
// 自己的绝对路径（.app 拖到哪里都行，Windows 的安装目录也由安装器决定），只有跑
// 起来的进程算得出来。
//
//   - macOS：可执行文件在 Contents/MacOS/，资源在 Contents/Resources/。
//   - Windows/Linux：与可执行文件同级的 chromium/ 目录。
//
// 每个平台给的是一串候选而不是一个：打包脚本可能把浏览器放在 Chromium.app 里，也
// 可能是裸的可执行文件，先找到哪个算哪个。
func bundledChromiumRelativePaths() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{
			"../Resources/chromium/Chromium.app/Contents/MacOS/Chromium",
			"../Resources/chromium/chrome",
		}
	case "windows":
		return []string{`chromium\chrome.exe`}
	default:
		return []string{"chromium/chrome"}
	}
}

// bundledChromiumPath 返回这次安装自带的 Chromium 的绝对路径；没带就返回空。
//
// **空是一种正常形态**，不是错误：一次不含浏览器的安装（体积敏感的分发、开发时
// 直接 `wails dev`）照样能跑，只是退到系统探测。所以这里既不报错也不记警告——
// 一条每次启动都出现的告警等于没有告警。真正会 fail-loud 的是后面：配置显式指名
// 了一个不存在的浏览器时，启动阶段会响亮地报出来。
//
// 它只返回**确实存在**的路径。返回一个不存在的路径会让内置这一级悄悄接管：
// resolveChromiumBin 对 BundledPath 做存在性检查，但把「找不到」和「没带」混在
// 一起，会让下一个人以为这台机器上装的浏览器坏了。
func bundledChromiumPath() string {
	exe, err := os.Executable()
	if err != nil {
		// 拿不到自己的路径就无从算起。这不是能兜的事，也不该让 App 起不来：
		// 退到系统探测，与「没带浏览器」是同一种形态。
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	dir := filepath.Dir(exe)
	for _, rel := range bundledChromiumRelativePaths() {
		candidate := filepath.Clean(filepath.Join(dir, rel))
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}
