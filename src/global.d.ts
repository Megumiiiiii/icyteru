import type { AuthDiscovery, NotificationPayload, OutgoingAttachment } from '../shared/protocol'
import type { AppScreen, Snapshot, TestResult, ThemePreference } from '../shared/snapshot'

export interface ConnectionInput {
  url?: string
  token?: string
  username?: string
  password?: string
  method?: 'password' | 'token'
}

declare global {
  interface Window {
    icyteru: {
      getSnapshot: () => Promise<Snapshot>
      testConnection: (input: ConnectionInput) => Promise<TestResult>
      probeAuth: (input: ConnectionInput) => Promise<AuthDiscovery>
      saveConnection: (input: ConnectionInput) => Promise<Snapshot>
      forgetConnection: () => Promise<Snapshot>
      setTheme: (theme: ThemePreference) => Promise<Snapshot>
      showScreen: (screen: AppScreen) => Promise<Snapshot>
      reconnect: () => Promise<void>
      refreshSessions: () => Promise<void>
      openSession: (id: string) => Promise<void>
      setSessionPinned: (id: string, pinned: boolean) => Promise<void>
      newChat: () => Promise<void>
      sendMessage: (text: string, attachments?: OutgoingAttachment[]) => Promise<void>
      steer: (text: string) => Promise<string>
      queue: (text: string, attachments?: OutgoingAttachment[]) => Promise<void>
      deleteQueued: (id: string) => Promise<void>
      mediaUrl: (path: string) => Promise<string>
      mediaData: (path: string) => Promise<string>
      compress: () => Promise<string>
      slash: (command: string) => Promise<string>
      enableNotifications: () => Promise<boolean>
      notify: (payload: NotificationPayload) => Promise<void>
      testApproval: () => Promise<{ ok: boolean; session_id: string }>
      interrupt: () => Promise<void>
      answer: (id: string, result: unknown) => Promise<void>
      answerRemoteClarify: (clarifyId: string, answer: string) => Promise<void>
      answerRemoteApproval: (sessionKey: string, requestId: string, choice: string, reason?: string, commandDigest?: string) => Promise<void>
      setModel: (model: string, provider: string, confirm?: boolean) => Promise<string>
      setSessionModel: (model: string, provider: string, confirm?: boolean) => Promise<string | { confirmationRequired: true; message: string; model: string; provider: string }>
      cancelSessionModel: () => void
      setReasoning: (value: string) => Promise<string>
      setGlobalReasoning: (value: string) => Promise<string>
      selectProfile: (gatewayId: string, name: string) => Promise<void>
      setPinned: (gatewayId: string, name: string, pinned: boolean) => Promise<void>
      createProfile: (label: string) => Promise<void>
      getAppearance: () => Promise<{ dim: number; blur: number; light: string | null; dark: string | null }>
      setBackground: (mode: 'light' | 'dark', image: string) => Promise<{ dim: number; blur: number; light: string | null; dark: string | null }>
      clearBackground: (mode: 'light' | 'dark') => Promise<{ dim: number; blur: number; light: string | null; dark: string | null }>
      setBackdrop: (dim: number, blur: number) => Promise<{ dim: number; blur: number; light: string | null; dark: string | null }>
      addGateway: (input: ConnectionInput) => Promise<Snapshot>
      removeGateway: (id: string) => Promise<void>
      onSnapshot: (listener: (snapshot: Snapshot) => void) => () => void
    }
  }
}

export {}
