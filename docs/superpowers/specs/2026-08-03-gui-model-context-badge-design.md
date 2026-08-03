---
title: GUI 底部工具栏显示当前模型与上下文大小（需求1）
date: 2026-08-03
status: draft
tags: [gui, model, context, config, wails]
related:
  - "[[2026-08-01-tool-result-truncation-governance-design]]"
---

# GUI 底部工具栏显示当前模型与上下文大小（需求1）

## 1. 背景

用户在聊天输入框底部工具栏（`ChatPanel.tsx` 的 `AgentSelector`/`ModeSelector` 那一行，截图红框位置）看不到**当前用的是哪个模型、上下文窗口多大**。需要在红框处显示：当前选中 agent 实际使用的 **model 名 + context 大小**。

这是两个独立需求中的第 1 个（需求2「等待时可停止」拆到单独 spec，复杂度高一档、跨三层中断）。

**关键前置结论（已实测）**：OpenAI 兼容 `/v1/models`（deepseek）只返 `{id, object, owned_by}`，**不含 context window**——无法动态查。故 context 大小走**配置数据驱动**（符合 legionAgent CLAUDE.md「数值必须数据驱动、严禁硬编码」铁律）。

## 2. 目标与范围

- config `maas.profiles[name]` 新增 `context_length`（token 数）字段。
- GUI 底部工具栏红框显示：`<model> · <context>`，**随选中 agent 变**（agent 各自的 `maas_profile` 可能不同 model）。
- GUI 设置里可编辑每个 profile 的 `context_length`。
- 数据经**新增只读 Go 绑定** `GetAgentModelInfo`（后端权威解析 agent→profile→model+context），前端只显示。

### 不做（YAGNI）
- 不动态查 provider（已证不可行）。
- 不做需求2（停止等待）——单独 spec。
- 不用 context_length 做预算缩放（那是截断治理 P2 的事，本 spec 只显示；但字段命名/语义与将来 P2 一致，便于复用）。

## 3. 跨仓库说明

| 改动 | 仓库 |
|------|------|
| `config.MaasProfile` 加 `ContextLength` | `legionAgent`（server） |
| `App.GetAgentModelInfo` 绑定 | `legionAgentGUI` |
| 前端 `ModelBadge` + `ProfilesEditor` 字段 | `legionAgentGUI/frontend` |

## 4. 数据模型

`legionAgent/internal/config/config.go` 的 `MaasProfile`（config.go:69）加字段：
```go
type MaasProfile struct {
	Model         string `json:"model"`
	BaseURL       string `json:"base_url"`
	APIKey        string `json:"api_key"`
	ContextLength int    `json:"context_length"` // 模型上下文窗口(token)，0=未配
}
```
`context_length` 是**可选字段**（契约允许缺省=0=未配），0 时 GUI 显示「context 未设」——这是契约声明的可选，非 fail-loud 违反。

## 5. 组件

### (a) Go 绑定 `App.GetAgentModelInfo`（`legionAgentGUI/app_agents.go`）
```go
type ModelInfo struct {
	Model         string `json:"model"`
	ContextLength int    `json:"context_length"`
	Profile       string `json:"profile"` // 解析出的 profile 名，便于显示与诊断
}

// GetAgentModelInfo resolves the model + context window an agent actually uses:
// agent's maas_profile (empty → maas.default_profile) → maas.profiles[profile].
// Returns an error (fail-loud) when the resolved profile name does not exist in
// maas.profiles — a misconfiguration the UI must surface, not hide.
func (a *App) GetAgentModelInfo(agentName string) (ModelInfo, error)
```
解析链：
1. 读主 config（agent.json）的 `maas.profiles` + `maas.default_profile` + `agents`（name→config path）。
2. `agentName` 有对应 agent config 文件 → 读其 `maas_profile`；为空或 agent 无独立 config（如内置「默认」agent）→ 用 `maas.default_profile`。
3. `profile` 名在 `maas.profiles` 中不存在 → **返回 error**（`fmt.Errorf("agent %q resolved profile %q not in maas.profiles: %w", ...)`）。
4. 命中 → 返回 `{Model, ContextLength, Profile}`；`ContextLength` 可能为 0（未配，合法）。

> 复用现有 config 加载 + `GetAgentConfig`/`agentregistry.AgentConfig.MaasProfile`（`config.go:8`）解析 agent 的 profile。

