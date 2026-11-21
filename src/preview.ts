import type { AgentProfile, SessionRow } from '../shared/protocol'
import { emptySnapshot, type Snapshot } from '../shared/snapshot'

type ProfileSeed = Pick<AgentProfile, 'name' | 'label' | 'initial' | 'preview' | 'pinned' | 'lastActive'>

const now = Math.floor(Date.now() / 1000)

const sampleImage = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjOGI1Y2Y2Ii8+PC9zdmc+'
const sampleAudio = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAgICAgAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAgA=='
const sampleVideo = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANebW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAHgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAol0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAIAAAACAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAB4AAAEAAABAAAAAAIBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAABgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABrG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWxzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2V+IiMBEAAADAAQAAAMAyDxIllgBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAuz0AAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAMAAAIAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAAoY3R0cwAAAAAAAAADAAAAAQAABAAAAAABAAAGAAAAAAEAAAIAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAADAAAAAQAAACBzdHN6AAAAAAAAAAAAAAADAAACtwAAAAwAAAAMAAAAFHN0Y28AAAAAAAAAAQAAA44AAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAxAAAACGZyZWUAAALXbWRhdAAAAqAGBf//nNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDBAIAAAAAPZYiEADP//vbsvgU2FMjBAAAACEGaImxCv/7AAAAACAGeQXkK/8SB'

function profile(seed: ProfileSeed): AgentProfile {
  return {
    gatewayId: 'primary',
    name: seed.name,
    label: seed.label,
    description: '',
    model: '',
    avatar: '',
    initial: seed.initial,
    hasAvatar: false,
    preview: seed.preview,
    lastActive: seed.lastActive,
    pinned: seed.pinned,
    hidden: false,
    botMeta: seed.pinned ? { pinned: true } : {}
  }
}

function session(id: string, title: string, source: string, minutesAgo: number): SessionRow {
  return {
    id,
    title,
    preview: title,
    source,
    model: '',
    updatedAt: now - minutesAgo * 60,
    messageCount: 0,
    running: false,
    pinned: false
  }
}

