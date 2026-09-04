package main

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"legionAgentGUI/internal/chromium"
)

// BundledChromiumPath 返回这次安装自带的浏览器路径；没带就是空。
//
// 界面用它决定要不要提示安装：空**不是错误**，一次不含浏览器的安装照样能跑，
// Agent 会退到系统上装着的浏览器。
func (a *App) BundledChromiumPath() string { return a.chromiumPath() }

// InstallBundledChromium 按当前系统去 GitHub 取对应的安装脚本，校验之后执行它，
// 把那个固定版浏览器装到 App 旁边。
//
// **它执行的是从网上取回来的代码**，所以不在启动时自己跑：由界面在人主动点过之后
// 调用（设置 · 浏览器）。取回来的内容必须与随包发出的摘要逐字相符，否则拒绝执行
// （见 chromium.Install）。
//
// 已经有浏览器时它**拒绝**：重装意味着再下 150MB，而它当下什么问题也不解决。要覆盖
// 装一次是另一件事，走 ReinstallBundledChromium。
func (a *App) InstallBundledChromium() error {
	if path := a.chromiumPath(); path != "" {
		return fmt.Errorf("this install already has a browser at %s", path)
	}
	return a.runChromiumInstall()
}

// ReinstallBundledChromium 覆盖安装：即使已经有一个浏览器，也重新取脚本、重新装。
//
// 单独一个入口而不是给上面那个加 force 参数：调用点在 TypeScript 里，
// InstallBundledChromium(true) 在调用处读不出含义。
//
// 覆盖能力本来就在脚本里（install-chromium.ps1 与 .sh 都先清空目标目录再装），所以
// 这里不自己删任何东西——**也不应该**：先删后装的窗口归脚本一处管，两处都删会让
// 「装到一半失败」的状态更难说清。
//
// 代价由调用方说给用户听：脚本先删后装，下载中断就是**旧的没了、新的没装上**。
// 界面在点这个之前会先确认（见 BrowserPage）。
func (a *App) ReinstallBundledChromium() error {
	return a.runChromiumInstall()
}

// runChromiumInstall 是两个入口共用的执行体：取上下文、逐行发进度、装完发结果。
//
// 脚本的输出（下载进度、装到哪、装完的版本）逐行发到 "chromium:install" 事件，
// 因为整件事要几分钟——没有进度的几分钟，用户会以为它死了。
func (a *App) runChromiumInstall() error {
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	emit := func(line string) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "chromium:install", line)
		}
	}
	if err := chromium.Install(ctx, a.client, emit); err != nil {
		emit("安装失败：" + err.Error())
		return err
	}
	emit("安装完成：" + a.chromiumPath())
	return nil
}
