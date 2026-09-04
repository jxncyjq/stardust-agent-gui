# 设置里的内置浏览器安装（D-1）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在设置里主动安装（或重装）内置 Chromium，并在安装的几分钟里一直看得到进度。

**Architecture:** `internal/chromium` 不动（覆盖能力已在两份脚本里）；Go 绑定加一个显式的 `ReinstallBundledChromium()` 入口；安装状态放 zustand store，`chromium:install` 的监听挂在 App 顶层常驻，所以切 tab / 关设置面板都不打断；设置弹窗加第三个 tab「浏览器」只读那个 store。

**Tech Stack:** Go 1.26 + Wails v2 绑定；React 18 + zustand + Tailwind；vitest + @testing-library。

**Spec:** `docs/superpowers/specs/2026-09-04-chromium-install-in-settings-design.md`

## Global Constraints

- **前端测试必须在 `frontend/` 目录里跑**：仓根另有一个没配 jsdom 的 vitest，在那儿跑会得到 `document is not defined` 的假失败。
- **`wails dev` / `wails build` 必须带 `-m`**（`go mod tidy` 不认 go.work 的 replace）。
- **错误链不裸铺**：失败原文一律「人话一句 + `<details>` 折叠原文」（本仓 #48 定的规矩）。
- **不解析脚本输出**：不做百分比、不做进度条。脚本写什么就显示什么。
- **~~不改 `internal/chromium`~~ —— 2026-09-04 终审后松绑，见下**：原约束的理由是「覆盖能力已在脚本里（`install-chromium.ps1:66` 与 `install-chromium.sh:98` 都先清空目标再装），那一层不需要知道是不是重装」——它约束的是**重装语义**，不是**输出通道**。
  终审发现 `install.go:153` 用 `cmd.CombinedOutput()`，输出在脚本**退出之后**才一次性回调，于是「几分钟里一直看得到进度」这条 Goal 根本没实现（界面几分钟一个字不变，结束瞬间 200 行齐出）。**允许改 `internal/chromium/install.go` 把执行改成流式**（`StdoutPipe`+`Start`+`Scanner`+`Wait`），并配一条「脚本退出前 progress 至少被调用一次」的测试。重装语义仍然不许动。
  这条错在规划阶段：spec 把 gui#42 的「逐行发出」当既有能力直接引用，**没有核到代码**——而 `app_chromium.go` 的注释也这么写着，注释在说谎。

---

### Task 1: Go 绑定加 `ReinstallBundledChromium`

**Files:**
- Modify: `app_chromium.go`
- Test: `app_chromium_test.go`

**Interfaces:**
- Consumes: `chromium.Path() string`、`chromium.Install(ctx, *http.Client, func(string)) error`（均已存在）
- Produces: `(*App).ReinstallBundledChromium() error` —— 供 Task 4 的前端调用；`(*App).InstallBundledChromium() error` 行为不变

- [ ] **Step 1: 看既有测试里有没有相关守卫**

Run: `grep -n "InstallBundledChromium" app_chromium_test.go`

**为什么不能直接用 `chromium.Path()` 写断言**：`go test` 下它**恒为空**——它按
`os.Executable()` 找同级目录，而测试二进制在临时目录里（2026-09-04 探针实测）。以
`if chromium.Path() == "" { t.Skip() }` 开头的测试在任何机器上都会 skip，套件全绿而
断言一次没跑，正是本仓栽过多次的「绿得不是地方」。所以先加一道注入接缝。

- [ ] **Step 2: 加接缝——`App.chromiumPath`**

`app.go` 的 `App` 结构体（`:18-24`）加一个字段：

```go
	// chromiumPath 回答「现在有没有内置浏览器」。它是字段而不是直接调
	// chromium.Path()，只为一件事：让「已装时该不该拒绝安装」这条判断可测。
	// chromium.Path() 按 os.Executable() 的同级目录找，而 go test 的二进制在临时
	// 目录里——它在测试下恒为空，任何以它为前提的断言都会静默跳过。
	// NewApp 填 chromium.Path，生产路径逐字不变。
	chromiumPath  func() string
```

`NewApp` 里 `app := &App{...}` 的字段列表加上 `chromiumPath: chromium.Path,`
（`app.go` 需要 import `legionAgentGUI/internal/chromium`；若已 import 则不动）。

- [ ] **Step 2b: 加第二道接缝——`App.installChromium`**

`App` 结构体再加一个字段（挨着 `chromiumPath`）：

```go
	// installChromium 执行那次真正的安装。它是字段而不是直接调 chromium.Install，
	// 理由与 chromiumPath 同类但更硬：chromium.Install 会去 GitHub 取脚本并**执行
	// 它**（一次 150MB 的下载）。任何走到它的测试都会变成一个下载器，在有网络的 CI
	// 上尤其明显，而那些测试想验的其实只是「前置检查放没放行」。
	// NewApp 填 chromium.Install，生产路径逐字不变。
	installChromium func(ctx context.Context, client *http.Client, progress func(string)) error
```

