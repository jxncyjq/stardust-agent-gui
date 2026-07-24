// FieldWidget selects the control the settings modal renders for a config field.
export type FieldWidget =
  | 'toggle'
  | 'number'
  | 'text'
  | 'secret'
  | 'color'
  | 'profiles'
  | 'agents'
  | 'stringlist'
  | 'readonly'
  | 'tool-checklist'

// FieldSpec describes one editable (or read-only) config field by its dot-path
// into the agent.json object.
export interface FieldSpec {
  path: string
  label: string
  widget: FieldWidget
}

// SectionSpec groups fields under a collapsible section. `advanced` sections
// render collapsed by default. `help` comes from the agent.complete.example.json
// _comment for that section.
export interface SectionSpec {
  key: string
  title: string
  help: string
  advanced: boolean
  fields: FieldSpec[]
}

const THEME_COLORS: FieldSpec[] = [
  { path: 'tui.theme.accent', label: 'accent', widget: 'color' },
  { path: 'tui.theme.accent2', label: 'accent2', widget: 'color' },
  { path: 'tui.theme.text', label: 'text', widget: 'color' },
  { path: 'tui.theme.dim', label: 'dim', widget: 'color' },
  { path: 'tui.theme.error', label: 'error', widget: 'color' },
  { path: 'tui.theme.status_fg', label: 'status_fg', widget: 'color' },
  { path: 'tui.theme.status_bg', label: 'status_bg', widget: 'color' },
  { path: 'tui.theme.shell_bg', label: 'shell_bg', widget: 'color' },
]

