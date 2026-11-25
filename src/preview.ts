import { applyGatewayEvent, emptyTranscript, type AgentProfile, type SessionRow } from '../shared/protocol'
import { emptySnapshot, type Snapshot, type ThemePreference } from '../shared/snapshot'

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
  const namedTheme = ['sakura', 'antartika', 'kraft', 'abyss', 'github-light', 'github-dark']
    .find(theme => shot.startsWith(theme))
  const connect = shot === 'connect'
  const markdown = shot === 'markdown' || shot === 'dark-markdown'
  const base = emptySnapshot({
    url: connect ? '' : 'http://100.64.0.2:9119',
    hasToken: !connect,
    hasPassword: false,
    authMode: 'token',
    theme: (namedTheme || (dark ? 'dark' : 'light')) as ThemePreference,
    gateways: []
  })
  if (connect) {
    base.screen = 'connect'
    return base
  }
  base.screen = shot === 'settings' || shot === 'dark-settings' || shot === 'sakura-settings' || shot === 'settings-global' ? 'settings' : 'chat'
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
  const hiddenProfile = profile({ name: 'noustest', label: 'noustest', initial: 'N', preview: '', pinned: false, lastActive: null })
  hiddenProfile.hidden = true
  base.profiles.push(hiddenProfile)
  base.sessions = [
    session('s1', 'Say hello in one short sentence.', 'gui', 28),
    session('s2', 'Reply with the word stream.', 'telegram', 29),
    session('s3', 'Say hello in one short sentence.', 'discord', 30)
  ]
  base.activeSessionId = 's1'
  if (shot === 'idle-running') {
    base.sessions[0].running = true
    base.transcript.streaming = false
  }
  base.currentModel = 'deepseek/deepseek-v4.1-flash'
  base.currentProvider = 'commandcode'
  if (shot === 'settings-global') {
    base.currentModel = 'deepseek/deepseek-v4-pro'
  }
  base.globalModel = 'deepseek/deepseek-v4.1-flash'
  base.globalProvider = 'commandcode'
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
          status: 'done',
          startedAt: Date.now() - 45_000,
          finishedAt: Date.now()
        }],
        pending: false
      }
    ]
  }
  if (shot === 'desktop-preview' || shot === 'preview-panel') {
    base.transcript.messages[1].tools.push({
      id: shot === 'preview-panel' ? 'preview-panel-1' : 'preview-1',
      name: shot === 'preview-panel' ? 'preview_panel' : 'desktop_preview',
      argsText: JSON.stringify({
        action: 'open',
        url: 'https://example.com',
        label: 'TAP verify'
      }),
      resultText: JSON.stringify({ success: true, url: 'https://example.com', label: 'TAP verify' }),
      status: 'done'
    })
  }
  if (shot === 'tok-chat') {
    base.transcript.streaming = true
  }
  if (shot === 'table' || shot === 'dark-table' || shot === 'mobile-table') {
    base.transcript.messages[0].text = 'cek hasil verifikasi uptime-watch'
    base.transcript.messages[1].tools = []
    base.transcript.messages[1].text = [
      '**Definisi selesai — 4/4 lolos**',
      '',
      '| Kriteria | Hasil |',
      '|---|---|',
      '| `pm2s list` menunjukkan uptime-watch online | ✅ id 24, online |',
      '| Log terbaru: poll=60s, ambang=120s, dry=False | ✅ |',
      '| Satu notifikasi test masuk ke Telegram | ✅ ok=True |',
      '| Dry-run tidak me-restart apa pun | ✅ zero execution |'
    ].join('\n')
  }
  if (shot === 'markdown-identifiers') {
    base.transcript.messages = [
      {
        id: 'u-identifiers',
        role: 'user',
        text: 'Salin pesan_kalo_pake_ini lalu CONTOH_PESAN; kedua underscore harus tetap ada.',
        tools: [],
        pending: false
      },
      {
        id: 'a-identifiers',
        role: 'assistant',
        text: 'Identifier snake_case tetap literal, sedangkan _italic yang disengaja_ masih miring.',
        tools: [],
        pending: false
      }
    ]
  }
  if (shot === 'thinking') {
    base.transcript.streaming = true
    base.tokensPerSecond = null
    base.transcript.messages[1].text = ''
    base.transcript.messages[1].tools = []
  }
  if (shot === 'tool') {
    base.transcript.streaming = true
    base.transcript.messages[1].tools[0].status = 'running'
    base.transcript.messages[1].tools[0].startedAt = Date.now() - 12_000
    base.transcript.messages[1].tools[0].finishedAt = undefined
  }
  if (shot === 'tool-writing') {
    base.transcript.streaming = true
    base.transcript.messages[1].text = ''
    base.transcript.messages[1].tools = [{
      id: 'writing-1',
      name: 'write_file',
      argsText: 'DIALECTICA.md',
      resultText: '',
      status: 'running',
      startedAt: Date.now() - 12_000
    }]
  }
  if (shot === 'split-fixed') {
    let transcript = emptyTranscript()
    transcript.messages.push({
      id: 'user-split', role: 'user', text: 'kenapa pesan kebelah tool call?', tools: [], pending: false
    })
    transcript = applyGatewayEvent(transcript, {
      type: 'message.delta',
      payload: { text: 'Aku cek transcript dan offset tool dulu.', offset: 0, turn_id: 'split', segment: 0 }
    })
    for (let i = 1; i <= 6; i += 1) {
      transcript = applyGatewayEvent(transcript, {
        type: 'tool.start',
        payload: { tool_id: `split-${i}`, name: 'terminal', args: { command: `probe ${i}` } }
      })
      transcript = applyGatewayEvent(transcript, {
        type: 'tool.complete',
        payload: { tool_id: `split-${i}`, name: 'terminal', result: `ok ${i}`, is_error: false }
      })
    }
    const baseTime = Date.now() - 45_000
    transcript.messages[0].tools.forEach((tool, i) => {
      tool.startedAt = baseTime + i * 6_000
      tool.finishedAt = baseTime + (i + 1) * 6_000
    })
    transcript = applyGatewayEvent(transcript, {
      type: 'message.complete',
      payload: {
        text: 'Itu bukan 700 pesan chat baru, sayang. Itu hitungan baris aktif setelah compression, dan mayoritas isinya tool call. Blok tool tetap terpisah dari bubble teks, jadi pesan ini tidak ikut tertutup saat tool dilipat.',
        status: 'ok'
      }
    })
    base.transcript = transcript
  }
  if (shot === 'split-normal') {
    base.transcript.messages = [
      base.transcript.messages[0],
      {
        id: 'normal-a1',
        role: 'assistant',
        text: 'Aku tulis release notes dulu.',
        tools: [{ id: 'n1', name: 'write_file', argsText: 'release notes', resultText: 'written', status: 'done', startedAt: Date.now() - 30_000, finishedAt: Date.now() - 22_000 }],
        pending: false
      },
      {
        id: 'normal-a2',
        role: 'assistant',
        text: 'Sekarang bump versi dan verifikasi.',
        tools: [{ id: 'n2', name: 'terminal', argsText: 'npm run version:set', resultText: '0.0.51', status: 'done', startedAt: Date.now() - 18_000, finishedAt: Date.now() - 4_000 }],
        pending: false
      },
      {
        id: 'normal-a3',
        role: 'assistant',
        text: 'Tag terkirim, aku pantau workflow.',
        tools: [],
        pending: false
      }
    ]
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
  if (shot === 'question-multi') {
    base.transcript.streaming = true
    base.question = {
      id: 'q-preview-multi',
      method: 'clarify.request',
      sessionId: 's1',
      title: 'Hermes has a question',
      body: 'Pilih opsi yang mau dijalankan.',
      choices: [],
      secret: false,
      questions: [
        {
          id: 'q1',
          question: 'Mana saja yang mau dijalankan?',
          choices: ['Nanti saja, aku restart sendiri', 'Restart sekarang', 'Opsi, lain'],
          multiSelect: true
        }
      ],
      promptId: 'q-preview-multi',
      executionGeneration: 7
    }
  }
  if (shot === 'vault-save') {
    base.transcript.streaming = true
    base.question = {
      id: 'q-preview-vault-save',
      method: 'vault.save_login',
      sessionId: 's1',
      title: 'Save login for github.com',
      body: 'Save this login for https://github.com? The identifier and password stay in the vault and never reach the model.',
      choices: [],
      secret: false,
      questions: [],
      vault: { kind: 'save_login', site: 'github.com', origin: 'https://github.com' }
    }
  }
  if (shot === 'vault-code') {
    base.transcript.streaming = true
    base.question = {
      id: 'q-preview-vault-code',
      method: 'vault.code',
      sessionId: 's1',
      title: 'Code for github.com',
      body: 'Enter the one-time code github.com sent you. It is sent straight to the vault and never reaches the model.',
      choices: [],
      secret: true,
      questions: [],
      vault: { kind: 'code', site: 'github.com' }
    }
  }
  if (shot === 'remote-clarify') {
    base.transcript.streaming = true
    base.remoteClarifies = [{
      clarifyId: 'remote-q-preview',
      sessionKey: 'agent:main:telegram:dm:1924400666',
      question: '9router cuma terdaftar di profil aino, dialpool, hotaru, dan rin. Mau aku daftarkan di profil default?',
      choices: [
        'Daftarkan + jadi fallback di belakang deepseek',
        'Daftarkan sebagai provider saja (dipilih manual)',
        'Jangan, biarkan profil default apa adanya'
      ],
      multiSelect: false,
      awaitingText: false
    }]
  }
  if (shot === 'remote-clarify-multi') {
    base.transcript.streaming = true
    base.remoteClarifies = [{
      clarifyId: 'remote-q-preview-multi',
      sessionKey: 'agent:main:telegram:dm:1924400666',
      question: 'Mana saja yang mau dijalankan?',
      choices: ['Nanti saja, aku restart sendiri', 'Restart sekarang'],
      multiSelect: true,
      awaitingText: false
    }]
  }
  if (shot === 'remote-approval') {
    base.transcript.streaming = true
    base.remoteApprovals = [{
      sessionKey: 'agent:main:telegram:dm:1924400666',
      requestId: 'remote-a-preview',
      command: "rm -rf /tmp/icyteru-approval-test && echo 'cleaned'",
      description: 'Clean up the temporary approval test directory.',
      allowSession: true,
      allowPermanent: false,
      smartDenied: false,
      denyOnly: false
    }]
  }
  if (shot === 'subagents') {
    base.transcript.streaming = true
    const now = Date.now()
    base.subagents = [
      {
        id: 'sa-1', goal: 'Audit the Icyteru UI/menu layer for broken controls and layout problems',
        status: 'completed', taskIndex: 0, taskCount: 3, parentId: '', childSessionId: 'child-1',
        delegationId: 'deleg_preview', depth: 0, model: 'deepseek-v4.1-flash', toolCount: 41,
        toolsets: ['terminal', 'browser'], lastText: 'Report ready', toolName: 'terminal',
        activity: 'complete', startedAt: now - 60000, updatedAt: now - 20000,
        durationSeconds: 40, summary: 'done', inputTokens: 12000, outputTokens: 2400, apiCalls: 9
      },
      {
        id: 'sa-2', goal: 'Audit the Icyteru core client, protocol, and state layer for logic bugs and races',
        status: 'completed', taskIndex: 1, taskCount: 3, parentId: '', childSessionId: 'child-2',
        delegationId: 'deleg_preview', depth: 0, model: 'deepseek-v4.1-flash', toolCount: 32,
        toolsets: ['terminal', 'file'], lastText: 'Differences found', toolName: 'terminal',
        activity: 'complete', startedAt: now - 60000, updatedAt: now - 15000,
        durationSeconds: 45, summary: 'done', inputTokens: 14000, outputTokens: 2600, apiCalls: 11
      },
      {
        id: 'sa-3', goal: 'Audit packaging, Android runtime, notifications, release workflow, and the gateway plugin',
        status: 'running', taskIndex: 2, taskCount: 3, parentId: '', childSessionId: 'child-3',
        delegationId: 'deleg_preview', depth: 0, model: 'deepseek-v4.1-flash', toolCount: 54,
        toolsets: ['terminal', 'browser'], lastText: 'Checking plugin auth paths', toolName: 'terminal',
        activity: 'thinking', startedAt: now - 55000, updatedAt: now,
        durationSeconds: 0, summary: '', inputTokens: 16000, outputTokens: 3000, apiCalls: 13
      }
    ]
  }
  if (shot === 'media') {
    base.transcript.streaming = false
    base.transcript.messages = [
      { id: 'u-media', role: 'user', text: 'Kirim file, gambar, audio, dan video.', tools: [], pending: false,
        attachments: [
          { name: 'cium.md', mime: 'text/markdown', image: false, dataUrl: `data:text/markdown;base64,${btoa('# LAPORAN\n\nCIUM')}` },
          { name: 'icyteru-preview.svg', mime: 'image/svg+xml', image: true, dataUrl: sampleImage }
        ] },
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
    renameSession: () => Promise.resolve(),
    sessionInfo: () => Promise.resolve({ id: 's1', title: 'Say hello in one short sentence.', messages: 30, estimatedTokens: 24817 }),
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
    saveDownload: () => Promise.resolve('Download/Icyteru/preview'),
    compress: () => Promise.resolve('Compressed the conversation.'),
    slash: (command: string) => Promise.resolve(`Ran ${command}.`),
    enableNotifications: () => Promise.resolve(true),
    notify: () => Promise.resolve(),
    testApproval: () => Promise.resolve({ ok: true, session_id: 'preview' }),
    interrupt: () => Promise.resolve(),
    answer: () => Promise.resolve(),
    answerRemoteClarify: () => Promise.resolve(),
    answerRemoteApproval: () => Promise.resolve(),
    setModel: () => Promise.resolve(''),
    setSessionModel: (_model: string, _provider: string, _confirm = false) => Promise.resolve('Session model set in preview.'),
    cancelSessionModel: () => undefined,
    setReasoning: () => Promise.resolve('Reasoning set in preview.'),
    setGlobalReasoning: () => Promise.resolve('Global reasoning set in preview.'),
    selectProfile: () => Promise.resolve(),
    setPinned: () => Promise.resolve(),
    setProfileHidden: () => Promise.resolve(),
    createProfile: () => Promise.resolve(),
    getAppearance: () => Promise.resolve({ dim: 0.22, blur: 10, light: null, dark: null }),
    setBackground: () => Promise.resolve({ dim: 0.22, blur: 10, light: null, dark: null }),
    clearBackground: () => Promise.resolve({ dim: 0.22, blur: 10, light: null, dark: null }),
    setBackdrop: () => Promise.resolve({ dim: 0.22, blur: 10, light: null, dark: null }),
    addGateway: () => Promise.resolve(snapshot),
    removeGateway: () => Promise.resolve(snapshot),
    onSnapshot: (listener: (next: Snapshot) => void) => {
      listener(snapshot)
      return () => undefined
    }
  }
  window.icyteru = api
}
