import { Fragment, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import { PhoneNav } from './phone'
import type { Snapshot } from '../shared/snapshot'
import { orderedParts, approvalLabel, modelIdsMatch, modelShortName, pickReasoning, sourceLabel, type OutgoingAttachment, type RemoteApproval, type RemoteClarify, type SessionInfo, type SessionRow, type SubagentProgress, type ToolCall } from '../shared/protocol'
import { GROUP_ORDER_KEY, normalizeGroupOrder, reorderGroups } from '../shared/group-order'
import { Avatar } from './Avatar'
import { Markdown, copyText } from './Markdown'
import { PinIcon } from './PinIcon'
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

type PreviewTarget = { url: string; label: string; id: string }

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Find the latest desktop_preview open/close in the transcript. */
function previewTargetFrom(messages: Snapshot['transcript']['messages']): PreviewTarget | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const tools = messages[messageIndex].tools
    for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const tool = tools[toolIndex]
      if (tool.name !== 'desktop_preview' && tool.name !== 'preview_panel') continue
      let args: Record<string, unknown> = {}
      let result: Record<string, unknown> = {}
      try { args = recordValue(JSON.parse(tool.argsText || '{}')) } catch { /* older rows may not be JSON */ }
      try { result = recordValue(JSON.parse(tool.resultText || '{}')) } catch { /* result is optional */ }
      const action = typeof args.action === 'string' ? args.action : ''
      if (action === 'close') return null
      const url = typeof args.url === 'string' ? args.url : typeof result.url === 'string' ? result.url : ''
      if (!/^https?:\/\//i.test(url)) continue
      const label = typeof args.label === 'string' && args.label.trim()
        ? args.label.trim()
        : typeof result.label === 'string' && result.label.trim()
          ? result.label.trim()
          : new URL(url).hostname
      return { url, label, id: tool.id }
    }
  }
  return null
}

