# 设置里的内置浏览器安装（D-1）

**日期**：2026-09-04
**决策来源**：接续文档 `legionAgent/docs/superpowers/plans/2026-09-04-open-items-handoff.md` §三 D-1。原方案是「首次运行弹一次询问」，**已拍板改形态**：不弹窗，放进设置菜单，由用户主动发起。
**理由**：安装执行的是**从网上取回来的代码**。主动发起比开机询问更贴合这个性质。

---

## 一、现状

机制在 gui#42 就交付了，**但前端一个消费者都没有**——这是本仓记过的「接缝在但没人调用它」的又一例：

| 已有 | 位置 | 行为 |
|---|---|---|
| `BundledChromiumPath()` | `app_chromium.go:16` | 返回随包/已装的浏览器路径；**空不是错误**，Agent 会退到系统浏览器 |
| `InstallBundledChromium()` | `app_chromium.go:26` | 取脚本 → 校验摘要 → 执行；**已装则直接报错拒绝** |
| `chromium:install` 事件 | 同上 | 脚本输出逐行发出（整件事几分钟，没有进度用户会以为它死了） |

`chromium.Install` 本身**已经是覆盖式安装**：两份脚本都先清空目标再装
（`scripts/install-chromium.ps1:66` `Remove-Item -Recurse -Force $dest`；
`scripts/install-chromium.sh:98` `rm -rf "$dest"`）。所以「重新安装」不需要新的安装
逻辑，只需要一个不提前返回的入口。

## 二、四个单元

### 1. `internal/chromium` —— 不动

覆盖能力已经在脚本里。这一层不需要知道「这是不是一次重装」。

### 2. Go 绑定（`app_chromium.go`）

- `InstallBundledChromium()`：**保持现状**，已装即拒绝。它防的是误触发一次 150MB 下载。
- `ReinstallBundledChromium()`：**新增**，跳过那道检查，直接走 `chromium.Install`。

两个入口而不是一个 `force bool` 参数：调用点在 TS 里，`InstallBundledChromium(true)`
在调用处读不出含义，而 `ReinstallBundledChromium()` 读得出。

两者共用同一段执行体（取事件上下文、发进度、装完发结果），差别只在那道前置检查。

### 3. `chromiumStore`（新，zustand）

```ts
status: 'unknown' | 'absent' | 'installing' | 'installed' | 'failed'
path: string          // 'installed' 时非空
lines: string[]       // 脚本输出，保留最近 200 行
error: string | null  // 'failed' 时非空
```

- `lines` 限长：一次安装的输出行数没有上限，无界数组会一直涨。
- `status` 是显式状态机，不用 `path !== ''` 之类的推导：**「装完了」与「装之前就带着」在界面上要说的话不同**，而路径非空对两者都成立。

### 4. `BrowserPage`（新）—— 设置的第三个 tab

`SettingsModal` 现在是「配置 / 插件」两个 tab，加第三个「浏览器」。只读 store、只调绑定，
自身不持有安装状态。

## 三、数据流：监听常驻应用层

`chromium:install` 的 `EventsOn` **挂在应用层**（与 `useAgentEvents` 同级），
**不在 `BrowserPage` 里**。

这是「切 tab / 关面板不打断安装」的唯一实现方式：切 tab 会 unmount 页面
（`SettingsModal.tsx:132` 的注释已经写明这一点），若监听在页面里，unmount 即丢事件，
Go 侧还在装、界面却再也收不到一行输出。

安装结束后调 `BundledChromiumPath()` **复核**路径写进 store，而不是相信脚本说的
「装到了 X」——`install.go:167` 已经为 Go 侧立过同一条规矩（脚本落点与运行时查找位置
各写各的，正是这里唯一要防的事）。

## 四、重装的代价要说出来

脚本是**先删后装**。下载中断 = 旧的已经删了、新的没装上 → 从「有浏览器」变成
「没浏览器」。

所以「重新安装」前弹一次确认，正文写明这句话。这不是走过场：它是重装唯一的真实风险，
而且用户此刻拥有的是一个**能用**的浏览器。

## 五、界面状态

| status | 显示 |
|---|---|
| `absent` | 「这次安装没有自带浏览器，Agent 会用系统上装着的那个。」+ 「安装内置浏览器」按钮 |
| `installing` | 徽标「安装中」+ 滚动日志（最近 200 行）+ 按钮禁用 |
| `installed` | 路径 + 「重新安装」按钮（点击先确认） |
| `failed` | 人话一句 + `<details>` 折叠原文 + 「重试」按钮 |

失败原文按 #48 定下的规矩折叠，不裸铺：安装失败的原文可能是整个脚本输出。

## 六、测试

**Go**
- `ReinstallBundledChromium` 在已装时不提前返回（与 `InstallBundledChromium` 的拒绝行为形成对照）；
- `InstallBundledChromium` 已装时仍然拒绝（这条保护不能在加新入口时被顺手删掉）。

**前端**
- store 状态机：`absent → installing → installed`、`absent → installing → failed`；
- **面板关闭时事件仍进 store**（这条是本设计的要害，测试要在应用层而不是页面层断言）；
- `lines` 超过 200 行只保留最近的；
- 失败原文在 `<details>` 里，不出现在裸段落中；
- `installed` 态点「重新安装」先出确认框，取消则不调绑定。

## 七、明确不做

- **不做进度条**：脚本输出没有稳定的百分比格式，解析它等于让界面依赖两份 shell 脚本的措辞，脚本一改就静默失真。
- **不做自动安装**：与拍板一致，安装永远由用户主动发起。
- **不动 `internal/chromium`**：覆盖能力已在脚本里，这一层不需要知道是不是重装。
