import { create } from 'zustand'

export interface MessageMeta {
  elapsedSec: number
  // Token breakdown from the task_completed event. promptTokens is the input,
  // completionTokens the output; cachedTokens is the subset of promptTokens
  // served from the provider prompt cache (0 when the provider does not report
  // it). totalTokens is kept for backward compatibility.
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  totalTokens: number
}

// Message.role carries an extra 'system' value for locally-generated notices
// (slash command output, confirmations, errors). System messages never reach
// the model; they are rendered with a distinct style and bypass markdown.
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  streaming?: boolean
  meta?: MessageMeta
  // agent is the sub-agent that produced an assistant message. It belongs on
  // the message rather than on the session: a session's agent_id is fixed when
  // the session is created, but the answering agent is picked per submission,
  // so one session can legitimately hold replies from different agents.
  // Undefined for user/system messages and for history predating the field.
  agent?: string
}

interface ChatState {
  messages: Message[]
  addMessage: (msg: Message) => void
  appendToken: (id: string, token: string) => void
  finalizeMessage: (id: string) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  appendToken: (id, token) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + token } : m
      ),
    })),
  finalizeMessage: (id) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m
      ),
    })),
  clearMessages: () => set({ messages: [] }),
}))