`NewApp` 的字段列表加 `installChromium: chromium.Install,`。

- [ ] **Step 3: 写失败测试**

追加到 `app_chromium_test.go`（import 需要 `strings`）：

```go
// 这两条一起钉的是「加了新入口，旧保护还在」：InstallBundledChromium 对已装直接拒绝
// （防的是误触发一次 150MB 下载），ReinstallBundledChromium 不做那道检查。
//
// 两条都不真的装：断言落在**那道前置检查**上。注入 chromiumPath 是必须的——真实的
// chromium.Path() 在 go test 下恒为空，用它写前提等于让这两条永远 skip。
// newChromiumTestApp 给出一个**不碰网络**的 App：路径可注入，安装被换成记账用的假
// 实现。返回的计数器就是断言的着力点——「有没有走到安装」比「安装返回了什么」更接近
// 这些用例真正要钉的东西。
func newChromiumTestApp(t *testing.T, path string) (*App, *int) {
	t.Helper()
	app := NewApp("")
	installs := 0
	app.chromiumPath = func() string { return path }
	app.installChromium = func(context.Context, *http.Client, func(string)) error {
		installs++
		return nil
	}
	return app, &installs
}

func TestInstallBundledChromiumRefusesWhenOneIsPresent(t *testing.T) {
	app, installs := newChromiumTestApp(t, "/opt/app/chrome")

	err := app.InstallBundledChromium()
	if err == nil {
		t.Fatal("已经有浏览器时必须拒绝：重装意味着再下 150MB，而它当下什么问题也不解决")
	}
	if *installs != 0 {
		t.Errorf("拒绝之后仍然走到了安装：%d 次", *installs)
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
	app, installs := newChromiumTestApp(t, "/opt/app/chrome")

	if err := app.ReinstallBundledChromium(); err != nil {
		t.Fatalf("重装入口不该因为「已经有了」而失败：%v", err)
	}
	if *installs != 1 {
		t.Errorf("重装入口没有走到安装（%d 次）：它的全部意义就是绕过那道前置检查", *installs)
	}
}

// 没有浏览器时 InstallBundledChromium 也必须放行——否则「装一次」这条主路径就没了。
func TestInstallBundledChromiumProceedsWhenNoneIsPresent(t *testing.T) {
	app, installs := newChromiumTestApp(t, "")

	if err := app.InstallBundledChromium(); err != nil {
		t.Fatalf("没有浏览器时安装必须放行：%v", err)
	}
	if *installs != 1 {
		t.Errorf("没有浏览器却没走到安装（%d 次）：这条主路径没了", *installs)
	}
}
```

**三条都不许碰网络。** 上一版计划让它们走到真的 `chromium.Install`，理由写的是
「取脚本失败是预期的」——那句话只在**没有网络**的机器上成立。CI 有网络：脚本会取到、
校验通过、然后**被执行**，于是 `TestInstallBundledChromiumProceedsWhenNoneIsPresent`
会在 CI 上真下 150MB 装一个浏览器。测试验的东西也就不再是它声称验的那条判断。

所以第二道接缝：`App.installChromium`（见 Step 2b），测试注入一个记账用的假实现。

- [ ] **Step 4: 跑测试，确认它红**

Run: `go test -run "BundledChromium" .`
Expected: 编译失败 `undefined: (*App).ReinstallBundledChromium`（以及 `chromiumPath` 未定义，若 Step 2 还没做）

- [ ] **Step 5: 实现（把执行体抽出来共用）**

改 `app_chromium.go`：

```go
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
	if err := a.installChromium(ctx, a.client, emit); err != nil {
		emit("安装失败：" + err.Error())
		return err
	}
	emit("安装完成：" + a.chromiumPath())
	return nil
}
```

- [ ] **Step 5b: 跑测试，确认它绿**

Run: `go test -run "BundledChromium" -v . && go test ./...`
Expected: 三条 PASS（**不是 SKIP**），且**每条都在 1 秒内**——超过几秒说明它在联网，接缝没接上。全量两包 ok

- [ ] **Step 6: 生成 Wails 绑定**

Run: `wails generate module`

Run: `grep -c ReinstallBundledChromium frontend/wailsjs/go/main/App.d.ts frontend/wailsjs/go/main/App.js`
Expected: 两个文件各 ≥1。**漏了这一步前端调不到**（本仓 gui#43 就是事后补提交生成绑定）。

- [ ] **Step 7: 提交**

```bash
git add app_chromium.go app_chromium_test.go frontend/wailsjs
git commit -m "feat(chromium): 加 ReinstallBundledChromium 覆盖安装入口"
```

---

### Task 2: `chromiumStore`

**Files:**
- Create: `frontend/src/stores/chromiumStore.ts`
- Test: `frontend/src/stores/chromiumStore.test.ts`

