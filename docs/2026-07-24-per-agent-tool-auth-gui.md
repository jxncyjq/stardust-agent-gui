# Per-Agent 工具授权 · GUI（PR2）实施计划

> **For agentic workers:** 用 subagent-driven-development 逐任务执行。步骤用 `- [ ]` 复选框跟踪。

**Goal:** GUI 里给 agent 配置加「工具授权」勾选界面：默认全勾（全可用），取消勾把工具名写进 `disabled_tools`（deny-list）。sub-agent 与默认 agent 两处都支持。依赖后端 PR #51 已合入的 `ListGateableTools` 绑定。

**Architecture:** 新增 `tool-checklist` field widget，挂进现有 store 无关的 `WidgetControl`（value/onChange），主配置表单与 sub-agent 表单自动共用。widget 挂载时拉 `ListGateableTools()` 渲染全集勾选框，勾选状态 = 该工具**不在** field 的 `disabled_tools` 数组里。

**Tech Stack:** Wails v2 + React + Zustand + TypeScript；vitest。

## 背景

后端（server PR #51，已合 master）：`AgentConfig.DisabledTools` / `RuntimeConfig.DisabledTools`（deny-list，缺/null/[]=全可用），`effectiveTools` 收窄，未知名 fail-loud，`App.ListGateableTools() []GateableToolDTO{Name,Description}` 绑定。本 PR 只做 GUI 勾选界面。设计见 `../legionAgent/docs/superpowers/specs/2026-07-24-per-agent-tool-authorization-design.md`。

## Global Constraints

- Fail-Loud 铁律（GUI CLAUDE.md §0）：`ListGateableTools()` 加载失败必须显式报错，**不得**渲染空勾选列表冒充「没有工具」。
- 门禁：`cd frontend && npm run build`（tsc + vite）绿、`npm test`（vitest）全绿；`go build ./... && go vet ./...`（GUI 内嵌 serve）绿、`gofmt -l .` 空。
- deny-list 语义：勾选=允许=**不在** disabled_tools；取消勾=禁用=加进 disabled_tools。field 值缺失/undefined = 空 deny-list = 全勾。
- 元工具不在 `ListGateableTools` 返回里（后端已排除），GUI 不特殊处理。
- serve 内嵌 exe：改后端代码才需 `run.bat build`；本 PR 纯前端 + 绑定重生成，真机验证需 `run.bat build` 一次让绑定进 exe。

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `frontend/wailsjs/go/main/App.{js,d.ts}` + `models.ts` | 重生成含 `ListGateableTools` + `GateableToolDTO` | 生成 |
| `frontend/src/types/config.ts` | `FieldWidget` 加 `'tool-checklist'` | 修改 |
| `frontend/src/components/settings/fields/ToolChecklistField.tsx` | 勾选 widget（拉全集、渲染、deny-list 读写、加载/失败态） | 创建 |
| `frontend/src/components/settings/fields/ToolChecklistField.test.tsx` | widget vitest | 创建 |
| `frontend/src/components/settings/fields/FieldRenderer.tsx` | `WidgetControl` 加 `case 'tool-checklist'` | 修改 |
| `frontend/src/types/agentConfig.ts` | AGENT_SECTIONS 加「工具授权」段（`disabled_tools`） | 修改 |
| `frontend/src/types/config.ts` | CONFIG_SECTIONS runtime 段加 `runtime.disabled_tools` | 修改 |

---

### Task 1: GUI App.ListGateableTools 绑定 + 重生成

**背景更正（server PR #52 已合）：** PR #51 的 `ListGateableTools` 加在了 server `internal/app.App`（错的 App，GUI 够不到），已删。公开 seam 现为 `serve.GateableTools() []serve.GateableTool{Name,Description}`（server master）。GUI 是独立 module，经已 import 的 `github.com/stardust/legion-agent/serve` 调用它。

**Files:**
- Modify: `app_agents.go`（GUI 根，加 `App.ListGateableTools`）
- Test: `app_agents_test.go` 或 `app_test.go`（GUI 根）
- Generate: `frontend/wailsjs/go/main/App.{js,d.ts}`、`frontend/wailsjs/go/models.ts`

