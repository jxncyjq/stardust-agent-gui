# 插件状态实时推送 实施计划（G5）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 插件面板不必手点刷新——收敛完成、插件被健康度卸载、依赖满足后恢复，界面自己就变。

**Architecture:** 服务端**什么都不用改**（见下方勘察结论）：六个插件事件已经流到 `/v1/events`，也已经过 GUI 的 SSE 桥到达前端。要做的只有两件：桥上给 `plugin/*` 开一条专用频道（先例是 approval / browser），面板订阅它并**去抖后重新拉取权威列表**。

**Tech Stack:** Go（GUI 侧 SSE 桥）、React + vitest。不碰 server 仓。

**上游依据:** 路线 `plans/2026-08-28-plugin-gap-closure-roadmap.md`（server 仓）的 G5。

## 勘察结论：服务端已经通了

开工前先把链路走了一遍，结果比路线里估的少一半：

```
loader.publish(plugin/loaded|unloaded|suspended|resumed|activation_failed|unload_leaked)
  → Config.Events = workflowEvents = eventbridge.Bridge      （internal/cli/command.go:2334）
  → Bridge.Publish 双写：内部 slice（poll 契约） + platformEvents（推送）
  → GET /v1/events 的 SSE：event: plugin/loaded / data: {"task_id":"","message":"plugin=…"}
  → GUI sse_bridge.go consumeSSEWithToken → emit("agent:event", {type, data})
```

也就是说**插件事件此刻已经到了前端**，只是没人听。所以本期不新增端点、不改事件、不动 server 仓。

## 为什么是「重新拉取」而不是「按事件打补丁」

事件的 `message` 是一行给人看的文本（`plugin=foo reason=health category=trap revoked=2`），不是结构化载荷。照它去改界面状态，等于让 UI 依赖一个随时会被改写的字符串格式——这个仓已经为同类耦合付过一次代价（`UNTRUSTED_MARKER` 那条，两侧字面量各写一遍）。

所以事件只当**「有什么变了」的信号**，随后向权威来源（`ListPlugins`）问一次。附带的好处：拉取走的是面板既有的 `load()`，因此**自动带上 `resolved` 的对账**（2026-08-28 真机走查修的那条），不会出现两条刷新路径行为不一致。

## Global Constraints

- Fail-loud：自动刷新失败要看得见，不得静默保留旧数据装作没事。
- **vitest 必须** `npx vitest run --pool=forks --poolOptions.forks.singleFork=true`，且**从 `frontend/` 目录跑**（父目录另有一个没有 jsdom 的 vitest）；判据看**文件数**不只看「全绿」。
- Go 侧 `go build ./... && go test ./...` 全绿、`gofmt -l .` 为空。
- 每个 task 做变异验证：把核心机制改坏，确认测试确实 FAIL，输出留在报告里，然后还原并 `git status` 核对。
- 提交只 stage 本 task 的文件（显式路径），永不 `git add -A`。

---

### Task 1: SSE 桥给 `plugin/*` 开专用频道

**Files:**
- Modify: `sse_bridge.go`（`consumeSSEWithToken` 的分发）
- Test: `sse_bridge_test.go`

**Interfaces:**
- Produces: Wails 事件 `agent:plugin`，载荷 `{type: string, data: string}`（与 `agent:approval` 同形）

面板本可以自己从 `agent:event` 里挑，AuditTab 就是那么做的。但 token 流是**每个增量一条事件**，让插件面板在每个 token 上跑一次回调没有必要；更重要的是「哪些类型算插件事件」是**服务端契约**，属于桥这一层，不属于某一个 React 组件。approval 与 browser 已经是这个先例。

- [ ] **Step 1: 写失败测试**

在 `sse_bridge_test.go` 里照它既有的表驱动/假服务器写法追加：

```go
func TestSSEBridgeEmitsPluginEventsOnTheirOwnChannel(t *testing.T) {
	// 假 SSE 服务器发一条 plugin/loaded，断言既有的 agent:event 仍然发出
	// （现有消费者不受影响），并且额外发出 agent:plugin。
}

func TestSSEBridgeDoesNotPutNonPluginEventsOnThePluginChannel(t *testing.T) {
	// 发一条 runtime.token，断言 agent:plugin 一条都没有——否则面板会在每个
	// token 上重新拉取整张插件列表。
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `go test . -run TestSSEBridgeEmitsPluginEvents -v`
Expected: FAIL（没有 `agent:plugin`）

- [ ] **Step 3: 实现**

在 `consumeSSEWithToken` 既有的 `switch eventType` 里加一个分支之外的前缀判断（`switch` 只能匹配定值，插件事件是前缀族）：

```go
			// 插件生命周期事件走专用频道：面板据此重新拉取权威列表，不必从
			// 事件文本里解析状态，也不必在每个 token 事件上被唤醒。
			if strings.HasPrefix(eventType, "plugin/") {
				emit("agent:plugin", map[string]any{"type": eventType, "data": data})
			}
