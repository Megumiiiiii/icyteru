import { useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import type { Snapshot, ThemePreference } from '../shared/snapshot'
import { isTerminalSubagentStatus } from '../shared/protocol'
import { Avatar } from './Avatar'
import { ChatScreen } from './ChatScreen'
import { ConnectScreen } from './ConnectScreen'
import { SettingsScreen } from './SettingsScreen'
import { initialPhone, PhoneNav, type PhoneView } from './phone'
import { PinIcon } from './PinIcon'
import { SakuraPetals } from './SakuraPetals'
import { Starfield } from './Starfield'
import { Snowflakes } from './Snowflakes'
import { initSakuga, syncSakugaPalette } from './sakuga'
import { isRecent } from './time'

type Appearance = { dim: number; blur: number; light: string | null; dark: string | null }

export function App({ snapshot }: { snapshot: Snapshot }) {
  const [appearance, setAppearance] = useState<Appearance | null>(null)
  const [phoneView, setPhoneView] = useState<PhoneView>(initialPhone)
  const [leftWidth, setLeftWidth] = useState(() => readSize('icyteru-left-width', 272, 200, 440))
  const [rightWidth, setRightWidth] = useState(() => readSize('icyteru-details-width', 320, 240, 560))
  const [leftOpen, setLeftOpen] = useState(() => {
    try {
      return localStorage.getItem('icyteru-left-open') !== '0'
    } catch {
      return true
    }
  })
  const [leftTitle, setLeftTitle] = useState(() => localStorage.getItem('icyteru-left-title') || 'Agents')
  const [muted, setMuted] = useState(() => {
    try {
      // Older builds started muted; unmute once so desktop notifications are
      // discoverable, then respect whatever the user picks afterwards.
      if (localStorage.getItem('icyteru-notify-on-v1') !== '1') {
        localStorage.setItem('icyteru-notify-on-v1', '1')
        localStorage.removeItem('icyteru-muted')
        return false
      }
      return localStorage.getItem('icyteru-muted') === '1'
    } catch {
      return false
    }
  })
  const seenMessages = useRef<Set<string> | null>(null)
  const activeSessionRef = useRef(snapshot.activeSessionId)
  const notifyTimer = useRef<number | null>(null)
  const pendingReply = useRef<{ title: string; body: string; ids: string[] } | null>(null)
  const lastQuestion = useRef<string | null>(null)
  const sizeRef = useRef({ left: leftWidth, right: rightWidth })
  const dark = useDark(snapshot.connection.theme)
  const mode = snapshot.connection.theme === 'system'
    ? (dark ? 'github-dark' : 'github-light')
    : snapshot.connection.theme
  const image = mode === 'github-light' || mode === 'github-dark'
    ? (mode === 'github-dark' ? appearance?.dark : appearance?.light)
    : null
  useEffect(() => {
    void window.icyteru.getAppearance().then(setAppearance).catch(() => undefined)
  }, [])
  useEffect(() => {
    initSakuga(mode)
  }, [])
  useEffect(() => {
    syncSakugaPalette(mode)
  }, [mode])
  useEffect(() => {
    sizeRef.current = { left: leftWidth, right: rightWidth }
  }, [leftWidth, rightWidth])
  useEffect(() => {
    localStorage.setItem('icyteru-muted', muted ? '1' : '0')
  }, [muted])
  useEffect(() => {
    localStorage.setItem('icyteru-left-open', leftOpen ? '1' : '0')
  }, [leftOpen])
  useEffect(() => {
    if (notifyTimer.current != null) {
      window.clearTimeout(notifyTimer.current)
      notifyTimer.current = null
    }
    pendingReply.current = null
    const assistant = snapshot.transcript.messages.filter(message => message.role === 'assistant' && message.text.trim())
    // Opening a different stored session loads its history at once. Mark that
    // history as seen so old replies never look like fresh notifications.
    if (!seenMessages.current || activeSessionRef.current !== snapshot.activeSessionId) {
      activeSessionRef.current = snapshot.activeSessionId
      seenMessages.current = new Set(assistant.map(message => message.id))
      lastQuestion.current = snapshot.question?.id || null
      return
    }
    const seen = seenMessages.current
    // A streaming snapshot can arrive before its final assistant row. Keep
    // fresh rows pending until streaming is over and no tool/subagent is still
    // running; a tool-call preamble must never look like a finished reply.
    const fresh = assistant.filter(message => !seen.has(message.id))
    const nowStreaming = snapshot.transcript.streaming
    const runningTool = snapshot.transcript.messages.some(message =>
      message.tools.some(tool => tool.status === 'running')
    )
    const liveSubagent = snapshot.subagents.some(item => !isTerminalSubagentStatus(item.status))
    // Android receives every turn through FCM. A second local notification would
    // duplicate it, so only desktop/web notify from the renderer.
    const canNotify = Capacitor.getPlatform() !== 'android'
    const sessionTitle = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)?.title || 'New chat'
    if (!nowStreaming && !runningTool && !liveSubagent && fresh.length > 0 && !muted && canNotify) {
      const last = fresh[fresh.length - 1]
      pendingReply.current = {
        title: `${snapshot.profileName} · ${sessionTitle}`,
        body: notificationPreview(last.text, 280),
        ids: fresh.map(message => message.id)
      }
      notifyTimer.current = window.setTimeout(() => {
        const pending = pendingReply.current
        if (!pending) return
        pendingReply.current = null
        notifyTimer.current = null
        for (const id of pending.ids) seen.add(id)
        void window.icyteru.notify({ title: pending.title, body: pending.body })
      }, 2000)
    }
    const question = snapshot.question
    if (question && question.id !== lastQuestion.current && !muted && canNotify) {
      void window.icyteru.notify({
        title: `${snapshot.profileName} needs you`,
        body: plainText(question.body || question.title).slice(0, 180)
      })
    }
    lastQuestion.current = question?.id || null
  }, [snapshot, muted])
  useEffect(() => () => {
    if (notifyTimer.current != null) window.clearTimeout(notifyTimer.current)
  }, [])
  useEffect(() => {
    const root = document.documentElement
    root.dataset.backdrop = image
      ? 'image'
      : mode === 'sakura'
        ? 'sakura'
        : mode === 'abyss'
          ? 'abyss'
          : mode === 'antartika'
            ? 'antartika'
            : mode === 'kraft'
              ? 'kraft'
              : mode === 'dark'
                ? 'stars'
                : 'plain'
    root.style.setProperty('--bg-dim', String(appearance?.dim ?? 0.4))
    root.style.setProperty('--panel-blur', `${appearance?.blur ?? 12}px`)
  }, [mode, image, dark, appearance, snapshot.connection.theme])

  useEffect(() => {
    const openFromNotification = () => setPhoneView('chat')
    window.addEventListener('icyteru:open-session', openFromNotification)
    return () => window.removeEventListener('icyteru:open-session', openFromNotification)
  }, [])

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    let cancelled = false
    let listener: { remove: () => Promise<void> } | null = null
    void CapacitorApp.addListener('backButton', () => {
      const back = new CustomEvent('icyteru:back', { cancelable: true })
      window.dispatchEvent(back)
      if (back.defaultPrevented) return
      if (snapshot.screen === 'settings') {
        void window.icyteru.showScreen('chat')
        return
      }
      if (phoneView === 'panel') {
        setPhoneView('chat')
        return
      }
      if (phoneView === 'chat') {
        setPhoneView('roster')
        return
      }
      void CapacitorApp.exitApp()
    }).then(handle => {
      if (cancelled) void handle.remove()
      else listener = handle
    })
    return () => {
      cancelled = true
      if (listener) void listener.remove()
    }
  }, [phoneView, snapshot.screen])

  const shellStyle = {
    '--sidebar-width': `${leftWidth}px`,
    '--details-width': `${rightWidth}px`
  } as CSSProperties

  function startResize(side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const handle = event.currentTarget
    const startX = event.clientX
    const startLeft = sizeRef.current.left
    const startRight = sizeRef.current.right
    handle.classList.add('dragging')
    const move = (next: PointerEvent) => {
      if (side === 'left') {
        const width = clampSize(startLeft + (next.clientX - startX), 200, 440)
        sizeRef.current.left = width
        setLeftWidth(width)
      } else {
        const width = clampSize(startRight - (next.clientX - startX), 240, 560)
        sizeRef.current.right = width
        setRightWidth(width)
      }
    }
    const stop = () => {
      handle.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      localStorage.setItem('icyteru-left-width', String(sizeRef.current.left))
      localStorage.setItem('icyteru-details-width', String(sizeRef.current.right))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function changeLeftTitle(next: string) {
    setLeftTitle(next)
    localStorage.setItem('icyteru-left-title', next)
  }

  return (
    <>
      <div className="sky" aria-hidden="true">
        {mode === 'dark' && !image && <Starfield />}
        {mode === 'sakura' && !image && <SakuraPetals />}
        {mode === 'antartika' && !image && <Snowflakes />}
        {image && <div className="sky-photo" style={{ backgroundImage: `url("${image}")` }} />}
        <div className="sky-dim" />
      </div>
      {snapshot.screen === 'connect' || !snapshot.connection.url
        ? <ConnectScreen snapshot={snapshot} />
        : (
          <PhoneNav.Provider value={{ view: phoneView, setView: setPhoneView }}>
          <div className={`shell ${leftOpen ? '' : 'left-hidden'}`} data-phone={phoneView} style={shellStyle}>
            <div
              className="resize-handle resize-left"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize agents panel"
              onPointerDown={event => startResize('left', event)}
            />
            <Sidebar snapshot={snapshot} title={leftTitle} muted={muted} onMuted={setMuted} />
            {snapshot.screen === 'settings'
              ? <SettingsScreen snapshot={snapshot} appearance={appearance} onAppearance={setAppearance} leftTitle={leftTitle} onLeftTitle={changeLeftTitle} />
              : <ChatScreen snapshot={snapshot} leftHidden={!leftOpen} onToggleLeft={() => setLeftOpen(open => !open)} />}
            <div
              className="resize-handle resize-right"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize history panel"
              onPointerDown={event => startResize('right', event)}
            />
          </div>
          </PhoneNav.Provider>
        )}
    </>
  )
}

function Sidebar({ snapshot, title, muted, onMuted }: { snapshot: Snapshot; title: string; muted: boolean; onMuted: (muted: boolean) => void }) {
  const phone = useContext(PhoneNav)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const footerRef = useRef<HTMLDivElement | null>(null)
  const visibleProfiles = snapshot.profiles.filter(profile => !profile.hidden)
  const hiddenProfiles = snapshot.profiles.filter(profile => profile.hidden)

  useEffect(() => {
    if (!hiddenOpen) return
    const close = (event: PointerEvent) => {
      if (!footerRef.current?.contains(event.target as Node)) setHiddenOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHiddenOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [hiddenOpen])

  async function addProfile() {
    setError('')
    try {
      await window.icyteru.createProfile(name)
      setName('')
      setAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes did not create that profile.')
    }
  }

  async function hideProfile(profile: Snapshot['profiles'][number]): Promise<void> {
    setError('')
    try {
      await window.icyteru.setProfileHidden(profile.gatewayId, profile.name, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes did not hide that agent.')
    }
  }

  async function unhideProfile(profile: Snapshot['profiles'][number]): Promise<void> {
    setError('')
    try {
      await window.icyteru.setProfileHidden(profile.gatewayId, profile.name, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes did not unhide that agent.')
    }
  }

  return (
    <aside className="sidebar">
      <div className="bots-head">
        <span>{title.trim() || 'Agents'}</span>
        <span className="bots-tools">
          <button
            className={muted ? 'icon-button' : 'icon-button on'}
            type="button"
            aria-pressed={!muted}
            title={muted ? 'Notifications off — tap to enable' : 'Notifications on'}
            onClick={async () => {
              if (muted) {
                const granted = await window.icyteru.enableNotifications()
                onMuted(!granted)
              } else {
                onMuted(true)
              }
            }}
          >
            {muted ? <BellOff /> : <Bell />}
          </button>
          <button className="icon-button" type="button" title="New profile" onClick={() => setAdding(open => !open)}>
            <Plus />
          </button>
          <button
            className="icon-button phone-only"
            type="button"
            title="Back to active chat"
            aria-label="Back to active chat"
            onClick={() => {
              phone.setView('chat')
              if (snapshot.screen === 'settings') void window.icyteru.showScreen('chat')
            }}
          >
            <ChevronRight />
          </button>
        </span>
      </div>
      {adding && (
        <form className="add-bot" onSubmit={event => { event.preventDefault(); void addProfile() }}>
          <input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Profile name" />
          <button className="solid tiny" type="submit" disabled={!name.trim()}>Add</button>
        </form>
      )}
      {error && <p className="inline-error side-note">{error}</p>}
      <div className="bot-list">
        {visibleProfiles.map(profile => {
          const selected = profile.gatewayId === snapshot.activeGatewayId && profile.name === snapshot.activeProfile
          const online = selected || isRecent(profile.lastActive)
          return (
            <div className={selected ? 'bot-row active' : 'bot-row'} key={`${profile.gatewayId}:${profile.name}`}>
              <button
                className="bot-main"
                type="button"
                onClick={() => {
                  phone.setView('chat')
                  if (snapshot.screen === 'settings') void window.icyteru.showScreen('chat')
                  void window.icyteru.selectProfile(profile.gatewayId, profile.name)
                }}
              >
                <Avatar label={profile.label} initial={profile.initial} src={profile.avatar} />
                <span className="bot-copy">
                  <span className="bot-name">
                    <i className={online ? 'presence live' : 'presence'} />
                    {profile.label}
                  </span>
                </span>
              </button>
              <button
                className="bot-hide"
                type="button"
                title={`Hide ${profile.label}`}
                aria-label={`Hide ${profile.label}`}
                onClick={event => {
                  event.stopPropagation()
                  void hideProfile(profile)
                }}
              >
                <EyeOff />
              </button>
              <button
                className={profile.pinned ? 'pin-button on' : 'pin-button'}
                type="button"
                title={profile.pinned ? 'Unpin' : 'Pin to top'}
                onClick={() => void window.icyteru.setPinned(profile.gatewayId, profile.name, !profile.pinned)}
              >
                <PinIcon filled={profile.pinned} />
              </button>
            </div>
          )
        })}
        {visibleProfiles.length === 0 && <p className="empty-list">All agents are hidden. Use the eye button beside Settings to unhide one.</p>}
      </div>
      <div className="side-footer" ref={footerRef}>
        {hiddenOpen && (
          <div className="hidden-bots-menu" role="dialog" aria-label="Hidden agents">
            <div className="hidden-bots-head">
              <span>Hidden agents</span>
              <button className="hidden-bots-close" type="button" onClick={() => setHiddenOpen(false)} aria-label="Close hidden agents">×</button>
            </div>
            {hiddenProfiles.length === 0 && <p className="hidden-bots-empty">No hidden agents.</p>}
            {hiddenProfiles.map(profile => (
              <div className="hidden-bot-row" key={`${profile.gatewayId}:${profile.name}`}>
                <Avatar label={profile.label} initial={profile.initial} src={profile.avatar} size={26} />
                <span className="hidden-bot-name">{profile.label}</span>
                <button className="ghost tiny" type="button" onClick={() => void unhideProfile(profile)}>Unhide</button>
              </div>
            ))}
          </div>
        )}
        <button
          className="settings-link hidden-bots-link"
          type="button"
          title="Hidden agents"
          aria-label="Hidden agents"
          aria-expanded={hiddenOpen}
          onClick={() => setHiddenOpen(open => !open)}
        >
          <span className="hidden-bots-eye">
            <Eye />
            {hiddenProfiles.length > 0 && <span className="hidden-count">{hiddenProfiles.length}</span>}
          </span>
          <span className="settings-label">Hidden</span>
        </button>
        <button className="settings-link" onClick={() => { phone.setView('chat'); setHiddenOpen(false); void window.icyteru.showScreen('settings') }} type="button" aria-label="Settings">
          <Gear />
          <span className="settings-label">Settings</span>
        </button>
      </div>
    </aside>
  )
}

function Bell() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function BellOff() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 9.5-4.8M18 9c0 5 2 6 2 6H8M10 18a2 2 0 0 0 4 0M4 4l16 16" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function Plus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Eye() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.7M6.1 6.6C3.9 8.3 2.5 12 2.5 12s3.5 6 9.5 6c1.4 0 2.7-.3 3.8-.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function Gear() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M19.4 13.2a7.8 7.8 0 0 0 0-2.4l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2-1.2L14.6 3h-4l-.4 2.7a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2 1.2l.4 2.7h4l.4-2.7a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function useDark(theme: ThemePreference): boolean {
  const [dark, setDark] = useState(() => resolveDark(theme))
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      applyTheme(theme)
      setDark(resolveDark(theme))
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [theme])
  return dark
}

const DARK_THEMES = new Set<ThemePreference>(['dark', 'abyss', 'github-dark'])

function resolveDark(theme: ThemePreference): boolean {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches
  return DARK_THEMES.has(theme)
}

function applyTheme(theme: ThemePreference): void {
  const mode = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'github-dark' : 'github-light')
    : theme
  document.documentElement.dataset.theme = mode
  localStorage.setItem('icyteru-theme', theme)
}

function readSize(key: string, fallback: number, min: number, max: number): number {
  const stored = Number(localStorage.getItem(key))
  return Number.isFinite(stored) && stored > 0 ? clampSize(stored, min, max) : fallback
}

function clampSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function plainText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/[`*_>#|]+/g, ' ')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([:;,.!?])/g, '$1')
    .trim()
}

function notificationPreview(value: string, limit: number): string {
  const text = plainText(value)
  if (text.length <= limit) return text
  const slice = text.slice(0, limit)
  const finish = (cut: string) => `${cut.trimEnd().replace(/[.,;:!?]+$/, '')}…`
  const sentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? ')
  )
  if (sentence >= limit * 0.6) return finish(slice.slice(0, sentence + 1))
  const word = slice.lastIndexOf(' ')
  return finish(slice.slice(0, word > 0 ? word : limit))
}
