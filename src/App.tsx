import { useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Snapshot, ThemePreference } from '../shared/snapshot'
import { Avatar } from './Avatar'
import { ChatScreen } from './ChatScreen'
import { ConnectScreen } from './ConnectScreen'
import { SettingsScreen } from './SettingsScreen'
import { initialPhone, PhoneNav, type PhoneView } from './phone'
import { Starfield } from './Starfield'
import { ago, isRecent } from './time'

type Appearance = { dim: number; blur: number; light: string | null; dark: string | null }

export function App({ snapshot }: { snapshot: Snapshot }) {
  const [appearance, setAppearance] = useState<Appearance | null>(null)
  const [phoneView, setPhoneView] = useState<PhoneView>(initialPhone)
  const [leftWidth, setLeftWidth] = useState(() => readSize('icyteru-left-width', 272, 200, 440))
  const [rightWidth, setRightWidth] = useState(() => readSize('icyteru-details-width', 320, 240, 560))
  const [leftTitle, setLeftTitle] = useState(() => localStorage.getItem('icyteru-left-title') || 'Agents')
  const sizeRef = useRef({ left: leftWidth, right: rightWidth })
  const dark = useDark(snapshot.connection.theme)
  useEffect(() => {
    void window.icyteru.getAppearance().then(setAppearance).catch(() => undefined)
  }, [])
  useEffect(() => {
    sizeRef.current = { left: leftWidth, right: rightWidth }
  }, [leftWidth, rightWidth])
  useEffect(() => {
    const root = document.documentElement
    const image = dark ? appearance?.dark : appearance?.light
    root.dataset.backdrop = image ? 'image' : dark ? 'stars' : 'plain'
    root.style.setProperty('--bg-dim', String(appearance?.dim ?? 0.4))
    root.style.setProperty('--panel-blur', `${appearance?.blur ?? 12}px`)
  }, [dark, appearance])

  const image = dark ? appearance?.dark : appearance?.light
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
        {dark && !image && <Starfield />}
        {image && <div className="sky-photo" style={{ backgroundImage: `url("${image}")` }} />}
        <div className="sky-dim" />
      </div>
      {snapshot.screen === 'connect' || !snapshot.connection.url
        ? <ConnectScreen snapshot={snapshot} />
        : (
          <PhoneNav.Provider value={{ view: phoneView, setView: setPhoneView }}>
          <div className="shell" data-phone={phoneView} style={shellStyle}>
            <div
              className="resize-handle resize-left"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize agents panel"
              onPointerDown={event => startResize('left', event)}
            />
            <Sidebar snapshot={snapshot} title={leftTitle} />
            {snapshot.screen === 'settings'
              ? <SettingsScreen snapshot={snapshot} appearance={appearance} onAppearance={setAppearance} leftTitle={leftTitle} onLeftTitle={changeLeftTitle} />
              : <ChatScreen snapshot={snapshot} />}
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

function Sidebar({ snapshot, title }: { snapshot: Snapshot; title: string }) {
  const phone = useContext(PhoneNav)
  const [muted, setMuted] = useState(() => localStorage.getItem('icyteru-muted') === '1')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

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

  return (
    <aside className="sidebar">
      <div className="bots-head">
        <span>{title.trim() || 'Agents'}</span>
        <span className="bots-tools">
          <button
            className={muted ? 'icon-button on' : 'icon-button'}
            type="button"
            aria-pressed={muted}
            title={muted ? 'Notifications off' : 'Notifications on'}
            onClick={() => {
              const next = !muted
              setMuted(next)
              localStorage.setItem('icyteru-muted', next ? '1' : '0')
            }}
          >
            {muted ? <BellOff /> : <Bell />}
          </button>
          <button className="icon-button" type="button" title="New profile" onClick={() => setAdding(open => !open)}>
            <Plus />
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
        {snapshot.profiles.map(profile => {
          const selected = profile.gatewayId === snapshot.activeGatewayId && profile.name === snapshot.activeProfile
          return (
            <div className={selected ? 'bot-row active' : 'bot-row'} key={`${profile.gatewayId}:${profile.name}`}>
              <button
                className="bot-main"
                type="button"
                onClick={() => {
                  phone.setView('chat')
                  void window.icyteru.selectProfile(profile.gatewayId, profile.name)
                }}
              >
                <Avatar label={profile.label} initial={profile.initial} src={profile.avatar} />
                <span className="bot-copy">
                  <span className="bot-name">
                    <i className={isRecent(profile.lastActive) ? 'presence live' : 'presence'} />
                    {profile.label}
                  </span>
                  {profile.preview && <span className="bot-preview">{profile.preview}</span>}
                </span>
                {profile.lastActive != null && <time>{ago(profile.lastActive)}</time>}
              </button>
              <button
                className={profile.pinned ? 'pin-button on' : 'pin-button'}
                type="button"
                title={profile.pinned ? 'Unpin' : 'Pin to top'}
                onClick={() => void window.icyteru.setPinned(profile.gatewayId, profile.name, !profile.pinned)}
              >
                {profile.pinned ? 'Unpin' : 'Pin'}
              </button>
            </div>
          )
        })}
        {snapshot.profiles.length === 0 && <p className="empty-list">Hermes profiles show up here.</p>}
      </div>
      <button className="settings-link" onClick={() => { phone.setView('chat'); void window.icyteru.showScreen('settings') }} type="button" aria-label="Settings">
        <Gear />
        <span className="settings-label">Settings</span>
      </button>
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

function resolveDark(theme: ThemePreference): boolean {
  return theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

function applyTheme(theme: ThemePreference): void {
  document.documentElement.dataset.theme = resolveDark(theme) ? 'dark' : 'light'
  localStorage.setItem('icyteru-theme', theme)
}

function readSize(key: string, fallback: number, min: number, max: number): number {
  const stored = Number(localStorage.getItem(key))
  return Number.isFinite(stored) && stored > 0 ? clampSize(stored, min, max) : fallback
}

function clampSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
