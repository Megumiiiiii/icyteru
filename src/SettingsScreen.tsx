import { useContext, useEffect, useRef, useState } from 'react'
import { PhoneNav } from './phone'
import type { AuthMode } from '../shared/protocol'
import type { Snapshot, ThemePreference } from '../shared/snapshot'

type Appearance = { dim: number; blur: number; light: string | null; dark: string | null }
type Method = 'password' | 'token'

export function SettingsScreen({ snapshot, appearance, onAppearance, leftTitle, onLeftTitle }: {
  snapshot: Snapshot
  appearance: Appearance | null
  onAppearance: (appearance: Appearance) => void
  leftTitle: string
  onLeftTitle: (value: string) => void
}) {
  const phone = useContext(PhoneNav)
  const [url, setUrl] = useState(snapshot.connection.url)
  const [token, setToken] = useState<string | undefined>(undefined)
  const [username, setUsername] = useState<string | undefined>(undefined)
  const [password, setPassword] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<AuthMode>(snapshot.connection.authMode)
  const [method, setMethod] = useState<Method>(snapshot.connection.method || (snapshot.connection.authMode === 'token' ? 'token' : 'password'))
  const [message, setMessage] = useState('')
  const [notifyNote, setNotifyNote] = useState('')
  const [busy, setBusy] = useState(false)
  const picked = useRef(false)

  useEffect(() => {
    const target = url.trim()
    picked.current = false
    if (!/^https?:\/\//i.test(target)) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const found = await window.icyteru.probeAuth({ url: target })
        if (found.ok && !cancelled) {
          setMode(found.mode)
          if (!picked.current) {
            if (found.mode === 'token') setMethod('token')
            else if (found.mode === 'password') setMethod('password')
          }
        }
      } catch {
        // Keep the last known mode; saving still tests the credentials directly.
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [url])

  function choose(next: Method) {
    picked.current = true
    setMethod(next)
  }

  const payload = {
    url,
    method,
    ...(method === 'password'
      ? {
        ...(username === undefined ? {} : { username }),
        ...(password === undefined ? {} : { password }),
        token: ''
      }
      : {
        ...(token === undefined ? {} : { token }),
        username: '',
        password: ''
      })
  }

  async function save() {
    setBusy(true)
    setMessage('')
    try {
      await window.icyteru.saveConnection(payload)
      setToken(undefined)
      setUsername(undefined)
      setPassword(undefined)
      setMessage('Saved. Icyteru is using this gateway.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings">
      <header className="chat-bar">
        <div>
          <h1>Settings</h1>
          <p>{snapshot.hermesVersion ? `Hermes ${snapshot.hermesVersion}` : 'Gateway'}</p>
        </div>
        <div className="bar-actions">
          <button className="top-action tiny phone-only" onClick={() => { phone.setView('roster'); void window.icyteru.showScreen('chat') }} type="button">Bots</button>
          <button className="top-action tiny" onClick={() => { phone.setView('chat'); void window.icyteru.showScreen('chat') }} type="button">Back to chat</button>
        </div>
      </header>
      <div className="settings-body">
        <section>
          <h2>Connection</h2>
          <label>
            Gateway URL
            <input value={url} onChange={event => setUrl(event.target.value)} spellCheck={false} />
          </label>
          <div className="auth-tabs" role="tablist" aria-label="Sign in method">
            <button
              className={method === 'password' ? 'auth-tab selected' : 'auth-tab'}
              role="tab"
              aria-selected={method === 'password'}
              onClick={() => choose('password')}
              type="button"
            >
              Password
            </button>
            <button
              className={method === 'token' ? 'auth-tab selected' : 'auth-tab'}
              role="tab"
              aria-selected={method === 'token'}
              onClick={() => choose('token')}
              type="button"
            >
              Token
            </button>
          </div>
          {mode === 'none' && <p className="hint">This gateway is open. No login is needed.</p>}
          {method === 'password' ? (
            <>
              <label>
                Username
                <input
                  value={username ?? ''}
                  onChange={event => setUsername(event.target.value)}
                  placeholder={snapshot.connection.hasPassword ? 'Saved on this computer.' : 'Your dashboard username'}
                  autoComplete="username"
                  spellCheck={false}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password ?? ''}
                  onChange={event => setPassword(event.target.value)}
                  placeholder={snapshot.connection.hasPassword ? 'Saved on this computer. Type to replace it.' : 'Your dashboard password'}
                  autoComplete="current-password"
                />
              </label>
            </>
          ) : (
            <label>
              Session token
              <input
                type="password"
                value={token ?? ''}
                onChange={event => setToken(event.target.value)}
                placeholder={snapshot.connection.hasToken ? 'Saved on this computer. Type to replace it.' : "Paste your gateway's session token"}
                spellCheck={false}
              />
            </label>
          )}
          <p className="hint">
            Pick how this gateway signs you in. Leave a field blank to keep the credential already saved on this computer.
          </p>
          <div className="row">
            <button className="solid" disabled={busy} onClick={() => void save()} type="button">Test and save</button>
            <button className="ghost" onClick={() => void window.icyteru.reconnect()} type="button">Reconnect</button>
            <button className="ghost danger" onClick={() => void window.icyteru.forgetConnection()} type="button">Forget gateway</button>
          </div>
          {message && <p className="hint">{message}</p>}
        </section>
        <section>
          <h2>Layout</h2>
          <label>
            Left panel title
            <input value={leftTitle} onChange={event => onLeftTitle(event.target.value)} placeholder="Agents" spellCheck={false} />
          </label>
          <p className="hint">Drag the divider between panels to resize them. Widths and this title are remembered on this device.</p>
        </section>
        <section>
          <h2>Appearance</h2>
          <div className="theme-choices">
            {(['light', 'dark', 'system'] as ThemePreference[]).map(theme => (
              <button
                key={theme}
                className={snapshot.connection.theme === theme ? 'solid' : 'ghost'}
                onClick={() => void window.icyteru.setTheme(theme)}
                type="button"
              >
                {theme === 'system' ? 'Match system' : theme === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <p className="hint">Light mode is the warm paper look. Dark mode is a purple night sky with stars, unless you set a picture below.</p>
          <BackgroundCard
            title="Light background"
            image={appearance?.light ?? null}
            onPick={file => void pick('light', file, onAppearance)}
            onReset={() => void window.icyteru.clearBackground('light').then(onAppearance)}
          />
          <BackgroundCard
            title="Dark background"
            image={appearance?.dark ?? null}
            onPick={file => void pick('dark', file, onAppearance)}
            onReset={() => void window.icyteru.clearBackground('dark').then(onAppearance)}
          />
          <label>
            Dim the picture ({Math.round((appearance?.dim ?? 0.4) * 100)}%)
            <input
              type="range" min={0} max={0.75} step={0.05}
              value={appearance?.dim ?? 0.4}
              onChange={event => void window.icyteru.setBackdrop(Number(event.target.value), appearance?.blur ?? 12).then(onAppearance)}
            />
          </label>
          <label>
            Frost the panels ({Math.round(appearance?.blur ?? 12)} px)
            <input
              type="range" min={0} max={28} step={1}
              value={appearance?.blur ?? 12}
              onChange={event => void window.icyteru.setBackdrop(appearance?.dim ?? 0.4, Number(event.target.value)).then(onAppearance)}
            />
          </label>
        </section>
        <section>
          <h2>Notifications</h2>
          <p className="hint">The bell in the Agents panel asks the system for permission. Use this button to check that a native notification reaches this device.</p>
          <div className="row">
            <button
              className="ghost"
              onClick={async () => {
                setNotifyNote('')
                const granted = await window.icyteru.enableNotifications()
                if (!granted) {
                  setNotifyNote('Notifications are blocked. Allow Icyteru in the system notification settings, then try again.')
                  return
                }
                await window.icyteru.notify({ title: 'Icyteru test', body: 'If you can see this, notifications are working.' })
                setNotifyNote('Test notification sent. Check your notification shade or toast.')
              }}
              type="button"
            >
              Send test notification
            </button>
          </div>
          {notifyNote && <p className="hint">{notifyNote}</p>}
        </section>
        <section>
          <h2>About</h2>
          <p>
            Icyteru {appVersion()} talks to the Hermes gateway the same way Hermes Desktop does: HTTP <code>/api/status</code> and the <code>/api/ws</code> JSON-RPC chat socket. Models, memory, tools, skills, and chat history stay on your Hermes.
          </p>
        </section>
      </div>
    </section>
  )
}

function appVersion(): string {
  return '0.0.8'
}

function BackgroundCard({ title, image, onPick, onReset }: {
  title: string
  image: string | null
  onPick: (file: File) => void
  onReset: () => void
}) {
  return (
    <div className="bg-card">
      <strong>{title}</strong>
      <div className="bg-preview" style={image ? { backgroundImage: `url("${image}")` } : undefined}>
        {image ? '' : 'Default'}
      </div>
      <div className="row">
        <label className="ghost tiny file-button">
          Choose image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onPick(file)
            }}
          />
        </label>
        <button className="ghost tiny" type="button" disabled={!image} onClick={onReset}>Reset to default</button>
      </div>
    </div>
  )
}

async function pick(mode: 'light' | 'dark', file: File, onAppearance: (appearance: Appearance) => void) {
  const image = await readFile(file)
  onAppearance(await window.icyteru.setBackground(mode, image))
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