```

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `go test . -run TestSSEBridge -v` → PASS
Run: `go test ./...` → 全绿

- [ ] **Step 5: 变异验证**

把前缀从 `"plugin/"` 改成 `"plugins/"`（一个字母），确认
`TestSSEBridgeEmitsPluginEventsOnTheirOwnChannel` FAIL；还原。

- [ ] **Step 6: 提交**

```bash
git add sse_bridge.go sse_bridge_test.go
git commit -m "feat: SSE 桥给插件生命周期事件开专用频道"
```

---

### Task 2: 面板订阅并去抖刷新

**Files:**
- Modify: `frontend/src/components/settings/PluginsPage.tsx`
- Test: `frontend/src/components/settings/PluginsPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `agent:plugin` 事件

**去抖是必须的，不是优化**：一次收敛会连着发好几条（卸旧、装新、依赖恢复），每条都拉一次列表就是把一次状态变化放大成 N 个请求，而且中间几次拿到的是收敛进行中的半截状态。300ms 尾部去抖：最后一条事件之后才拉。

**卸载时要拆订阅**：设置面板会被反复开关，漏掉 `cancel()` 就是每开一次多一个监听器，最后一次收敛触发 N 次刷新。

- [ ] **Step 1: 写失败测试**

```tsx
it('reloads the list when a plugin lifecycle event arrives', async () => {
	// 渲染 → 断言首拉一次 → 触发 agent:plugin → 等去抖 → 断言 ListPlugins 被调用第二次，
	// 且新状态出现在界面上（第二次 mock 返回 loaded）。
})

it('coalesces a burst of events into a single reload', async () => {
	// 连发 5 条 → 等去抖 → ListPlugins 总共只多调用一次。
})

it('stops listening when the panel unmounts', async () => {
	// unmount 后触发事件 → ListPlugins 调用次数不变；并断言 EventsOn 返回的 cancel 被调用。
})
```

三个测试都要用假计时器（`vi.useFakeTimers()`）推进去抖窗口，并在断言后恢复真计时器。`EventsOn` 的 mock 形状照 `ChatPanel.test.tsx` 现成那份写——那里已经有一份能记录并触发回调的实现，**不要新造一套**。

- [ ] **Step 2: 跑测试确认失败**

Run（在 `frontend/`）：`npx vitest run --pool=forks --poolOptions.forks.singleFork=true src/components/settings/PluginsPage.test.tsx`
Expected: FAIL（事件到达后 `ListPlugins` 仍只被调用一次）

- [ ] **Step 3: 实现**

`PluginsPage` 里加一个 effect：

```tsx
  // 插件生命周期事件只当"有什么变了"的信号：随后向 ListPlugins 问一次权威状态。
  // 不按事件文本打补丁——那行 message 是给人看的，格式随时会变，而这个仓已经为
  // 同类耦合付过一次代价（见 UNTRUSTED_MARKER 的注释）。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = EventsOn('agent:plugin', () => {
      // 尾部去抖：一次收敛会连发好几条事件，每条拉一次列表既放大请求，也会
      // 把"收敛进行中"的半截状态显示出来。
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { load() }, pluginEventDebounceMs)
    })
    return () => {
      cancel()
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2 → PASS

- [ ] **Step 5: 全量前端 + 变异**

Run（在 `frontend/`）：`npx vitest run --pool=forks --poolOptions.forks.singleFork=true`
Expected: 文件数与测试数都不低于改前（**看文件数**）。

变异：把 `return () => { cancel(); … }` 里的 `cancel()` 去掉，确认
「stops listening when the panel unmounts」FAIL；还原。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/settings/PluginsPage.tsx frontend/src/components/settings/PluginsPage.test.tsx
git commit -m "feat(plugins): 面板按事件自动刷新（去抖 + 卸载拆订阅）"
```

---

### Task 3: 文档

**Files:**
- Modify: docs 仓 `agents/reference/reference-legion-agent-plugins-001.md`（§7.3 GUI 段落）
- Modify: docs 仓 `design/architecture/legion-plugin-system.md`（路线表 G5）

- [ ] **Step 1: 手册**

§7.3 现在写着「GUI 只在打开面板时取一次，之后靠手动点刷新」——改成：面板订阅 `agent:plugin`，收敛完成/健康度卸载/依赖恢复会自动反映，去抖 300ms；**仍然没有轮询**，断线由 SSE 桥自己重连。

- [ ] **Step 2: 路线表 G5 标记已交付，并写明「服务端本来就通了，本期只做 GUI 侧」**

- [ ] **Step 3: 提交（docs 仓单独分支与 PR）**

---

## 自检

**范围覆盖**：G5 要的「六个事件接到既有 SSE 桥 + 面板订阅后就地更新」——服务端已通（勘察结论），桥在 Task 1，面板在 Task 2，文档在 Task 3。

**刻意不做**：轮询兜底（SSE 桥已有重连，再加轮询就是两条路径各说各话）；按事件文本打补丁（见上）；把插件事件塞进 `agent:event` 之外还额外改 server 仓（没必要）。

**已知留白**：`EventsOn` 的 mock 与假 SSE 服务器都用各自文件里现成的写法，名字以现状为准——本仓每个测试文件都有自己的助手，新造平行的一套会更差。