**Interfaces:**
- Produces:
  - `type ChromiumStatus = 'unknown' | 'absent' | 'installed' | 'installing' | 'failed'`
  - `export const maxInstallLines = 200`
  - `useChromiumStore`，字段 `status / path / lines / error`，方法 `setPresence(path: string)`、`start()`、`appendLine(line: string)`、`succeed(path: string)`、`fail(message: string)`
- Task 3 用写入方法；Task 4 只读字段。

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/stores/chromiumStore.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { maxInstallLines, useChromiumStore } from './chromiumStore'

describe('chromiumStore', () => {
  beforeEach(() => {
    useChromiumStore.setState({ status: 'unknown', path: '', lines: [], error: null })
  })

  // status 是显式状态机，不从 path 推导：「刚装完」与「本来就随包带着」在界面上要说的
  // 话不同，而 path 非空对两者都成立。
  it('setPresence 按路径有无落到 installed / absent', () => {
    useChromiumStore.getState().setPresence('/opt/app/chrome')
    expect(useChromiumStore.getState().status).toBe('installed')
    expect(useChromiumStore.getState().path).toBe('/opt/app/chrome')

    useChromiumStore.getState().setPresence('')
    expect(useChromiumStore.getState().status).toBe('absent')
    expect(useChromiumStore.getState().path).toBe('')
  })

  // 上一次失败的红字不能挂在这一次安装上（BrowserToolbar 记过同样的教训：一条过期的
  // 错误会一直遮住真实状态）。
  it('start 清掉上一次的输出与错误', () => {
    useChromiumStore.setState({ status: 'failed', lines: ['旧的一行'], error: '上次的失败' })
    useChromiumStore.getState().start()
    expect(useChromiumStore.getState().status).toBe('installing')
    expect(useChromiumStore.getState().lines).toEqual([])
    expect(useChromiumStore.getState().error).toBeNull()
  })

  it('succeed / fail 落到对应状态', () => {
    useChromiumStore.getState().start()
    useChromiumStore.getState().succeed('/opt/app/chrome')
    expect(useChromiumStore.getState().status).toBe('installed')
    expect(useChromiumStore.getState().path).toBe('/opt/app/chrome')

    useChromiumStore.getState().start()
    useChromiumStore.getState().fail('boom')
    expect(useChromiumStore.getState().status).toBe('failed')
    expect(useChromiumStore.getState().error).toBe('boom')
  })

  // 一次安装的输出行数没有上限，无界数组会一直涨。
  it('lines 只保留最近 maxInstallLines 行', () => {
    useChromiumStore.getState().start()
    for (let i = 0; i < maxInstallLines + 50; i++) {
      useChromiumStore.getState().appendLine(`line-${i}`)
    }
    const lines = useChromiumStore.getState().lines
    expect(lines).toHaveLength(maxInstallLines)
    expect(lines[0]).toBe('line-50')
    expect(lines[lines.length - 1]).toBe(`line-${maxInstallLines + 49}`)
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `cd frontend && npx vitest run src/stores/chromiumStore.test.ts`
Expected: FAIL —— 无法解析 `./chromiumStore`

- [ ] **Step 3: 实现**

创建 `frontend/src/stores/chromiumStore.ts`：

```ts
import { create } from 'zustand'

// maxInstallLines 限住安装日志的长度。一次安装的输出行数没有上限（脚本在下 150MB 的
// 过程里会一直写），无界数组会一直涨；保留最近这些行足够看清它卡在哪一步。
export const maxInstallLines = 200

export type ChromiumStatus = 'unknown' | 'absent' | 'installed' | 'installing' | 'failed'

interface ChromiumState {
  // status 是显式状态机，而不是从 path 是否为空推导出来的：「刚装完」与「本来就随包
  // 带着」在界面上要说的话不同，而 path 非空对两者都成立；'unknown' 也必须与 'absent'
  // 分开——还没问过后端，和问过之后确认没有，是两件事。
  status: ChromiumStatus
  path: string
  lines: string[]
  error: string | null
  setPresence: (path: string) => void
  start: () => void
  appendLine: (line: string) => void
  succeed: (path: string) => void
  fail: (message: string) => void
}

export const useChromiumStore = create<ChromiumState>((set) => ({
  status: 'unknown',
  path: '',
  lines: [],
  error: null,
  setPresence: (path) => set({ status: path === '' ? 'absent' : 'installed', path }),
  // 清掉上一次的输出与错误：一条过期的红字会一直遮住这一次的真实状态。
  start: () => set({ status: 'installing', lines: [], error: null }),
  appendLine: (line) => set((s) => ({ lines: [...s.lines, line].slice(-maxInstallLines) })),
  succeed: (path) => set({ status: 'installed', path, error: null }),
  fail: (message) => set({ status: 'failed', error: message }),
}))
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `cd frontend && npx vitest run src/stores/chromiumStore.test.ts`
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
git add frontend/src/stores/chromiumStore.ts frontend/src/stores/chromiumStore.test.ts
git commit -m "feat(chromium): 安装状态放进 chromiumStore"
```

---

### Task 3: 常驻监听 `useChromiumInstall`

**Files:**
- Create: `frontend/src/hooks/useChromiumInstall.ts`
- Test: `frontend/src/hooks/useChromiumInstall.test.tsx`
- Modify: `frontend/src/App.tsx`（`useHtmlPreviewEvents()` 那行下面加一行）

**Interfaces:**
- Consumes: Task 2 的 `useChromiumStore`；绑定 `BundledChromiumPath()`（已存在）
- Produces: `useChromiumInstall(): void` —— 只订阅事件与首屏探测，不返回值

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/hooks/useChromiumInstall.test.tsx`：

```tsx
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  BundledChromiumPath: vi.fn(),
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))
vi.mock('../../wailsjs/go/main/App', () => ({ BundledChromiumPath: mocks.BundledChromiumPath }))
vi.mock('../../wailsjs/runtime/runtime', () => ({ EventsOn: mocks.EventsOn, EventsOff: mocks.EventsOff }))

import { useChromiumInstall } from './useChromiumInstall'
import { useChromiumStore } from '../stores/chromiumStore'

function Harness() {
  useChromiumInstall()
  return null
}

function installHandler(): (line: string) => void {
  const call = mocks.EventsOn.mock.calls.find((c) => c[0] === 'chromium:install')
  if (!call) throw new Error('没有订阅 chromium:install')
  return call[1] as (line: string) => void
}

describe('useChromiumInstall', () => {
  beforeEach(() => {
    mocks.BundledChromiumPath.mockReset().mockResolvedValue('')
    mocks.EventsOn.mockReset()
    mocks.EventsOff.mockReset()
    useChromiumStore.setState({ status: 'unknown', path: '', lines: [], error: null })
  })

  it('首屏问一次后端，把有没有浏览器写进 store', async () => {
    mocks.BundledChromiumPath.mockResolvedValue('/opt/app/chrome')
    render(<Harness />)
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('installed'))
    expect(useChromiumStore.getState().path).toBe('/opt/app/chrome')
  })

  // 这条是整个设计的要害：安装要几分钟，用户会去干别的。监听挂在 App 顶层而不是设置
  // 面板里，所以设置面板从没挂载过也照样收得到——这里用「只渲染 Harness」代表那个场景。
  it('设置面板没开着的时候，安装输出照样进 store', async () => {
    render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalledWith('chromium:install', expect.any(Function)))
    useChromiumStore.getState().start()
    installHandler()('正在下载 chromium…')
    expect(useChromiumStore.getState().lines).toEqual(['正在下载 chromium…'])
  })

  // 装完之后**由查找逻辑自己回答**它看不看得见，而不是相信脚本说的「装到了 X」：
  // 脚本的落点与运行时的查找位置各写各的（internal/chromium/install.go 已为 Go 侧
  // 立过同一条规矩）。
  it('收到完成行之后回头问一次真实路径', async () => {
    render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    useChromiumStore.getState().start()
    mocks.BundledChromiumPath.mockResolvedValue('/opt/app/chrome')
    installHandler()('安装完成：/opt/app/chrome')
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('installed'))
    expect(useChromiumStore.getState().path).toBe('/opt/app/chrome')
  })

  // 脚本说装完了、查找逻辑却看不到，是失败而不是成功：那正是「装到了 App 旁边而不是
  // App 里面」的形态，Go 侧对同一情形也是报错。
  it('完成行之后路径仍为空 → failed', async () => {
    render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    useChromiumStore.getState().start()
    mocks.BundledChromiumPath.mockResolvedValue('')
    installHandler()('安装完成：')
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('failed'))
  })

  it('失败行落成 failed，错误里不带那个前缀', async () => {
    render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    useChromiumStore.getState().start()
    installHandler()('安装失败：run the install script: exit status 1')
    expect(useChromiumStore.getState().status).toBe('failed')
    expect(useChromiumStore.getState().error).toBe('run the install script: exit status 1')
  })

  it('卸载时摘掉监听', async () => {
    const { unmount } = render(<Harness />)
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    unmount()
    expect(mocks.EventsOff).toHaveBeenCalledWith('chromium:install')
  })
})
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `cd frontend && npx vitest run src/hooks/useChromiumInstall.test.tsx`
Expected: FAIL —— 无法解析 `./useChromiumInstall`