**Interfaces:**
- Consumes: `serve.GateableTools()`（server master）
- Produces（供 Task 2 import）：`ListGateableTools(): Promise<main.GateableToolDTO[]>`（`frontend/wailsjs/go/main/App`）；`main.GateableToolDTO { name: string; description: string }`（`frontend/wailsjs/go/models`）

- [ ] **Step 1: 写失败测试**（GUI 根 Go 测试）

```go
func TestListGateableToolsExposesToolsWithoutMeta(t *testing.T) {
	got := (&App{}).ListGateableTools()
	if len(got) == 0 {
		t.Fatal("ListGateableTools() returned nothing")
	}
	var sawWrite bool
	for _, tl := range got {
		if tl.Name == "" || tl.Description == "" {
			t.Errorf("gateable tool missing name/description: %+v", tl)
		}
		if tl.Name == "write_file" {
			sawWrite = true
		}
		if tl.Name == "call_tool" || tl.Name == "load_capabilities" {
			t.Errorf("leaked meta-tool %q", tl.Name)
		}
	}
	if !sawWrite {
		t.Error("missing write_file")
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

`go test ./ -run TestListGateableTools`（GUI 根）→ 方法未定义。

- [ ] **Step 3: 实现**（GUI 根 `app_agents.go`）

```go
// GateableToolDTO is one tool the per-agent config UI can allow or disable.
type GateableToolDTO struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ListGateableTools returns every tool a per-agent config may disable, each with
// a one-line description, for the tool-authorization checklist. It reads the
// public serve seam (serve.GateableTools) because this module cannot import
// legionAgent's internal/toolauth directly. Meta-tools are excluded.
func (a *App) ListGateableTools() []GateableToolDTO {
	tools := serve.GateableTools()
	out := make([]GateableToolDTO, 0, len(tools))
	for _, t := range tools {
		out = append(out, GateableToolDTO{Name: t.Name, Description: t.Description})
	}
	return out
}
```

import `"github.com/stardust/legion-agent/serve"`（GUI 已依赖该包）。

- [ ] **Step 4: 跑测试确认通过 + 重生成绑定**

```bash
go test ./ -run TestListGateableTools
wails generate module
grep -n "ListGateableTools" frontend/wailsjs/go/main/App.d.ts
grep -n "GateableToolDTO" frontend/wailsjs/go/models.ts
```

预期绑定出现：`App.d.ts` 有 `ListGateableTools():Promise<Array<main.GateableToolDTO>>`；`models.ts` 有 `GateableToolDTO`。再 `cd frontend && npm run build`（tsc 过，证明绑定 TS 合法）。

- [ ] **Step 5: 提交**

```bash
git add app_agents.go app_test.go frontend/wailsjs/
git commit -m "feat(gui): App.ListGateableTools 经 serve seam 暴露可 gate 工具，重生成绑定"
```

---

### Task 2: tool-checklist widget

**Files:**
- Modify: `frontend/src/types/config.ts`（`FieldWidget` 加成员）
- Create: `frontend/src/components/settings/fields/ToolChecklistField.tsx`
- Create: `frontend/src/components/settings/fields/ToolChecklistField.test.tsx`
- Modify: `frontend/src/components/settings/fields/FieldRenderer.tsx`（`WidgetControl` 加 case）

**Interfaces:**
- Consumes: Task 1 的 `ListGateableTools` / `GateableToolDTO`
- Produces: `ToolChecklistField({ value: string[]; onChange: (v: string[]) => void })`——`value` 是 disabled_tools 数组

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({ ListGateableTools: vi.fn() }))
vi.mock('../../../../wailsjs/go/main/App', () => mocks)

import { ToolChecklistField } from './ToolChecklistField'

beforeEach(() => {
  mocks.ListGateableTools.mockReset()
  mocks.ListGateableTools.mockResolvedValue([
    { name: 'read_file', description: '读文件' },
    { name: 'write_file', description: '写文件' },
  ])
})

// Deny-list semantics: every gateable tool renders, and a tool is checked unless
// it is in the disabled_tools value.
it('renders every gateable tool, checked unless disabled', async () => {
  render(<ToolChecklistField value={['write_file']} onChange={() => {}} />)

  const read = await screen.findByRole('checkbox', { name: /read_file/ })
  const write = await screen.findByRole('checkbox', { name: /write_file/ })
  expect(read).toBeChecked()        // not disabled → allowed
  expect(write).not.toBeChecked()   // in disabled_tools → unchecked
})

// Unchecking a tool adds it to disabled_tools.
it('unchecking a tool adds it to disabled_tools', async () => {
  const onChange = vi.fn()
  render(<ToolChecklistField value={[]} onChange={onChange} />)

  const read = await screen.findByRole('checkbox', { name: /read_file/ })
  await userEvent.click(read)

  expect(onChange).toHaveBeenCalledWith(['read_file'])
})

// Re-checking a disabled tool removes it from disabled_tools.
it('checking a disabled tool removes it from disabled_tools', async () => {
  const onChange = vi.fn()
  render(<ToolChecklistField value={['read_file']} onChange={onChange} />)

  const read = await screen.findByRole('checkbox', { name: /read_file/ })
  await userEvent.click(read)

  expect(onChange).toHaveBeenCalledWith([])
})

// undefined value = empty deny-list = all checked.
it('treats an undefined value as all-allowed', async () => {
  render(<ToolChecklistField value={undefined as unknown as string[]} onChange={() => {}} />)

  const write = await screen.findByRole('checkbox', { name: /write_file/ })
  expect(write).toBeChecked()
})

// Fail-loud: a load failure shows an error, never an empty list masquerading as
// "no tools" (which would let the user think nothing is gateable).
it('shows an error when loading the tool list fails', async () => {
  mocks.ListGateableTools.mockRejectedValue(new Error('boom'))
  render(<ToolChecklistField value={[]} onChange={() => {}} />)

  await waitFor(() => expect(screen.getByText(/加载.*失败/)).toBeInTheDocument())
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 跑测试确认失败**

`cd frontend && npx vitest run src/components/settings/fields/ToolChecklistField.test.tsx` → 模块不存在，失败。

- [ ] **Step 3: 实现**

`config.ts` 的 `FieldWidget` 加 `| 'tool-checklist'`。

`ToolChecklistField.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { ListGateableTools } from '../../../../wailsjs/go/main/App'

