// Command wherechromium 打印这次安装自带的 Chromium 的路径，没带就打印空行。
//
// 它存在只为一件事：让**安装脚本的落点**与**运行时的查找位置**在 CI 上被端到端地
// 对上。两边各写各的路径，是那种「装了也白装」的错——运行时找不到就静悄悄退到系统
// 浏览器，没有任何症状，直到有人问「为什么内置的那个版本没生效」。
//
// 它是从 GUI 的可执行文件位置算的，所以 CI 必须把它放在与 App 同一个目录里跑。
package main

import (
	"fmt"
	"os"

	"legionAgentGUI/internal/chromium"
)

func main() {
	path := chromium.Path()
	fmt.Println(path)
	if path == "" {
		os.Exit(1)
	}
}