- [ ] **Step 3: 实现**

创建 `frontend/src/hooks/useChromiumInstall.ts`：

```ts
import { useEffect } from 'react'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { BundledChromiumPath } from '../../wailsjs/go/main/App'
import { useChromiumStore } from '../stores/chromiumStore'

// 这两个前缀是 Go 侧 runChromiumInstall 收尾时**自己发出**的两行（app_chromium.go）。
// 认它们不等于解析脚本输出：脚本自己写什么这里一概不看。
const installFinishedPrefix = '安装完成：'
const installFailedPrefix = '安装失败：'

// useChromiumInstall 订阅内置浏览器的安装事件，并在首屏问一次「现在有没有」。
//
// **挂在 App 顶层**（与 useBrowserSession 并列），不挂在设置面板里：安装要几分钟，
// 用户多半会切走 tab 或干脆把设置关掉，而切 tab 会 unmount 设置页（SettingsModal 的
// 注释写明了这一点）。监听若在页面里，unmount 就等于把还在进行的安装的全部反馈丢掉
// ——Go 侧照装，界面再也收不到一行。
export function useChromiumInstall() {
  useEffect(() => {
    let cancelled = false
    void BundledChromiumPath()
      .then((path) => {
        if (cancelled) return
        // 只在还没开始装的时候写：首屏探测的结果不能覆盖正在进行的安装状态。
        if (useChromiumStore.getState().status === 'unknown') {
          useChromiumStore.getState().setPresence(path)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) useChromiumStore.getState().fail(String(err))
      })

    const handle = (line: string) => {
      const store = useChromiumStore.getState()
      store.appendLine(line)
      if (line.startsWith(installFailedPrefix)) {
        store.fail(line.slice(installFailedPrefix.length))
        return
      }
      if (line.startsWith(installFinishedPrefix)) {
        // 不采信这行里的路径，回头问查找逻辑：脚本的落点与运行时的查找位置各写各的。
        void BundledChromiumPath()
          .then((path) => {
            if (path === '') {
              useChromiumStore
                .getState()
                .fail('安装脚本说装完了，但这个应用在它查找的任何位置都看不到浏览器')
              return
            }
            useChromiumStore.getState().succeed(path)
          })
          .catch((err: unknown) => useChromiumStore.getState().fail(String(err)))
      }
    }
    EventsOn('chromium:install', handle)
    return () => {
      cancelled = true
      EventsOff('chromium:install')
    }
  }, [])
}
```

