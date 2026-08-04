# GUI 模型+上下文标签（需求1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GUI 聊天输入框底部工具栏红框显示当前选中 agent 实际用的 model + context 大小（如 `deepseek-v4-flash · 128K`），随选中 agent 变；context 走 config `maas.profiles[].context_length`（数据驱动）。

**Architecture:** 跨两仓库。`legionAgent` config 加 `context_length` 字段。`legionAgentGUI` 加只读 Go 绑定 `GetAgentModelInfo`（后端权威解析 agent→profile→model+context，GUI 侧自解析 raw JSON，不 import internal/config），wails 生成 TS 绑定，前端 `ModelBadge` 组件插入 ChatPanel 底部工具栏 + `ProfilesEditor` 加 context_length 编辑。

**Tech Stack:** Go（config + Wails App 绑定）；React/TS（Zustand store、Wails bindings）。

**参考 spec:** `legionAgentGUI/docs/superpowers/specs/2026-08-03-gui-model-context-badge-design.md`

**关键前置结论:** deepseek `/v1/models` 不返 context（已实测），故 context 走 config。GUI 不能 import `legionAgent/internal/config`（只用 `serve` public seam / 自解析 JSON）。

**门槛:**
- legionAgent：`go build/vet/test` 全绿、`gofmt -l .` 空。
- legionAgentGUI：`go build ./...` + `go test ./...` + 前端 `npx tsc --noEmit` + 相关前端测试。

---

## 文件结构

| 文件 | 仓库 | 动作 |
|------|------|------|
| `internal/config/config.go` | legionAgent | `MaasProfile` 加 `ContextLength int` |
| `app_agents.go` | legionAgentGUI | 新 `GetAgentModelInfo` + `ModelInfo` |
| `app_agents_test.go`（或新 test 文件） | legionAgentGUI | GetAgentModelInfo 测试 |
| `wailsjs/go/main/App.{d.ts,js}` | legionAgentGUI | wails 生成（含新绑定） |
| `frontend/src/components/ModelBadge.tsx` | legionAgentGUI | 新建 |
| `frontend/src/components/ChatPanel.tsx` | legionAgentGUI | 插入 ModelBadge |
| `frontend/src/components/settings/fields/ProfilesEditor.tsx` | legionAgentGUI | 加 context_length 字段 |

---

## Task 1（legionAgent）: config 加 context_length 字段

**Files:**
- Modify: `legionAgent/internal/config/config.go`（`MaasProfile`）
- Test: `legionAgent/internal/config/config_test.go`

- [ ] **Step 1: 写测试——MaasProfile 能解析 context_length**

在 `legionAgent/internal/config/config_test.go` 追加：
```go
func TestMaasProfileContextLength(t *testing.T) {
	raw := `{"maas":{"profiles":{"dev":{"model":"deepseek-v4-flash","context_length":128000}}}}`
	var cfg Config
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got := cfg.Maas.Profiles["dev"].ContextLength; got != 128000 {
		t.Fatalf("ContextLength = %d, want 128000", got)
	}
}
```
（文件若未 import `encoding/json`，加上。）

- [ ] **Step 2: 跑测试确认失败**

Run（在 `legion/legionAgent`）: `go test ./internal/config/ -run TestMaasProfileContextLength -v`
Expected: 编译失败（`MaasProfile` 无 `ContextLength`）

- [ ] **Step 3: 加字段**

`legionAgent/internal/config/config.go` 的 `MaasProfile`（config.go:69）加：
```go
	// ContextLength is the model's context window in tokens, used by the GUI to
	// show the active model's context size. Optional (0 = unset); the GUI shows
	// "context 未设" when absent. Data-driven per the 数值必须数据驱动 铁律 —— the
	// provider /models API does not return it.
	ContextLength int `json:"context_length"`
```
（加在 `Model`/`BaseURL`/`APIKey`/`PromptCache` 字段之间任意位置。）

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `go test ./internal/config/ -run TestMaasProfileContextLength -v ; go build ./... ; go test ./... ; gofmt -l .`
Expected: PASS + 构建成功 + 全绿 + gofmt 空

- [ ] **Step 5: Commit（legionAgent 仓库）**

```bash
git -C F:/source/stardust/Legion/legion/legionAgent add internal/config/config.go internal/config/config_test.go
git -C F:/source/stardust/Legion/legion/legionAgent commit -m "feat(config): MaasProfile 加 context_length 字段（GUI 显示模型上下文）"
```

