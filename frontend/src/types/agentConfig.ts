import type { SectionSpec } from './config'

// AGENT_SECTIONS drives the sub-agent config form. It mirrors the authoritative
// Go schema (internal/agentregistry.AgentConfig): id / role / maas_profile plus
// the per-agent context_files, workspace, and skills blocks.
//
// Unlike the main config, the path-ish fields here are editable: they are the
// user's own per-agent choices (which persona to load, where that agent writes
// its docs and memory), not the system paths that break the service if wrong.
export const AGENT_SECTIONS: SectionSpec[] = [
  {
    key: 'identity',
    title: '身份',
    help: 'id/role 供 workflow 引用；maas_profile 必须是主配置 maas.profiles 里的一个 profile 名。',
    advanced: false,
    fields: [
      { path: 'id', label: 'id', widget: 'text' },
      { path: 'role', label: 'role', widget: 'text' },
      { path: 'maas_profile', label: 'maas_profile', widget: 'text' },
    ],
  },
  {
    key: 'context_files',
    title: '上下文文件',
    help: '该 Agent 每次推理注入的常驻上下文。路径相对 root 解析。',
    advanced: false,
    fields: [
      { path: 'context_files.enabled', label: 'enabled', widget: 'toggle' },
      { path: 'context_files.root', label: 'root', widget: 'text' },
      { path: 'context_files.soul_path', label: 'soul_path', widget: 'text' },
      { path: 'context_files.tools_path', label: 'tools_path', widget: 'text' },
      { path: 'context_files.user_path', label: 'user_path', widget: 'text' },
      { path: 'context_files.memory_path', label: 'memory_path', widget: 'text' },
      { path: 'context_files.max_file_chars', label: 'max_file_chars', widget: 'number' },
    ],
  },
  {
    key: 'workspace',
    title: '工作区',
    help: '该 Agent 的产出目录：docs 写报告/经验，memory 写长期记忆。',
    advanced: false,
    fields: [
      { path: 'workspace.docs_root', label: 'docs_root', widget: 'text' },
      { path: 'workspace.memory_root', label: 'memory_root', widget: 'text' },
    ],
  },
  {
    key: 'skills',
    title: '技能',
    help: '该 Agent 的技能安装位置与可选的远端 registry。',
    advanced: false,
    fields: [
      { path: 'skills.registry_url', label: 'registry_url', widget: 'text' },
      { path: 'skills.install_root', label: 'install_root', widget: 'text' },
    ],
  },
  {
    key: 'tools',
    title: '工具授权',
    help: '默认全部可用；取消勾选即禁止该 Agent 调用对应工具。元工具（load_capabilities/call_tool）常驻，不在此列。',
    advanced: false,
    fields: [{ path: 'disabled_tools', label: '可用工具', widget: 'tool-checklist' }],
  },
]

// agentTemplate builds the starting config for a newly added sub-agent whose
// file does not exist yet. id/role default to the agent's name and the model
// profile to the main config's default_profile, so the agent is runnable the
// moment it is saved; the per-agent output roots are namespaced by name to keep
// agents from writing over each other.
export function agentTemplate(name: string, defaultProfile: string): Record<string, unknown> {
  return {
    id: name,
    role: name,
    maas_profile: defaultProfile,
    context_files: {
      enabled: true,
      root: '.',
      soul_path: 'configs/persona/SOUL.md',
      tools_path: 'configs/persona/TOOLS.md',
      user_path: 'configs/persona/USER.md',
      memory_path: 'configs/persona/MEMORY.md',
      max_file_chars: 20000,
    },
    workspace: {
      docs_root: `docs/${name}`,
      memory_root: `memory/${name}`,
    },
    skills: {
      registry_url: '',
      install_root: `skills/${name}`,
    },
  }
}
