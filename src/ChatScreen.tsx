import { Fragment, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Capacitor } from '@capacitor/core'
import { PhoneNav } from './phone'
import type { Snapshot } from '../shared/snapshot'
import { orderedParts, approvalLabel, modelIdsMatch, modelShortName, sourceLabel, type OutgoingAttachment, type ToolCall } from '../shared/protocol'
import { Avatar } from './Avatar'
import { Markdown } from './Markdown'
import { ago } from './time'

type IncomingAttachment = {
  path: string
  name: string
  image: boolean
}

const MEDIA_TAG_RE = /(?:^|\s)MEDIA:\s*([^\s]+)/g

function cleanMediaPath(raw: string): string {
  return raw.replace(/[)\]};.,]+$/g, '')
}

function splitMedia(text: string): { text: string; attachments: IncomingAttachment[] } {
  const attachments: IncomingAttachment[] = []
  const stripped = text.replace(MEDIA_TAG_RE, (_match, raw: string) => {
    const path = cleanMediaPath(raw)
    if (!path) return ''
    const name = path.split(/[\\/]/).pop() || path
    attachments.push({ path, name, image: /\.(png|jpe?g|webp|gif)$/i.test(path) })
    return ''
  })
  return { text: stripped.replace(/\n{3,}/g, '\n\n').trim(), attachments }
}

const isAndroid = Capacitor.getPlatform() === 'android'

function StatusBar({
  state,
  title,
  message,
  elapsed,
  track
}: {
  state: 'running' | 'done' | 'error' | 'info'
  title: string
  message?: string
  elapsed?: number
  track?: boolean
}) {
  const icon = state === 'running'
    ? <span className="statusbar-spinner" aria-hidden="true" />
    : state === 'error'
      ? <span className="statusbar-icon error" aria-hidden="true">✕</span>
      : state === 'done'
        ? <span className="statusbar-icon done" aria-hidden="true">✓</span>
        : <span className="statusbar-icon info" aria-hidden="true">i</span>

  return (
    <div className={`statusbar ${state}`} role="status" aria-live="polite">
      <div className="statusbar-head">
        {icon}
        <span className="statusbar-label">{title}</span>
        {typeof elapsed === 'number' && <span className="statusbar-time">{elapsed}s</span>}
      </div>
      {message && <p className="statusbar-message">{message}</p>}
      {track && <div className="statusbar-track"><span /></div>}
    </div>
  )
}