export function previewSnapshot(shot: string): Snapshot {
  const dark = shot.startsWith('dark')
  const connect = shot === 'connect'
  const markdown = shot === 'markdown' || shot === 'dark-markdown'
  const base = emptySnapshot({
    url: connect ? '' : 'http://100.64.0.2:9119',
    hasToken: !connect,
    hasPassword: false,
    authMode: 'token',
    theme: dark ? 'dark' : 'light',
    gateways: []
  })
  if (connect) {
    base.screen = 'connect'
    return base
  }
  base.screen = shot === 'settings' || shot === 'dark-settings' ? 'settings' : 'chat'
  base.phase = 'ready'
  base.hermesVersion = '0.1.0'
  base.profileName = 'Hermes'
  base.activeProfile = 'default'
  base.activeGatewayId = 'primary'
  base.profiles = [
    profile({ name: 'scout', label: 'Scout', initial: 'S', preview: 'Hello from your Hermes…', pinned: true, lastActive: now - 13 * 60 }),
    profile({ name: 'default', label: 'Hermes', initial: 'H', preview: 'Hello from your Hermes…', pinned: false, lastActive: now - 24 * 60 }),
    profile({ name: 'aino', label: 'Aino', initial: 'A', preview: '', pinned: false, lastActive: null }),
    profile({ name: 'guide', label: 'Guide', initial: 'G', preview: '', pinned: false, lastActive: null })
  ]
  base.sessions = [
    session('s1', 'Say hello in one short sentence.', 'gui', 28),
    session('s2', 'Reply with the word stream.', 'telegram', 29),
    session('s3', 'Say hello in one short sentence.', 'discord', 30)
  ]
  base.activeSessionId = 's1'
  base.currentModel = 'deepseek/deepseek-v4.1-flash'
  base.currentProvider = 'commandcode'
  base.currentReasoning = 'medium'
  base.globalReasoning = 'high'
  base.tokensPerSecond = 275
  base.models = [
    { id: 'deepseek/deepseek-v4.1-flash', label: 'deepseek/deepseek-v4.1-flash', provider: 'CommandCode' },
    { id: 'deepseek/deepseek-v4-pro', label: 'deepseek/deepseek-v4-pro', provider: 'CommandCode' },
    { id: 'Qwen/Qwen3.7-Max', label: 'Qwen/Qwen3.7-Max', provider: 'CommandCode' },
    { id: 'gpt-6.2-sol', label: 'gpt-6.2-sol', provider: 'ChatGPT' },
    { id: 'claude-opus-4.6', label: 'claude-opus-4.6', provider: 'OpenRouter' }
  ]
  base.memory = {
    available: true,
    summary: 'The user is building Icyteru, a quiet window onto their Hermes gateway.',
    notes: 'Prefer short replies unless the user asks for a walkthrough.',
    user: 'Calls the app Icyteru and keeps the agent on their own machine.',
    instructions: 'You are Hermes. Stay concise, and keep tool calls visible but tucked away.'
  }
  base.instructionsNote = ''
  base.skills = [
    { name: 'terminal', description: 'Run a command on the Hermes machine.', category: 'core', enabled: true },
    { name: 'memory', description: 'Read and write the notes this profile keeps.', category: 'core', enabled: true }
  ]
  base.transcript = {
    streaming: shot === 'stream',
    messages: [
      {
        id: 'u1',
        role: 'user',
        text: 'Say hello in one short sentence.',
        tools: [],
        pending: false
      },
      {
        id: 'a1',
        role: 'assistant',
        text: 'Hello from your Hermes gateway. This reply was streamed one piece at a time.',
        tools: [{
          id: 't1',
          name: 'memory',
          argsText: '{ "action": "read" }',
          resultText: 'No extra notes for this chat.',
          status: 'done'
        }],
        pending: false
      }
    ]
  }
  if (shot === 'tool') {
    base.transcript.streaming = true
    base.transcript.messages[1].tools[0].status = 'running'
  }
  if (shot === 'question') {
    base.transcript.streaming = true
    base.question = {
      id: 'q-preview',
      method: 'clarify.request',
      sessionId: 's1',
      title: 'Hermes has a question',
      body: 'Restart gateway sekarang biar 0.7 langsung aktif?',
      choices: [],
      secret: false,
      questions: [
        {
          id: 'q1',
          question: 'Restart gateway sekarang biar 0.7 langsung aktif?',
          choices: ['Restart sekarang — sesi ini putus sebentar, lanjut kirim pesan', 'Nanti saja, aku restart sendiri'],
          multiSelect: false
        }
      ],
      promptId: 'q-preview',
      executionGeneration: 7
    }
  }
  if (shot === 'media') {
    base.transcript.streaming = false
    base.transcript.messages = [
      { id: 'u-media', role: 'user', text: 'Kirim file, gambar, audio, dan video.', tools: [], pending: false },
      {
        id: 'a-media',
        role: 'assistant',
        text: 'Ini contoh file, gambar, audio, dan video.\n\nMEDIA:/tmp/icyteru-preview.svg\nMEDIA:/tmp/icyteru-preview.txt\nMEDIA:/tmp/icyteru-preview.wav\nMEDIA:/tmp/icyteru-preview.mp4',
        tools: [],
        pending: false
      }
    ]
  }
  if (markdown) {
    const sample = [
      '# Panduan upload ke Arweave',
      '',
      'Ini **penting** dan _catatan kecil_. Ada `inline code` dan [dokumentasi](https://example.com/docs).',
      '',
      '## Langkah',
      '',
      '1. Siapkan arsipnya',
      '2. Pecah jadi 20 MB',
      '3. Upload tiap bagian',
      '',
      '- Jangan upload sekaligus',
      '- Simpan transaksi id',
      '- Cek saldo Turbo dulu',
      '',
      '> Kredit terbatas? Upload per bagian, jangan boros.',
      '',
      '```bash',
      'zip -s 20m bukti.zip --out bukti-part.zip',
      'for f in bukti-part.z*; do turbo -t arweave "$f"; done',
      '```',
      '',
      '---',
      '',
      'Selesai ~~tidak~~.',
      '',
      'Semoga membantu.'
    ].join('\n')
    base.transcript.messages = [
      { id: 'u-md', role: 'user', text: 'Tolong rapikan panduan upload ini.', tools: [], pending: false },
      { id: 'a-md', role: 'assistant', text: sample, tools: [], pending: false }
    ]
    for (let index = 0; index < 16; index += 1) {
      base.transcript.messages.push({
        id: `fill-${index}`,
        role: index % 2 === 0 ? 'assistant' : 'user',
        text: `Baris filler ${index + 1}. Ini cuma untuk menguji scroll transcript.`,
        tools: [],
        pending: false
      })
    }
  }
  return base
}

