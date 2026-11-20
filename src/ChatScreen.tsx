import { useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PhoneNav } from './phone'
import type { Snapshot } from '../shared/snapshot'
import { approvalLabel, modelIdsMatch, sourceLabel, type OutgoingAttachment, type ToolCall } from '../shared/protocol'
import { Avatar } from './Avatar'
import { Markdown } from './Markdown'
import { ago } from './time'

export function ChatScreen({ snapshot }: { snapshot: Snapshot }) {
  const phone = useContext(PhoneNav)
  const [draft, setDraft] = useState('')
  const [panel, setPanel] = useState(true)
  const [pane, setPane] = useState<'history' | 'profile'>(() => {
    const shot = new URLSearchParams(location.search).get('shot') || ''
    return shot === 'profile' ? 'profile' : 'history'
  })
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [atBottom, setAtBottom] = useState(true)
  const [files, setFiles] = useState<OutgoingAttachment[]>([])
  const queue = useRef<Array<{ text: string; files: OutgoingAttachment[] }>>([])
  const scroller = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const atBottomRef = useRef(true)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const profile = snapshot.profiles.find(item => item.gatewayId === snapshot.activeGatewayId && item.name === snapshot.activeProfile)
  const streaming = snapshot.transcript.streaming

  useEffect(() => {
    const shot = new URLSearchParams(location.search).get('shot') || ''
    if (shot !== 'profile') setPane('history')
    setQuery('')
  }, [snapshot.activeProfile, snapshot.activeGatewayId])

  // A new session starts at the newest message.
  useEffect(() => {
    atBottomRef.current = true
    setAtBottom(true)
  }, [snapshot.activeSessionId])

  // Follow streaming replies only while the user is already at the bottom.
  // Scrolling up must never yank the transcript back down.
  useEffect(() => {
    const node = scroller.current
    if (!node || !atBottomRef.current) return
    node.scrollTop = node.scrollHeight
  }, [snapshot.transcript, snapshot.question])

  useEffect(() => {
    const node = scroller.current
    if (!node) return
    const onScroll = () => {
      node.classList.add('scrolling')
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
      scrollTimer.current = setTimeout(() => node.classList.remove('scrolling'), 700)
      const near = node.scrollHeight - node.scrollTop - node.clientHeight < 80
      if (near !== atBottomRef.current) {
        atBottomRef.current = near
        setAtBottom(near)
      }
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      node.removeEventListener('scroll', onScroll)
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
    }
  }, [])

  function jumpToLatest() {
    const node = scroller.current
    if (!node) return
    atBottomRef.current = true
    setAtBottom(true)
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }

  // Grow the composer upward as the draft wraps, keeping the caret in view.
  useEffect(() => {
    const node = composer.current
    if (!node) return
    node.style.height = 'auto'
    const next = Math.min(node.scrollHeight, 280)
    node.style.height = `${Math.max(next, 48)}px`
    node.style.overflowY = node.scrollHeight > 280 ? 'auto' : 'hidden'
  }, [draft])

  async function addFiles(list: FileList | File[] | null): Promise<void> {
    if (!list || !list.length) return
    setNotice('')
    const accepted: OutgoingAttachment[] = []
    for (const file of Array.from(list)) {
      const image = file.type.startsWith('image/')
      const limit = image ? 20 * 1024 * 1024 : 50 * 1024 * 1024
      if (file.size > limit) {
        setNotice(`${file.name} is larger than ${image ? 20 : 50} MB.`)
        continue
      }
      try {
        accepted.push({ name: file.name, mime: file.type || 'application/octet-stream', base64: await readBase64(file) })
      } catch {
        setNotice(`Could not read ${file.name}.`)
      }
    }
    if (accepted.length) setFiles(current => [...current, ...accepted])
  }

  async function submit(text: string, sendingFiles: OutgoingAttachment[]): Promise<void> {
    if ((!text && sendingFiles.length === 0) || sending) return
    setDraft('')
    setFiles([])
    setSending(true)
    setNotice('')
    atBottomRef.current = true
    setAtBottom(true)
    try {
      await window.icyteru.sendMessage(text, sendingFiles)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Message was not sent.')
    } finally {
      setSending(false)
    }
  }

  // Send locally queued /queue messages once the current turn ends.
  useEffect(() => {
    if (streaming || sending) return
    const next = queue.current.shift()
    if (next) void submit(next.text, next.files)
  }, [streaming, sending])

  async function send() {
    const text = draft.trim()
    if ((!text && files.length === 0) || sending) return

    if (text.startsWith('/')) {
      if (files.length) {
        setNotice('Slash commands do not take attachments.')
        return
      }
      const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
      const name = (match?.[1] || '').toLowerCase()
      const arg = (match?.[2] || '').trim()

      if (name === 'queue') {
        if (!arg) {
          setNotice('Usage: /queue <message>')
          return
        }
        setDraft('')
        if (streaming || sending) {
          queue.current.push({ text: arg, files: [] })
          setNotice(`Queued ${queue.current.length}: ${arg.slice(0, 60)}${arg.length > 60 ? '…' : ''}`)
        } else {
          await submit(arg, [])
        }
        return
      }

      if (name === 'steer') {
        if (!arg) {
          setNotice('Usage: /steer <message>')
          return
        }
        setDraft('')
        if (!streaming) {
          await submit(arg, [])
          return
        }
        setSending(true)
        setNotice('')
        try {
          setNotice(await window.icyteru.steer(arg))
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'Steer failed.')
        } finally {
          setSending(false)
        }
        return
      }

      if (name === 'compress' || name === 'compact') {
        setDraft('')
        setSending(true)
        setNotice('Compressing context…')
        try {
          setNotice(await window.icyteru.compress())
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'Compression failed.')
        } finally {
          setSending(false)
        }
        return
      }

      setDraft('')
      setSending(true)
      setNotice('')
      try {
        setNotice(await window.icyteru.slash(text))
      } catch (error) {
        setNotice(error instanceof Error ? error.message : `/${name} failed.`)
      } finally {
        setSending(false)
      }
      return
    }

    if (streaming) {
      queue.current.push({ text, files: [...files] })
      setDraft('')
      setFiles([])
      setNotice(`Queued ${queue.current.length}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`)
      return
    }
    await submit(text, files)
  }

  return (
    <>
      <section className="chat">
        <header className="chat-bar">
          <button className="icon-button phone-only" type="button" aria-label="Bots" onClick={() => phone.setView('roster')}>
            <span aria-hidden="true">‹</span>
          </button>
          <div className="chat-title">
              <Avatar label={snapshot.profileName} initial={profile?.initial || snapshot.profileName.slice(0, 1)} src={snapshot.avatar} size={28} />
              <div>
                <h1>{active?.title || 'New chat'}</h1>
                <p>{snapshot.phase === 'connecting' ? 'Connecting…' : snapshot.profileName}</p>
              </div>
            </div>
          <div className="bar-actions">
            <ModelMenu snapshot={snapshot} onNotice={setNotice} />
            <button
              className="top-action tiny"
              onClick={() => {
                if (window.matchMedia('(max-width: 760px)').matches) {
                  setPanel(true)
                  phone.setView('panel')
                  return
                }
                setPanel(open => !open)
              }}
              type="button"
              aria-label="Open chat history"
            >
              <span className="desktop-only">{panel ? 'Hide history' : 'History'}</span>
              <span className="phone-only history-arrow" aria-hidden="true">›</span>
            </button>
          </div>
        </header>
        {snapshot.phase === 'error' && snapshot.error && (
          <div className="banner wrap">
            {snapshot.error}
            <button className="ghost tiny" onClick={() => void window.icyteru.reconnect()} type="button">Try again</button>
          </div>
        )}
        <div className="transcript" ref={scroller}>
          {snapshot.transcript.messages.length === 0 && (
            <div className="welcome">
              <h2>Ask {snapshot.profileName}</h2>
              <p>The reply is streamed from your own gateway. Tool calls stay tucked under the message.</p>
            </div>
          )}
          {snapshot.transcript.messages.map(message => (
            <article className={`bubble ${message.role}`} key={message.id}>
              {message.text && <Markdown text={message.text} />}
              {message.tools.length > 0 && <ToolGroup tools={message.tools} />}
              {message.error && <p className="inline-error">{message.error}</p>}
            </article>
          ))}
          {streaming && <p className="working">{snapshot.profileName} is working…</p>}
        </div>
        {!atBottom && (
          <button className="jump-latest" onClick={jumpToLatest} type="button" aria-label="Jump to the latest message">
            <span aria-hidden="true">↓</span> Latest
          </button>
        )}
        {snapshot.question && <QuestionCard question={snapshot.question} />}
        {notice && <p className="banner wrap">{notice}</p>}
        {files.length > 0 && (
          <div className="attachments">
            {files.map((file, index) => (
              <span className="attachment-chip" key={`${file.name}-${index}`}>
                <span className="attachment-name" title={file.name}>{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles(current => current.filter((_, at) => at !== index))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <form className="composer" onSubmit={event => { event.preventDefault(); void send() }}>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={event => {
              void addFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <button
            className="attach"
            type="button"
            title="Attach images or files"
            aria-label="Attach images or files"
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip />
          </button>
          <textarea
            ref={composer}
            value={draft}
            placeholder={snapshot.phase === 'ready' ? `Message ${snapshot.profileName}` : 'Connect to Hermes to send a message'}
            disabled={snapshot.phase !== 'ready'}
            rows={1}
            onChange={event => setDraft(event.target.value)}
            onPaste={event => {
              const items = event.clipboardData?.items
              if (!items) return
              const pasted: File[] = []
              for (const item of Array.from(items)) {
                if (item.kind !== 'file') continue
                const file = item.getAsFile()
                if (file) pasted.push(file)
              }
              if (pasted.length) {
                event.preventDefault()
                void addFiles(pasted)
              }
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          {streaming && !draft.trim() && files.length === 0
            ? <button className="solid" onClick={() => void window.icyteru.interrupt()} type="button">Stop</button>
            : <button className="solid" disabled={snapshot.phase !== 'ready' || sending || (!draft.trim() && files.length === 0)} type="submit">Send</button>}
        </form>
      </section>
      {panel && <SidePanel snapshot={snapshot} pane={pane} setPane={setPane} query={query} setQuery={setQuery} />}
    </>
  )
}

function ToolGroup({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const running = tools.some(tool => tool.status === 'running')
  useEffect(() => {
    if (!running) setOpen(false)
  }, [running])
  return (
    <div className="tools">
      <button className="tool-toggle" onClick={() => setOpen(value => !value)} type="button">
        <span>{open ? '▾' : '▸'}</span>
        {running ? 'Using tools' : `${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'}`}
      </button>
      {open && tools.map(tool => <ToolRow key={tool.id} tool={tool} />)}
    </div>
  )
}

function ToolRow({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tool">
      <button onClick={() => setOpen(value => !value)} type="button">
        <span>{open ? '▾' : '▸'}</span>
        <strong>{tool.name}</strong>
        <em>{tool.status === 'running' ? 'running' : 'done'}</em>
      </button>
      {open && (
        <div className="tool-body">
          {tool.argsText && <pre>{tool.argsText}</pre>}
          {tool.resultText && <pre>{tool.resultText}</pre>}
        </div>
      )}
    </div>
  )
}

function QuestionCard({ question }: { question: NonNullable<Snapshot['question']> }) {
  const [secret, setSecret] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

  async function send(result: unknown) {
    setNote('')
    try {
      await window.icyteru.answer(question.id, result)
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not send that answer.')
    }
  }

  return (
    <section className="question">
      <h2>{question.title}</h2>
      {question.body && <p>{question.body}</p>}
      {question.choices.length > 0 && (
        <div className="row">
          {question.choices.map(choice => (
            <button key={choice} className={choice === 'deny' ? 'ghost' : 'solid'} onClick={() => void send({ choice })} type="button">
              {approvalLabel(choice)}
            </button>
          ))}
        </div>
      )}
      {question.questions.map(item => (
        <div className="clarify" key={item.id}>
          <p>{item.question}</p>
          <div className="row">
            {item.choices.map(choice => (
              <button
                key={choice}
                className={answers[item.id]?.split(', ').includes(choice) ? 'solid' : 'ghost'}
                onClick={() => setAnswers(current => {
                  const picked = (current[item.id] || '').split(', ').filter(Boolean)
                  if (!item.multiSelect) return { ...current, [item.id]: choice }
                  const next = picked.includes(choice) ? picked.filter(value => value !== choice) : [...picked, choice]
                  return { ...current, [item.id]: next.join(', ') }
                })}
                type="button"
              >
                {choice}
              </button>
            ))}
          </div>
          {item.choices.length === 0 && (
            <input
              value={answers[item.id] || ''}
              onChange={event => setAnswers(current => ({ ...current, [item.id]: event.target.value }))}
            />
          )}
        </div>
      ))}
      {question.questions.length > 0 && (
        <button className="solid" onClick={() => void send({ answers, outcome: 'submitted' })} type="button">Send answers</button>
      )}
      {question.secret && (
        <form onSubmit={event => { event.preventDefault(); void send({ value: secret }) }}>
          <input type="password" value={secret} onChange={event => setSecret(event.target.value)} placeholder="Password or secret" />
          <div className="row">
            <button className="solid" type="submit">Send</button>
            <button className="ghost" onClick={() => void send({ value: '' })} type="button">Skip</button>
          </div>
        </form>
      )}
      {note && <p className="inline-error">{note}</p>}
    </section>
  )
}

function ModelMenu({ snapshot, onNotice }: { snapshot: Snapshot; onNotice: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [provider, setProvider] = useState('all')
  const menu = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const currentProvider = (snapshot.currentProvider || '').toLowerCase()

  function isModelActive(model: { id: string; provider: string }): boolean {
    if (!modelIdsMatch(model.id, snapshot.currentModel)) return false
    if (!currentProvider) return true
    const name = model.provider.toLowerCase()
    return name === currentProvider || name.includes(currentProvider) || currentProvider.includes(name)
  }

  function isProviderActive(name: string): boolean {
    const lower = name.toLowerCase()
    if (currentProvider && (lower === currentProvider || lower.includes(currentProvider) || currentProvider.includes(lower))) return true
    return snapshot.models.some(model => isModelActive(model) && model.provider === name)
  }

  function chooseProvider(name: string) {
    if (dragged.current) {
      dragged.current = false
      return
    }
    setProvider(name)
  }

  function startTabDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const node = event.currentTarget
    if (node.scrollWidth <= node.clientWidth) return
    event.preventDefault()
    dragged.current = false
    const startX = event.clientX
    const startLeft = node.scrollLeft
    node.classList.add('dragging')
    const move = (next: PointerEvent) => {
      if (Math.abs(next.clientX - startX) > 3) dragged.current = true
      node.scrollLeft = startLeft - (next.clientX - startX)
    }
    const stop = () => {
      node.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const providers = useMemo(
    () => [...new Set(snapshot.models.map(model => model.provider || 'other'))],
    [snapshot.models]
  )
  const models = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return snapshot.models.filter(model => {
      if (provider !== 'all' && (model.provider || 'other') !== provider) return false
      return `${model.label} ${model.provider} ${model.id}`.toLowerCase().includes(needle)
    })
  }, [filter, provider, snapshot.models])
  if (snapshot.models.length === 0) return null
  const current = snapshot.currentModel || 'Model'
  return (
    <div className="model-menu" ref={menu}>
      <button className="top-action tiny desktop-only" onClick={() => setOpen(value => !value)} type="button" title={current}>{current}</button>
      <button className="icon-button phone-only" onClick={() => setOpen(value => !value)} type="button" title="Choose model" aria-label="Choose model">
        <Sliders />
      </button>
      {open && (
        <div className="model-pop">
          <input autoFocus value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search models" />
          {providers.length > 1 && (
            <div
              className="provider-tabs"
              role="tablist"
              aria-label="Model providers"
              onPointerDown={startTabDrag}
              onWheel={event => {
                const node = event.currentTarget
                if (node.scrollWidth > node.clientWidth) node.scrollLeft += event.deltaY
              }}
            >
              <button
                className={provider === 'all' ? 'active' : ''}
                onClick={() => chooseProvider('all')}
                type="button"
                role="tab"
                aria-selected={provider === 'all'}
              >
                All
              </button>
              {providers.map(name => (
                <button
                  key={name}
                  className={provider === name ? 'active' : ''}
                  onClick={() => chooseProvider(name)}
                  type="button"
                  role="tab"
                  aria-selected={provider === name}
                >
                  {name}
                  {isProviderActive(name) && <span className="provider-inuse" aria-label="in use">•</span>}
                </button>
              ))}
            </div>
          )}
          <div className="model-list">
            {models.map(model => {
              const active = isModelActive(model)
              return (
                <button
                  key={`${model.provider}:${model.id}`}
                  className={active ? 'active' : ''}
                  onClick={() => {
                    setOpen(false)
                    void window.icyteru.setModel(model.id, model.provider).then(onNotice).catch(error => {
                      onNotice(error instanceof Error ? error.message : 'Could not change the model.')
                    })
                  }}
                  type="button"
                >
                  <span className="model-label">
                    <strong>{model.label}</strong>
                    <em>{model.provider}</em>
                  </span>
                  {active && <span className="model-check" aria-label="Current model">✓</span>}
                </button>
              )
            })}
            {models.length === 0 && <p className="hint">No models in this provider.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function SidePanel({ snapshot, pane, setPane, query, setQuery }: {
  snapshot: Snapshot
  pane: 'history' | 'profile'
  setPane: (pane: 'history' | 'profile') => void
  query: string
  setQuery: (query: string) => void
}) {
  const phone = useContext(PhoneNav)
  const needle = query.trim().toLowerCase()
  const sessions = snapshot.sessions.filter(session => `${session.title} ${session.preview} ${session.source}`.toLowerCase().includes(needle))
  return (
    <aside className="details">
      <button className="ghost tiny phone-only back-link" type="button" onClick={() => phone.setView('chat')}>Back to chat</button>
      <div className="pane-switch">
        <button className={pane === 'history' ? 'on' : ''} type="button" onClick={() => setPane('history')}>History</button>
        <button className={pane === 'profile' ? 'on' : ''} type="button" onClick={() => setPane('profile')}>Profile</button>
      </div>
      {pane === 'history' ? (
        <>
          <div className="history-tools">
            <label className="search">
              <span className="sr">Search this profile's chats</span>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search chats" />
            </label>
            <button className="ghost tiny" type="button" onClick={() => void window.icyteru.newChat()}>New chat</button>
          </div>
          <div className="session-list">
            {sessions.length === 0 && <p className="empty-list">No chats for {snapshot.profileName} yet. Telegram and Discord chats show up here when Hermes has them.</p>}
            {sessions.map(session => (
              <button
                className={session.id === snapshot.activeSessionId ? 'session active' : 'session'}
                key={session.id}
                type="button"
                onClick={() => { phone.setView('chat'); void window.icyteru.openSession(session.id) }}
              >
                <span className="session-title">
                  {session.running && <i className="dot" />}
                  {session.title}
                </span>
                <span className="session-meta">
                  <em>{sourceLabel(session.source)}</em>
                  {session.updatedAt ? <time>{ago(session.updatedAt)}</time> : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="profile-pane">
          <section>
            <h2>Instructions</h2>
            {snapshot.memory.instructions
              ? <Markdown text={snapshot.memory.instructions} />
              : <p>{snapshot.instructionsNote}</p>}
          </section>
          <section>
            <h2>Memory</h2>
            {snapshot.memory.available
              ? (
                <>
                  {snapshot.memory.summary && <p>{snapshot.memory.summary}</p>}
                  {snapshot.memory.notes && <Markdown text={snapshot.memory.notes} />}
                  {snapshot.memory.user && (
                    <>
                      <h3>About you</h3>
                      <Markdown text={snapshot.memory.user} />
                    </>
                  )}
                </>
              )
              : <p>This gateway does not share a memory view.</p>}
          </section>
          <section>
            <h2>Skills</h2>
            {snapshot.skillsNote && <p>{snapshot.skillsNote}</p>}
            <ul className="skills">
              {snapshot.skills.slice(0, 80).map(skill => (
                <li key={skill.name}>
                  <strong>{skill.name}</strong>
                  {skill.description && <span>{skill.description}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </aside>
  )
}

function Sliders() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function Paperclip() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path d="M8.5 12.5l6.2-6.2a3.4 3.4 0 0 1 4.8 4.8l-7.4 7.4a5.2 5.2 0 0 1-7.4-7.4l7-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}
