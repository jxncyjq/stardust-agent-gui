package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"legionAgentGUI/internal/chromium"
)

// 这两条一起钉的是「加了新入口，旧保护还在」：InstallBundledChromium 对已装直接拒绝
// （防的是误触发一次 150MB 下载），ReinstallBundledChromium 不做那道检查。
//
// 两条都不真的装：断言落在**那道前置检查**上。注入 chromiumPath 是必须的——真实的
// chromium.Path() 在 go test 下默认为空（它按 os.Executable() 的同级目录找，而测试
// 二进制在临时目录里），用它写前提等于让这两条永远 skip。
//
// chromiumTestApp 把「不碰网络的 App」与它这次留下的痕迹放在一起：走没走到安装
// （installs）、往界面发了哪些行（lines）。两者都是断言的着力点——「有没有走到安装」
// 比「安装返回了什么」更接近这些用例真正要钉的东西，而「发了哪些行」是 Go 与前端之间
// 那两个前缀唯一能被测到的地方。
type chromiumTestApp struct {
	*App
	mu       sync.Mutex
	installs int
	lines    []string
}

// installCount 是这次走到安装的次数。
func (c *chromiumTestApp) installCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.installs
}

// emitted 是这次发到 "chromium:install" 的全部行。
func (c *chromiumTestApp) emitted() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.lines...)
}

func newChromiumTestApp(t *testing.T, path string) *chromiumTestApp {
	t.Helper()
	c := &chromiumTestApp{App: NewApp("")}
	// 生产里 startup 同时填 ctx 与 emitInstall；这里照着填，只是把「发到界面」换成
	// 记录下来。给一个真 ctx 是因为它会被原样传给 installChromium。
	c.ctx = context.Background()
	c.chromiumPath = func() string { return path }
	c.installChromium = func(context.Context, *http.Client, func(string)) error {
		c.mu.Lock()
		c.installs++
		c.mu.Unlock()
		return nil
	}
	c.emitInstall = func(line string) {
		c.mu.Lock()
		c.lines = append(c.lines, line)
		c.mu.Unlock()
	}
	return c
}