export function installPreview(shot: string): void {
  const snapshot = previewSnapshot(shot)
  const api = {
    getSnapshot: () => Promise.resolve(snapshot),
    testConnection: () => Promise.resolve({ ok: true, message: 'Preview only.' }),
    probeAuth: () => Promise.resolve({ ok: true, message: 'Preview only.', mode: 'token' as const, authRequired: true, providers: ['session-token'] }),
    saveConnection: () => Promise.resolve(snapshot),
    forgetConnection: () => Promise.resolve(snapshot),
    setTheme: () => Promise.resolve(snapshot),
    showScreen: () => Promise.resolve(snapshot),
    reconnect: () => Promise.resolve(),
    refreshSessions: () => Promise.resolve(),
    openSession: () => Promise.resolve(),
    setSessionPinned: () => Promise.resolve(),
    newChat: () => Promise.resolve(),
    sendMessage: () => Promise.resolve(),
    steer: () => Promise.resolve('Steered.'),
    queue: () => Promise.resolve(),
    deleteQueued: () => Promise.resolve(),
    mediaUrl: () => Promise.resolve(''),
    mediaData: (path: string) => Promise.resolve(
      path.endsWith('.svg')
        ? sampleImage
        : path.endsWith('.wav')
          ? sampleAudio
          : path.endsWith('.mp4')
            ? sampleVideo
            : `data:text/plain;base64,${btoa('Hello from Icyteru preview.')}`
    ),
    compress: () => Promise.resolve('Compressed the conversation.'),
    slash: (command: string) => Promise.resolve(`Ran ${command}.`),
    enableNotifications: () => Promise.resolve(true),
    notify: () => Promise.resolve(),
    testApproval: () => Promise.resolve({ ok: true, session_id: 'preview' }),
    interrupt: () => Promise.resolve(),
    answer: () => Promise.resolve(),
    setModel: () => Promise.resolve(''),
    setSessionModel: (_model: string, _provider: string, _confirm = false) => Promise.resolve('Session model set in preview.'),
    cancelSessionModel: () => undefined,
    setReasoning: () => Promise.resolve('Reasoning set in preview.'),
    setGlobalReasoning: () => Promise.resolve('Global reasoning set in preview.'),
    selectProfile: () => Promise.resolve(),
    setPinned: () => Promise.resolve(),
    createProfile: () => Promise.resolve(),
    getAppearance: () => Promise.resolve({ dim: 0.22, blur: 10, light: null, dark: null }),
    setBackground: () => Promise.resolve({ dim: 0.22, blur: 10, light: null, dark: null }),
    clearBackground: () => Promise.resolve({ dim: 0.22, blur: 10, light: null, dark: null }),
    setBackdrop: () => Promise.resolve({ dim: 0.22, blur: 10, light: null, dark: null }),
    addGateway: () => Promise.resolve(snapshot),
    removeGateway: () => Promise.resolve(),
    onSnapshot: (listener: (next: Snapshot) => void) => {
      listener(snapshot)
      return () => undefined
    }
  }
  window.icyteru = api
}
