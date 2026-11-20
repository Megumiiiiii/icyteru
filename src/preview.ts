import type { AgentProfile, SessionRow } from '../shared/protocol'
import { emptySnapshot, type Snapshot } from '../shared/snapshot'

type ProfileSeed = Pick<AgentProfile, 'name' | 'label' | 'initial' | 'preview' | 'pinned' | 'lastActive'>

const now = Math.floor(Date.now() / 1000)

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
  base.screen = 'chat'
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
    newChat: () => Promise.resolve(),
    sendMessage: () => Promise.resolve(),
    steer: () => Promise.resolve('Steered.'),
    compress: () => Promise.resolve('Compressed the conversation.'),
    slash: (command: string) => Promise.resolve(`Ran ${command}.`),
    enableNotifications: () => Promise.resolve(true),
    notify: () => Promise.resolve(),
    interrupt: () => Promise.resolve(),
    answer: () => Promise.resolve(),
    setModel: () => Promise.resolve(''),
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
