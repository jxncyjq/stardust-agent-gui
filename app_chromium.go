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
func (a *App) BundledChromiumPath() string { return chromium.Path() }

// InstallBundledChromium 按当前系统去 GitHub 取对应的安装脚本，校验之后执行它，
// 把那个固定版浏览器装到 App 旁边。
//
// **它执行的是从网上取回来的代码**，所以不在启动时自己跑：由界面在问过人之后调用。
// 取回来的内容必须与随包发出的摘要逐字相符，否则拒绝执行（见 chromium.Install）。
//
// 脚本的输出（下载进度、装到哪、装完的版本）逐行发到 "chromium:install" 事件，
// 因为整件事要几分钟——没有进度的几分钟，用户会以为它死了。
func (a *App) InstallBundledChromium() error {
	if path := chromium.Path(); path != "" {
		// 已经有了就不重装：重装意味着再下 150MB，而它当下什么问题也不解决。
		return fmt.Errorf("this install already has a browser at %s", path)
	}
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
	emit("安装完成：" + chromium.Path())
	return nil
}