---

## Task 2（legionAgentGUI）: GetAgentModelInfo 绑定

**Files:**
- Modify: `legionAgentGUI/app_agents.go`
- Test: `legionAgentGUI/app_agents_test.go`（或现有 test 文件）

- [ ] **Step 1: 写失败测试**

在 `legionAgentGUI` 新建/追加测试（参照现有 `app_config_test.go` 怎么构造 App + 临时 cfgPath；用 `t.TempDir()` 写 agent.json + agent config 文件）：
```go
func TestGetAgentModelInfo(t *testing.T) {
	dir := t.TempDir()
	main := `{"maas":{"default_profile":"dev","profiles":{"dev":{"model":"deepseek-v4-flash","context_length":128000},"fast":{"model":"deepseek-v4-pro","context_length":64000}}},"agents":{"researcher":"researcher.json"}}`
	if err := os.WriteFile(filepath.Join(dir, "agent.json"), []byte(main), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "researcher.json"), []byte(`{"id":"researcher","maas_profile":"fast"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	a := &App{cfgPath: filepath.Join(dir, "agent.json")}

	// agent with maas_profile=fast → its model+context
	info, err := a.GetAgentModelInfo("researcher")
	if err != nil {
		t.Fatalf("researcher: %v", err)
	}
	if info.Model != "deepseek-v4-pro" || info.ContextLength != 64000 || info.Profile != "fast" {
		t.Fatalf("researcher info = %+v", info)
	}

	// unknown agent (not in agents map) → default_profile
	info, err = a.GetAgentModelInfo("默认")
	if err != nil {
		t.Fatalf("default agent: %v", err)
	}
	if info.Model != "deepseek-v4-flash" || info.ContextLength != 128000 || info.Profile != "dev" {
		t.Fatalf("default info = %+v", info)
	}
}

func TestGetAgentModelInfoProfileMissingFailsLoud(t *testing.T) {
	dir := t.TempDir()
	main := `{"maas":{"default_profile":"dev","profiles":{"dev":{"model":"m","context_length":1000}}},"agents":{"x":"x.json"}}`
	os.WriteFile(filepath.Join(dir, "agent.json"), []byte(main), 0o644)
	os.WriteFile(filepath.Join(dir, "x.json"), []byte(`{"id":"x","maas_profile":"nonexistent"}`), 0o644)
	a := &App{cfgPath: filepath.Join(dir, "agent.json")}
	if _, err := a.GetAgentModelInfo("x"); err == nil {
		t.Fatal("expected error when resolved profile not in maas.profiles")
	}
}
```
> 先确认 `App` 结构体字段名（`cfgPath`）与构造方式：grep `type App struct` in legionAgentGUI；现有测试（app_config_test.go）怎么建 App with a temp cfgPath — 照它写。若 App 需更多字段才能构造，用现有测试的 helper。

- [ ] **Step 2: 跑测试确认失败**

Run（在 `legion/legionAgentGUI`）: `go test . -run TestGetAgentModelInfo -v`
Expected: 编译失败（`GetAgentModelInfo`/`ModelInfo` 未定义）

- [ ] **Step 3: 实现 GetAgentModelInfo（app_agents.go）**

在 `legionAgentGUI/app_agents.go` 追加（import 加 `encoding/json`）：
```go
// ModelInfo is the active model an agent uses plus its context window, for the
// GUI's model badge.
type ModelInfo struct {
	Model         string `json:"model"`
	ContextLength int    `json:"context_length"`
	Profile       string `json:"profile"`
}

// mainConfigModelView / agentConfigProfileView are the minimal JSON subsets this
// binding reads. legionAgentGUI cannot import legionAgent/internal/config, so it
// parses the raw config JSON directly (same "read the file verbatim" approach as
// GetConfig).
type mainConfigModelView struct {
	Maas struct {
		DefaultProfile string `json:"default_profile"`
		Profiles       map[string]struct {
			Model         string `json:"model"`
			ContextLength int    `json:"context_length"`
		} `json:"profiles"`
	} `json:"maas"`
	Agents map[string]string `json:"agents"`
}

type agentConfigProfileView struct {
	MaasProfile string `json:"maas_profile"`
}