interface GateableTool {
  name: string
  description: string
}

// ToolChecklistField edits a per-agent disabled_tools deny-list as checkboxes.
// It lists every gateable tool (App.ListGateableTools) and checks the ones that
// are NOT disabled; unchecking a tool adds its name to the value, re-checking
// removes it. An empty/undefined value means nothing is disabled — all checked.
export function ToolChecklistField({
  value,
  onChange,
}: {
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [tools, setTools] = useState<GateableTool[] | null>(null)
  const [error, setError] = useState('')
  const disabled = Array.isArray(value) ? value : []

  useEffect(() => {
    let cancelled = false
    ListGateableTools()
      .then((list) => {
        if (!cancelled) setTools(list as GateableTool[])
      })
      .catch((err) => {
        // Fail-loud: never render an empty checklist as if there were no tools;
        // that would silently hide the whole feature on a binding failure.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <p className="text-xs text-error">加载工具列表失败：{error}</p>
  }
  if (!tools) {
    return <p className="text-xs text-muted-foreground">加载中…</p>
  }

  const toggle = (name: string, checked: boolean) => {
    if (checked) {
      onChange(disabled.filter((n) => n !== name))
    } else {
      onChange([...disabled, name])
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {tools.map((tool) => {
        const checked = !disabled.includes(tool.name)
        return (
          <label key={tool.name} className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => toggle(tool.name, e.target.checked)}
              aria-label={tool.name}
            />
            <span>
              <span className="font-mono">{tool.name}</span>
              <span className="text-muted-foreground"> — {tool.description}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
```

`FieldRenderer.tsx` 的 `WidgetControl` switch 加：

```tsx
    case 'tool-checklist':
      return <ToolChecklistField value={value} onChange={onChange} />
```

并 import `ToolChecklistField`。

- [ ] **Step 4: 跑测试确认通过**

`cd frontend && npx vitest run src/components/settings/fields/ToolChecklistField.test.tsx`

- [ ] **Step 5: 提交**

```bash
git add frontend/src/types/config.ts frontend/src/components/settings/fields/ToolChecklistField.tsx frontend/src/components/settings/fields/ToolChecklistField.test.tsx frontend/src/components/settings/fields/FieldRenderer.tsx
git commit -m "feat(settings): tool-checklist widget，勾选编辑 disabled_tools deny-list"
```

---

### Task 3: 接入两处配置表单

**Files:**
- Modify: `frontend/src/types/agentConfig.ts`（AGENT_SECTIONS 加段）
- Modify: `frontend/src/types/config.ts`（CONFIG_SECTIONS runtime 段加字段）
- Test: `frontend/src/components/settings/AgentConfigPage.test.tsx`（若无则新建）或既有 section 渲染测试

**Interfaces:**
- Consumes: Task 2 的 `tool-checklist` widget

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ ListGateableTools: vi.fn() }))
vi.mock('../../../wailsjs/go/main/App', () => ({
  ...mocks,
  // AgentConfigPage/loadAgent 需要的其它绑定按现有测试补齐
}))

import { AGENT_SECTIONS } from '../../types/agentConfig'
import { CONFIG_SECTIONS } from '../../types/config'

// Sub-agent form exposes a tool-authorization section bound to disabled_tools.
it('sub-agent sections include a disabled_tools tool-checklist', () => {
  const field = AGENT_SECTIONS.flatMap((s) => s.fields).find((f) => f.path === 'disabled_tools')
  expect(field?.widget).toBe('tool-checklist')
})

// Default agent (main config runtime) exposes runtime.disabled_tools.
it('main config runtime section includes runtime.disabled_tools tool-checklist', () => {
  const field = CONFIG_SECTIONS.flatMap((s) => s.fields).find((f) => f.path === 'runtime.disabled_tools')
  expect(field?.widget).toBe('tool-checklist')
})
```

- [ ] **Step 2: 跑测试确认失败**

`cd frontend && npx vitest run` （新测试红）。

- [ ] **Step 3: 实现**

`agentConfig.ts` 的 `AGENT_SECTIONS` 末尾加：

```ts
  {
    key: 'tools',
    title: '工具授权',
    help: '默认全部可用；取消勾选即禁止该 Agent 调用对应工具。元工具（load_capabilities/call_tool）常驻，不在此列。',
    advanced: false,
    fields: [{ path: 'disabled_tools', label: '可用工具', widget: 'tool-checklist' }],
  },
```

`config.ts` 的 `CONFIG_SECTIONS` runtime 段 fields 末尾加：

```ts
      { path: 'runtime.disabled_tools', label: 'disabled_tools', widget: 'tool-checklist' },
```

- [ ] **Step 4: 跑测试确认通过 + 全量门禁**

```bash
cd frontend && npx vitest run && npm run build
```

回 GUI 根：`go build ./... && go vet ./... && gofmt -l .`（空）。

- [ ] **Step 5: 提交并开 PR**

```bash
git add frontend/src/types/agentConfig.ts frontend/src/types/config.ts frontend/src/components/settings/
git commit -m "feat(settings): sub-agent 与默认 agent 配置接入工具授权勾选"
```

开 PR（base master），标题「feat: per-agent 工具授权勾选界面（GUI）」，正文引用 spec + 注明依赖 server PR #51（已合）。

---

## 人工验证（合并后）

1. `cd legionAgentGUI && run.bat build`（让新绑定 + 前端进 exe）。
2. 交互启动 GUI → 设置 → 某 sub-agent（或默认 agent runtime 段）→「工具授权」：默认全勾。
3. 取消勾 `write_file` → 保存并重启 → 给该 agent 发写文件任务 → Audit 面板应无 `write_file`，模型收到 not-found 或改道。
4. 反例：勾回 → 写文件恢复。

## 非目标

- skills 的勾选（只 gate 工具）。
- 后端逻辑（已在 PR #51）。
- 运行时热改（走「保存并重启」）。