// CONFIG_SECTIONS is the single source of truth for the settings form layout.
// Ordered: common (advanced:false) first, then advanced (collapsed).
export const CONFIG_SECTIONS: SectionSpec[] = [
  {
    key: 'maas',
    title: '模型 (MaaS)',
    help: '设置 model 时走 OpenAI 兼容 /chat/completions；model 为空时走 Legion 内部 MaaS。',
    advanced: false,
    fields: [
      { path: 'maas.base_url', label: 'base_url', widget: 'text' },
      { path: 'maas.api_key', label: 'api_key', widget: 'secret' },
      { path: 'maas.default_profile', label: 'default_profile', widget: 'text' },
      { path: 'maas.profiles', label: 'profiles', widget: 'profiles' },
    ],
  },
  {
    key: 'agents',
    title: '子 Agent',
    help: '多 Agent 子配置：名称对应 workflow 的 task.agent_id，路径相对本配置文件所在目录解析。可增删改。',
    advanced: false,
    fields: [
      { path: 'agents', label: 'agents', widget: 'agents' },
    ],
  },
  {
    key: 'runtime',
    title: '运行时',
    help: 'demo_response 仅在无真实 MaaS 时降级演示；max_tool_rounds 控制工具调用闭环轮数。',
    advanced: false,
    fields: [
      { path: 'runtime.demo_response', label: 'demo_response', widget: 'text' },
      { path: 'runtime.max_tool_rounds', label: 'max_tool_rounds', widget: 'number' },
      { path: 'runtime.lazy_tools', label: 'lazy_tools', widget: 'toggle' },
    ],
  },
  {
    key: 'session',
    title: '会话',
    help: '多轮会话连续性：把最近 N 轮写入 SQLite 并注入下一轮 prompt。',
    advanced: false,
    fields: [
      { path: 'session.enabled', label: 'enabled', widget: 'toggle' },
      { path: 'session.default_recent_turns', label: 'default_recent_turns', widget: 'number' },
      { path: 'session.max_turn_chars', label: 'max_turn_chars', widget: 'number' },
      { path: 'session.restore_latest_on_tui_start', label: 'restore_latest_on_tui_start', widget: 'toggle' },
      { path: 'session.cache_enabled', label: 'cache_enabled', widget: 'toggle' },
      { path: 'session.cache_max_entries', label: 'cache_max_entries', widget: 'number' },
    ],
  },
  {
    key: 'tui',
    title: '界面主题 (TUI)',
    help: '交互式 TUI 配置；theme 支持 ANSI 色号或 truecolor hex。',
    advanced: false,
    fields: [
      { path: 'tui.show_prompt', label: 'show_prompt', widget: 'toggle' },
      { path: 'tui.show_thinking', label: 'show_thinking', widget: 'toggle' },
      { path: 'tui.color_profile', label: 'color_profile', widget: 'text' },
      ...THEME_COLORS,
    ],
  },
  {
    key: 'context_files',
    title: '上下文文件',
    help: '运行时注入上下文。路径类字段只读（改错会导致 serve 启动失败）。',
    advanced: false,
    fields: [
      { path: 'context_files.enabled', label: 'enabled', widget: 'toggle' },
      { path: 'context_files.max_file_chars', label: 'max_file_chars', widget: 'number' },
    ],
  },
  {
    key: 'server',
    title: '服务器 (高级)',
    help: 'agent serve 的 HTTP 管理面。注意：GUI 内嵌 serve 固定用随机端口，listen_addr 不生效。',
    advanced: true,
    fields: [
      { path: 'server.listen_addr', label: 'listen_addr (不生效)', widget: 'readonly' },
      { path: 'server.admin_token', label: 'admin_token', widget: 'secret' },
      { path: 'server.public_health_enabled', label: 'public_health_enabled', widget: 'toggle' },
      { path: 'server.request_id_header', label: 'request_id_header', widget: 'text' },
    ],
  },
  {
    key: 'service',
    title: '后台 (高级)',
    help: '后台 coordinator heartbeat 间隔（如 "1s"）。',
    advanced: true,
    fields: [
      { path: 'service.background_interval', label: 'background_interval', widget: 'text' },
    ],
  },
  {
    key: 'storage',
    title: '存储 (高级·只读)',
    help: '存储驱动与路径。危险字段，只读展示。',
    advanced: true,
    fields: [
      { path: 'storage.driver', label: 'driver', widget: 'readonly' },
      { path: 'storage.path', label: 'path', widget: 'readonly' },
    ],
  },
  {
    key: 'tasks',
    title: '任务账本 (高级)',
    help: '多 Agent 协作任务账本。路径类只读，上限与状态数组可改。',
    advanced: true,
    fields: [
      { path: 'tasks.index_path', label: 'index_path', widget: 'readonly' },
      { path: 'tasks.root', label: 'root', widget: 'readonly' },
      { path: 'tasks.archive_root', label: 'archive_root', widget: 'readonly' },
      { path: 'tasks.max_index_lines', label: 'max_index_lines', widget: 'number' },
      { path: 'tasks.max_task_lines', label: 'max_task_lines', widget: 'number' },
      { path: 'tasks.max_message_chars', label: 'max_message_chars', widget: 'number' },
      { path: 'tasks.active_statuses', label: 'active_statuses', widget: 'stringlist' },
      { path: 'tasks.done_statuses', label: 'done_statuses', widget: 'stringlist' },
    ],
  },
  {
    key: 'context_files_paths',
    title: '上下文路径 (高级·只读)',
    help: 'AGENTS/SOUL/TOOLS/USER/MEMORY 注入路径。危险字段，只读展示。',
    advanced: true,
    fields: [
      { path: 'context_files.root', label: 'root', widget: 'readonly' },
      { path: 'context_files.soul_path', label: 'soul_path', widget: 'readonly' },
      { path: 'context_files.tools_path', label: 'tools_path', widget: 'readonly' },
      { path: 'context_files.user_path', label: 'user_path', widget: 'readonly' },
      { path: 'context_files.memory_path', label: 'memory_path', widget: 'readonly' },
    ],
  },
  {
    key: 'workspace',
    title: '工作区 (高级·只读)',
    help: 'docs/memory 产出目录。危险字段，只读展示。',
    advanced: true,
    fields: [
      { path: 'workspace.docs_root', label: 'docs_root', widget: 'readonly' },
      { path: 'workspace.memory_root', label: 'memory_root', widget: 'readonly' },
    ],
  },
  {
    key: 'skills',
    title: '技能 (高级)',
    help: 'registry_url 可改；install_root 路径只读。',
    advanced: true,
    fields: [
      { path: 'skills.registry_url', label: 'registry_url', widget: 'text' },
      { path: 'skills.install_root', label: 'install_root', widget: 'readonly' },
    ],
  },
  {
    key: 'web',
    title: 'Web 工具 (高级)',
    help: 'fetch_url 工具。默认开启 SSRF 防护，allow_private_hosts 才允许内网 IP。',
    advanced: true,
    fields: [
      { path: 'web.enabled', label: 'enabled', widget: 'toggle' },
      { path: 'web.allow_private_hosts', label: 'allow_private_hosts', widget: 'toggle' },
      { path: 'web.timeout_seconds', label: 'timeout_seconds', widget: 'number' },
      { path: 'web.max_response_kb', label: 'max_response_kb', widget: 'number' },
      { path: 'web.allowlist', label: 'allowlist', widget: 'stringlist' },
    ],
  },
  {
    key: 'evolution',
    title: '退化检测 (高级)',
    help: '周期性退化检测任务的阈值/窗口/扫描间隔。',
    advanced: true,
    fields: [
      { path: 'evolution.degradation_threshold', label: 'degradation_threshold', widget: 'number' },
      { path: 'evolution.degradation_window_days', label: 'degradation_window_days', widget: 'number' },
      { path: 'evolution.degradation_scan_minutes', label: 'degradation_scan_minutes', widget: 'number' },
    ],
  },
]
