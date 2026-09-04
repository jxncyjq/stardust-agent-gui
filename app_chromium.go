package main

import "fmt"

// installFinishedPrefix 与 installFailedPrefix 是 runChromiumInstall 收尾时**自己发出**
// 的那两行的前缀，也是 Go 与前端之间**唯一的**终态信号：前端按它们判定「装完了没有」
// （frontend/src/hooks/useChromiumInstall.ts 里有各自对应的同名常量）。
//
// 两边各写一份字面量，中间没有共享定义——改这里就必须一并改那边，否则两边测试都绿而
// 真机上装完之后界面永远停在「安装中…」、按钮永久禁用。
// TestTheInstallMarkersTheFrontendMatchesOnDoNotDrift 把这两个值逐字钉住，就是为了让
// 「改了这里」必然先撞上这句话。
//
// 不导出：package main 没有别的包 import 得到它，导出只会让人以为它是对外契约。
const (
	installFinishedPrefix = "安装完成："
	installFailedPrefix   = "安装失败："
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

// runChromiumInstall 是两个入口共用的执行体：先确认这次安装有人看得到、挡住并发的
// 第二次，再边跑边把脚本的输出发出去，最后发结果。
//
// 脚本的输出（下载进度、装到哪、装完的版本）在它**还在跑的时候**就逐行发到
// "chromium:install" 事件（见 chromium.runInstallScript），因为整件事要几分钟——没有
// 进度的几分钟，用户会以为它死了。
func (a *App) runChromiumInstall() error {
	// 没有地方能收到输出，就不装：这个入口只可能被界面调用，emitInstall 由 startup
	// 填，它是 nil 就说明调用来自别处。照装的后果是一次**没有任何人能观察到过程与
	// 结果**的 150MB 下载，而函数还会正常返回。
	emit := a.emitInstall
	if emit == nil {
		return fmt.Errorf("the window is not up yet, so nobody could see this install's output or its result;" +
			" refusing to download a browser nobody can watch")
	}
	// 前端那个禁用的按钮不算护栏：界面一重载（wails dev 热重载 / Ctrl+R）store 就回到
	// 初始态，而这边那次安装还在跑。两次并发对同一个目录先删后解压，结果是谁也说不清
	// 的半个浏览器。
	if !a.installing.CompareAndSwap(false, true) {
		return fmt.Errorf("a chromium install is already running; wait for it to finish before starting another")
	}
	defer a.installing.Store(false)

	if err := a.installChromium(a.ctx, a.client, emit); err != nil {
		emit(installFailedPrefix + err.Error())
		return err
	}
	// 不采信脚本说的「装到了 X」，回头问查找逻辑自己看不看得见（前端收到这一行之后
	// 还会再问一次，理由相同）。
	emit(installFinishedPrefix + a.chromiumPath())
	return nil
}