// GetAgentModelInfo resolves the model + context window agentName actually uses:
// the agent's maas_profile (empty, or agent not in agents map → maas.default_profile)
// → maas.profiles[profile]. Returns an error (fail-loud) when the resolved
// profile is not in maas.profiles — a misconfiguration the UI must surface.
// Called by React via the Wails bindings.
func (a *App) GetAgentModelInfo(agentName string) (ModelInfo, error) {
	raw, err := a.GetConfig()
	if err != nil {
		return ModelInfo{}, err
	}
	var main mainConfigModelView
	if err := json.Unmarshal([]byte(raw), &main); err != nil {
		return ModelInfo{}, fmt.Errorf("parse main config for model info: %w", err)
	}

	profile := ""
	if rel, ok := main.Agents[agentName]; ok && strings.TrimSpace(rel) != "" {
		ac, err := a.GetAgentConfig(rel)
		if err != nil {
			return ModelInfo{}, err
		}
		if ac.Exists {
			var av agentConfigProfileView
			if err := json.Unmarshal([]byte(ac.Content), &av); err != nil {
				return ModelInfo{}, fmt.Errorf("parse agent config %q for model info: %w", rel, err)
			}
			profile = strings.TrimSpace(av.MaasProfile)
		}
	}
	if profile == "" {
		profile = strings.TrimSpace(main.Maas.DefaultProfile)
	}
	if profile == "" {
		return ModelInfo{}, fmt.Errorf("agent %q: no maas_profile and no maas.default_profile configured", agentName)
	}
	p, ok := main.Maas.Profiles[profile]
	if !ok {
		return ModelInfo{}, fmt.Errorf("agent %q resolved profile %q not found in maas.profiles", agentName, profile)
	}
	return ModelInfo{Model: p.Model, ContextLength: p.ContextLength, Profile: profile}, nil
}
```
（`strings`/`fmt` 已在 app_agents.go import；加 `encoding/json`。）

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `go test . -run TestGetAgentModelInfo -v ; go build ./... ; go test ./... ; gofmt -l .`
Expected: PASS ×2 + 构建成功 + 全绿 + gofmt 空

> 注意：Task 2 依赖 Task 1 的 config 字段吗？不——GUI 侧自定义 struct 解析 JSON，不依赖 legionAgent config struct。但 legionAgentGUI 的 go.mod 若 replace/require legionAgent，Task 1 的 config 改动会被拉入；确保 legionAgentGUI `go build` 用的是含 Task 1 的 legionAgent（本地 replace 指向同 repo，自动生效）。

- [ ] **Step 5: Commit（legionAgentGUI 仓库）**

```bash
git -C F:/source/stardust/Legion/legion/legionAgentGUI add app_agents.go app_agents_test.go
git -C F:/source/stardust/Legion/legion/legionAgentGUI commit -m "feat(gui): GetAgentModelInfo 绑定——解析 agent 当前 model+context"
```

---

## Task 3（legionAgentGUI）: 生成 Wails TS 绑定

前端要调 `GetAgentModelInfo`，需 wails 生成的 TS 绑定（`wailsjs/go/main/App.d.ts` + `App.js`）。

**Files:**
- Modify: `legionAgentGUI/frontend/wailsjs/go/main/App.d.ts` + `App.js`（生成）+ `models.ts`（ModelInfo 类型，若 wails 生成）

- [ ] **Step 1: 生成绑定**

优先用 wails CLI（在 `legion/legionAgentGUI`）：
```bash
wails generate module
```
若 `wails` CLI 不可用（未安装），**手动**补绑定（照现有 App.d.ts/App.js 里其它方法的写法）：
- `wailsjs/go/main/App.d.ts` 加：
  ```ts
  export function GetAgentModelInfo(arg1:string):Promise<main.ModelInfo>;
  ```
- `wailsjs/go/main/App.js` 加：
  ```js
  export function GetAgentModelInfo(arg1) {
    return window['go']['main']['App']['GetAgentModelInfo'](arg1);
  }
  ```
- `wailsjs/go/models.ts` 的 `main` namespace 加 `ModelInfo` class（照现有 model 类写法，字段 model/context_length/profile）。若手写，参照文件里已有的一个 DTO class 结构。

- [ ] **Step 2: 确认绑定存在**

Run: grep `GetAgentModelInfo` in `frontend/wailsjs/go/main/App.d.ts`
Expected: 有该导出。

- [ ] **Step 3: Commit**

```bash
git -C F:/source/stardust/Legion/legion/legionAgentGUI add frontend/wailsjs/go/main/App.d.ts frontend/wailsjs/go/main/App.js frontend/wailsjs/go/models.ts
git -C F:/source/stardust/Legion/legion/legionAgentGUI commit -m "chore(gui): 生成 GetAgentModelInfo 的 Wails TS 绑定"
```

---

## Task 4（legionAgentGUI frontend）: ModelBadge 组件

**Files:**
- Create: `legionAgentGUI/frontend/src/components/ModelBadge.tsx`
- Modify: `legionAgentGUI/frontend/src/components/ChatPanel.tsx`（插入 badge）
- Test: `legionAgentGUI/frontend/src/components/ModelBadge.test.tsx`

- [ ] **Step 1: 写 context 格式化 + 组件测试**

创建 `frontend/src/components/ModelBadge.test.tsx`（照现有组件测试的 render/mock 写法；先 grep 一个现有 `*.test.tsx` 看它怎么 mock wailsjs 绑定 —— 例如 `ChatPanel.test.tsx` 如何 mock `../../wailsjs/go/main/App`）：
```tsx
import { formatContext } from './ModelBadge'