- [ ] **Step 4: 跑测试，确认它绿**

Run: `cd frontend && npx vitest run src/hooks/useChromiumInstall.test.tsx`
Expected: 6 passed

- [ ] **Step 5: 接到 App 顶层**

`frontend/src/App.tsx` 顶部加：

```tsx
import { useChromiumInstall } from './hooks/useChromiumInstall'
```

`useHtmlPreviewEvents()` 下面加：

```tsx
  useChromiumInstall()
```

- [ ] **Step 6: 全量前端 + 类型检查**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: 全绿、tsc 无输出

- [ ] **Step 7: 提交**

```bash
git add frontend/src/hooks/useChromiumInstall.ts frontend/src/hooks/useChromiumInstall.test.tsx frontend/src/App.tsx
git commit -m "feat(chromium): 安装事件的监听常驻 App 顶层"
```

---

### Task 4: 设置里的第三个 tab

**Files:**
- Modify: `frontend/src/stores/uiStore.ts`
- Modify: `frontend/src/components/settings/SettingsModal.tsx`
- Create: `frontend/src/components/settings/BrowserPage.tsx`
- Create: `frontend/src/components/settings/BrowserPage.test.tsx`
- Modify: `frontend/src/components/settings/SettingsModal.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `useChromiumStore`；Task 1 的 `InstallBundledChromium()` / `ReinstallBundledChromium()`
- Produces: `BrowserPage` 组件；`useUIStore` 的 `settingsTab: 'config' | 'plugins' | 'browser'` 与 `setSettingsTab(tab)`

- [ ] **Step 1: tab 状态从布尔改成三态**

`uiStore.ts` 现在是 `pluginsOpen: boolean` + `openPlugins/closePlugins`（`:27/:32/:33/:48/:53/:54/:56/:57`）。两个 tab 用布尔尚可，三个必须是枚举——否则「哪一页开着」要靠两个布尔的组合表达，而那两个布尔可以同时为真。

- 加 `export type SettingsTab = 'config' | 'plugins' | 'browser'`
- `UIState`：`pluginsOpen: boolean` → `settingsTab: SettingsTab`；`openPlugins/closePlugins` → `setSettingsTab: (tab: SettingsTab) => void`
- 初值 `settingsTab: 'config'`
- `closeSettings` 与 `openAgent` 里的 `pluginsOpen: false` → `settingsTab: 'config'`
- 那段解释 `pluginsOpen` 的注释跟着改写成解释 `settingsTab`

- [ ] **Step 2: 跑一次全量，拿到被打断的清单**

Run: `cd frontend && npx vitest run 2>&1 | tail -40`
Expected: 引用 `pluginsOpen` / `openPlugins` / `closePlugins` 的地方 FAIL。**先看清清单再逐个改**：调用改成 `setSettingsTab('plugins')`、断言改成 `settingsTab`。

- [ ] **Step 3: 写 BrowserPage 的失败测试**

创建 `frontend/src/components/settings/BrowserPage.test.tsx`：

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  InstallBundledChromium: vi.fn(),
  ReinstallBundledChromium: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => ({
  InstallBundledChromium: mocks.InstallBundledChromium,
  ReinstallBundledChromium: mocks.ReinstallBundledChromium,
}))

import { BrowserPage } from './BrowserPage'
import { useChromiumStore } from '../../stores/chromiumStore'

describe('BrowserPage', () => {
  beforeEach(() => {
    mocks.InstallBundledChromium.mockReset().mockResolvedValue(undefined)
    mocks.ReinstallBundledChromium.mockReset().mockResolvedValue(undefined)
    useChromiumStore.setState({ status: 'unknown', path: '', lines: [], error: null })
  })

  it('没有浏览器时给安装入口，并说明现在用的是系统浏览器', () => {
    useChromiumStore.setState({ status: 'absent' })
    render(<BrowserPage />)
    expect(screen.getByText(/系统上装着的/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '安装内置浏览器' })).toBeEnabled()
  })

  it('安装中显示逐行输出，且按钮不可再点', () => {
    useChromiumStore.setState({ status: 'installing', lines: ['正在下载…', '解压中…'] })
    render(<BrowserPage />)
    expect(screen.getByText(/正在下载…/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /安装中/ })).toBeDisabled()
  })

  // 重装是先删后装：下载中断就是旧的没了、新的没装上。这个代价必须在点下去之前说出来。
  it('已装时点重新安装先确认，取消则一次绑定都不调', async () => {
    useChromiumStore.setState({ status: 'installed', path: '/opt/app/chrome' })
    render(<BrowserPage />)
    expect(screen.getByText('/opt/app/chrome')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新安装' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/先删除现在这个/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.ReinstallBundledChromium).not.toHaveBeenCalled()
  })

  it('确认之后才调 ReinstallBundledChromium', async () => {
    useChromiumStore.setState({ status: 'installed', path: '/opt/app/chrome' })
    render(<BrowserPage />)
    fireEvent.click(screen.getByRole('button', { name: '重新安装' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认重新安装' }))
    await waitFor(() => expect(mocks.ReinstallBundledChromium).toHaveBeenCalledTimes(1))
  })

  // 失败原文可能是整个脚本输出。按本仓 #48 的规矩：人话一句 + 折叠原文，不裸铺。
  it('失败时人话在外、原文折叠在 details 里', () => {
    useChromiumStore.setState({
      status: 'failed',
      error: 'run the install script: exit status 1 ' + 'x'.repeat(400),
    })
    render(<BrowserPage />)
    expect(screen.getByText('安装内置浏览器失败。')).toBeInTheDocument()
    expect(screen.getByText(/exit status 1/).closest('details')).not.toBeNull()
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
  })

  // 绑定 reject 也要把界面带到 failed：事件掉了一次，不该让它永远停在「安装中」。
  it('绑定 reject 时也落到 failed', async () => {
    useChromiumStore.setState({ status: 'absent' })
    mocks.InstallBundledChromium.mockRejectedValue('serve is down')
    render(<BrowserPage />)
    fireEvent.click(screen.getByRole('button', { name: '安装内置浏览器' }))
    await waitFor(() => expect(useChromiumStore.getState().status).toBe('failed'))
  })
})
```

