# 会话事件日志 P4b —— 实现计划（轨迹视图）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 GUI 里做出轨迹视图——把一条会话的事件按 turn 分组铺成表格，配统计工具条与密度带，做成对话栏上方的标签页。

**Architecture:** 数据从 P4a 开好的两个口子来：`GET /v1/sessions/{id}/events` 拉历史（经新增的 Go 绑定，不用 fetch），SSE 的 `session_event` 帧实时追加（经 `sse_bridge.go` 的**专用频道**，不订通用 firehose）。前端按 seq 连续性判断漏帧，漏了回端点从断点补拉。组件切分照抄 harness（`TrajectoryView` → `Toolbar`/`Timeline`/`Table` → `Turn` → `Cell`），不抄它的框架。

**Tech Stack:** React 19 + zustand + TypeScript + Tailwind；测试用 vitest + @testing-library/react（jsdom）；Wails v2 绑定。无新依赖。

## Global Constraints

- Spec：`legionAgent/docs/superpowers/specs/2026-08-31-session-event-log-and-trajectory-design.md`（在**另一个仓**，master）。本计划做 spec §7 的「前端组件」那段。
- **P4a 已合入 `stardust-agent-server` master（`acaa107`）**，三个口子都开好了。本计划只消费它们，**不改 server**。
- **fail-loud 铁律**（`legionAgentGUI/CLAUDE.md` §0）：禁止兜底/fallback、禁止丢弃错误、禁止静默跳过、禁止零值假装正常。唯一豁免是契约显式声明的「可选」。前端的对应写法：不要 `catch {}` 后照常渲染、不要把解析失败的事件当成空对象塞进列表。
- 完成判据：`npm run build`（`tsc && vite build`）通过，`npm test` 全绿；Go 侧改动 `go build ./... && go vet ./...` 全绿、`gofmt -l` 为空。
- 每条不变量都要有断言且**变异可验红**——每个任务最后一步写明「删掉什么会让哪条测试红」，实现者必须真跑并把输出贴进报告。
- **P4b 不做**：G3 开关（P5）、投影缓存、虚拟滚动（spec §7：靠 `limit` 分页压住每屏事件数，测出卡顿再加）。

### ⚠️ 跑测试必须在 `frontend/` 目录里

这个仓有过一次真栽：**在仓库根跑 `npm test` 会命中另一个没有 jsdom 的 vitest v4，症状是 `document is undefined` 的假失败**。jsdom 配置在 `frontend/vite.config.ts`（`environment: 'jsdom'`）。

**所有测试命令都必须 `cd frontend` 之后再跑。** 报告里贴命令时把 `cd` 一并贴出来。

### P4a 交过来的三个口子（契约，不要改）

| 口子 | 契约 |
|---|---|
| `GET /v1/sessions/{id}/events?from_seq=&limit=` | 响应 `{"events":[{"seq","type","time","data"}],"next_seq":N}`；**截断时 `next_seq` 指向被截掉的第一条**；会话不存在 404（与「没有事件」是两件事） |
| SSE `session_event` 帧 | 帧的 `data` 里有 `session_id`、`seq`、`event_type`；**不带完整事件 data**——帧只做通知，内容回端点拉 |
| `tool/result` 的 `spill_locator` | 工具根相对路径，交给 `/v1/files?session_id=<sid>&path=<locator>` 取全文 |

### ⚠️ `spill_locator` 有一个前提（P4a 复审抓到，spec §7 已写明）

两个根**仅当会话绑定了 `working_dir` 时同源**。未绑定的会话，spill 落在 `ContextFiles.Root` 下并产出一个非空定位符，而 `/v1/files` 对空 `WorkingDir` 直接 **404**——**那个定位符取不回来**。

server 侧有意不修（返回空串等于「有全文却说没有」）。**所以 P4b 必须把 404 当成「全文不可得」的合法结果渲染，不是错误弹窗。**

### 事件类型闭集（server 侧 `domain.SessionEventType`）

