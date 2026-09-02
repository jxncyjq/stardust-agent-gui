import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// FetchPreviewFile 是「查看全文」的取数口子（经 Go 绑定走 /v1/files，避开 WebView2
// 的 CORS）。这里 mock 掉它：组件测试不碰真网络，也不需要 Wails runtime。
const appMocks = vi.hoisted(() => ({ FetchPreviewFile: vi.fn() }))
vi.mock('../../../wailsjs/go/main/App', () => appMocks)

import { TrajectoryCell } from './TrajectoryCell'

const ev = (type: string, data: Record<string, unknown>) => ({
  seq: 1, type, time: '2026-09-02T00:00:00Z', data: { turn: 0, ...data },
})

beforeEach(() => {
  appMocks.FetchPreviewFile.mockReset()
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

  it('未知事件类型把原始 JSON 折叠在里面，展开后能看到', async () => {
    render(<TrajectoryCell event={ev('session/teleport', { note: 'ufo' })} sessionID="sess-1" />)
    expect(screen.queryByText(/"note": "ufo"/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /原始 JSON/ }))
    expect(screen.getByText(/"note": "ufo"/)).toBeInTheDocument()
  })

  it('出错的 tool/result 有明确的出错标记，成功的没有', () => {
    const { unmount } = render(<TrajectoryCell event={ev('tool/result', { call_id: 'c1', preview: 'ok', is_error: false })} sessionID="sess-1" />)
    expect(screen.queryByText('出错')).toBeNull()
    unmount()
    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c2', preview: 'boom', is_error: true })} sessionID="sess-1" />)
    expect(screen.getByText('出错')).toBeInTheDocument()
  })

  // 空正文是合法的：P3 折叠之前的中间轮次正文就是空的。空白行看起来像 bug，
  // 所以要显式说明。
  it('assistant/message 空正文显示「无正文」而不是空白行', () => {
    render(<TrajectoryCell event={ev('assistant/message', { content: '' })} sessionID="sess-1" />)
    expect(screen.getByText('ASSISTANT')).toBeInTheDocument()
    expect(screen.getByText(/无正文/)).toBeInTheDocument()
  })

  // content 整个缺席不是「空正文」，是坏数据——按 fail-loud 显式标出来，
  // 不许渲染成跟空正文一样的样子。
  it('assistant/message 缺 content 字段时标为坏数据', () => {
    render(<TrajectoryCell event={ev('assistant/message', {})} sessionID="sess-1" />)
    expect(screen.getByText(/content 字段缺失或类型不对/)).toBeInTheDocument()
  })

  // tool/call 的 name/arguments 也是 fail-loud 守卫，此前没有测试断言过
  // （见 task-4-review.md Important-2：M7 变异删掉相邻的 preview/is_error 守卫后
  // 全绿，说明这一片守卫此前完全没被测试盯住）。
  it('tool/call 缺 name 或 arguments 类型不对时标为坏数据', () => {
    const { unmount } = render(<TrajectoryCell event={ev('tool/call', { call_id: 'c1' })} sessionID="sess-1" />)
    expect(screen.getByText(/name 字段缺失或类型不对/)).toBeInTheDocument()
    unmount()

    render(<TrajectoryCell event={ev('tool/call', { name: 'read_file', call_id: 'c1', arguments: 123 })} sessionID="sess-1" />)
    expect(screen.getByText(/arguments 字段缺失或类型不对/)).toBeInTheDocument()
  })

  // preview 缺席时不能悄悄渲染成一个只有 RESULT 徽章的空行——那和契约②要避免的
  // 「空白行看起来像 bug」是同一个病。
  it('tool/result 缺 preview 字段时标为坏数据', () => {
    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c1', is_error: false })} sessionID="sess-1" />)
    expect(screen.getByText(/preview 字段缺失或类型不对/)).toBeInTheDocument()
  })

  // is_error 不是布尔值（比如字符串 "false"）不能被当成「没出错」悄悄放过。
  it('tool/result 的 is_error 不是布尔值时标为坏数据', () => {
    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c1', preview: 'ok', is_error: 'false' })} sessionID="sess-1" />)
    expect(screen.getByText(/is_error 字段缺失或类型不对/)).toBeInTheDocument()
  })

  // user/message 的空正文当前判为坏数据（「空的用户消息不会产生一轮」，报告 §6.3
  // 自陈存疑，task-4-review.md Important-3 指出这个假设无 server 契约实锤，且与
  // assistant/message 把空串当合法可选不对称）。这条测试不对判断本身背书，只是把
  // *当前*行为钉住：谁要把这条对齐成 assistant 的「（无正文）」路线，必须先让这条
  // 测试连同判断一起改掉，而不是在改别处时顺手带跑。
  it('user/message 空正文按当前判断标为坏数据（判断存疑，见 task-4-review.md Important-3）', () => {
    render(<TrajectoryCell event={ev('user/message', { content: '' })} sessionID="sess-1" />)
    expect(screen.getByText(/content 字段缺失或类型不对/)).toBeInTheDocument()
  })

  it('turn/end 渲染成边界行并带上原因', () => {
    render(<TrajectoryCell event={ev('turn/end', { reason: 'completed' })} sessionID="sess-1" />)
    expect(screen.getByText(/turn\/end/)).toBeInTheDocument()
    expect(screen.getByText(/completed/)).toBeInTheDocument()
  })

  // spill_locator 在、却不是字符串是坏数据：当成「没有全文」会把一条取得回来的
  // 全文说成没有。
  it('spill_locator 不是字符串时标为坏数据，而不是当成「没有全文」', () => {
    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c1', preview: 'p', is_error: false, spill_locator: 42 })} sessionID="sess-1" />)
    expect(screen.getByText(/spill_locator 字段缺失或类型不对/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /查看全文/ })).toBeNull()
  })

  it('spill_locator 为空串时没有「查看全文」入口', () => {
    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c1', preview: 'p', is_error: false, spill_locator: '' })} sessionID="sess-1" />)
    expect(screen.queryByRole('button', { name: /查看全文/ })).toBeNull()
  })

  it('spill_locator 非空时「查看全文」能取回全文', async () => {
    appMocks.FetchPreviewFile.mockResolvedValue({ kind: 'code', text: '全文内容在这里', dataURI: '', lang: 'text' })
    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c1', preview: 'p', is_error: false, spill_locator: '.legion/spill/c1.txt' })} sessionID="sess-1" />)
    await userEvent.click(screen.getByRole('button', { name: /查看全文/ }))
    await waitFor(() => expect(screen.getByText(/全文内容在这里/)).toBeInTheDocument())
    expect(appMocks.FetchPreviewFile).toHaveBeenCalledWith('sess-1', '.legion/spill/c1.txt')
  })

  // 会话未绑定 working_dir 时 /v1/files 对空 WorkingDir 直接 404，而 spill_locator
  // 指向 ContextFiles.Root——那个定位符本来就取不回来，server 侧有意不修。
  // 所以 404 是**合法结果**，渲染成说明而不是错误。
  it('全文取回 404 时说明「全文不可得」，不是错误', async () => {
    appMocks.FetchPreviewFile.mockRejectedValue('fetch preview ".legion/spill/c1.txt": status 404')
    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c1', preview: 'p', is_error: false, spill_locator: '.legion/spill/c1.txt' })} sessionID="sess-1" />)
    await userEvent.click(screen.getByRole('button', { name: /查看全文/ }))
    await waitFor(() => expect(screen.getByText(/全文不可得/)).toBeInTheDocument())
    expect(screen.queryByText(/取回全文失败/)).toBeNull()
  })

  // 404 之外的失败是真失败，必须响亮——不许跟「全文不可得」混为一谈。
  it('全文取回 500 时报错，不当成「全文不可得」', async () => {
    appMocks.FetchPreviewFile.mockRejectedValue('fetch preview "x": status 500')
    render(<TrajectoryCell event={ev('tool/result', { call_id: 'c1', preview: 'p', is_error: false, spill_locator: 'x' })} sessionID="sess-1" />)
    await userEvent.click(screen.getByRole('button', { name: /查看全文/ }))
    await waitFor(() => expect(screen.getByText(/取回全文失败/)).toBeInTheDocument())
    expect(screen.queryByText(/全文不可得/)).toBeNull()
  })
})