function MediaAttachment({ path, name, image }: IncomingAttachment) {
  const [dataUrl, setDataUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await window.icyteru.mediaData(path)
        if (!cancelled) setDataUrl(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load that file.')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [path])

  if (error) return <span className="incoming-file error">{error}</span>
  if (dataUrl) {
    return image
      ? (
        <a className="incoming-image-link" href={dataUrl} download={name} title={`Download ${name}`}>
          <img className="incoming-image" src={dataUrl} alt={name} />
        </a>
      )
      : <a className="incoming-file" href={dataUrl} download={name}>{name}</a>
  }
  return <span className="incoming-file">{name}</span>
}

export function ChatScreen({ snapshot, leftHidden = false, onToggleLeft }: {
  snapshot: Snapshot
  leftHidden?: boolean
  onToggleLeft?: () => void
}) {
  const phone = useContext(PhoneNav)
  const [draft, setDraft] = useState('')
  const [panel, setPanel] = useState(true)
  const [pane, setPane] = useState<'history' | 'profile'>(() => {
    const shot = new URLSearchParams(location.search).get('shot') || ''
    return shot === 'profile' ? 'profile' : 'history'
  })
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)
  const [sendActions, setSendActions] = useState<{ text: string; files: OutgoingAttachment[] } | null>(null)
  const [notice, setNotice] = useState('')
  const [compress, setCompress] = useState<{ status: 'running' | 'done' | 'error'; started: number; message: string } | null>(null)
  const [compressElapsed, setCompressElapsed] = useState(0)
  const [steerPending, setSteerPending] = useState<{ toolCount: number } | null>(null)
  const [steerNote, setSteerNote] = useState<{ text: string; age: number } | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [files, setFiles] = useState<OutgoingAttachment[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const queueWrap = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const profile = snapshot.profiles.find(item => item.gatewayId === snapshot.activeGatewayId && item.name === snapshot.activeProfile)
  const streaming = snapshot.transcript.streaming
  const toolRunning = useMemo(
    () => snapshot.transcript.messages.some(message => message.tools.some(tool => tool.status === 'running')),
    [snapshot.transcript.messages]
  )
  const toolCount = useMemo(
    () => snapshot.transcript.messages.reduce((count, message) => count + message.tools.length, 0),
    [snapshot.transcript.messages]
  )

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

  useEffect(() => {
    if (!streaming) setSendActions(null)
  }, [streaming])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  // A steer is read at the agent's next tool call, not on a timer. Keep the
  // notice until a new tool row appears or the turn ends.
  useEffect(() => {
    if (!steerPending) return
    if (toolCount > steerPending.toolCount || !streaming) {
      setSteerPending(null)
      setSteerNote(null)
    }
  }, [toolCount, streaming, steerPending])

  useEffect(() => {
    if (!steerNote) return
    const started = Date.now()
    const timer = setInterval(() => {
      const age = Math.floor((Date.now() - started) / 1000)
      if (age >= 60) setSteerNote(null)
      else setSteerNote(current => current ? { ...current, age } : null)
    }, 500)
    return () => clearInterval(timer)
  }, [steerNote?.text])

  useEffect(() => {
    if (!queueOpen) return
    const close = (event: MouseEvent) => {
      if (!queueWrap.current?.contains(event.target as Node)) setQueueOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [queueOpen])

  // Compression is one long gateway call, so keep a local status bar alive:
  // the backend does not stream a percentage, but elapsed time and phase are real.
  useEffect(() => {
    if (!compress || compress.status !== 'running') return
    const tick = () => setCompressElapsed(Math.floor((Date.now() - compress.started) / 1000))
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [compress])

  useEffect(() => {
    if (!compress || compress.status === 'running') return
    const timer = setTimeout(() => setCompress(null), compress.status === 'error' ? 8000 : 6000)
    return () => clearTimeout(timer)
  }, [compress])

  async function enqueue(text: string, attachments: OutgoingAttachment[]): Promise<void> {
    setSending(true)
    setNotice('')
    try {
      await window.icyteru.queue(text, attachments)
      setDraft(current => current === draft ? '' : current)
      setFiles(current => current.filter(file => !attachments.includes(file)))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not queue the message.')
    } finally {
      setSending(false)
    }
  }

  function beginSteer(text: string): void {
    setNotice('')
    setSteerNote({ text, age: 0 })
    setSteerPending({ toolCount })
  }

  async function send() {
    const text = draft.trim()
    if ((!text && files.length === 0) || sending) return

    // A free-text reply while a clarify card is open is the answer to that card,
    // not a new chat turn.
    if (text && files.length === 0 && snapshot.question?.questions.length === 1) {
      const item = snapshot.question.questions[0]
      setDraft('')
      setSending(true)
      setNotice('')
      try {
        await window.icyteru.answer(snapshot.question.id, { answers: { [item.id]: text }, outcome: 'submitted' })
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Message was not sent.')
        setDraft(text)
      } finally {
        setSending(false)
      }
      return
    }

    if (text.startsWith('/')) {
      const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
      const name = (match?.[1] || '').toLowerCase()
      const arg = (match?.[2] || '').trim()

      if (name === 'queue') {
        if (!arg && !files.length) {
          setNotice('Usage: /queue <message>')
          return
        }
        await enqueue(arg, files)
        return
      }
      if (files.length) {
        setNotice('Slash commands do not take attachments.')
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
          const note = await window.icyteru.steer(arg)
          if (/^Steered|^Steer sent/.test(note)) beginSteer(note)
          else setNotice(note)
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
        setNotice('')
        setCompress({ status: 'running', started: Date.now(), message: '' })
        setCompressElapsed(0)
        try {
          const summary = await window.icyteru.compress()
          setCompress({ status: 'done', started: Date.now(), message: summary })
        } catch (error) {
          setCompress({
            status: 'error',
            started: Date.now(),
            message: error instanceof Error ? error.message : 'Compression failed.'
          })
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
      setSendActions({ text, files: [...files] })
      return
    }
    await submit(text, files)
  }

  async function chooseSendAction(action: 'stop' | 'steer' | 'queue'): Promise<void> {
    const pending = sendActions
    if (!pending) return
    if (action === 'stop') {
      setSendActions(null)
      await window.icyteru.interrupt()
      setNotice('Stopped the current task. Your message is still in the composer.')
      return
    }
    if (action === 'steer') {
      if (pending.files.length > 0) {
        setNotice('Steer only sends text. Use Queue for attachments.')
        return
      }
      setSendActions(null)
      setSending(true)
      setNotice('')
      try {
        const note = await window.icyteru.steer(pending.text)
        if (/^Steered|^Steer sent/.test(note)) beginSteer(note)
        else setNotice(note)
        setDraft('')
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Steer failed.')
      } finally {
        setSending(false)
      }
      return
    }
    setSendActions(null)
    await enqueue(pending.text, pending.files)
  }

  return (
    <>
      <section className="chat">
        <header className="chat-bar">
          <div className="chat-left">
            <button
              className="icon-button left-toggle"
              type="button"
              aria-label={leftHidden ? 'Show agents panel' : 'Hide agents panel'}
              title={leftHidden ? 'Show agents panel' : 'Hide agents panel'}
              onClick={() => {
                if (window.matchMedia('(max-width: 760px)').matches) {
                  phone.setView('roster')
                  return
                }
                onToggleLeft?.()
              }}
            >
              <span aria-hidden="true">{leftHidden ? '›' : '‹'}</span>
            </button>
            <div className="chat-identity">
              <Avatar label={snapshot.profileName} initial={profile?.initial || snapshot.profileName.slice(0, 1)} src={snapshot.avatar} size={28} />
              <div>
                <strong>{profile?.label || snapshot.profileName}</strong>
                <span>{snapshot.phase === 'connecting' ? 'Connecting…' : snapshot.profileName}</span>
              </div>
            </div>
          </div>
          <div className="chat-title">
            <h1>{active?.title || 'New chat'}</h1>
          </div>
          <div className="bar-actions">
            <ReasoningMenu snapshot={snapshot} onNotice={setNotice} />
            <ModelMenu snapshot={snapshot} onNotice={setNotice} />
            <button
              className="top-action tiny history-button"
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
              <span className="history-arrow" aria-hidden="true">›</span>
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
            <Fragment key={message.id}>
              {orderedParts(message).map((part, i) => {
                const media = splitMedia(part.text)
                return (
                  <Fragment key={i}>
                    {media.attachments.length > 0 && (
                      <div className="incoming-attachments">
                        {media.attachments.map(attachment => (
                          <MediaAttachment key={attachment.path} path={attachment.path} name={attachment.name} image={attachment.image} />
                        ))}
                      </div>
                    )}
                    {media.text.trim() && <article className={`bubble ${message.role}`}><Markdown text={media.text} /></article>}
                    {part.tools.length > 0 && <div className="tool-standalone"><ToolGroup tools={part.tools} /></div>}
                  </Fragment>
                )
              })}
              {message.error && (
                <p className="inline-error standalone-error">{message.error}</p>
              )}
            </Fragment>
          ))}
          {streaming && <p className="working">{snapshot.profileName} is working…</p>}
        </div>
        {!atBottom && (
          <button className="jump-latest" onClick={jumpToLatest} type="button" aria-label="Jump to the latest message">
            <span aria-hidden="true">↓</span> Latest
          </button>
        )}
        {snapshot.question && <QuestionCard question={snapshot.question} />}
        {steerNote && (
          <StatusBar
            state="running"
            title="Steering the current turn…"
            message={steerNote.text}
            elapsed={steerNote.age}
            track
          />
        )}
        {notice && (
          <StatusBar
            state={/error|failed|could not|did not|refused|invalid|too many|not connected/i.test(notice) ? 'error' : 'info'}
            title={notice}
          />
        )}
        {compress && (
          <div className={`compress-bar ${compress.status}`} role="status" aria-live="polite">
            <div className="compress-head">
              <span className="compress-spinner" aria-hidden="true" />
              <span className="compress-label">
                {compress.status === 'running'
                  ? (compressElapsed < 2 ? 'Preparing compression…' : compressElapsed < 8 ? 'Summarizing the conversation…' : 'Summarizing a long conversation…')
                  : compress.status === 'done' ? 'Compression complete' : 'Compression failed'}
              </span>
              {compress.status === 'running' && <span className="compress-time">{compressElapsed}s</span>}
            </div>
            {compress.status === 'running' && <div className="compress-track"><span /></div>}
            {compress.status !== 'running' && <p className="compress-message">{compress.message}</p>}
          </div>
        )}
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
        {snapshot.queued.length > 0 && (
          <div className="queue-wrap" ref={queueWrap}>
            <button
              className="queue-pill"
              type="button"
              aria-expanded={queueOpen}
              onClick={() => setQueueOpen(open => !open)}
            >
              <span className="queue-dot" aria-hidden="true" />
              {snapshot.queued.length} {snapshot.queued.every(entry => entry.status === 'queued') ? 'queued' : 'queue updates'}
              <span className="queue-caret" aria-hidden="true">{queueOpen ? '⌄' : '⌃'}</span>
            </button>
            {queueOpen && (
              <div className="queue-list">
                {snapshot.queued.map(entry => (
                  <div className={`queue-item ${entry.status}`} key={entry.id}>
                    <div className="queue-text">
                      <span>{[entry.text, ...(entry.attachmentNames || [])].filter(Boolean).join(' · ')}</span>
                      {entry.status === 'unknown' && <small>Gateway status unknown</small>}
                      {entry.error && <small>{entry.error}</small>}
                    </div>
                    {entry.status !== 'unknown' && (
                      <div className="queue-actions">
                        <button
                          type="button"
                          className="ghost tiny danger"
                          disabled={entry.status !== 'failed'}
                          title={entry.status === 'failed' ? 'Dismiss' : 'The gateway cannot delete this without risking interruption of a started turn.'}
                          aria-label={entry.status === 'failed' ? 'Dismiss failed message' : 'Delete queued message'}
                          onClick={() => void window.icyteru.deleteQueued(entry.id).catch(error => setNotice(error instanceof Error ? error.message : 'Could not delete the queued message.'))}
                        >×</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <form className="composer" onSubmit={event => { event.preventDefault(); void send() }}>
          {sendActions && (
            <div className="send-menu" role="menu" aria-label="What should happen to this message?">
              <button className="danger" type="button" onClick={() => void chooseSendAction('stop')}>
                <span aria-hidden="true">■</span> Stop current task
              </button>
              <span className="send-menu-line" />
              <button type="button" disabled={sendActions.files.length > 0} onClick={() => void chooseSendAction('steer')}>
                <span aria-hidden="true">↪</span> Steer current task
              </button>
              <button type="button" onClick={() => void chooseSendAction('queue')}>
                <span aria-hidden="true">⇥</span> Queue for next turn
              </button>
            </div>
          )}
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
          <div className="composer-tools">
            <button
              className="attach"
              type="button"
              title="Attach images or files"
              aria-label="Attach images or files"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip />
            </button>
            {streaming && (
              <span
                className={toolRunning ? 'tok-pill tool' : snapshot.tokensPerSecond ? 'tok-pill' : 'tok-pill pending'}
                title={toolRunning ? 'Tool call in progress' : 'Live output speed'}
                aria-label={toolRunning ? 'Tool call in progress' : 'Tokens per second'}
              >
                <span aria-hidden="true">{toolRunning ? '⚔️' : '⌨️'}</span>
                {snapshot.tokensPerSecond ? `${snapshot.tokensPerSecond} Tok/s` : '… Tok/s'}
              </span>
            )}
          </div>
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
              if (event.key === 'Enter' && !event.shiftKey && !isAndroid) {
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
      {panel && <SidePanel snapshot={snapshot} pane={pane} setPane={setPane} query={query} setQuery={setQuery} onNotice={setNotice} />}
    </>
  )
}

function ToolStatus({ running }: { running: boolean }) {
  return <span className={`tool-status ${running ? 'running' : 'done'}`} role="img" aria-label={running ? 'Running' : 'Done'}>{running ? null : '✓'}</span>
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
        <ToolStatus running={running} />
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
        <ToolStatus running={tool.status === 'running'} />
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
  const [custom, setCustom] = useState<Record<string, string>>({})
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
      {question.body && question.body !== question.questions[0]?.question && <p className="question-body">{question.body}</p>}
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
          <input
            className="custom-answer"
            value={custom[item.id] || ''}
            onChange={event => setCustom(current => ({ ...current, [item.id]: event.target.value }))}
            placeholder="Or type your own answer"
            aria-label="Custom answer"
          />
        </div>
      ))}
      {question.questions.length > 0 && (
        <div className="question-actions">
          <button
            className="solid"
            onClick={() => {
              const merged = { ...answers }
              for (const [id, value] of Object.entries(custom)) {
                if (value.trim()) merged[id] = value.trim()
              }
              void send({ answers: merged, outcome: 'submitted' })
            }}
            type="button"
          >
            Send answers
          </button>
        </div>
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

  function isModelActive(model: { id: string; provider: string; providerId?: string }): boolean {
    if (!modelIdsMatch(model.id, snapshot.currentModel)) return false
    if (!currentProvider) return true
    const providerId = (model.providerId || model.provider).toLowerCase()
    const providerName = model.provider.toLowerCase()
    return providerId === currentProvider || providerName === currentProvider ||
      providerId.includes(currentProvider) || currentProvider.includes(providerId)
  }

  function isProviderActive(name: string): boolean {
    const lower = name.toLowerCase()
    if (currentProvider && (lower === currentProvider || lower.includes(currentProvider) || currentProvider.includes(lower))) return true
    return snapshot.models.some(model => isModelActive(model) && (model.providerId || model.provider) === name)
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

  const providerRows = useMemo(() => {
    const labels = new Map<string, string>()
    for (const model of snapshot.models) {
      const id = model.providerId || model.provider || 'other'
      if (!labels.has(id)) labels.set(id, model.provider || id)
    }
    return [...labels].map(([id, label]) => ({ id, label }))
  }, [snapshot.models])
  const models = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return snapshot.models.filter(model => {
      if (provider !== 'all' && (model.providerId || model.provider || 'other') !== provider) return false
      return `${model.label} ${model.provider} ${model.id}`.toLowerCase().includes(needle)
    })
  }, [filter, provider, snapshot.models])
  if (snapshot.models.length === 0) return null
  const current = snapshot.currentModel || 'Model'
  const currentLabel = modelShortName(current)
  return (
    <div className="model-menu" ref={menu}>
      <button className="top-action tiny" onClick={() => setOpen(value => !value)} type="button" title={current}>{currentLabel}</button>
      {open && (
        <div className="model-pop">
          <input autoFocus value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search models" />
          {providerRows.length > 1 && (
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
              {providerRows.map(item => (
                <button
                  key={item.id}
                  className={provider === item.id ? 'active' : ''}
                  onClick={() => chooseProvider(item.id)}
                  type="button"
                  role="tab"
                  aria-selected={provider === item.id}
                >
                  {item.label}
                  {isProviderActive(item.id) && <span className="provider-inuse" aria-label="in use">•</span>}
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
                    void window.icyteru.setSessionModel(model.id, model.providerId || model.provider).then(onNotice).catch(error => {
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

function ReasoningMenu({ snapshot, onNotice }: { snapshot: Snapshot; onNotice: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const levels = [
    { id: 'none', label: 'Off' },
    { id: 'minimal', label: 'Minimal' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'X-High' },
    { id: 'max', label: 'Max' },
    { id: 'ultra', label: 'Ultra' }
  ]
  const current = snapshot.currentReasoning || 'medium'
  const shortLabels: Record<string, string> = {
    none: 'Off',
    minimal: 'Min',
    low: 'Low',
    medium: 'Med',
    high: 'High',
    xhigh: 'XHigh',
    max: 'Max',
    ultra: 'Ultra'
  }
  const currentLabel = shortLabels[current] || current

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

  return (
    <div className="model-menu reasoning-menu" ref={menu}>
      <button className="top-action tiny" onClick={() => setOpen(value => !value)} type="button" title={`Reasoning: ${currentLabel}`} aria-label="Reasoning">
        {currentLabel}
      </button>
      {open && (
        <div className="model-pop">
          <div className="model-list">
            {levels.map(level => (
              <button
                key={level.id}
                className={current === level.id ? 'active' : ''}
                onClick={() => {
                  setOpen(false)
                  void window.icyteru.setReasoning(level.id).then(onNotice).catch(error => {
                    onNotice(error instanceof Error ? error.message : 'Could not change reasoning.')
                  })
                }}
                type="button"
              >
                <span className="model-label">
                  <strong>{level.label}</strong>
                  <em>Effort</em>
                </span>
                {current === level.id && <span className="model-check" aria-label="Current reasoning">✓</span>}
              </button>
            ))}
            <button
              onClick={() => {
                setOpen(false)
                void window.icyteru.setReasoning('reset').then(onNotice).catch(error => {
                  onNotice(error instanceof Error ? error.message : 'Could not reset reasoning.')
                })
              }}
              type="button"
            >
              <span className="model-label">
                <strong>Reset</strong>
                <em>Back to profile default</em>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SidePanel({ snapshot, pane, setPane, query, setQuery, onNotice }: {
  snapshot: Snapshot
  pane: 'history' | 'profile'
  setPane: (pane: 'history' | 'profile') => void
  query: string
  setQuery: (query: string) => void
  onNotice: (text: string) => void
}) {
  const phone = useContext(PhoneNav)
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set())
  const needle = query.trim().toLowerCase()
  const sessions = snapshot.sessions.filter(session => `${session.title} ${session.preview} ${session.source}`.toLowerCase().includes(needle))
  const bySource = new Map<string, typeof sessions>()
  for (const session of sessions) {
    const label = sourceLabel(session.source)
    const list = bySource.get(label) || []
    list.push(session)
    bySource.set(label, list)
  }
  const order = ['Telegram', 'Discord', 'Slack', 'WhatsApp', 'Signal', 'Schedule', 'Desktop', 'API', 'Editor']
  const groups = [...bySource.entries()]
    .map(([label, list]) => [label, [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0))] as const)
    .sort(([a], [b]) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b)
    })
  const toggleGroup = (label: string) => setClosedGroups(prev => {
    const next = new Set(prev)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    return next
  })
  return (
    <aside className="details">
      <button className="top-action tiny phone-only back-link" type="button" onClick={() => phone.setView('chat')}>Back to chat</button>
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
            {groups.map(([label, group]) => {
              const closed = closedGroups.has(label)
              return (
                <div className="session-group" key={label}>
                  <button
                    className={closed ? 'session-group-title closed' : 'session-group-title'}
                    type="button"
                    aria-expanded={!closed}
                    onClick={() => toggleGroup(label)}
                  >
                    <span>{label}</span>
                    <span className="session-group-count">{group.length}</span>
                    <i aria-hidden="true">›</i>
                  </button>
                  {!closed && group.map(session => (
                    <div className={session.id === snapshot.activeSessionId ? 'session-row active' : 'session-row'} key={session.id}>
                      <button
                        className={session.id === snapshot.activeSessionId ? 'session active' : 'session'}
                        type="button"
                        onClick={() => { phone.setView('chat'); void window.icyteru.openSession(session.id) }}
                      >
                        <span className="session-title">
                          {session.running && <i className="dot" />}
                          {session.title}
                        </span>
                        <span className="session-meta">
                          <span>{session.messageCount.toLocaleString()} msgs</span>
                          {session.updatedAt ? <time>{ago(session.updatedAt)}</time> : null}
                        </span>
                      </button>
                      <button
                        className={session.pinned ? 'session-pin on' : 'session-pin'}
                        type="button"
                        title={session.pinned ? 'Unpin session' : 'Pin session'}
                        aria-label={session.pinned ? 'Unpin session' : 'Pin session'}
                        onClick={() => {
                          void window.icyteru.setSessionPinned(session.id, !session.pinned).catch(error => {
                            onNotice(error instanceof Error ? error.message : 'Could not change the session pin.')
                          })
                        }}
                      >
                        {session.pinned ? 'Unpin' : 'Pin'}
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="profile-pane">
          <details className="profile-doc">
            <summary>SOUL.md</summary>
            <div className="profile-doc-body">
              {snapshot.memory.instructions
                ? <Markdown text={snapshot.memory.instructions} />
                : <p>{snapshot.instructionsNote}</p>}
            </div>
          </details>
          <details className="profile-doc">
            <summary>MEMORY.md</summary>
            <div className="profile-doc-body">
              {snapshot.memory.available
                ? (
                  <>
                    {snapshot.memory.summary && <p>{snapshot.memory.summary}</p>}
                    {snapshot.memory.notes
                      ? <Markdown text={snapshot.memory.notes} />
                      : <p>This gateway does not share memory notes yet.</p>}
                  </>
                )
                : <p>This gateway does not share a memory view.</p>}
            </div>
          </details>
          <details className="profile-doc">
            <summary>USER.md</summary>
            <div className="profile-doc-body">
              {snapshot.memory.available
                ? (snapshot.memory.user
                  ? <Markdown text={snapshot.memory.user} />
                  : <p>This gateway does not share a user profile yet.</p>)
                : <p>This gateway does not share a memory view.</p>}
            </div>
          </details>
          <details className="profile-doc">
            <summary>Skills</summary>
            <div className="profile-doc-body">
              {snapshot.skillsNote && <p>{snapshot.skillsNote}</p>}
              <ul className="skills">
                {snapshot.skills.slice(0, 80).map(skill => (
                  <li key={skill.name}>
                    <strong>{skill.name}</strong>
                    {skill.description && <span>{skill.description}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      )}
    </aside>
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