`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`assistant/message`、`tool/call`、`tool/result`。

**遇到不认识的类型不要静默丢弃**——渲染成一行「未知事件类型 X」并把原始 JSON 折叠在里面。理由：静默丢弃意味着 server 加了新类型后，轨迹会悄悄少东西而没人发现；而这正是这个项目栽过五次的形状。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `app_session_events.go`（新建） | Wails 绑定 `GetSessionEvents(sessionID string, fromSeq int64, limit int)`：调 P4a 的端点 |
| `app_session_events_test.go`（新建） | 绑定的参数校验与响应解码 |
| `sse_bridge.go`（修改） | `session_event` 走**专用频道** `agent:session_event`，不让轨迹订通用 firehose |
| `sse_bridge_test.go`（修改） | 专用频道的断言 |
| `frontend/src/stores/trajectoryStore.ts`（新建） | 事件列表、按 turn 分组、seq 连续性与补拉状态 |
| `frontend/src/stores/trajectoryStore.test.ts`（新建） | 分组、漏帧判定、补拉触发 |
| `frontend/src/hooks/useSessionEvents.ts`（新建） | 订阅 `agent:session_event`、首屏加载、漏帧时补拉 |
| `frontend/src/hooks/useSessionEvents.test.tsx`（新建） | 订阅与补拉的接线 |
| `frontend/src/components/trajectory/TrajectoryCell.tsx`（新建） | USER / ASSISTANT / TOOL 一行：徽章 + 摘要 +（TOOL）结果预览与全文展开 |
| `frontend/src/components/trajectory/TrajectoryTurn.tsx`（新建） | 按 turn 分组，左侧 "Turn N" 标记 |
| `frontend/src/components/trajectory/TrajectoryTable.tsx`（新建） | 表格容器 |
| `frontend/src/components/trajectory/TrajectoryToolbar.tsx`（新建） | Duration / Turns / Calls + 搜索框 |
| `frontend/src/components/trajectory/TrajectoryTimeline.tsx`（新建） | 顶部三条密度带（Input / Model / Tools） |
| `frontend/src/components/trajectory/TrajectoryView.tsx`（新建） | 组装上面四个 |
| 各组件的 `.test.tsx` | 与本仓既有组件一一对应的测试范式 |
| `frontend/src/components/ChatPanel.tsx` 或其容器（修改） | 「对话 / 轨迹」标签页，互斥 |
| `frontend/src/components/status/EventsTab.tsx`（删除） | spec §7：轨迹落地后它退休——它是同一批数据的贫瘠版本 |

`trajectory/` 单独成目录：六个组件是一族，且本仓已有 `status/`、`layout/` 的同类先例。

---

## Task 1: Go 绑定与 SSE 专用频道

**Files:**
- Create: `app_session_events.go`
- Create: `app_session_events_test.go`
- Modify: `sse_bridge.go`
- Modify: `sse_bridge_test.go`

**Interfaces:**
- Consumes: P4a 的 `GET /v1/sessions/{id}/events`、SSE `session_event` 帧
- Produces: Wails 绑定 `GetSessionEvents(sessionID string, fromSeq int64, limit int) (map[string]any, error)`；Wails 事件 `agent:session_event`，payload `{type, data}`（`data` 是原始 JSON 字符串，与本仓既有专用频道一致）

**为什么要专用频道**：`sse_bridge.go` 的注释已经把理由写死了——通用 `agent:event` 频道**每个流式 token 一条**，让轨迹订它等于模型每吐一个字就唤醒一次面板。approval / browser / plugin 都因此有了专用频道，`session_event` 同理。

- [ ] **Step 1: 写失败的测试**

`app_session_events_test.go`：

```go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 绑定把 P4a 的端点原样开给前端。这条断言的是它真的带上了分页参数——
// 少带一个，轨迹翻页就会永远从头拉。
func TestGetSessionEventsPassesThePagingParameters(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"events":[{"seq":7,"type":"turn/start","time":"2026-09-02T00:00:00Z","data":{"turn":0}}],"next_seq":8}`))
	}))
	defer srv.Close()

	app := newTestAppWithBaseURL(t, srv.URL)
	got, err := app.GetSessionEvents("sess-1", 7, 100)
	if err != nil {
		t.Fatalf("GetSessionEvents: %v", err)
	}

	if !strings.Contains(gotQuery, "from_seq=7") {
		t.Errorf("请求 query = %q，要带 from_seq=7", gotQuery)
	}
	if !strings.Contains(gotQuery, "limit=100") {
		t.Errorf("请求 query = %q，要带 limit=100", gotQuery)
	}
	raw, _ := json.Marshal(got)
	if !strings.Contains(string(raw), `"next_seq"`) {
		t.Errorf("返回值里没有 next_seq，前端翻页要用它：%s", raw)
	}
}

// 空 session id 是调用方的错，必须报错而不是去请求一个畸形 URL。
func TestGetSessionEventsRefusesAnEmptySessionID(t *testing.T) {
	app := newTestAppWithBaseURL(t, "http://127.0.0.1:1")
	if _, err := app.GetSessionEvents("  ", 0, 0); err == nil {
		t.Fatal("空 session id 没有被拒绝")
	}
}

// 会话不存在时端点返回 404。绑定必须把它作为**错误**传上去，
// 而不是返回一个空事件列表——「没有事件」和「会话不存在」是两件事，
// 这正是 P4a 特意把它做成 404 的理由。
func TestGetSessionEventsSurfacesNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"session \"sess-nope\" not found"}`))
	}))
	defer srv.Close()

	app := newTestAppWithBaseURL(t, srv.URL)
	if _, err := app.GetSessionEvents("sess-nope", 0, 0); err == nil {
		t.Fatal("404 没有变成错误：前端会把「会话不存在」当成「这条会话没有事件」")
	}
}
```

> **实现者注意**：`newTestAppWithBaseURL` 需要你自己建或复用本仓既有的（`app.go` 的 `apiGet` 怎么拿 base URL，就照那个路子造一个测试用的 App）。**先读 `app.go` 里 `apiGet` 与 `GetSessionTurns`（`app.go:312`）的真实写法**，照它写，不要新造一套。

`sse_bridge_test.go` 加一条：

```go
// session_event 必须走专用频道。通用 agent:event 频道每个流式 token 一条，
// 轨迹订它等于模型每吐一个字就唤醒一次面板——approval/browser/plugin 都因此
// 有了专用频道（见 sse_bridge.go 里那段注释），session_event 同理。
func TestSessionEventsGetTheirOwnChannel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		frames := []string{
			"event: session_event\ndata: {\"session_id\":\"sess-1\",\"seq\":7,\"event_type\":\"tool/call\"}\n\n",
			"event: task.completed\ndata: {\"task_id\":\"task-1\"}\n\n",
		}
		for _, f := range frames {
			fmt.Fprint(w, f)
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
	defer srv.Close()

	type emitted struct {
		event string
		data  any
	}
	var got []emitted
	emit := func(event string, data any) {
		got = append(got, emitted{event: event, data: data})
	}

	if err := consumeSSE(context.Background(), srv.URL, emit); err == nil {
		t.Fatal("consumeSSE 返回了 nil error；流结束时应当带上原因")
	}

	// 1) 专用频道收到了它，data 是原始 JSON 字符串（与其它专用频道一致）。
	var dedicated []emitted
	for _, e := range got {
		if e.event == "agent:session_event" {
			dedicated = append(dedicated, e)
		}
	}
	if len(dedicated) != 1 {
		t.Fatalf("agent:session_event 收到 %d 条，要 1 条：轨迹订的就是这条频道，没有它就永远不会实时更新", len(dedicated))
	}
	payload, ok := dedicated[0].data.(map[string]any)
	if !ok {
		t.Fatalf("payload 类型 %T，要 map[string]any", dedicated[0].data)
	}
	if payload["type"] != "session_event" {
		t.Errorf("payload type = %v，要 session_event", payload["type"])
	}
	raw, ok := payload["data"].(string)
	if !ok || !strings.Contains(raw, `"seq":7`) {
		t.Errorf("payload data = %v，要原样转发含 seq 的 JSON 字符串", payload["data"])
	}

	// 2) 通用频道**也**收到了它——既有契约：agent:event 是全量的，
	//    专用频道是它的旁路而不是替代。
	generic := 0
	for _, e := range got {
		if e.event == "agent:event" {
			generic++
		}
	}
	if generic != 2 {
		t.Errorf("agent:event 收到 %d 条，要 2 条（session_event 与 task.completed 都该在全量频道里）", generic)
	}
}
```

> 那行 `t.Fatal` 是**故意的占位**，必须被真实断言替换。用 `t.Fatal` 而不是 `t.Skip`：`t.Skip` 挡不住编译期检查、留着毫无意义（本仓上游项目栽过），`t.Fatal` 会让这条测试永远红，逼你写完。

- [ ] **Step 2: 跑测试确认它红**

```bash
go test ./... -run "SessionEvents" -count=1 -timeout 5m
```

Expected: 编译失败（`GetSessionEvents` 未定义）+ 桥那条 `t.Fatal`。**把真实输出记进报告。**

- [ ] **Step 3: 写实现**

`app_session_events.go`：

```go
package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// GetSessionEvents 拉一条会话的原始事件，供轨迹视图的首屏与翻页使用。
//
// 它直通 P4a 的 GET /v1/sessions/{id}/events：响应里的 next_seq 由服务端给出，
// 截断时指向**被截掉的第一条**，前端据此续读不会漏事件。
//
// 走 Go 绑定而不是前端 fetch：WebView2 里跨源请求要处理 CORS 预检，而本仓已有
// 的绑定路径没有这个问题（app.go 的 apiGet 同源直连内嵌 serve）。
//
// fromSeq/limit 为 0 时不带该参数，由服务端用它的默认值——参数缺席是端点契约里
// 显式允许的可选，不是兜底。
func (a *App) GetSessionEvents(sessionID string, fromSeq int64, limit int) (map[string]any, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	q := url.Values{}
	if fromSeq > 0 {
		q.Set("from_seq", strconv.FormatInt(fromSeq, 10))
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	path := "/v1/sessions/" + url.PathEscape(sessionID) + "/events"
	if encoded := q.Encode(); encoded != "" {
		path += "?" + encoded
	}
	body, err := a.apiGet(path)
	if err != nil {
		return nil, err
	}
	var page map[string]any
	if err := json.Unmarshal(body, &page); err != nil {
		return nil, fmt.Errorf("decode session events for %q: %w", sessionID, err)
	}
	return page, nil
}
```

> **实现者注意**：`apiGet` 对非 2xx 的处理由它自己决定。**核实 404 真的会变成 error**（`TestGetSessionEventsSurfacesNotFound` 断的就是这个）——如果 `apiGet` 把 404 当成正常响应返回 body，那这条测试会红，**修的是这里而不是测试**：在本函数里显式检查。把你核实的结论写进报告。

`sse_bridge.go` 在既有的 `switch eventType` 里加一路：

```go
case "session_event":
	// 会话事件走专用频道。通用 agent:event 频道每个流式 token 一条，
	// 让轨迹订它等于模型每吐一个字就唤醒一次面板——与 approval/browser/plugin
	// 分频道的理由完全一样。
	//
	// data 原样转发（与其它专用频道一致），React 侧自己 parse。
	emit("agent:session_event", map[string]any{
		"type": eventType,
		"data": data,
	})
```

- [ ] **Step 4: 跑测试确认它绿**

```bash
go build ./... && go vet ./...
go test ./... -run "SessionEvents" -count=1 -timeout 5m -v
gofmt -l $(git ls-files '*.go')
```

Expected: 四条测试都 `--- PASS`（桥那条的 `t.Fatal` 此时必须已删）。核对 `-run` 真的匹配到了你写的函数名（`grep -n "^func Test" app_session_events_test.go sse_bridge_test.go`），不要接受 `[no tests to run]` 却报 `ok`。

- [ ] **Step 5: 变异验证（三条）**

| # | 变异 | 期望红在哪 |
|---|---|---|
| 1 | `GetSessionEvents` 里不拼 `from_seq` | `TestGetSessionEventsPassesThePagingParameters` |
| 2 | 桥里那一路 `emit("agent:session_event", ...)` 删掉 | `TestSessionEventsGetTheirOwnChannel` |
| 3 | 空 session id 检查删掉 | `TestGetSessionEventsRefusesAnEmptySessionID` |

变异 2 是**接线守卫**——桥不发帧，轨迹就永远不会实时更新，而这不会报任何错。若它不红，**补测试再继续**。

每条：改 → 跑 → 贴真实 FAIL 输出 → `git checkout --` 还原 → `git status --short` 确认为空。**变异只造成编译失败不算变异验证**。

- [ ] **Step 6: 生成绑定并提交**

```bash
wails generate module
git add app_session_events.go app_session_events_test.go sse_bridge.go sse_bridge_test.go frontend/wailsjs/go/main/App.d.ts frontend/wailsjs/go/main/App.js
git commit -m "feat(gui): 会话事件的 Go 绑定与 SSE 专用频道"
```

> `wails generate module` 会重写 `frontend/wailsjs/`。**只 stage 上面列出的文件**，如果它顺带改了别的绑定文件，先看清楚是不是你的改动引起的。

---

## Task 2: `trajectoryStore` —— 分组、漏帧判定、补拉

**Files:**
- Create: `frontend/src/stores/trajectoryStore.ts`
- Create: `frontend/src/stores/trajectoryStore.test.ts`

**Interfaces:**
- Consumes: 事件的形状 `{seq: number, type: string, time: string, data: Record<string, unknown>}`
- Produces: `useTrajectoryStore`，含 `events`、`turns`（分组结果）、`appendFromFrame(sessionID, seq)`、`loadPage(events, nextSeq)`、`gapDetected`

**这个 store 是轨迹的算法核心**，与渲染无关，所以能脱离 DOM 直接单测——本仓 `stores/*.test.ts` 就是这个范式。

- [ ] **Step 1: 写失败的测试**

`frontend/src/stores/trajectoryStore.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useTrajectoryStore } from './trajectoryStore'

const ev = (seq: number, type: string, data: Record<string, unknown> = {}) => ({
  seq,
  type,
  time: '2026-09-02T00:00:00Z',
  data: { turn: 0, ...data },
})

beforeEach(() => {
  useTrajectoryStore.getState().reset()
})

describe('按 turn 分组', () => {
  it('把事件按 data.turn 分成组，组内保持 seq 顺序', () => {
    useTrajectoryStore.getState().loadPage(
      [
        ev(0, 'turn/start', { turn: 0 }),
        ev(1, 'user/message', { turn: 0, content: '第一轮' }),
        ev(2, 'turn/end', { turn: 0, reason: 'completed' }),
        ev(3, 'turn/start', { turn: 1 }),
        ev(4, 'user/message', { turn: 1, content: '第二轮' }),
      ],
      5,
    )

    const turns = useTrajectoryStore.getState().turns
    expect(turns).toHaveLength(2)
    expect(turns[0].turn).toBe(0)
    expect(turns[0].events.map((e) => e.seq)).toEqual([0, 1, 2])
    expect(turns[1].turn).toBe(1)
    expect(turns[1].events.map((e) => e.seq)).toEqual([3, 4])
  })
})

describe('漏帧判定', () => {
  // SSE 帧只做通知，不保证送达。前端靠 seq 连续性发现漏帧，漏了回端点补拉。
  // 这条断言的是「发现」——补拉的接线是 useSessionEvents 的事。
  it('帧的 seq 不接着已有的最后一条时，标记出现缺口', () => {
    const store = useTrajectoryStore.getState()
    store.loadPage([ev(0, 'turn/start'), ev(1, 'user/message')], 2)

    store.appendFromFrame('sess-1', 2)
    expect(useTrajectoryStore.getState().gapDetected).toBe(false)

    // seq 5 跳过了 2/3/4
    store.appendFromFrame('sess-1', 5)
    expect(useTrajectoryStore.getState().gapDetected).toBe(true)
  })

  it('缺口被补上之后清除标记', () => {
    const store = useTrajectoryStore.getState()
    store.loadPage([ev(0, 'turn/start')], 1)
    store.appendFromFrame('sess-1', 4)
    expect(useTrajectoryStore.getState().gapDetected).toBe(true)

    store.loadPage([ev(1, 'user/message'), ev(2, 'step/start'), ev(3, 'assistant/message'), ev(4, 'turn/end')], 5)
    expect(useTrajectoryStore.getState().gapDetected).toBe(false)
  })
})

describe('重复与乱序', () => {
  // 补拉与实时帧可能带来同一条 seq 两次。事件是 append-only 且 seq 唯一，
  // 所以重复的那条应当被丢弃而不是渲染两行。
  it('同一个 seq 只保留一条', () => {
    const store = useTrajectoryStore.getState()
    store.loadPage([ev(0, 'turn/start'), ev(1, 'user/message')], 2)
    store.loadPage([ev(1, 'user/message'), ev(2, 'step/start')], 3)

    expect(useTrajectoryStore.getState().events.map((e) => e.seq)).toEqual([0, 1, 2])
  })
})

describe('未知事件类型', () => {
  // server 侧的类型是闭集，但它会长。静默丢弃意味着 server 加了新类型后
  // 轨迹会悄悄少东西而没人发现——这个项目栽过五次的形状。
  it('保留未知类型的事件，不丢弃', () => {
    useTrajectoryStore.getState().loadPage([ev(0, 'turn/start'), ev(1, 'session/teleport')], 2)

    const events = useTrajectoryStore.getState().events
    expect(events.map((e) => e.type)).toContain('session/teleport')
  })
})
```

- [ ] **Step 2: 跑测试确认它红**

```bash
cd frontend && npx vitest run src/stores/trajectoryStore.test.ts
```

Expected: 找不到模块 `./trajectoryStore`。**注意必须在 `frontend/` 里跑**——在仓库根跑会命中另一个没有 jsdom 的 vitest，产出 `document is undefined` 的假失败。

- [ ] **Step 3: 写实现**

`frontend/src/stores/trajectoryStore.ts`：

```ts
import { create } from 'zustand'

export interface SessionEvent {
  seq: number
  type: string
  time: string
  data: Record<string, unknown>
}

export interface TrajectoryTurnGroup {
  turn: number
  events: SessionEvent[]
}

interface TrajectoryState {
  events: SessionEvent[]
  turns: TrajectoryTurnGroup[]
  /**
   * nextSeq 是服务端给的续读点。截断时它指向**被截掉的第一条**（P4a 的契约），
   * 所以前端据此翻页不会漏。
   */
  nextSeq: number
  /**
   * gapDetected 表示实时帧的 seq 跳过了若干条——SSE 帧只做通知、不保证送达，
   * 发现缺口就回端点从断点补拉，而不是猜中间是什么。
   */
  gapDetected: boolean
  loadPage: (events: SessionEvent[], nextSeq: number) => void
  appendFromFrame: (sessionID: string, seq: number) => void
  reset: () => void
}