describe('formatContext', () => {
  it('formats K/M and unset', () => {
    expect(formatContext(128000)).toBe('128K')
    expect(formatContext(1000000)).toBe('1M')
    expect(formatContext(500)).toBe('500')
    expect(formatContext(0)).toBe('context 未设')
  })
})
```
（若还想测组件渲染：mock `GetAgentModelInfo` resolve `{model:'m',context_length:128000,profile:'dev'}`，断言渲染 `m · 128K`；mock reject 断言「配置错误」。参照现有测试的 mock 手法。）

- [ ] **Step 2: 跑测试确认失败**

Run（在 `frontend`）: `npx vitest run src/components/ModelBadge.test.tsx`（或该仓库前端测试命令，见 package.json scripts）
Expected: FAIL（ModelBadge 未创建）

- [ ] **Step 3: 实现 ModelBadge.tsx**

创建 `frontend/src/components/ModelBadge.tsx`：
```tsx
import { useState, useEffect } from 'react'
import { GetAgentModelInfo } from '../../wailsjs/go/main/App'
import { useAgentStore } from '../stores/agentStore'

// formatContext renders a token count compactly: 128000 -> "128K",
// 1000000 -> "1M", small values as-is, and 0/negative (unconfigured) as the
// explicit "context 未设" so an unset context reads as unset, not as a wrong
// number.
export function formatContext(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'context 未设'
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

// ModelBadge shows the model + context window the currently selected agent uses.
// It re-fetches whenever the selected agent changes. A resolution error (e.g. an
// agent's maas_profile points at a missing profile) is surfaced as "配置错误"
// with the reason in the tooltip rather than hidden.
export function ModelBadge() {
  const agent = useAgentStore((s) => s.selected)
  const [info, setInfo] = useState<{ model: string; contextLength: number } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    setErr('')
    GetAgentModelInfo(agent)
      .then((r: any) => {
        if (cancelled) return
        setInfo({ model: String(r?.model ?? ''), contextLength: Number(r?.context_length ?? 0) })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setInfo(null)
        setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [agent])

  const base = 'flex items-center gap-1 rounded-md border border-input bg-muted/50 px-2 py-1 text-xs text-muted-foreground'
  if (err) return <span className={base} title={`模型信息读取失败: ${err}`}>配置错误</span>
  if (!info) return <span className={base}>…</span>
  return (
    <span className={base} title={`模型 ${info.model} · 上下文 ${info.contextLength} tokens`}>
      {info.model} · {formatContext(info.contextLength)}
    </span>
  )
}
```
> 确认 `useAgentStore` 的 `selected` 字段名（grep `agentStore.ts`）。若 selected 可能为空字符串，`GetAgentModelInfo("")` 会走 default_profile（后端逻辑已处理），是合理行为。

- [ ] **Step 4: 插入 ChatPanel 底部工具栏**

`frontend/src/components/ChatPanel.tsx`：import `ModelBadge`，在底部工具栏 `<ModeSelector />`（ChatPanel.tsx:920）之后加 `<ModelBadge />`：
```tsx
          <AgentSelector />
          <ModeSelector />
          <ModelBadge />
```
（红框在该行右侧空白，badge 追加在末尾即落在红框区域。）

- [ ] **Step 5: 跑测试 + tsc + 构建前端**

Run（在 `frontend`）: `npx vitest run src/components/ModelBadge.test.tsx ; npx tsc --noEmit`
Expected: PASS + 无类型错

- [ ] **Step 6: Commit**

```bash
git -C F:/source/stardust/Legion/legion/legionAgentGUI add frontend/src/components/ModelBadge.tsx frontend/src/components/ModelBadge.test.tsx frontend/src/components/ChatPanel.tsx
git -C F:/source/stardust/Legion/legion/legionAgentGUI commit -m "feat(gui): 底部工具栏显示当前 agent 的 model+context（ModelBadge）"
```

---

## Task 5（legionAgentGUI frontend）: ProfilesEditor 加 context_length 编辑

**Files:**
- Modify: `frontend/src/components/settings/fields/ProfilesEditor.tsx`

- [ ] **Step 1: 加 context_length 到 Profile interface + 编辑 UI**

`ProfilesEditor.tsx`：
- `Profile` interface 加 `context_length?: number`：
  ```ts
  interface Profile {
    model?: string
    base_url?: string
    api_key?: string
    prompt_cache?: boolean
    context_length?: number
  }
  ```
- 现有字段循环只处理 `['model','base_url','api_key']`（text/password）。context_length 是 number，单独渲染一行（在该循环之后）：
  ```tsx
  <div className="flex items-center gap-2">
    <label className="text-[10px] uppercase text-muted-foreground w-16 shrink-0">context</label>
    <input
      type="number"
      min={0}
      className="text-xs px-2 py-1 rounded border border-input bg-background w-full"
      value={profiles[name]?.context_length ?? ''}
      placeholder="上下文 token 数，如 128000"
      onChange={(e) => {
        const raw = e.target.value
        const next = { ...profiles, [name]: { ...profiles[name], context_length: raw === '' ? undefined : Number(raw) } }
        onChange(next)
      }}
    />
  </div>
  ```
  > `setField` 现有签名是 `(name, key, v: string)`，对 number 不合适——context_length 用上面的内联 onChange（存 number 或 undefined），不要走 setField 的 string 版本。空串存 undefined（保持"未配"语义），非 0。

- [ ] **Step 2: tsc + 前端测试**

Run（在 `frontend`）: `npx tsc --noEmit ; npx vitest run`（全量前端测试确认没破坏）
Expected: 无类型错、测试全绿

- [ ] **Step 3: Commit**

```bash
git -C F:/source/stardust/Legion/legion/legionAgentGUI add frontend/src/components/settings/fields/ProfilesEditor.tsx
git -C F:/source/stardust/Legion/legion/legionAgentGUI commit -m "feat(gui): 设置里可编辑 profile 的 context_length"
```

---

## 自检结论（写计划者已核对）

- **Spec 覆盖**：config context_length（T1）、GetAgentModelInfo 后端解析+fail-loud（T2）、wails 绑定（T3）、ModelBadge 显示+随 agent 变+格式化+错误降级（T4）、ProfilesEditor 编辑（T5）。均有任务。
- **Placeholder 扫描**：无 TBD/TODO。多处"grep 确认 App 结构/agentStore.selected/现有测试 mock 手法"是明确的照现有模式指引（App 构造、前端测试 mock 方式我未逐字确认，指向现有文件让实现者对齐），非留白。
- **类型一致**：`ModelInfo{Model,ContextLength,Profile}` Go 定义（T2）↔ 前端读 `r.model/r.context_length`（T4）一致（json tag `context_length`）；`GetAgentModelInfo(agentName string)→ModelInfo` 签名 T2 定义、T3 绑定、T4 调用一致；`formatContext` T4 定义+测试一致；Profile.context_length T5。
- **跨仓库 commit**：T1 legionAgent；T2-T5 legionAgentGUI。各自 `git -C` 指定仓库。
- **实现锚点**：`config.go:69 MaasProfile`；`app_agents.go`（GetAgentConfig/resolveAgentPath 复用）、`app_config.go GetConfig`（读 raw JSON）；`ChatPanel.tsx:920`（ModeSelector 后插）；`ProfilesEditor.tsx`（Profile interface + 字段循环）；`agentStore.selected`；wails `frontend/wailsjs/go/main/App.*`。
- **已知不确定（实现者注意）**：wails CLI 是否可用（T3 给了手写绑定备选）；前端测试框架命令（vitest 假定，实际见 package.json scripts —— 实现者按真实命令跑）。