func TestInstallBundledChromiumRefusesWhenOneIsPresent(t *testing.T) {
	app := newChromiumTestApp(t, "/opt/app/chrome")

	err := app.InstallBundledChromium()
	if err == nil {
		t.Fatal("已经有浏览器时必须拒绝：重装意味着再下 150MB，而它当下什么问题也不解决")
	}
	if app.installCount() != 0 {
		t.Errorf("拒绝之后仍然走到了安装：%d 次", app.installCount())
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
	app := newChromiumTestApp(t, "/opt/app/chrome")

	if err := app.ReinstallBundledChromium(); err != nil {
		t.Fatalf("重装入口不该因为「已经有了」而失败：%v", err)
	}
	if app.installCount() != 1 {
		t.Errorf("重装入口没有走到安装（%d 次）：它的全部意义就是绕过那道前置检查", app.installCount())
	}
}

// 没有浏览器时 InstallBundledChromium 也必须放行——否则「装一次」这条主路径就没了。
func TestInstallBundledChromiumProceedsWhenNoneIsPresent(t *testing.T) {
	app := newChromiumTestApp(t, "")

	if err := app.InstallBundledChromium(); err != nil {
		t.Fatalf("没有浏览器时安装必须放行：%v", err)
	}
	if app.installCount() != 1 {
		t.Errorf("没有浏览器却没走到安装（%d 次）：这条主路径没了", app.installCount())
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

// installFinishedPrefix / installFailedPrefix 是 Go 与前端之间**唯一的**终态信号：
// 前端按前缀认「装完了没有」（frontend/src/hooks/useChromiumInstall.ts），两边各写
// 一份字面量，中间没有共享定义。这两条测试就是那条缝上唯一的钉子。
//
// 它们分成两截断言，缺一不可：
//   - 前缀的**字面值**必须逐字不变。把全角冒号改成半角、或改成英文，Go 与前端两边的
//     测试都照样绿（前端喂的是它自己那份字面量），而真机上安装成功后界面永远停在
//     「安装中…」、按钮永久禁用。所以这里把字节写死，改它就必须来这里，也就必然读到
//     「一并改前端那份」这句话。
//   - emit 路径必须**真的被执行到**。注入的安装桩返回 nil、发出去的行被记录下来，
//     于是那两行 emit 第一次有了执行它们的测试。
func TestTheInstallMarkersTheFrontendMatchesOnDoNotDrift(t *testing.T) {
	if installFinishedPrefix != "安装完成：" {
		t.Errorf("完成前缀变成了 %q：改它就要一并改 frontend/src/hooks/useChromiumInstall.ts "+
			"里的 installFinishedPrefix，否则装完之后界面永远停在「安装中…」", installFinishedPrefix)
	}
	if installFailedPrefix != "安装失败：" {
		t.Errorf("失败前缀变成了 %q：改它就要一并改 frontend/src/hooks/useChromiumInstall.ts "+
			"里的 installFailedPrefix，否则失败之后界面永远停在「安装中…」", installFailedPrefix)
	}
}

func TestASuccessfulInstallEndsWithTheFinishedMarker(t *testing.T) {
	app := newChromiumTestApp(t, "")
	// 装完之后 chromiumPath 才看得到它——完成行里带的就是这个值。
	app.chromiumPath = func() string { return "/opt/app/chrome" }

	if err := app.ReinstallBundledChromium(); err != nil {
		t.Fatalf("桩安装返回 nil，入口却报错：%v", err)
	}
	lines := app.emitted()
	if len(lines) == 0 {
		t.Fatal("一行都没发到界面：前端只认这条通路，它不发就等于装完了没人知道")
	}
	last := lines[len(lines)-1]
	if !strings.HasPrefix(last, installFinishedPrefix) {
		t.Fatalf("最后一行是 %q，前端认的前缀是 %q", last, installFinishedPrefix)
	}
	if got := strings.TrimPrefix(last, installFinishedPrefix); got != "/opt/app/chrome" {
		t.Errorf("完成行里的路径是 %q，want %q", got, "/opt/app/chrome")
	}
}

func TestAFailedInstallEndsWithTheFailedMarker(t *testing.T) {
	app := newChromiumTestApp(t, "")
	boom := errors.New("run the install script: exit status 1")
	app.installChromium = func(context.Context, *http.Client, func(string)) error { return boom }

	err := app.ReinstallBundledChromium()
	if !errors.Is(err, boom) {
		t.Fatalf("安装失败没有原样往上报：%v", err)
	}
	lines := app.emitted()
	if len(lines) == 0 {
		t.Fatal("失败了一行都没发到界面：绑定 reject 之外那条通路断了")
	}
	last := lines[len(lines)-1]
	if !strings.HasPrefix(last, installFailedPrefix) {
		t.Fatalf("最后一行是 %q，前端认的前缀是 %q", last, installFailedPrefix)
	}
	if !strings.Contains(last, boom.Error()) {
		t.Errorf("失败行里没带原因，用户看到的就是一句「安装失败」：%q", last)
	}
}

// M-3：没有地方能收到输出时，**不装**。
//
// 这个入口只可能被界面调用，emitInstall 由 startup 填——它是 nil 就说明调用来自别处。
// 照装的后果是一次没有任何人能观察到过程与结果的 150MB 下载，函数还正常返回。
func TestAnInstallNobodyCanWatchIsRefused(t *testing.T) {
	app := newChromiumTestApp(t, "")
	app.emitInstall = nil

	err := app.InstallBundledChromium()
	if err == nil {
		t.Fatal("没人收得到输出却照装：那是一次没人看得见过程与结果的 150MB 下载")
	}
	if app.installCount() != 0 {
		t.Errorf("拒绝之后仍然走到了安装：%d 次", app.installCount())
	}
	if !strings.Contains(err.Error(), "nobody") {
		t.Errorf("错误没说清是「没人看得到」而不是别的失败：%v", err)
	}
}

// M-4：同一时刻只许有一次安装。
//
// 前端那个禁用的按钮不算护栏——它是 store 里的状态，界面一重载（wails dev 热重载 /
// Ctrl+R）就回到初始态，而这边那次安装还在跑；此刻首屏探测很可能什么也看不到（脚本
// 已经把旧目录删了、新的还没落地），于是界面显示「没有浏览器」，用户再点一次安装。
// 两次并发对同一个目录先删后解压，留下的是谁也说不清的半个浏览器。
//
// 断言的是「第二次被挡住」而不是「第二次晚一点跑」：拒绝要立刻返回，并说清是为什么。
func TestASecondInstallIsRefusedWhileOneIsRunning(t *testing.T) {
	app := newChromiumTestApp(t, "")
	started := make(chan struct{})
	release := make(chan struct{})
	app.installChromium = func(context.Context, *http.Client, func(string)) error {
		app.mu.Lock()
		app.installs++
		nth := app.installs
		app.mu.Unlock()
		// 只有第一次挂住：末尾那次「闸门放开了没有」不该再被拦在这里。
		if nth == 1 {
			close(started)
			<-release
		}
		return nil
	}

	first := make(chan error, 1)
	go func() { first <- app.ReinstallBundledChromium() }()
	<-started

	err := app.InstallBundledChromium()
	if err == nil {
		t.Fatal("第一次还在跑，第二次却放行了：两次并发对同一目录先删后解压")
	}
	if !strings.Contains(err.Error(), "already running") {
		t.Errorf("拒绝的理由没说清是「已经有一次在跑」：%v", err)
	}
	if got := app.installCount(); got != 1 {
		t.Errorf("走到安装 %d 次，want 1", got)
	}

	close(release)
	if err := <-first; err != nil {
		t.Fatalf("第一次安装反而失败了：%v", err)
	}
	// 第一次结束之后闸门要放开，否则「重试」这条路会被自己上一次锁死。
	if err := app.ReinstallBundledChromium(); err != nil {
		t.Fatalf("上一次已经结束，闸门却没放开：%v", err)
	}
}