### (b) 前端 `ModelBadge`（`legionAgentGUI/frontend/src/components/ModelBadge.tsx` 新建）
- 订阅 `agentStore.selected`（当前 agent），变化时调 `GetAgentModelInfo(agentName)`。
- 渲染于 `ChatPanel.tsx` 底部工具栏（`AgentSelector`/`ModeSelector` 同行，红框处，ChatPanel.tsx:919-920 之后）。
- 显示 `<model> · <context>`；加载中显示占位；出错显示「配置错误」并附 title（error 文本）。

### (c) 前端设置编辑（`legionAgentGUI/frontend/src/components/settings/fields/ProfilesEditor.tsx`）
- 每个 profile 的编辑表单加 `context_length`（number widget）。前端 config 类型（`agentConfig.ts`/`config.ts` 里 profile 结构）加 `context_length`。

## 6. 数据流

```
AgentSelector 选中 agent (agentStore.selected)
   → ModelBadge useEffect 调 App.GetAgentModelInfo(agentName)
      → serve 解析 config: agent.maas_profile ?? default_profile → profiles[profile]
      → {model, context_length, profile}
   → ModelBadge 显示 "deepseek-v4-flash · 128K"
```

## 7. 显示格式

- `<model> · <context>`
- context 格式化：`128000`→`128K`、`1000000`→`1M`、`< 1000`→原值、`0`→`context 未设`
- 例：`deepseek-v4-flash · 128K`；未配：`deepseek-v4-flash · context 未设`

## 8. 错误处理（fail-loud 铁律）

- agent 的 `maas_profile` 解析出的 profile 名不在 `maas.profiles` → `GetAgentModelInfo` 返 Go error → 前端 badge 显示「配置错误」+ title 带原因，**不静默显示空/猜测**。
- 主 config 读取失败 → 返 error（`%w` 包装），前端显示错误。
- `context_length=0` 是**契约允许的可选缺省**（未配），显示「context 未设」，非 fail-loud 违反（区别于「本应有却读失败」）。
- Go 绑定内部读文件/解析 JSON 失败 → 返 error，不吞。

## 9. 测试

### Go（legionAgentGUI）
- `GetAgentModelInfo`：agent 有 `maas_profile` 指向存在 profile → 返正确 model+context+profile；`maas_profile` 空 → 用 default_profile；agent 无 config → default_profile；解析 profile 不存在 → **返 error**；`context_length` 未配 → 返 0（不报错）。

### 前端（legionAgentGUI/frontend）
- `ModelBadge`：正常渲染 `model · 128K`；切 agent → 重新拉取更新；`context_length=0` → 「context 未设」；`GetAgentModelInfo` reject → 「配置错误」。
- context 格式化函数：128000→128K、1000000→1M、500→500、0→未设。
- `ProfilesEditor`：能编辑 context_length 并保存回 config。

### 门槛
- legionAgent：`go build/vet/test` 全绿、`gofmt -l .` 空。
- legionAgentGUI：`go build ./...` + 前端 `tsc --noEmit` + 相关前端测试通过。

## 10. 实现锚点

- `legionAgent/internal/config/config.go:69` `MaasProfile`（加 `ContextLength`）；`config.go:62-67` `MaasConfig`（`DefaultProfile`/`Profiles`）。
- `legionAgent/internal/agentregistry/config.go:8` `AgentConfig.MaasProfile`。
- `legionAgentGUI/app_agents.go:85` `GetAgentConfig`（复用读 agent config）；`legionAgentGUI/app.go:262` `ListAgents`（name→config 映射经 agent.json `agents`）。新绑定 `GetAgentModelInfo` 加在 `app_agents.go`。
- `legionAgentGUI/frontend/src/components/ChatPanel.tsx:876-921`（底部工具栏，红框，插 `ModelBadge`）。
- `legionAgentGUI/frontend/src/stores/agentStore.ts`（`selected`）、`configStore.ts`（config draft）。
- `legionAgentGUI/frontend/src/components/settings/fields/ProfilesEditor.tsx`（加 context_length 字段）；`frontend/src/types/config.ts` / `agentConfig.ts`（profile 类型加 context_length）。

## 11. 开放问题

无（数据源=config context_length、显示随 agent 变、访问经 Go 绑定 A 均已确认）。