- [ ] **Step 4: 跑测试，确认它红**

Run: `cd frontend && npx vitest run src/components/settings/BrowserPage.test.tsx`
Expected: FAIL —— 无法解析 `./BrowserPage`

- [ ] **Step 5: 实现 BrowserPage**

创建 `frontend/src/components/settings/BrowserPage.tsx`：

```tsx
import { useState } from 'react'
import { InstallBundledChromium, ReinstallBundledChromium } from '../../../wailsjs/go/main/App'
import { useChromiumStore } from '../../stores/chromiumStore'

// BrowserPage 是设置里的「浏览器」页：内置 Chromium 装没装、装在哪、以及**由人主动
// 发起**的安装。
//
// 安装执行的是从网上取回来的代码（校验摘要后才执行，见 chromium.Install），所以它
// 永远是一个人点下去的动作，不在启动时自己跑，也不弹窗问。
//
// 这一页自己不持有安装状态：状态在 chromiumStore，事件监听在 App 顶层
// （useChromiumInstall）。所以关掉设置、切走 tab 都不影响正在进行的安装，回来还看得到
// 进度——这一页 unmount 只是不再渲染而已。
export function BrowserPage() {
  const status = useChromiumStore((s) => s.status)
  const path = useChromiumStore((s) => s.path)
  const lines = useChromiumStore((s) => s.lines)
  const error = useChromiumStore((s) => s.error)
  const start = useChromiumStore((s) => s.start)
  const fail = useChromiumStore((s) => s.fail)
  const [confirming, setConfirming] = useState(false)

  const install = (reinstall: boolean) => {
    setConfirming(false)
    start()
    const call = reinstall ? ReinstallBundledChromium : InstallBundledChromium
    // 绑定 reject 也要落到 store：Go 侧失败时也会发一行「安装失败：…」，但两条路都要
    // 能把界面带到 failed——事件掉了一次不该让界面永远停在「安装中」。
    void call().catch((err: unknown) => fail(String(err)))
  }

  return (
    <div className="py-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold">内置浏览器</span>
        <span className="text-[10px] text-muted-foreground">
          Agent 用它来打开网页。安装会从 GitHub 取回官方脚本、校验摘要后执行，整个过程要几分钟。
        </span>
      </div>

      {status === 'absent' && (
        <p className="text-xs text-muted-foreground">
          这次安装没有自带浏览器，Agent 会用系统上装着的那个。
        </p>
      )}

      {status === 'installed' && <p className="text-xs text-muted-foreground break-all">{path}</p>}

      {status === 'failed' && (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-destructive">安装内置浏览器失败。</p>
          <details className="text-[10px] text-muted-foreground">
            <summary className="interactive cursor-pointer select-none">显示详细错误</summary>
            <pre className="whitespace-pre-wrap break-all mt-0.5">{error}</pre>
          </details>
        </div>
      )}

      {lines.length > 0 && (
        <pre className="max-h-48 overflow-y-auto rounded border border-border bg-muted/40 p-2 text-[10px] whitespace-pre-wrap break-all">
          {lines.join('\n')}
        </pre>
      )}

      <div>
        {status === 'installing' ? (
          <button type="button" disabled className="interactive text-xs px-2 py-1 rounded border border-input opacity-50">
            安装中…
          </button>
        ) : status === 'installed' ? (
          <button
            type="button"
            className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted text-muted-foreground"
            onClick={() => setConfirming(true)}
          >
            重新安装
          </button>
        ) : (
          <button
            type="button"
            className="interactive text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
            onClick={() => install(false)}
          >
            {status === 'failed' ? '重试' : '安装内置浏览器'}
          </button>
        )}
      </div>

      {confirming && (
        // 先删后装的代价要在点下去**之前**说清楚：安装脚本会先清空目标目录，下载中断
        // 就是旧的没了、新的没装上。用户此刻拥有的是一个能用的浏览器。
        <div role="dialog" aria-label="重新安装内置浏览器" className="rounded border border-border p-2 flex flex-col gap-2">
          <p className="text-xs">
            重新安装会先删除现在这个，再下载新的。下载中途失败，这台机器上就既没有旧的、
            也没有新的，要再装一次才能恢复。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="interactive text-xs px-2 py-1 rounded border border-input hover:bg-muted"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="interactive text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:opacity-90"
              onClick={() => install(true)}
            >
              确认重新安装
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: 跑测试，确认它绿**

Run: `cd frontend && npx vitest run src/components/settings/BrowserPage.test.tsx`
Expected: 7 passed

- [ ] **Step 7: 接进 SettingsModal**

`frontend/src/components/settings/SettingsModal.tsx`：

- import `BrowserPage`
- 读 `settingsTab` / `setSettingsTab`，删掉 `pluginsOpen` / `openPlugins` / `closePlugins`
- 标题（`:125`）按三态给：`config → '设置 · Agent 配置'`、`plugins → '设置 · 插件授权'`、`browser → '设置 · 浏览器'`
- tab 按钮区（`:139-156`）加第三个「浏览器」，选中样式判据改成 `settingsTab === 'config' | 'plugins' | 'browser'`
- 正文区（`:170`）：`settingsTab === 'plugins' ? <PluginsPage /> : settingsTab === 'browser' ? <BrowserPage /> : (原来的配置表单)`

**`consentInFlight` 的门控照旧只为插件而设**：三个 tab 按钮与关闭键保留 `disabled={consentInFlight}`（那道门防的是插件授权收敛被打断），**不要**给安装加同样的门——安装要几分钟，把人锁在设置面板里不合理，而且它本来就设计成关掉也不影响。

- [ ] **Step 8: 给 SettingsModal 补一条用例**

在 `SettingsModal.test.tsx` 里加（打开弹窗的写法照该文件既有用例）：

```tsx
it('浏览器 tab 打得开', async () => {
  render(<SettingsModal />)
  fireEvent.click(await screen.findByRole('button', { name: '浏览器' }))
  expect(screen.getByText('内置浏览器')).toBeInTheDocument()
})
```

- [ ] **Step 9: 全量前端 + 类型检查**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: 全绿、tsc 无输出

- [ ] **Step 10: 提交**

```bash
git add frontend/src
git commit -m "feat(settings): 设置里加浏览器 tab，可主动安装内置浏览器"
```

---

### Task 5: 接线断言、变异验证与收尾

**Files:**
- Create/Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `useChromiumInstall` 已接进 `App.tsx`

- [ ] **Step 1: 补接线断言**

Task 3 的 hook 测试只证明 hook 自己对，**证明不了它被接进了 App**——本仓栽过三次「接缝在但没人调用它」。在 `frontend/src/App.test.tsx` 里加（若该文件不存在则新建，mock 方式照 `useChromiumInstall.test.tsx`）：

```tsx
it('App 挂了 chromium 安装监听（否则关掉设置面板就再也收不到进度）', async () => {
  render(<App />)
  await waitFor(() =>
    expect(mocks.EventsOn.mock.calls.some((c) => c[0] === 'chromium:install')).toBe(true)
  )
})
```

- [ ] **Step 2: 变异——把接线摘掉**

把 `App.tsx` 里的 `useChromiumInstall()` 注释掉，跑
`cd frontend && npx vitest run src/App.test.tsx`
Expected: 上面那条 FAIL。恢复后再跑，Expected: PASS。

- [ ] **Step 3: 变异——去掉 lines 限长**

把 `chromiumStore.ts` 的 `.slice(-maxInstallLines)` 去掉，跑
`cd frontend && npx vitest run src/stores/chromiumStore.test.ts`
Expected: 限长那条 FAIL。恢复后再跑，Expected: PASS。

- [ ] **Step 4: 变异——去掉重装确认**

把 `BrowserPage.tsx` 里 `onClick={() => setConfirming(true)}` 改成 `onClick={() => install(true)}`，跑
`cd frontend && npx vitest run src/components/settings/BrowserPage.test.tsx`
Expected: 「取消则一次绑定都不调」FAIL。恢复后再跑，Expected: PASS。

- [ ] **Step 5: 全量**

Run: `go build ./... && go test ./...`
Expected: 两包 ok

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: 全绿、tsc 无输出

- [ ] **Step 6: 逐项 grep 确认落盘**

```bash
grep -c ReinstallBundledChromium app_chromium.go frontend/wailsjs/go/main/App.d.ts
grep -c useChromiumInstall frontend/src/App.tsx
grep -c settingsTab frontend/src/stores/uiStore.ts frontend/src/components/settings/SettingsModal.tsx
grep -c pluginsOpen frontend/src/stores/uiStore.ts
```
Expected: 前三条均 ≥1，最后一条 **0**。

- [ ] **Step 7: 提交并开 PR**

```bash
git add -A
git commit -m "test(chromium): 接线断言与变异验证"
git push -u origin feat/chromium-install-in-settings
```

PR 正文要写明：三条变异各自验红的结果、以及下面那三项真机验证**尚未做**。

---

## 真机验证（2026-09-04 做了，**三项都没跑完**，因为撞出四个缺陷）

原定三项：①装一次 ②装到一半关面板再打开 ③重装确认框。**第一项就没过**，后两项依赖它，未做。

真机跑出来的四个缺陷，全部是自动化测试测不到的那类：

| # | 缺陷 | 状态 |
|---|---|---|
| 1 | **本地 serve 的 bearer token 被发给 github.com**：`loopbackAuthTransport` 对每个请求无条件加头、不看主机，而 `chromium.Install` 用的是同一个 client。GitHub 对坏凭据返回 404，症状伪装成「脚本不存在」。安全问题 | 已修 `a9ecb14`（按 host+port 严格匹配，fail-closed；变异验红） |
| 2 | **脚本执行目录里缺 `chromium-pin.json`**：`Install` 只写脚本，而脚本要求同目录有 pin 文件，于是 100% 在 `ps1:22` throw | 已修 `83e726b`（pin 与脚本走同一套取回+摘要校验；摘要纳入漂移守卫） |
| 3 | **PowerShell 输出中文乱码**：Windows 按控制台编码输出，Go 侧当 UTF-8 读，失败信息成了替换符 | 已修 `83e726b`（改走 `-Command` 并设 `[Console]::OutputEncoding=UTF8`） |
| 4 | **`Get-Content $pinPath -Raw` 没带 `-Encoding`**：PS 5.1 把无 BOM 的 UTF-8 按 ANSI 读，pin 里的中文注释被误解码，`ConvertFrom-Json` 抛错。**只在中文/DBCS 区域炸**，CI 上永远发现不了 | **未修**，见下 |

**缺陷 1、2 合起来意味着：这个功能从 gui#42 交付起就从来没能工作过。** 两期没人发现，因为
前端一直没有调用方——「接缝在但没人调用它」代价最大的一次实例。

### 缺陷 4 为什么单独走（2026-09-04 拍板：两步走）

修点在 `scripts/install-chromium.ps1`，而**脚本一改摘要就变**：`scriptRef` 指向的远端仍是旧
脚本，改了就变成所有平台「摘要不符、拒绝执行」——把「只有中文 Windows 装不上」换成「所有
平台都装不上」。这正是维护约束里那条「改脚本必须同时更新嵌入摘要**与**已推送的 `scriptRef`」。

拍板的顺序：

1. 本分支照常合入（含缺陷 1/2/3 的修复与 D-1 功能），`scriptRef` 不动；
2. 第二个 PR 只改 `scripts/install-chromium.ps1` 加 `-Encoding UTF8`，合入 master 拿到 SHA；
3. 第三步把 `scriptRef` 与两个嵌入摘要指到那个 SHA。

这样 `scriptRef` 始终指向 master 上的提交。**真机三项要等第 3 步之后才能跑完**。