/** groupByTurn 把事件按 data.turn 分组，组内保持 seq 顺序。 */
function groupByTurn(events: SessionEvent[]): TrajectoryTurnGroup[] {
  const groups = new Map<number, SessionEvent[]>()
  for (const e of events) {
    // turn 是事件载荷的约定字段（spec §4.1：turn 每会话单调）。它缺席是数据
    // 损坏而不是可选，但前端不该因此白屏——归到 -1 组并让它显式地显示出来。
    const turn = typeof e.data?.turn === 'number' ? e.data.turn : -1
    const bucket = groups.get(turn)
    if (bucket) bucket.push(e)
    else groups.set(turn, [e])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, evs]) => ({ turn, events: evs }))
}

/** mergeBySeq 合并两批事件：seq 唯一，重复的丢弃，结果按 seq 升序。 */
function mergeBySeq(existing: SessionEvent[], incoming: SessionEvent[]): SessionEvent[] {
  const bySeq = new Map<number, SessionEvent>()
  for (const e of existing) bySeq.set(e.seq, e)
  for (const e of incoming) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

export const useTrajectoryStore = create<TrajectoryState>((set, get) => ({
  events: [],
  turns: [],
  nextSeq: 0,
  gapDetected: false,

  loadPage: (incoming, nextSeq) => {
    const events = mergeBySeq(get().events, incoming)
    // 补完之后重新判定缺口：seq 从 0 起连续（P1 的不变量），所以
    // 「最后一条的 seq + 1 === 条数」等价于「没有洞」。
    const contiguous = events.length === 0 || events[events.length - 1].seq + 1 === events.length
    set({ events, turns: groupByTurn(events), nextSeq, gapDetected: !contiguous })
  },

  appendFromFrame: (_sessionID, seq) => {
    const { events } = get()
    const expected = events.length === 0 ? 0 : events[events.length - 1].seq + 1
    if (seq > expected) {
      // 跳号了：帧漏了。标记出来，由 useSessionEvents 回端点补拉。
      set({ gapDetected: true })
      return
    }
    // seq <= expected：这一条要么已经有了（补拉先到），要么正好接上。
    // 帧本身不带事件内容（P4a 的契约：帧只做通知），所以这里不入列，
    // 由调用方拉取后经 loadPage 进来。
  },

  reset: () => set({ events: [], turns: [], nextSeq: 0, gapDetected: false }),
}))
```

> **实现者注意**：上面 `appendFromFrame` 在「正好接上」时什么都不做——因为帧不带内容。**这意味着实时追加靠的是 `useSessionEvents` 收到帧后去拉**（Task 3）。请在实现时确认这个分工合理，若你认为 store 该承担更多，在报告里说明再改。

- [ ] **Step 4: 跑测试确认它绿**

```bash
cd frontend && npx vitest run src/stores/trajectoryStore.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 变异验证（三条）**

| # | 变异 | 期望红在哪 |
|---|---|---|
| 1 | `mergeBySeq` 改成 `[...existing, ...incoming]`（不去重） | 「同一个 seq 只保留一条」 |
| 2 | `appendFromFrame` 的 `seq > expected` 改成恒 false | 「帧的 seq 不接着已有的最后一条时，标记出现缺口」 |
| 3 | `groupByTurn` 里未知 turn 的事件直接 `continue`（丢弃） | 「保留未知类型的事件，不丢弃」（若不红，说明那条测试没盖住丢弃路径——**补测试**） |

每条：改 → 跑 → 贴真实 FAIL 输出 → 还原 → `git status --short` 确认为空。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/stores/trajectoryStore.ts frontend/src/stores/trajectoryStore.test.ts
git commit -m "feat(gui): 轨迹 store——按 turn 分组与漏帧判定"
```

---

## Task 3: `useSessionEvents` —— 首屏加载、实时追加、漏帧补拉

**Files:**
- Create: `frontend/src/hooks/useSessionEvents.ts`
- Create: `frontend/src/hooks/useSessionEvents.test.tsx`

**Interfaces:**
- Consumes: Task 1 的绑定 `GetSessionEvents`、Wails 事件 `agent:session_event`；Task 2 的 `useTrajectoryStore`
- Produces: `useSessionEvents(sessionID: string | null)`——挂载时拉首屏，收到帧时追加，发现缺口时补拉

**这是本期的接线任务**，也是「接缝在但没人调用它」的高发区。本仓 `useBrowserStream.ts` / `useHtmlPreviewEvents.ts` 是同类范式，**先读它们**。

- [ ] **Step 1: 写失败的测试**

`frontend/src/hooks/useSessionEvents.test.tsx`：

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  GetSessionEvents: vi.fn(),
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))

vi.mock('../../wailsjs/go/main/App', () => ({ GetSessionEvents: mocks.GetSessionEvents }))
vi.mock('../../wailsjs/runtime/runtime', () => ({ EventsOn: mocks.EventsOn, EventsOff: mocks.EventsOff }))

import { useSessionEvents } from './useSessionEvents'
import { useTrajectoryStore } from '../stores/trajectoryStore'

const page = (events: unknown[], nextSeq: number) => ({ events, next_seq: nextSeq })

beforeEach(() => {
  vi.clearAllMocks()
  useTrajectoryStore.getState().reset()
  mocks.GetSessionEvents.mockResolvedValue(page([], 0))
})

describe('首屏', () => {
  it('挂载时按会话号拉一次事件', async () => {
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ seq: 0, type: 'turn/start', time: 't', data: { turn: 0 } }], 1),
    )

    renderHook(() => useSessionEvents('sess-1'))

    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalledWith('sess-1', 0, expect.any(Number)))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(1))
  })

  it('没有会话号时不发请求', () => {
    renderHook(() => useSessionEvents(null))
    expect(mocks.GetSessionEvents).not.toHaveBeenCalled()
  })
})

describe('实时追加', () => {
  // 帧只做通知、不带内容（P4a 契约），所以收到帧要回端点拉。
  // 这条断言的是**接线**：帧来了，确实去拉了。
  it('收到 agent:session_event 帧后从断点续拉', async () => {
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ seq: 0, type: 'turn/start', time: 't', data: { turn: 0 } }], 1),
    )
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(1))

    const handler = mocks.EventsOn.mock.calls.find((c) => c[0] === 'agent:session_event')?.[1]
    expect(handler, 'hook 没有订阅 agent:session_event 专用频道').toBeTypeOf('function')

    mocks.GetSessionEvents.mockClear()
    mocks.GetSessionEvents.mockResolvedValue(
      page([{ seq: 1, type: 'user/message', time: 't', data: { turn: 0, content: '你好' } }], 2),
    )
    handler!({ type: 'session_event', data: JSON.stringify({ session_id: 'sess-1', seq: 1, event_type: 'user/message' }) })

    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalledWith('sess-1', 1, expect.any(Number)))
    await waitFor(() => expect(useTrajectoryStore.getState().events).toHaveLength(2))
  })

  // 别的会话的帧不该惊动这条会话的轨迹。
  it('忽略其它会话的帧', async () => {
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(mocks.GetSessionEvents).toHaveBeenCalled())

    const handler = mocks.EventsOn.mock.calls.find((c) => c[0] === 'agent:session_event')?.[1]
    mocks.GetSessionEvents.mockClear()
    handler!({ type: 'session_event', data: JSON.stringify({ session_id: 'sess-别人', seq: 9, event_type: 'turn/start' }) })

    expect(mocks.GetSessionEvents).not.toHaveBeenCalled()
  })

  // 载荷不是 JSON 是坏数据。不能当成空对象塞进去（fail-loud），
  // 也不能让整个面板崩掉。
  it('坏载荷被记录而不是崩溃', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())

    const handler = mocks.EventsOn.mock.calls.find((c) => c[0] === 'agent:session_event')?.[1]
    expect(() => handler!({ type: 'session_event', data: '{不是 JSON' })).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('卸载', () => {
  it('卸载时退订', async () => {
    const { unmount } = renderHook(() => useSessionEvents('sess-1'))
    await waitFor(() => expect(mocks.EventsOn).toHaveBeenCalled())
    unmount()
    expect(mocks.EventsOff).toHaveBeenCalledWith('agent:session_event')
  })
})
```

> **实现者注意**：mock 路径（`'../../wailsjs/go/main/App'`）要与本仓既有 hook 测试一致——**先读 `useBrowserStream.test.tsx` 或 `useHtmlPreviewEvents.test.tsx`**，照抄它们的 mock 写法，不要凭空写。

- [ ] **Step 2: 跑测试确认它红**

```bash
cd frontend && npx vitest run src/hooks/useSessionEvents.test.tsx
```

Expected: 找不到模块 `./useSessionEvents`。

- [ ] **Step 3: 写实现**

`frontend/src/hooks/useSessionEvents.ts`：

```ts
import { useEffect } from 'react'
import { GetSessionEvents } from '../../wailsjs/go/main/App'
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime'
import { useTrajectoryStore, type SessionEvent } from '../stores/trajectoryStore'

/** 一页拉多少条。spec §7 定了「虚拟滚动先不做，靠 limit 分页压住每屏事件数」。 */
const PAGE_LIMIT = 500

/**
 * useSessionEvents 把一条会话的事件喂给轨迹 store。
 *
 * 首屏拉一次；之后订阅 agent:session_event 专用频道——**不订通用 agent:event**，
 * 那条频道每个流式 token 一条，会让轨迹在模型说话时被反复唤醒。
 *
 * 帧只做通知、不带事件内容（P4a 的契约），所以收到帧后从 store 的 nextSeq
 * 续拉。跳号时同样是续拉——补的正是漏掉的那几条，而不是猜。
 */
export function useSessionEvents(sessionID: string | null) {
  useEffect(() => {
    if (!sessionID) return
    let cancelled = false

    const pull = async (fromSeq: number) => {
      try {
        const page = await GetSessionEvents(sessionID, fromSeq, PAGE_LIMIT)
        if (cancelled) return
        const events = (page?.events ?? []) as SessionEvent[]
        const nextSeq = Number(page?.next_seq ?? fromSeq)
        useTrajectoryStore.getState().loadPage(events, nextSeq)
      } catch (err) {
        // 拉不到就是拉不到：记录并停在原地，让下一帧再触发一次。
        // 不要把它吞成「这条会话没有事件」——那是 fail-loud 铁律禁止的零值假装正常。
        console.error(`加载会话 ${sessionID} 的事件失败:`, err)
      }
    }

    useTrajectoryStore.getState().reset()
    void pull(0)

    const onFrame = (payload: { type: string; data: string }) => {
      let parsed: { session_id?: string; seq?: number }
      try {
        parsed = JSON.parse(payload.data)
      } catch (err) {
        console.error('agent:session_event 载荷不是合法 JSON:', payload, err)
        return
      }
      if (parsed.session_id !== sessionID) return
      const seq = Number(parsed.seq)
      if (!Number.isFinite(seq)) {
        console.error('agent:session_event 载荷缺少 seq:', payload)
        return
      }
      useTrajectoryStore.getState().appendFromFrame(sessionID, seq)
      void pull(useTrajectoryStore.getState().nextSeq)
    }

    EventsOn('agent:session_event', onFrame)
    return () => {
      cancelled = true
      EventsOff('agent:session_event')
    }
  }, [sessionID])
}
```

- [ ] **Step 4: 跑测试确认它绿**

```bash
cd frontend && npx vitest run src/hooks/useSessionEvents.test.tsx
```

- [ ] **Step 5: 变异验证（三条）**

| # | 变异 | 期望红在哪 |
|---|---|---|
| 1 | `EventsOn('agent:session_event', ...)` 改成 `EventsOn('agent:event', ...)` | 「收到 agent:session_event 帧后从断点续拉」 |
| 2 | `parsed.session_id !== sessionID` 那条 return 删掉 | 「忽略其它会话的帧」 |
| 3 | 收到帧后不调 `pull` | 「收到 agent:session_event 帧后从断点续拉」 |

变异 1 与 3 是**接线守卫**：订错频道或收到帧不拉，轨迹都会静静地不更新而不报任何错。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/hooks/useSessionEvents.ts frontend/src/hooks/useSessionEvents.test.tsx
git commit -m "feat(gui): 会话事件的订阅与断点续拉"
```

---

## Task 4: 轨迹的五个组件

**Files:**
- Create: `frontend/src/components/trajectory/TrajectoryCell.tsx` + `.test.tsx`
- Create: `frontend/src/components/trajectory/TrajectoryTurn.tsx` + `.test.tsx`
- Create: `frontend/src/components/trajectory/TrajectoryTable.tsx` + `.test.tsx`
- Create: `frontend/src/components/trajectory/TrajectoryToolbar.tsx` + `.test.tsx`
- Create: `frontend/src/components/trajectory/TrajectoryTimeline.tsx` + `.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `SessionEvent`、`TrajectoryTurnGroup`
- Produces: 五个纯展示组件（数据从 props 来，不自己取数）

**组件切分照抄 harness**（spec §7），**不抄它的框架**：

```
TrajectoryView（Task 5 组装）
├─ TrajectoryToolbar    Duration / Turns / Calls + 搜索框
├─ TrajectoryTimeline   顶部三条密度带（Input / Model / Tools）
└─ TrajectoryTable
   └─ TrajectoryTurn（按 turn 分组，左侧 "Turn N" 标记）
      └─ TrajectoryCell   USER / ASSISTANT / TOOL 行：徽章 + 摘要 +（TOOL）→ 结果预览
```

**五个组件都是纯展示**：数据从 props 来，取数在 Task 3 的 hook 里。这样它们能脱离 Wails 直接测。

- [ ] **Step 1: 写失败的测试**

由于五个组件的测试较长，这一步分成五个文件写。**每个文件都必须有真实断言，不许只写组件名**。

`TrajectoryCell.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrajectoryCell } from './TrajectoryCell'

const ev = (type: string, data: Record<string, unknown>) => ({
  seq: 1, type, time: '2026-09-02T00:00:00Z', data: { turn: 0, ...data },
})

describe('TrajectoryCell', () => {
  it('user/message 显示 USER 徽章与内容', () => {
    render(<TrajectoryCell event={ev('user/message', { content: '帮我读文件' })} sessionID="sess-1" />)
    expect(screen.getByText('USER')).toBeInTheDocument()
    expect(screen.getByText(/帮我读文件/)).toBeInTheDocument()
  })

  it('tool/call 显示工具名与参数', () => {
    render(<TrajectoryCell event={ev('tool/call', { name: 'read_file', call_id: 'c1', arguments: '{"path":"a.md"}' })} sessionID="sess-1" />)
    expect(screen.getByText('TOOL')).toBeInTheDocument()
    expect(screen.getByText(/read_file/)).toBeInTheDocument()
    expect(screen.getByText(/a\.md/)).toBeInTheDocument()
  })

  it('tool/result 显示预览，出错时有明确标记', () => {
    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c1', preview: '读到了 42 行', is_error: false })} sessionID="sess-1" />)
    expect(screen.getByText(/读到了 42 行/)).toBeInTheDocument()

    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c2', preview: '文件不存在', is_error: true })} sessionID="sess-1" />)
    expect(screen.getByText(/文件不存在/)).toBeInTheDocument()
  })

  // 未知类型不能静默丢弃——server 侧的类型闭集会长，静默丢弃意味着
  // 轨迹会悄悄少东西而没人发现。
  it('未知事件类型渲染成一行并标出类型名', () => {
    render(<TrajectoryCell event={ev('session/teleport', { note: 'x' })} sessionID="sess-1" />)
    expect(screen.getByText(/session\/teleport/)).toBeInTheDocument()
  })
})
```

`TrajectoryTurn.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrajectoryTurn } from './TrajectoryTurn'

describe('TrajectoryTurn', () => {
  it('左侧显示 Turn N 标记，并渲染组内每一条事件', () => {
    render(
      <TrajectoryTurn
        group={{
          turn: 2,
          events: [
            { seq: 10, type: 'user/message', time: 't', data: { turn: 2, content: '问题' } },
            { seq: 11, type: 'assistant/message', time: 't', data: { turn: 2, content: '回答' } },
          ],
        }}
        sessionID="sess-1"
      />,
    )
    expect(screen.getByText(/Turn 2/)).toBeInTheDocument()
    expect(screen.getByText(/问题/)).toBeInTheDocument()
    expect(screen.getByText(/回答/)).toBeInTheDocument()
  })
})
```

`TrajectoryTable.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrajectoryTable } from './TrajectoryTable'

describe('TrajectoryTable', () => {
  it('按顺序渲染每个 turn 分组', () => {
    render(
      <TrajectoryTable
        turns={[
          { turn: 0, events: [{ seq: 0, type: 'user/message', time: 't', data: { turn: 0, content: '第一' } }] },
          { turn: 1, events: [{ seq: 1, type: 'user/message', time: 't', data: { turn: 1, content: '第二' } }] },
        ]}
        sessionID="sess-1"
      />,
    )
    expect(screen.getByText(/Turn 0/)).toBeInTheDocument()
    expect(screen.getByText(/Turn 1/)).toBeInTheDocument()
  })

  it('没有事件时说明这条会话还没有轨迹，而不是空白', () => {
    render(<TrajectoryTable turns={[]} sessionID="sess-1" />)
    expect(screen.getByText(/还没有/)).toBeInTheDocument()
  })
})
```

`TrajectoryToolbar.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TrajectoryToolbar } from './TrajectoryToolbar'

const events = [
  { seq: 0, type: 'turn/start', time: '2026-09-02T00:00:00Z', data: { turn: 0 } },
  { seq: 1, type: 'user/message', time: '2026-09-02T00:00:01Z', data: { turn: 0, content: 'x' } },
  { seq: 2, type: 'tool/call', time: '2026-09-02T00:00:02Z', data: { turn: 0, name: 'read_file', call_id: 'c1' } },
  { seq: 3, type: 'tool/call', time: '2026-09-02T00:00:03Z', data: { turn: 0, name: 'write_file', call_id: 'c2' } },
  { seq: 4, type: 'turn/end', time: '2026-09-02T00:00:10Z', data: { turn: 0, reason: 'completed' } },
]

describe('TrajectoryToolbar', () => {
  it('统计 Turns 与 Calls', () => {
    render(<TrajectoryToolbar events={events} turnCount={1} query="" onQueryChange={() => {}} />)
    expect(screen.getByText(/Turns/)).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/Calls/)).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('Duration 用首尾事件的时间差', () => {
    render(<TrajectoryToolbar events={events} turnCount={1} query="" onQueryChange={() => {}} />)
    // 首 00:00:00 尾 00:00:10 → 10 秒
    expect(screen.getByText(/10/)).toBeInTheDocument()
  })

  it('搜索框把输入交给调用方', async () => {
    const onQueryChange = vi.fn()
    render(<TrajectoryToolbar events={events} turnCount={1} query="" onQueryChange={onQueryChange} />)
    await userEvent.type(screen.getByRole('searchbox'), 'read')
    expect(onQueryChange).toHaveBeenCalled()
  })
})
```

`TrajectoryTimeline.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrajectoryTimeline } from './TrajectoryTimeline'

describe('TrajectoryTimeline', () => {
  it('渲染 Input / Model / Tools 三条密度带', () => {
    render(
      <TrajectoryTimeline
        events={[
          { seq: 0, type: 'user/message', time: 't', data: { turn: 0 } },
          { seq: 1, type: 'assistant/message', time: 't', data: { turn: 0 } },
          { seq: 2, type: 'tool/call', time: 't', data: { turn: 0, name: 'read_file' } },
        ]}
      />,
    )
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
  })

  it('每条带子的刻度数反映该类事件的条数', () => {
    const { container } = render(
      <TrajectoryTimeline
        events={[
          { seq: 0, type: 'tool/call', time: 't', data: { turn: 0 } },
          { seq: 1, type: 'tool/call', time: 't', data: { turn: 0 } },
          { seq: 2, type: 'tool/call', time: 't', data: { turn: 0 } },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-band="tools"] [data-tick]')).toHaveLength(3)
  })
})
```

- [ ] **Step 2: 跑测试确认它红**

```bash
cd frontend && npx vitest run src/components/trajectory/
```

Expected: 五个文件都找不到对应模块。**把真实输出记进报告。**

- [ ] **Step 3: 写实现**

五个组件都是纯展示。**样式照本仓既有组件的 Tailwind 用法**（先读 `components/status/TasksTab.tsx` 与 `components/FileCard.tsx`），这里只规定行为契约：

- **`TrajectoryCell`**：按 `event.type` 分派。`user/message` → USER 徽章 + `data.content`；`assistant/message` → ASSISTANT 徽章 + `data.content`（空正文是合法的——P3 折叠前的中间轮次就是空的，显示成「（无正文）」而不是空白行）；`tool/call` → TOOL 徽章 + `data.name` + `data.arguments`；`tool/result` → 结果预览 + `data.is_error` 的明确标记 + **`data.spill_locator` 非空时给一个「查看全文」的入口**；`turn/*`、`step/*` → 细边界行；**未知类型 → 一行「未知事件类型 X」并把原始 JSON 折叠在里面**。

  > **全文入口的契约（P4a 复审抓到的 caveat）**：定位符交给 `/v1/files?session_id=<sid>&path=<locator>`，但**会话未绑定 `working_dir` 时那个请求会 404，而且这是预期的**——server 侧有意不修。所以这个入口必须把 404 渲染成「全文不可得」的说明，**不是错误弹窗**。

- **`TrajectoryTurn`**：左侧 "Turn N" 标记 + 组内每条事件一个 `TrajectoryCell`。

- **`TrajectoryTable`**：按顺序渲染 turn 分组；空列表时显式说明「这条会话还没有轨迹」。

- **`TrajectoryToolbar`**：Duration（首尾事件时间差）/ Turns（分组数）/ Calls（`tool/call` 条数）+ 搜索框（`role="searchbox"`，输入交给调用方）。

- **`TrajectoryTimeline`**：三条密度带，`data-band` 分别为 `input`/`model`/`tools`，每条事件一个 `data-tick`。Input 对应 `user/message`，Model 对应 `assistant/message`，Tools 对应 `tool/call` + `tool/result`。

- [ ] **Step 4: 跑测试确认它绿**

```bash
cd frontend && npx vitest run src/components/trajectory/
```

核对每个 `-run`/文件路径确实匹配到了你写的测试。

- [ ] **Step 5: 变异验证（三条）**

| # | 变异 | 期望红在哪 |
|---|---|---|
| 1 | `TrajectoryCell` 的未知类型分支改成 `return null` | 「未知事件类型渲染成一行并标出类型名」 |
| 2 | `TrajectoryToolbar` 的 Calls 统计把 `tool/call` 换成所有事件 | 「统计 Turns 与 Calls」 |
| 3 | `TrajectoryTimeline` 的 tools 带子不渲染 tick | 「每条带子的刻度数反映该类事件的条数」 |

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/trajectory/
git commit -m "feat(gui): 轨迹的五个展示组件"
```

---

## Task 5: 组装、接进标签页、让「事件」标签退休

**Files:**
- Create: `frontend/src/components/trajectory/TrajectoryView.tsx` + `.test.tsx`
- Modify: 对话栏的容器组件（加「对话 / 轨迹」标签页——**实现者需自己定位**）
- Delete: `frontend/src/components/status/EventsTab.tsx` 与它的测试
- Modify: 引用 `EventsTab` 的地方

**Interfaces:**
- Consumes: Task 3 的 `useSessionEvents`、Task 4 的五个组件、Task 2 的 `useTrajectoryStore`
- Produces: `TrajectoryView`（自己取数、自己订阅）；对话栏上方的标签页

**spec §7 的两条硬要求**：

- **位置**：轨迹是**对话栏上方的标签页**（「对话 / 轨迹」），**与对话互斥**。理由：轨迹是「回头看整件事」的专注动作，且需要横向空间放「命令 → 结果」。
- **「事件」标签退休**：右侧状态栏现有的 `EventsTab` 是**同一批数据的贫瘠版本**，轨迹落地后删掉它。

**搜索是客户端的**（spec §7）：在**已加载的事件**里搜，与服务端的 FTS5 不共用——用户搜的是「我刚看到的这些」，模型搜的是「整个历史」。

- [ ] **Step 1: 写失败的测试**

`TrajectoryView.test.tsx`：

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  GetSessionEvents: vi.fn(),
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}))
vi.mock('../../../wailsjs/go/main/App', () => ({ GetSessionEvents: mocks.GetSessionEvents }))
vi.mock('../../../wailsjs/runtime/runtime', () => ({ EventsOn: mocks.EventsOn, EventsOff: mocks.EventsOff }))

import { TrajectoryView } from './TrajectoryView'
import { useTrajectoryStore } from '../../stores/trajectoryStore'

beforeEach(() => {
  vi.clearAllMocks()
  useTrajectoryStore.getState().reset()
  mocks.GetSessionEvents.mockResolvedValue({
    events: [
      { seq: 0, type: 'turn/start', time: '2026-09-02T00:00:00Z', data: { turn: 0 } },
      { seq: 1, type: 'user/message', time: '2026-09-02T00:00:01Z', data: { turn: 0, content: '读一下 notes.md' } },
      { seq: 2, type: 'tool/call', time: '2026-09-02T00:00:02Z', data: { turn: 0, name: 'read_file', call_id: 'c1' } },
    ],
    next_seq: 3,
  })
})

describe('TrajectoryView', () => {
  it('挂载后把事件铺成轨迹', async () => {
    render(<TrajectoryView sessionID="sess-1" />)
    await waitFor(() => expect(screen.getByText(/Turn 0/)).toBeInTheDocument())
    expect(screen.getByText(/读一下 notes\.md/)).toBeInTheDocument()
    expect(screen.getByText(/read_file/)).toBeInTheDocument()
  })

  // 搜索在**已加载的事件**里做（spec §7），不发新请求——
  // 用户搜的是「我刚看到的这些」。
  it('搜索只过滤已加载的事件，不发新请求', async () => {
    render(<TrajectoryView sessionID="sess-1" />)
    await waitFor(() => expect(screen.getByText(/read_file/)).toBeInTheDocument())

    mocks.GetSessionEvents.mockClear()
    await userEvent.type(screen.getByRole('searchbox'), 'read_file')

    await waitFor(() => expect(screen.queryByText(/读一下 notes\.md/)).not.toBeInTheDocument())
    expect(screen.getByText(/read_file/)).toBeInTheDocument()
    expect(mocks.GetSessionEvents).not.toHaveBeenCalled()
  })

  it('没有选中会话时说明要先选一个', () => {
    render(<TrajectoryView sessionID={null} />)
    expect(screen.getByText(/选择|先选/)).toBeInTheDocument()
  })
})
```

标签页的测试**加到对话栏容器的既有测试文件里**（实现者定位）：

```tsx
// 轨迹与对话互斥（spec §7 的 I1）：切到轨迹，对话的输入框就不在了。
it('对话与轨迹是互斥的两个标签', async () => {
  // 实现者：照该文件既有的渲染写法搭好容器，然后：
  //   1. 断言默认在「对话」——输入框在；
  //   2. 点「轨迹」标签；
  //   3. 断言输入框不在了、轨迹在了。
  // 断言的是**互斥**这个行为，不是「有两个按钮」。
  throw new Error('实现者：按上面的说明写出真实断言，然后删掉这一行')
})
```

> 那行 `throw` 是**故意的占位**，必须替换。理由同 Task 1 的 `t.Fatal`。

- [ ] **Step 2: 跑测试确认它红**

```bash
cd frontend && npx vitest run src/components/trajectory/TrajectoryView.test.tsx
```

- [ ] **Step 3: 写实现**

**(a) `TrajectoryView.tsx`**：调 `useSessionEvents(sessionID)` 取数，从 store 读 `events`/`turns`，自己持有搜索词 state，把过滤后的分组交给 `TrajectoryTable`，另把统计交给 `Toolbar`、事件交给 `Timeline`。`sessionID` 为 null 时渲染提示。

**搜索的过滤口径**：在事件的可见文本里搜（`content`/`name`/`arguments`/`preview`/`type`）。**过滤后仍按 turn 分组**——不要把匹配的事件拍平成一个列表，那会丢掉「这一条属于哪一轮」这个信息。

**(b) 标签页**：在对话栏容器里加「对话 / 轨迹」两个标签，互斥。**容器是哪个组件由你定位**（`ChatPanel.tsx` 或它的父层，读 `layout/ThreePanelLayout.tsx` 找）。把你的定位结论写进报告。

**(c) 让 `EventsTab` 退休**：删 `frontend/src/components/status/EventsTab.tsx` 与它的测试，并清理引用它的地方。

> **删之前先确认一件事**：`EventsTab` 用的是 `ListRuntimeEvents` 绑定，那是**运行时事件**（`domain.RuntimeEvent`），与会话事件日志**不是同一批数据**。spec 说它是「同一批数据的贫瘠版本」——**请自己核实这个说法**：如果 `ListRuntimeEvents` 里有轨迹拿不到的信息（例如非会话级的系统事件），删掉它就是丢功能。**核实结论写进报告；如果确实有信息会丢，停下来说明，不要删。**

- [ ] **Step 4: 跑测试确认它绿**

```bash
cd frontend && npx vitest run
cd frontend && npm run build
```

Expected: 全部 PASS；`tsc && vite build` 通过。**全量跑一次**——删 `EventsTab` 会牵动引用它的测试。

Go 侧也跑一次：`go build ./... && go vet ./...`

- [ ] **Step 5: 变异验证（三条）**

| # | 变异 | 期望红在哪 |
|---|---|---|
| 1 | 搜索过滤改成恒返回全部事件 | 「搜索只过滤已加载的事件，不发新请求」 |
| 2 | `TrajectoryView` 不调 `useSessionEvents` | 「挂载后把事件铺成轨迹」 |
| 3 | 标签切换改成两个都渲染（不互斥） | 「对话与轨迹是互斥的两个标签」 |

变异 2 是**接线守卫**：视图不取数就永远空着，而这不报任何错。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/trajectory/TrajectoryView.tsx frontend/src/components/trajectory/TrajectoryView.test.tsx
git add -u frontend/src/components/status/ frontend/src/components/
git commit -m "feat(gui): 轨迹视图接进标签页，事件标签退休"
```

> **只 stage 你实际改到的文件**。`git add -u` 只加已跟踪文件的改动（含删除），不会把无关的新文件带进来——但仍要 `git status` 核对一遍。

---

## 完成判据（P4b 全部做完时逐条核对）

- [ ] 轨迹视图能把一条会话的事件按 turn 铺成表格，USER / ASSISTANT / TOOL 各有徽章与摘要
- [ ] 工具条显示 Duration / Turns / Calls，搜索框**只过滤已加载的事件**、不发新请求
- [ ] 时间线有 Input / Model / Tools 三条密度带
- [ ] 首屏经 Go 绑定拉取（不是 fetch），实时追加订的是 **`agent:session_event` 专用频道**（不是通用 firehose）
- [ ] 帧漏了会从断点补拉，而不是猜
- [ ] **未知事件类型不被静默丢弃**，渲染成一行并标出类型名
- [ ] `tool/result` 的全文入口把 **404 当成「全文不可得」的合法结果**，不是错误弹窗
- [ ] 轨迹是对话栏上方的标签页，与对话**互斥**
- [ ] `EventsTab` 已退休（或有书面理由说明为什么不能删）
- [ ] `cd frontend && npm test` 全绿、`npm run build` 通过；Go 侧 `go build`/`go vet` 全绿、`gofmt -l` 为空
- [ ] **P4b 没有碰**：server 仓、G3 开关（P5）、投影缓存、虚拟滚动

## 本期已知、不在范围内的事

- 虚拟滚动不做（spec §7：靠 `limit` 分页压住每屏事件数，测出卡顿再加；harness 有 `trajectory-virtual-rows.ts` 可参考）
- 投影缓存不做（spec §6：投影在真实会话长度上测出慢时再加）
- G3 开关是 P5
- 未绑定 `working_dir` 的会话，其 `spill_locator` 取不回来——这是 server 侧有意的取舍，P4b 只负责把它渲染成「全文不可得」