function DesktopPreviewPanel({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  return (
    <aside className="desktop-preview" aria-label={`Preview ${target.label}`}>
      <header className="desktop-preview-head">
        <div>
          <span className="desktop-preview-kicker">PREVIEW</span>
          <strong>{target.label}</strong>
        </div>
        <div className="desktop-preview-actions">
          <a href={target.url} target="_blank" rel="noreferrer">Open in browser</a>
          <button type="button" onClick={onClose} aria-label="Close preview" title="Close preview">×</button>
        </div>
      </header>
      <iframe
        className="desktop-preview-frame"
        src={target.url}
        title={target.label}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
      />
    </aside>
  )
}

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

function dataUrlMime(dataUrl: string): string {
  const match = /^data:([^;,]+)(;base64)?,/i.exec(dataUrl)
  return match ? match[1].toLowerCase() : ''
}

function dataUrlText(dataUrl: string): string {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function ZoomableImage({ src, name }: { src: string; name: string }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const frame = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const lastPinchDistance = useRef<number | null>(null)
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  const clampZoom = (value: number) => Math.min(5, Math.max(1, value))

  const zoomAround = (clientX: number, clientY: number, factor: number) => {
    const rect = frame.current?.getBoundingClientRect()
    if (!rect) return
    setZoom(current => {
      const next = clampZoom(current * factor)
      if (next === current) return current
      if (next === 1) {
        setPan({ x: 0, y: 0 })
        return 1
      }
      const originX = clientX - rect.left - rect.width / 2
      const originY = clientY - rect.top - rect.height / 2
      const ratio = next / current
      setPan(currentPan => ({
        x: originX * (1 - ratio) + ratio * currentPan.x,
        y: originY * (1 - ratio) + ratio * currentPan.y
      }))
      return next
    })
  }

  const zoomFromCenter = (factor: number) => {
    const rect = frame.current?.getBoundingClientRect()
    if (!rect) return
    zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 1) {
      panStart.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    }
    if (pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values())
      lastPinchDistance.current = Math.hypot(first.x - second.x, first.y - second.y)
      panStart.current = null
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 1 && panStart.current && zoom > 1) {
      setPan({
        x: panStart.current.panX + (event.clientX - panStart.current.x),
        y: panStart.current.panY + (event.clientY - panStart.current.y)
      })
      return
    }
    if (pointers.current.size === 2) {
      const [first, second] = Array.from(pointers.current.values())
      const distance = Math.hypot(first.x - second.x, first.y - second.y)
      const previous = lastPinchDistance.current ?? distance
      if (previous > 0 && distance > 0) {
        zoomAround((first.x + second.x) / 2, (first.y + second.y) / 2, distance / previous)
      }
      lastPinchDistance.current = distance
    }
  }

  const releasePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) lastPinchDistance.current = null
    if (pointers.current.size === 1) {
      const [remaining] = Array.from(pointers.current.values())
      panStart.current = { x: remaining.x, y: remaining.y, panX: pan.x, panY: pan.y }
      return
    }
    if (pointers.current.size === 0) panStart.current = null
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    zoomAround(event.clientX, event.clientY, factor)
  }

  const reset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  return (
    <div
      ref={frame}
      className={`media-zoom${zoom > 1 ? ' zoomed' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onWheel={onWheel}
      onDoubleClick={reset}
    >
      <img
        src={src}
        alt={name}
        draggable={false}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      />
      <div className="media-zoom-controls">
        <button type="button" onClick={() => zoomFromCenter(1.25)} title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomFromCenter(0.8)} title="Zoom out" aria-label="Zoom out">−</button>
        <button type="button" onClick={reset} title="Reset zoom" aria-label="Reset zoom">⟲</button>
      </div>
    </div>
  )
}

function MediaAttachment({ path, name, image, src }: IncomingAttachment & { src?: string }) {
  const [dataUrl, setDataUrl] = useState(src || '')
  const [error, setError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saveNote, setSaveNote] = useState('')

  async function download(event: ReactMouseEvent<HTMLAnchorElement>) {
    // WebView ignores the HTML download attribute for data: URLs. Use the
    // native MediaStore bridge on Android; desktop/browser keeps the anchor.
    if (!isAndroid) return
    event.preventDefault()
    try {
      const saved = await window.icyteru.saveDownload(name, dataUrl)
      setSaveNote(saved ? 'Saved to Downloads' : 'Saved')
      setTimeout(() => setSaveNote(''), 2600)
    } catch (err) {
      setSaveNote(err instanceof Error ? err.message : 'Could not save that file.')
    }
  }

  useEffect(() => {
    if (src) {
      setDataUrl(src)
      setError('')
      return
    }
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
  }, [path, src])

  useEffect(() => {
    if (!previewOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewOpen(false)
    }
    const onBack = (event: Event) => {
      event.preventDefault()
      setPreviewOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('icyteru:back', onBack)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('icyteru:back', onBack)
    }
  }, [previewOpen])

  if (error) return <span className="incoming-file error">{error}</span>
  if (dataUrl) {
    const mime = dataUrlMime(dataUrl)
    const isImage = mime.startsWith('image/')
    const isText = mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime === 'application/javascript'
    const isPdf = mime === 'application/pdf'
    const isAudio = mime.startsWith('audio/')
    const isVideo = mime.startsWith('video/')
    return (
      <>
        <div className="incoming-media">
          <button type="button" className={`incoming-media-view ${image || isImage ? 'image' : 'file'}`} onClick={() => setPreviewOpen(true)} title={`View ${name}`} aria-label={`View ${name}`}>
            {image || isImage
              ? <img className="incoming-image" src={dataUrl} alt={name} />
              : <span className="incoming-file-name">{name}</span>}
          </button>
          <a className="incoming-media-download" href={dataUrl} download={name} onClick={event => void download(event)} title={saveNote || `Download ${name}`} aria-label={`Download ${name}`}>
            <span aria-hidden="true">{saveNote ? '✓' : '↓'}</span>
          </a>
          {saveNote && <span className="media-save-note">{saveNote}</span>}
        </div>
        {previewOpen && (
          <div className="media-preview" role="dialog" aria-modal="true" aria-label={`${name} preview`}>
            <div className="media-preview-backdrop" onClick={() => setPreviewOpen(false)} />
            <div className="media-preview-card">
              <header className="media-preview-head">
                <span className="media-preview-name" title={name}>{name}</span>
                <div className="media-preview-actions">
                  <a className="media-preview-download" href={dataUrl} download={name} onClick={event => void download(event)} title={saveNote || `Download ${name}`} aria-label={`Download ${name}`}>
                    <span aria-hidden="true">{saveNote ? '✓' : '↓'}</span> Download
                  </a>
                  <button type="button" className="media-preview-close" onClick={() => setPreviewOpen(false)} title="Close preview" aria-label="Close preview">
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              </header>
              <div className="media-preview-body">
                {isImage && <ZoomableImage src={dataUrl} name={name} />}
                {isText && <pre className="media-preview-text">{dataUrlText(dataUrl)}</pre>}
                {isPdf && <iframe className="media-preview-frame" src={dataUrl} title={name} />}
                {isAudio && <audio className="media-preview-audio" controls preload="metadata" src={dataUrl} />}
                {isVideo && <video className="media-preview-video" controls playsInline preload="metadata" src={dataUrl} />}
                {!isImage && !isText && !isPdf && !isAudio && !isVideo && (
                  <div className="media-preview-fallback">
                    <p>{name}</p>
                    <p>Preview is not available for this file type.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    )
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
  const [panel, setPanel] = useState(() => {
    const shot = new URLSearchParams(location.search).get('shot') || ''
    if (['history', 'profile', 'dark-history'].includes(shot)) return true
    return !window.matchMedia('(max-width: 980px)').matches
  })
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
  const sendMenuRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const profile = snapshot.profiles.find(item => item.gatewayId === snapshot.activeGatewayId && item.name === snapshot.activeProfile)
  // The stored row can still say `running` after an intermediate
  // `message.complete`; keep the working/Stop UI alive until the gateway says
  // the turn is idle. A live delegated child is also a running turn.
  const hasLiveSubagent = snapshot.subagents.some(item =>
    !['completed', 'failed', 'timed_out', 'timeout', 'cancelled', 'error', 'stopped'].includes(item.status)
  )
  const streaming = snapshot.transcript.streaming || hasLiveSubagent
  const desktopPreview = useMemo(() => previewTargetFrom(snapshot.transcript.messages), [snapshot.transcript.messages])
  const [dismissedPreview, setDismissedPreview] = useState('')
  const showDesktopPreview = Boolean(desktopPreview && dismissedPreview !== desktopPreview.id)
  const toolRunning = useMemo(
    () => snapshot.transcript.messages.some(message => message.tools.some(tool => tool.status === 'running')),
    [snapshot.transcript.messages]
  )
  const lastUserIndex = snapshot.transcript.messages.map(message => message.role).lastIndexOf('user')
  const hasAssistantText = snapshot.transcript.messages.some(
    (message, index) => index > lastUserIndex && message.role === 'assistant' && message.text.trim().length > 0
  )
  const runningTool = useMemo(
    () => snapshot.transcript.messages
      .flatMap(message => message.tools)
      .find(tool => tool.status === 'running') || null,
    [snapshot.transcript.messages]
  )
  const thinking = streaming && !toolRunning && !snapshot.tokensPerSecond && !hasAssistantText
  const showTokensPerSecond = Boolean(
    streaming && !thinking && !toolRunning && snapshot.tokensPerSecond && snapshot.tokensPerSecond > 0
  )
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null)
  useEffect(() => {
    if (thinking) setThinkingStartedAt(current => current ?? Date.now())
    else setThinkingStartedAt(null)
  }, [thinking])
  const phaseStartedAt = toolRunning ? (runningTool?.startedAt ?? null) : thinkingStartedAt
  const writingTool = Boolean(runningTool && ['write_file', 'patch'].includes(runningTool.name))
  const phaseEmoji = toolRunning ? (writingTool ? '✍️' : '⚔️') : '🔮'
  const phaseLabel = toolRunning ? (writingTool ? 'Writing' : 'Running tools') : 'Thinking'
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

  async function submit(text: string, sendingFiles: OutgoingAttachment[], force = false): Promise<void> {
    if ((!text && sendingFiles.length === 0) || (sending && !force)) return
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

  useEffect(() => {
    if (!sendActions) return
    const close = (event: PointerEvent) => {
      if (!sendMenuRef.current?.contains(event.target as Node)) setSendActions(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSendActions(null)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [sendActions])

  useEffect(() => {
    const onBack = (event: Event) => {
      if (queueOpen) {
        event.preventDefault()
        setQueueOpen(false)
        return
      }
      if (sendActions) {
        event.preventDefault()
        setSendActions(null)
      }
    }
    window.addEventListener('icyteru:back', onBack)
    return () => window.removeEventListener('icyteru:back', onBack)
  }, [queueOpen, sendActions])

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
          if (note === 'not_running') {
            await submit(arg, [], true)
            return
          }
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
        if (note === 'not_running') {
          await submit(pending.text, [], true)
          return
        }
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
                {snapshot.phase === 'connecting' && <span>Connecting…</span>}
                {snapshot.phase === 'error' && <span>Connection problem</span>}
              </div>
            </div>
          </div>
          <div className="chat-title">
            <h1 title={active?.title || 'New chat'}>{active?.title || 'New chat'}</h1>
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
                    {part.tools.length > 0 && <div className="tool-standalone"><ToolGroup tools={part.tools} /></div>}
                    {(media.text.trim() || media.attachments.length > 0) && (
                      <article className={`bubble ${message.role}`}>
                        {media.text.trim() && <Markdown text={media.text} />}
                        {media.attachments.length > 0 && (
                          <div className="incoming-attachments">
                            {media.attachments.map(attachment => (
                              <MediaAttachment key={attachment.path} path={attachment.path} name={attachment.name} image={attachment.image} />
                            ))}
                          </div>
                        )}
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="incoming-attachments outgoing-attachments">
                            {message.attachments.map(attachment => (
                              <MediaAttachment
                                key={`${message.id}:${attachment.name}`}
                                path=""
                                name={attachment.name}
                                image={attachment.image}
                                src={attachment.dataUrl}
                              />
                            ))}
                          </div>
                        )}
                      </article>
                    )}
                  </Fragment>
                )
              })}
              {message.error && (
                <p className="inline-error standalone-error">{message.error}</p>
              )}
            </Fragment>
          ))}
          <SubagentGroup subagents={snapshot.subagents} />
          {streaming && (
            thinking || toolRunning
              ? <WorkingPhase startedAt={phaseStartedAt} emoji={phaseEmoji} label={phaseLabel} />
              : <p className="working">{snapshot.profileName} is working…</p>
          )}
        </div>
        {!atBottom && (
          <button className="jump-latest" onClick={jumpToLatest} type="button" aria-label="Jump to the latest message">
            <span aria-hidden="true">↓</span> Latest
          </button>
        )}
        {snapshot.question && <QuestionCard question={snapshot.question} />}
        {!snapshot.question && snapshot.remoteApprovals[0] && (
          <RemoteApprovalCard approval={snapshot.remoteApprovals[0]} more={snapshot.remoteApprovals.length - 1} />
        )}
        {!snapshot.question && snapshot.remoteClarifies[0] && (
          <RemoteClarifyCard clarify={snapshot.remoteClarifies[0]} more={snapshot.remoteClarifies.length - 1} />
        )}
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
            <div className="send-menu" ref={sendMenuRef} role="menu" aria-label="What should happen to this message?">
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
            {showTokensPerSecond && (
              <span className="tok-pill" title="Live output speed" aria-label="Tokens per second">
                <span className="tok-emoji" aria-hidden="true">⌨️</span>
                {`${snapshot.tokensPerSecond} Tok/s`}
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
        {desktopPreview && !showDesktopPreview && (
          <button className="preview-reopen" type="button" onClick={() => setDismissedPreview('')}>
            <span aria-hidden="true">▣</span> Preview: {desktopPreview.label}
          </button>
        )}
        {showDesktopPreview && desktopPreview && (
          <DesktopPreviewPanel target={desktopPreview} onClose={() => setDismissedPreview(desktopPreview.id)} />
        )}
      </section>
      {panel && <SidePanel snapshot={snapshot} pane={pane} setPane={setPane} query={query} setQuery={setQuery} onNotice={setNotice} />}
    </>
  )
}

function WorkingPhase({ startedAt, emoji, label }: { startedAt: number | null; emoji: string; label: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  return (
    <p className="working">
      <span className="working-emoji" aria-hidden="true">{emoji}</span>
      <span>
        {label}
        <span className="thinking-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
        <span className="tok-elapsed">{seconds}s</span>
      </span>
    </p>
  )
}

function ToolStatus({ running }: { running: boolean }) {
  return <span className={`tool-status ${running ? 'running' : 'done'}`} role="img" aria-label={running ? 'Running' : 'Done'}>{running ? null : '✓'}</span>
}

function toolDuration(tool: ToolCall, now: number): number {
  if (!tool.startedAt) return 0
  const end = tool.finishedAt || (tool.status === 'running' ? now : tool.startedAt)
  return Math.max(0, Math.round((end - tool.startedAt) / 1000))
}

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'sec' : 'secs'}`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function toolSummary(tools: ToolCall[], running: boolean, now: number): string {
  const count = tools.length
  const started = tools.map(tool => tool.startedAt).filter((value): value is number => typeof value === 'number')
  const finished = tools.map(tool => tool.finishedAt).filter((value): value is number => typeof value === 'number')
  if (!started.length) return count === 1 ? '1 tool call' : `${count} tool calls`
  const elapsed = Math.max(0, Math.round(((running ? now : Math.max(...finished, ...started)) - Math.min(...started)) / 1000))
  const noun = count === 1 ? 'tool' : 'tools'
  return `${running ? 'Working' : 'Worked'} for ${durationLabel(elapsed)} · ${count} ${noun}`
}

function toolLabel(name: string): string {
  if (['terminal', 'bash', 'shell', 'run_command'].includes(name)) return 'Ran command'
  if (name === 'clarify') return 'Clarify'
  if (name === 'patch') return 'Patch'
  if (name === 'write_file') return 'Write file'
  if (name === 'read_file') return 'Read file'
  return name.replace(/[_-]+/g, ' ')
}

function toolPreviewText(tool: ToolCall): string {
  const raw = tool.argsText || tool.resultText
  return raw.replace(/\s+/g, ' ').trim().slice(0, 110)
}

function ToolGroup({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const running = tools.some(tool => tool.status === 'running')
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  useEffect(() => {
    if (!running) setNow(Date.now())
  }, [running])
  return (
    <div className={`tools ${running ? 'running' : 'done'} ${open ? 'expanded' : ''}`}>
      <button
        className="tool-toggle"
        onClick={() => setOpen(value => !value)}
        type="button"
        aria-expanded={open}
      >
        <span className="tool-summary-icon" aria-hidden="true">
          {running ? <span className="tool-status running" /> : <span className="tool-check">✓</span>}
        </span>
        <span className="tool-summary-text">{toolSummary(tools, running, now)}</span>
        <span className="tool-caret" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div className="tool-list">
          {tools.map(tool => <ToolRow key={tool.id} tool={tool} now={now} />)}
        </div>
      )}
    </div>
  )
}

function ToolIcon({ name }: { name: string }) {
  if (name === 'terminal' || name === 'bash' || name === 'shell' || name === 'run_command') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7 9l3 3-3 3M12 15h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'clarify') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M8 10h8M8 13h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'patch' || name === 'write_file') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M5 4h9l4 4v12H5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M14 4v5h5M8 13h7M8 17h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M14.5 4.5l5 5-9.5 9.5H5v-5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12.5 6.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function ToolRow({ tool, now }: { tool: ToolCall; now: number }) {
  const [open, setOpen] = useState(false)
  const elapsed = toolDuration(tool, now)
  const preview = toolPreviewText(tool)
  return (
    <div className={`tool ${tool.status === 'running' ? 'running' : 'done'}`}>
      <button onClick={() => setOpen(value => !value)} type="button" aria-expanded={open}>
        <span className="tool-row-icon" aria-hidden="true"><ToolIcon name={tool.name} /></span>
        <strong>{toolLabel(tool.name)}</strong>
        {preview && <span className="tool-row-preview">{preview}</span>}
        <span className="tool-row-time">{tool.status === 'running' ? <ToolStatus running /> : elapsed > 0 ? durationLabel(elapsed) : null}</span>
        <span className="tool-row-caret" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
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

function subagentDone(status: string): boolean {
  return ['completed', 'failed', 'timeout', 'cancelled', 'error', 'stopped'].includes(status)
}

function subagentStatusText(subagent: SubagentProgress): string {
  if (subagent.status === 'completed') return 'Completed'
  if (subagent.status === 'failed' || subagent.status === 'error') return 'Failed'
  if (subagent.status === 'timeout') return 'Timed out'
  if (subagent.status === 'cancelled' || subagent.status === 'stopped') return 'Stopped'
  if (subagent.status === 'queued') return 'Queued'
  if (subagent.activity === 'thinking') return 'Thinking'
  if (subagent.activity === 'tool') return subagent.toolName ? `Using ${subagent.toolName}` : 'Using tools'
  if (subagent.activity === 'progress') return 'Working'
  return 'Running'
}

function SubagentGroup({ subagents }: { subagents: SubagentProgress[] }) {
  const [open, setOpen] = useState(false)
  const live = subagents.filter(item => !subagentDone(item.status))
  if (live.length === 0) return null
  const active = [...live].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const batchTotal = Math.max(1, ...subagents.map(item => item.taskCount || 1), subagents.length)
  const batchIndex = Math.min(batchTotal, Math.max(1, ...subagents.map(item => (item.taskIndex || 0) + 1)))
  const percent = Math.round((batchIndex / batchTotal) * 100)

  return (
    <div className="tools subagent-group">
      <button className="tool-toggle subagent-toggle" onClick={() => setOpen(value => !value)} type="button">
        <span>{open ? '▾' : '▸'}</span>
        <ToolStatus running />
        <span>{live.length} subagent{live.length === 1 ? '' : 's'}</span>
      </button>
      <div className="subagent-detail">
        <div className="subagent-detail-head">
          <span className="subagent-kicker">SUBAGENT</span>
          <span className="subagent-status">{subagentStatusText(active)}</span>
        </div>
        <p className="subagent-goal">{active.goal}</p>
        {active.activity === 'tool' && active.lastText && (
          <p className="subagent-line">{active.lastText}</p>
        )}
        <div className="subagent-progress" aria-label={`${batchIndex} of ${batchTotal} subagent tasks`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="subagent-foot">
          <span>{batchIndex}/{batchTotal}</span>
          <span>Running {live.length} subagent{live.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      {open && (
        <div className="subagent-list">
          {subagents.map(item => (
            <div className="tool subagent-row" key={item.id}>
              <div className="subagent-row-head">
                <ToolStatus running={!subagentDone(item.status)} />
                <strong>{item.goal}</strong>
                <span className="subagent-row-status">{subagentStatusText(item)}</span>
              </div>
              {item.toolCount > 0 && (
                <span className="subagent-row-meta">{item.toolCount} tool {item.toolCount === 1 ? 'call' : 'calls'}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function QuestionCard({ question }: { question: NonNullable<Snapshot['question']> }) {
  const [secret, setSecret] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [multi, setMulti] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)

  async function send(result: unknown) {
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setNote('')
    try {
      await window.icyteru.answer(question.id, result)
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not send that answer.')
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const hasAnswer = question.questions.some(item => {
    if (custom[item.id]?.trim()) return true
    if (item.multiSelect) return (multi[item.id] || []).length > 0
    return Boolean((answers[item.id] || '').trim())
  })
  const saveLogin = question.vault?.kind === 'save_login'
  const secretPlaceholder = question.vault?.kind === 'code' ? 'One-time code' : 'Master password'

  return (
    <section className="question">
      <h2>{question.title}</h2>
      {question.body && question.body !== question.questions[0]?.question && <p className="question-body">{question.body}</p>}
      {question.choices.length > 0 && (
        <div className="row">
          {question.choices.map(choice => (
            <button key={choice} className={choice === 'deny' ? 'ghost' : 'solid'} disabled={sending} onClick={() => void send({ choice })} type="button">
              {approvalLabel(choice)}
            </button>
          ))}
        </div>
      )}
      {question.questions.map(item => (
        <div className="clarify" key={item.id}>
          <p>{item.question}</p>
          <div className="row">
            {item.choices.map(choice => {
              const picked = item.multiSelect
                ? (multi[item.id] || []).includes(choice)
                : answers[item.id] === choice
              return (
                <button
                  key={choice}
                  className={picked ? 'solid picked' : 'ghost'}
                  aria-pressed={picked}
                  onClick={() => {
                    if (!item.multiSelect) {
                      setAnswers(current => ({ ...current, [item.id]: choice }))
                      return
                    }
                    setMulti(current => {
                      const selected = current[item.id] || []
                      const next = selected.includes(choice)
                        ? selected.filter(value => value !== choice)
                        : [...selected, choice]
                      return { ...current, [item.id]: next }
                    })
                  }}
                  type="button"
                >
                  {picked ? `✓ ${choice}` : choice}
                </button>
              )
            })}
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
            disabled={!hasAnswer || sending}
            aria-busy={sending}
            onClick={() => {
              const merged: Record<string, string> = { ...answers }
              for (const [id, value] of Object.entries(custom)) {
                if (value.trim()) merged[id] = value.trim()
              }
              for (const item of question.questions) {
                if (!item.multiSelect) continue
                if (custom[item.id]?.trim()) continue
                const selected = multi[item.id] || []
                if (!selected.length) continue
                merged[item.id] = selected
                  .map(choice => item.choices.indexOf(choice) + 1)
                  .filter(index => index > 0)
                  .join(', ')
              }
              void send({ answers: merged, outcome: 'submitted' })
            }}
            type="button"
          >
            {sending ? 'Sending…' : 'Send answers'}
          </button>
        </div>
      )}
      {saveLogin && (
        <form
          className="vault-fields"
          onSubmit={event => {
            event.preventDefault()
            const login = identifier.trim()
            if (!login || !secret) return
            void send({ value: JSON.stringify({ identifier: login, password: secret }) })
          }}
        >
          <label>
            <span>Email, phone, or username</span>
            <input
              value={identifier}
              onChange={event => setIdentifier(event.target.value)}
              autoComplete="username"
              placeholder="Email, phone, or username"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={secret}
              onChange={event => setSecret(event.target.value)}
              autoComplete="current-password"
              placeholder="Password"
            />
          </label>
          <div className="row">
            <button className="solid" type="submit" disabled={!identifier.trim() || !secret || sending}>
              {sending ? 'Saving…' : 'Save login'}
            </button>
            <button className="ghost" onClick={() => void send({ value: '' })} disabled={sending} type="button">Skip</button>
          </div>
        </form>
      )}
      {question.secret && !saveLogin && (
        <form onSubmit={event => { event.preventDefault(); void send({ value: secret }) }}>
          <input
            type="password"
            value={secret}
            onChange={event => setSecret(event.target.value)}
            autoComplete={question.vault?.kind === 'code' ? 'one-time-code' : 'current-password'}
            placeholder={secretPlaceholder}
          />
          <div className="row">
            <button className="solid" type="submit" disabled={sending}>Send</button>
            <button className="ghost" onClick={() => void send({ value: '' })} disabled={sending} type="button">Skip</button>
          </div>
        </form>
      )}
      {note && <p className="inline-error">{note}</p>}
    </section>
  )
}

function remoteSourceLabel(sessionKey: string): string {
  if (!sessionKey) return 'another session'
  if (sessionKey.includes(':telegram:')) return 'Telegram session'
  if (sessionKey.includes(':discord:')) return 'Discord session'
  if (sessionKey.includes(':slack:')) return 'Slack session'
  if (sessionKey.includes(':detached:')) return `session ${sessionKey.split(':').pop()?.slice(0, 10) ?? ''}…`
  if (sessionKey.includes(':local:')) return 'Desktop session'
  return sessionKey.split(':').pop() || sessionKey
}

function RemoteClarifyCard({ clarify, more }: { clarify: RemoteClarify; more: number }) {
  const [picked, setPicked] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  async function send(answer: string) {
    if (!answer.trim() || sending) return
    setSending(true)
    setNote('')
    try {
      await window.icyteru.answerRemoteClarify(clarify.clarifyId, answer.trim())
      setPicked([])
      setCustom('')
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not send that answer.')
    } finally {
      setSending(false)
    }
  }

  function toggle(choice: string) {
    if (!clarify.multiSelect) {
      setPicked([choice])
      return
    }
    setPicked(current => current.includes(choice) ? current.filter(item => item !== choice) : [...current, choice])
  }

  const selected = picked
    .map(choice => clarify.choices.indexOf(choice) + 1)
    .filter(index => index > 0)
    .join(', ')
  const value = custom.trim() || selected

  return (
    <section className="question remote-card">
      <h2>Question from Hermes</h2>
      <p className="question-source">Pending in {remoteSourceLabel(clarify.sessionKey)}{more > 0 ? ` · +${more} more` : ''}</p>
      <div className="clarify">
        <p>{clarify.question}</p>
        {clarify.choices.length > 0 && (
          <div className="row">
            {clarify.choices.map(choice => {
              const isPicked = picked.includes(choice)
              return (
                <button
                  key={choice}
                  className={isPicked ? 'solid picked' : 'ghost'}
                  aria-pressed={isPicked}
                  onClick={() => toggle(choice)}
                  type="button"
                >
                  {isPicked ? `✓ ${choice}` : choice}
                </button>
              )
            })}
          </div>
        )}
        <input
          value={custom}
          onChange={event => setCustom(event.target.value)}
          placeholder={clarify.choices.length ? 'Or type your own answer' : 'Type your answer'}
          aria-label="Answer"
        />
      </div>
      <div className="question-actions">
        <button className="solid" disabled={!value || sending} onClick={() => void send(value)} type="button">
          {sending ? 'Sending…' : 'Send answer'}
        </button>
      </div>
      {note && <p className="inline-error">{note}</p>}
    </section>
  )
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function RemoteApprovalCard({ approval, more }: { approval: RemoteApproval; more: number }) {
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState('')

  async function answer(choice: string) {
    if (sending) return
    setSending(choice)
    setNote('')
    try {
      const commandDigest = choice === 'deny' ? '' : await sha256Hex(approval.command)
      await window.icyteru.answerRemoteApproval(approval.sessionKey, approval.requestId, choice, reason, commandDigest)
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not send that approval.')
    } finally {
      setSending('')
    }
  }

  const choices = ['once', 'session', 'always', 'deny'].filter(choice => {
    if (choice === 'session') return approval.allowSession && !approval.smartDenied
    if (choice === 'always') return approval.allowPermanent && !approval.smartDenied
    return true
  })

  return (
    <section className="question remote-card approval-card">
      <h2>Approval required</h2>
      <p className="question-source">Pending in {remoteSourceLabel(approval.sessionKey)}{more > 0 ? ` · +${more} more` : ''}</p>
      {approval.description && <p className="question-body">{approval.description}</p>}
      <pre className="remote-command">{approval.command}</pre>
      {approval.denyOnly && <p className="question-note">This request was Deny-only until the full command was shown. Review it before approving.</p>}
      <div className="row">
        {choices.map(choice => (
          <button
            key={choice}
            className={choice === 'deny' ? 'ghost' : 'solid'}
            onClick={() => void answer(choice)}
            disabled={Boolean(sending)}
            type="button"
          >
            {sending === choice ? 'Sending…' : approvalLabel(choice)}
          </button>
        ))}
      </div>
      <input
        className="custom-answer"
        value={reason}
        onChange={event => setReason(event.target.value)}
        placeholder="Optional reason for deny"
        aria-label="Approval reason"
      />
      {note && <p className="inline-error">{note}</p>}
    </section>
  )
}

function ModelMenu({ snapshot, onNotice }: { snapshot: Snapshot; onNotice: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [provider, setProvider] = useState('all')
  const [pending, setPending] = useState<{ message: string; model: string; provider: string } | null>(null)
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

  function closeMenu() {
    setOpen(false)
    setFilter('')
    setProvider('all')
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
      if (pending) return
      if (!menu.current?.contains(event.target as Node)) closeMenu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pending) {
          window.icyteru.cancelSessionModel()
          setPending(null)
        }
        closeMenu()
      }
    }
    const onBack = (event: Event) => {
      event.preventDefault()
      if (pending) {
        window.icyteru.cancelSessionModel()
        setPending(null)
      }
      closeMenu()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('icyteru:back', onBack)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('icyteru:back', onBack)
    }
  }, [open, pending])

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
      <button className="top-action tiny" onClick={() => open ? closeMenu() : setOpen(true)} type="button" title={current}>{currentLabel}</button>
      {open && (
        <div className="model-pop">
          {pending && (
            <div className="model-confirm">
              <p>{pending.message}</p>
              <div className="row">
                <button
                  className="solid"
                  onClick={() => {
                    const target = pending
                    void window.icyteru.setSessionModel(target.model, target.provider, true).then(result => {
                      setPending(null)
                      closeMenu()
                      onNotice(typeof result === 'string' ? result : result.message)
                    }).catch(error => {
                      onNotice(error instanceof Error ? error.message : 'Could not change the model.')
                    })
                  }}
                  type="button"
                >
                  Switch anyway
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    window.icyteru.cancelSessionModel()
                    setPending(null)
                    closeMenu()
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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
                    const targetModel = model.id
                    const targetProvider = model.providerId || model.provider
                    void window.icyteru.setSessionModel(targetModel, targetProvider).then(result => {
                      if (typeof result === 'string') {
                        setPending(null)
                        closeMenu()
                        onNotice(result)
                        return
                      }
                      setPending({ message: result.message, model: result.model, provider: result.provider })
                    }).catch(error => {
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
  const current = pickReasoning(snapshot.currentReasoning, snapshot.globalReasoning)
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
    const onBack = (event: Event) => {
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('icyteru:back', onBack)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('icyteru:back', onBack)
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
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    try {
      return normalizeGroupOrder(JSON.parse(localStorage.getItem(GROUP_ORDER_KEY) || '[]'))
    } catch {
      return normalizeGroupOrder([])
    }
  })
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const groupDragPointer = useRef<number | null>(null)
  const [sessionInfo, setSessionInfo] = useState<{
    session: SessionRow
    loading: boolean
    data?: SessionInfo
    error?: string
  } | null>(null)
  const [sessionIdCopied, setSessionIdCopied] = useState(false)

  useEffect(() => {
    if (!sessionInfo) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSessionInfo(null)
    }
    const onBack = (event: Event) => {
      event.preventDefault()
      setSessionInfo(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('icyteru:back', onBack)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('icyteru:back', onBack)
    }
  }, [sessionInfo])

  function openSessionInfo(session: SessionRow) {
    setSessionInfo({ session, loading: true })
    setSessionIdCopied(false)
    void window.icyteru.sessionInfo(session.id)
      .then(data => setSessionInfo(current => current?.session.id === session.id ? { session, loading: false, data } : current))
      .catch(error => setSessionInfo(current => current?.session.id === session.id
        ? { session, loading: false, error: error instanceof Error ? error.message : 'Could not read session info.' }
        : current))
  }
  const needle = query.trim().toLowerCase()
  const activeSessionRunning = snapshot.transcript.streaming
    || snapshot.transcript.messages.some(message => message.tools.some(tool => tool.status === 'running'))
    || snapshot.subagents.some(item => !['completed', 'failed', 'timed_out', 'timeout', 'cancelled', 'error', 'stopped'].includes(item.status))
  const sessions = snapshot.sessions.filter(session => `${session.title} ${session.preview} ${session.source}`.toLowerCase().includes(needle))
  const bySource = new Map<string, typeof sessions>()
  for (const session of sessions) {
    const label = sourceLabel(session.source)
    const list = bySource.get(label) || []
    list.push(session)
    bySource.set(label, list)
  }
  const order = groupOrder
  const groups = [...bySource.entries()]
    .map(([label, list]) => [label, [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0))] as const)
    .sort(([a], [b]) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b)
    })

  useEffect(() => {
    // Groups start folded. A search should reveal the matching chats without
    // making the user open each group, and clearing it returns to the compact view.
    setOpenGroups(needle ? new Set(groups.map(([label]) => label)) : new Set())
  }, [needle])

  function saveGroupOrder(next: string[]): void {
    setGroupOrder(next)
    try {
      localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(next))
    } catch {
      // A quota/private-mode failure must not break dragging.
    }
  }

  function startGroupDrag(event: ReactPointerEvent<HTMLButtonElement>, label: string): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Some older WebViews do not expose pointer capture; the handlers still work.
    }
    groupDragPointer.current = event.pointerId
    setDraggingGroup(label)
    setDropTarget(null)
  }

  function moveGroupDrag(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (draggingGroup === null || groupDragPointer.current !== event.pointerId) return
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.session-group')
    const target = hit?.dataset.group || ''
    if (!target || target === draggingGroup) {
      setDropTarget(null)
      return
    }
    const rect = hit!.getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2
    setDropTarget(target)
    const next = reorderGroups(groupOrder, draggingGroup, target, after)
    if (next !== groupOrder) saveGroupOrder(next)
  }

  function endGroupDrag(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (groupDragPointer.current !== event.pointerId) return
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Capture may already be gone.
    }
    groupDragPointer.current = null
    setDraggingGroup(null)
    setDropTarget(null)
  }
  const toggleGroup = (label: string) => setOpenGroups(prev => {
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
            <button className="ghost tiny" type="button" onClick={() => { phone.setView('chat'); setQuery(''); void window.icyteru.newChat() }}>New chat</button>
          </div>
          <div className="session-list">
            {sessions.length === 0 && <p className="empty-list">No chats for {snapshot.profileName} yet. Telegram and Discord chats show up here when Hermes has them.</p>}
            {groups.map(([label, group]) => {
              const open = openGroups.has(label)
              return (
                <div
                  className={`session-group${draggingGroup === label ? ' dragging' : ''}${dropTarget === label ? ' drop-target' : ''}`}
                  data-group={label}
                  key={label}
                >
                  <div
                    className={open ? 'session-group-title' : 'session-group-title closed'}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggleGroup(label)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        toggleGroup(label)
                      }
                    }}
                  >
                    <button
                      className="group-drag"
                      type="button"
                      aria-label={`Reorder ${label} group`}
                      title={`Drag to reorder ${label}`}
                      onClick={event => event.stopPropagation()}
                      onPointerDown={event => startGroupDrag(event, label)}
                      onPointerMove={moveGroupDrag}
                      onPointerUp={endGroupDrag}
                      onPointerCancel={endGroupDrag}
                    >
                      <span aria-hidden="true">⠿</span>
                    </button>
                    <span>{label}</span>
                    <span className="session-group-count">{group.length}</span>
                    <i aria-hidden="true">›</i>
                  </div>
                  {open && group.map(session => (
                    <div className={session.id === snapshot.activeSessionId ? 'session-row active' : 'session-row'} key={session.id}>
                      <button
                        className={session.id === snapshot.activeSessionId ? 'session active' : 'session'}
                        type="button"
                        onClick={() => { phone.setView('chat'); void window.icyteru.openSession(session.id) }}
                      >
                        <span className="session-title">
                          {(session.id === snapshot.activeSessionId ? activeSessionRunning : session.running) && (
                            <i className="dot" title="Session is running" aria-label="Session is running" />
                          )}
                          {session.title}
                        </span>
                        <span className="session-meta">
                          <span>{session.messageCount.toLocaleString()} msgs</span>
                          {session.updatedAt ? <time>{ago(session.updatedAt)}</time> : null}
                        </span>
                      </button>
                      <button
                        className="session-info-button"
                        type="button"
                        title={`Session info: ${session.title}`}
                        aria-label={`Session info for ${session.title}`}
                        onClick={() => openSessionInfo(session)}
                      >
                        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                          <rect x="4" y="13" width="3.2" height="7" rx="1" fill="currentColor" />
                          <rect x="10.4" y="8" width="3.2" height="12" rx="1" fill="currentColor" />
                          <rect x="16.8" y="3" width="3.2" height="17" rx="1" fill="currentColor" />
                        </svg>
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
                        <PinIcon filled={session.pinned} />
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
      {sessionInfo && createPortal(
        <div className="session-info-backdrop" role="presentation" onPointerDown={event => {
          if (event.currentTarget === event.target) setSessionInfo(null)
        }}>
          <section className="session-info-card" role="dialog" aria-modal="true" aria-labelledby="session-info-title">
            <header className="session-info-head">
              <span id="session-info-title">📊 Session Info</span>
              <button type="button" className="session-info-close" onClick={() => setSessionInfo(null)} title="Close session info" aria-label="Close session info">×</button>
            </header>
            <p className="session-info-session" title={sessionInfo.session.title}>{sessionInfo.session.title}</p>
            {sessionInfo.loading && <p className="hint">Reading session stats…</p>}
            {sessionInfo.error && <p className="inline-error">{sessionInfo.error}</p>}
            {sessionInfo.data && !sessionInfo.loading && !sessionInfo.error && (
              <div className="session-info-stats">
                <p><strong>Messages:</strong> {sessionInfo.data.messages.toLocaleString()}</p>
                <p><strong>Estimated context:</strong> ~{sessionInfo.data.estimatedTokens.toLocaleString()} tokens</p>
                <button
                  className="session-id-copy"
                  type="button"
                  title="Tap to copy session ID"
                  aria-label="Copy session ID"
                  onClick={() => {
                    void copyText(sessionInfo.session.id).then(copied => {
                      if (!copied) return
                      setSessionIdCopied(true)
                      setTimeout(() => setSessionIdCopied(false), 1800)
                    })
                  }}
                >
                  <span className="session-id-label">Session ID</span>
                  <code>{sessionInfo.session.id}</code>
                  <span className="session-id-action">{sessionIdCopied ? '✓ Copied' : 'Copy'}</span>
                </button>
              </div>
            )}
          </section>
        </div>,
        document.body
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
