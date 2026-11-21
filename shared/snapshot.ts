import type { AgentProfile, AuthMode, MemoryView, ModelChoice, PendingQuestion, SessionRow, SkillRow, Transcript } from './protocol'

export type ThemePreference = 'light' | 'dark' | 'system'
export type AppScreen = 'connect' | 'chat' | 'settings'

export interface GatewayInfo {
  id: string
  url: string
  label: string
}

export interface ConnectionInfo {
  url: string
  hasToken: boolean
  hasPassword: boolean
  authMode: AuthMode
  method?: 'password' | 'token'
  theme: ThemePreference
  gateways: GatewayInfo[]
}

export interface TestResult {
  ok: boolean
  message: string
  version?: string
  mode?: AuthMode
}

export interface QueuedMessage {
  id: string
  sessionId: string
  text: string
  status: 'queued' | 'unknown' | 'failed'
  attachmentNames?: string[]
  createdAt: number
  admissionId?: string
  error?: string
}

export interface Snapshot {
  screen: AppScreen
  connection: ConnectionInfo
  phase: 'idle' | 'connecting' | 'ready' | 'error'
  status: string
  error: string
  hermesVersion: string
  profileName: string
  avatar: string
  profiles: AgentProfile[]
  activeProfile: string
  activeGatewayId: string
  sessions: SessionRow[]
  activeSessionId: string
  transcript: Transcript
  models: ModelChoice[]
  currentModel: string
  currentProvider: string
  currentReasoning: string
  globalReasoning: string
  tokensPerSecond: number | null
  skills: SkillRow[]
  skillsNote: string
  memory: MemoryView
  instructionsNote: string
  question: PendingQuestion | null
  queued: QueuedMessage[]
}

export function emptySnapshot(connection: ConnectionInfo): Snapshot {
  return {
    screen: connection.url ? 'chat' : 'connect',
    connection,
    phase: 'idle',
    status: '',
    error: '',
    hermesVersion: '',
    profileName: 'Hermes',
    avatar: '',
    profiles: [],
    activeProfile: 'default',
    activeGatewayId: 'primary',
    sessions: [],
    activeSessionId: '',
    transcript: { messages: [], streaming: false },
    models: [],
    currentModel: '',
    currentProvider: '',
    currentReasoning: '',
    globalReasoning: '',
    tokensPerSecond: null,
    skills: [],
    skillsNote: '',
    memory: { available: false, summary: '', notes: '', user: '', instructions: '' },
    instructionsNote: 'Instructions live in SOUL.md on the Hermes machine. Chats on Telegram, Discord, and here all use that same file.',
    question: null,
    queued: []
  }
}
