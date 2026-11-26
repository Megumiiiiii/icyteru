import { useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Capacitor } from '@capacitor/core'
import { PhoneNav } from './phone'
import { isSakugaEnabled, setSakugaEnabled } from './sakuga'
import { APP_VERSION } from './version'
import { autoFocusSearch, findModelChoiceIndex } from '../shared/model-choice'
import type { AuthMode, FallbackModelEntry, ModelChoice } from '../shared/protocol'
import type { Snapshot, ThemePreference } from '../shared/snapshot'
import { THEME_PREFERENCES } from '../shared/snapshot'

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
  const [approvalNote, setApprovalNote] = useState('')
  const [globalNote, setGlobalNote] = useState('')
  const [appearanceNote, setAppearanceNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  const [sakugaOn, setSakugaOn] = useState(isSakugaEnabled)
  const [globalModelIndex, setGlobalModelIndex] = useState(() =>
    findModelChoiceIndex(snapshot.models, snapshot.globalModel, snapshot.globalProvider)
  )
  const [globalReasoningLevel, setGlobalReasoningLevel] = useState(snapshot.globalReasoning || 'medium')
  const [fallbackRows, setFallbackRows] = useState<FallbackModelEntry[]>(() => snapshot.fallbackModels)
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

  useEffect(() => {
    setGlobalModelIndex(findModelChoiceIndex(snapshot.models, snapshot.globalModel, snapshot.globalProvider))
  }, [snapshot.globalModel, snapshot.globalProvider, snapshot.models])

  useEffect(() => {
    setGlobalReasoningLevel(snapshot.globalReasoning || 'medium')
  }, [snapshot.globalReasoning])

  useEffect(() => {
    setFallbackRows(snapshot.fallbackModels)
  }, [snapshot.fallbackModels, snapshot.activeProfile, snapshot.activeGatewayId])

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

  async function saveGlobalDefaults() {
    setBusy(true)
    setGlobalNote('')
    try {
      const model = snapshot.models[globalModelIndex]
      if (model) {
        await window.icyteru.setModel(model.id, model.providerId || model.provider)
      }
      await window.icyteru.setGlobalReasoning(globalReasoningLevel)
      const cleanedFallbacks = fallbackRows.filter(entry => entry.provider.trim() && entry.model.trim())
      if (JSON.stringify(cleanedFallbacks) !== JSON.stringify(snapshot.fallbackModels)) {
        await window.icyteru.setFallbackModels(cleanedFallbacks)
      }
      setGlobalNote('Global defaults saved. New chats use them.')
    } catch (error) {
      setGlobalNote(error instanceof Error ? error.message : 'Could not save the global defaults.')
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
            {confirmForget ? (
              <>
                <button
                  className="ghost danger"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void window.icyteru.forgetConnection().finally(() => setBusy(false))
                  }}
                  type="button"
                >
                  Forget gateway?
                </button>
                <button className="ghost" onClick={() => setConfirmForget(false)} type="button">Keep</button>
              </>
            ) : (
              <button className="ghost danger" onClick={() => setConfirmForget(true)} type="button">Forget gateway</button>
            )}
          </div>
          {message && <p className="hint">{message}</p>}
        </section>
        <section>
          <h2>Global defaults</h2>
          <div className="settings-model-field">
            <span className="settings-field-label">Default model</span>
            <GlobalModelPicker models={snapshot.models} value={globalModelIndex} onChange={setGlobalModelIndex} />
          </div>
          <label>
            Default reasoning
            <select value={globalReasoningLevel} onChange={event => setGlobalReasoningLevel(event.target.value)}>
              {(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const).map(level => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>
          <FallbackModelsField
            models={snapshot.models}
            rows={fallbackRows}
            onChange={setFallbackRows}
          />
          <p className="hint">New chats use these defaults, and fallback models are tried in order if the primary model fails. You can still switch model or reasoning per chat.</p>
          <div className="row">
            <button className="solid" disabled={busy} onClick={() => void saveGlobalDefaults()} type="button">Save global defaults</button>
          </div>
          {globalNote && <p className="hint">{globalNote}</p>}
        </section>
        <section>
          <h2>Layout</h2>
          <label>
            Left panel title
            <input value={leftTitle} onChange={event => onLeftTitle(event.target.value)} placeholder="Agents" spellCheck={false} />
          </label>
          <p className="hint">Drag the divider between panels to resize them. Widths and this title are remembered on this device.</p>
        </section>
        <WindowCloseCard />
        <section>
          <h2>Appearance</h2>
          <div className="theme-choices theme-grid">
            {THEME_PREFERENCES.map(theme => (
              <button
                key={theme}
                className={snapshot.connection.theme === theme ? 'solid' : 'ghost'}
                onClick={() => void window.icyteru.setTheme(theme)}
                type="button"
              >
                {themeLabel(theme)}
              </button>
            ))}
          </div>
          <p className="hint">Paper is the warm writing paper. Sakura is pink with petals. Antartika is icy blue, Kraft is warm cardboard, Stars is the purple night sky, Abyss is deep teal, and the GitHub themes are the familiar plain light/dark palettes. System follows GitHub Light/Dark. Custom images below apply to GitHub Light/Dark only.</p>
          <BackgroundCard
            title="GitHub Light background"
            image={appearance?.light ?? null}
            onPick={file => {
              setAppearanceNote('')
              void pick('light', file, onAppearance).catch((error: unknown) => {
                setAppearanceNote(error instanceof Error ? error.message : 'Could not set that background.')
              })
            }}
            onReset={() => {
              setAppearanceNote('')
              void window.icyteru.clearBackground('light').then(onAppearance).catch((error: unknown) => {
                setAppearanceNote(error instanceof Error ? error.message : 'Could not clear that background.')
              })
            }}
          />
          <BackgroundCard
            title="GitHub Dark background"
            image={appearance?.dark ?? null}
            onPick={file => {
              setAppearanceNote('')
              void pick('dark', file, onAppearance).catch((error: unknown) => {
                setAppearanceNote(error instanceof Error ? error.message : 'Could not set that background.')
              })
            }}
            onReset={() => {
              setAppearanceNote('')
              void window.icyteru.clearBackground('dark').then(onAppearance).catch((error: unknown) => {
                setAppearanceNote(error instanceof Error ? error.message : 'Could not clear that background.')
              })
            }}
          />
          {appearanceNote && <p className="hint">{appearanceNote}</p>}
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
          <div className="row sakuga-toggle-row">
            <button
              className={sakugaOn ? 'solid' : 'ghost'}
              type="button"
              role="switch"
              aria-checked={sakugaOn}
              onClick={event => {
                const next = !sakugaOn
                setSakugaOn(next)
                void setSakugaEnabled(next, event.currentTarget)
              }}
            >
              Sakuga VFX: {sakugaOn ? 'On' : 'Off'}
            </button>
          </div>
          <p className="hint">Optional anime/manga impact bursts, smoke puffs, and SFX lettering on buttons, tabs, pins, and sliders. Follows your active theme and automatically disables when reduced motion is on.</p>
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
          <div className="row">
            <button
              className="ghost"
              onClick={async () => {
                setApprovalNote('')
                try {
                  const result = await window.icyteru.testApproval()
                  setApprovalNote(result.ok ? 'Test approval card published to the connected session.' : 'The gateway did not accept the test approval.')
                } catch (error) {
                  setApprovalNote(error instanceof Error ? error.message : 'Could not publish the test approval.')
                }
              }}
              type="button"
            >
              Test approval card
            </button>
          </div>
          {approvalNote && <p className="hint">{approvalNote}</p>}
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

function WindowCloseCard() {
  const api = typeof window.icyteru.getCloseBehavior === 'function' ? window.icyteru : null
  const [behavior, setBehavior] = useState<'quit' | 'tray' | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!api?.getCloseBehavior) return
    let cancelled = false
    void api.getCloseBehavior()
      .then(value => {
        if (!cancelled) setBehavior(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  if (!api) return null

  const choose = (value: 'quit' | 'tray') => {
    setNote('')
    void api.setCloseBehavior?.(value)
      .then(next => setBehavior(next))
      .catch((error: unknown) => {
        setNote(error instanceof Error ? error.message : 'Could not save that choice.')
      })
  }

  return (
    <section>
      <h2>Window</h2>
      <span className="settings-field-label">When I close the window</span>
      <div className="theme-choices">
        <button className={behavior === 'quit' ? 'solid' : 'ghost'} onClick={() => choose('quit')} type="button">
          Quit Icyteru
        </button>
        <button className={behavior === 'tray' ? 'solid' : 'ghost'} onClick={() => choose('tray')} type="button">
          Keep running in the tray
        </button>
      </div>
      <p className="hint">
        Keeping Icyteru in the tray leaves the chat connection and notifications alive after you press X. Reopen it from the
        tray icon, or choose Quit from that menu to close it for real.
      </p>
      {note && <p className="hint">{note}</p>}
    </section>
  )
}

function FallbackModelsField({ models, rows, onChange }: {
  models: ModelChoice[]
  rows: FallbackModelEntry[]
  onChange: (next: FallbackModelEntry[]) => void
}) {
  const [adding, setAdding] = useState(false)

  function updateRow(index: number, modelIndex: number) {
    const choice = models[modelIndex]
    if (!choice) return
    const nextProvider = choice.providerId || choice.provider
    onChange(rows.map((entry, at) => {
      if (at !== index) return entry
      const sameProvider = entry.provider.toLowerCase() === nextProvider.toLowerCase()
      return sameProvider
        ? { ...entry, provider: nextProvider, model: choice.id }
        : { provider: nextProvider, model: choice.id }
    }))
  }

  function moveRow(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, at) => at !== index))
  }

  return (
    <div className="settings-model-field fallback-models-field">
      <div className="fallback-models-head">
        <span className="settings-field-label">Fallback models</span>
        <button
          className="ghost tiny"
          type="button"
          disabled={models.length === 0 || adding}
          onClick={() => setAdding(true)}
        >
          + Add fallback
        </button>
      </div>
      {rows.length === 0 && !adding ? (
        <p className="hint fallback-empty">No fallback models yet. Add one to fail over automatically when the primary model is unavailable.</p>
      ) : (
        <div className="fallback-list">
          {rows.map((entry, index) => {
            const matched = models.findIndex(choice => {
              const choiceProvider = (choice.providerId || choice.provider).toLowerCase()
              const entryProvider = entry.provider.toLowerCase()
              const sameModel = choice.id.toLowerCase() === entry.model.toLowerCase()
              if (!sameModel) return false
              return !entryProvider || choiceProvider === entryProvider || choice.provider.toLowerCase() === entryProvider
            })
            return (
              <div className="fallback-row" key={`${index}:${entry.provider}:${entry.model}`}>
                <span className="fallback-rank" aria-label={`Fallback ${index + 1}`}>{index + 1}</span>
                <GlobalModelPicker
                  models={models}
                  value={matched}
                  fallbackLabel={entry.model ? { label: entry.model, provider: entry.provider || 'custom' } : undefined}
                  onChange={nextIndex => updateRow(index, nextIndex)}
                />
                {rows.length > 1 && (
                  <div className="fallback-reorder">
                    <button
                      className="ghost tiny fallback-icon"
                      type="button"
                      disabled={index === 0}
                      title="Move up"
                      aria-label={`Move fallback ${index + 1} up`}
                      onClick={() => moveRow(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="ghost tiny fallback-icon"
                      type="button"
                      disabled={index === rows.length - 1}
                      title="Move down"
                      aria-label={`Move fallback ${index + 1} down`}
                      onClick={() => moveRow(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                )}
                <button
                  className="ghost tiny fallback-icon"
                  type="button"
                  title="Remove fallback"
                  aria-label={`Remove fallback ${index + 1}`}
                  onClick={() => removeRow(index)}
                >
                  ×
                </button>
              </div>
            )
          })}
          {adding && (
            <div className="fallback-row fallback-add-row">
              <span className="fallback-rank" aria-hidden="true">{rows.length + 1}</span>
              <GlobalModelPicker
                models={models}
                value={-1}
                placeholder="Choose a model…"
                onChange={nextIndex => {
                  const choice = models[nextIndex]
                  if (!choice) return
                  onChange([...rows, { provider: choice.providerId || choice.provider, model: choice.id }])
                  setAdding(false)
                }}
              />
              <button
                className="ghost tiny fallback-icon"
                type="button"
                title="Cancel"
                aria-label="Cancel adding a fallback model"
                onClick={() => setAdding(false)}
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GlobalModelPicker({ models, value, onChange, fallbackLabel, placeholder }: {
  models: ModelChoice[]
  value: number
  onChange: (index: number) => void
  fallbackLabel?: { label: string; provider: string }
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [provider, setProvider] = useState('all')
  const [dropUp, setDropUp] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const matched = value >= 0 ? models[value] : undefined
  const selected = matched ?? (fallbackLabel
    ? { id: fallbackLabel.label, label: fallbackLabel.label, provider: fallbackLabel.provider, providerId: fallbackLabel.provider }
    : placeholder ? undefined : models[0])
  const selectedProvider = selected ? selected.providerId || selected.provider || 'other' : ''

  function openPicker() {
    const box = root.current?.getBoundingClientRect()
    const below = box ? window.innerHeight - box.bottom : 0
    const above = box ? box.top : 0
    const needed = Math.min(window.innerHeight * 0.7, 420)
    setDropUp(below < needed && above > below)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setFilter('')
    setProvider('all')
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
      if (!root.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onBack = (event: Event) => {
      event.preventDefault()
      close()
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

  const providers = useMemo(() => {
    const labels = new Map<string, string>()
    for (const model of models) {
      const id = model.providerId || model.provider || 'other'
      if (!labels.has(id)) labels.set(id, model.provider || id)
    }
    return [...labels].map(([id, label]) => ({ id, label }))
  }, [models])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return models.map((model, index) => ({ model, index })).filter(({ model }) => {
      if (provider !== 'all' && (model.providerId || model.provider || 'other') !== provider) return false
      return `${model.label} ${model.provider} ${model.id}`.toLowerCase().includes(needle)
    })
  }, [filter, models, provider])

  if (models.length === 0) return <p className="hint">No models available.</p>

  return (
    <div className="global-model-picker" ref={root}>
      <button
        className="global-model-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => open ? close() : openPicker()}
      >
        <span className="model-label">
          {selected ? (
            <>
              <strong>{selected.label}</strong>
              <em>{selected.provider}</em>
            </>
          ) : (
            <strong className="model-placeholder">{placeholder}</strong>
          )}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className={`model-pop global-model-pop${dropUp ? ' drop-up' : ''}`} role="dialog" aria-label="Choose default model">
          <input
            autoFocus={autoFocusSearch(Capacitor.getPlatform())}
            value={filter}
            onChange={event => setFilter(event.target.value)}
            placeholder="Search models"
          />
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
              <button className={provider === 'all' ? 'active' : ''} onClick={() => chooseProvider('all')} type="button" role="tab" aria-selected={provider === 'all'}>All</button>
              {providers.map(item => (
                <button
                  key={item.id}
                  className={provider === item.id ? 'active' : ''}
                  onClick={() => chooseProvider(item.id)}
                  type="button"
                  role="tab"
                  aria-selected={provider === item.id}
                >
                  {item.label}
                  {item.id === selectedProvider && <span className="provider-inuse" aria-label="selected provider">•</span>}
                </button>
              ))}
            </div>
          )}
          <div className="model-list">
            {visible.map(({ model, index }) => (
              <button
                key={`${model.providerId || model.provider}:${model.id}`}
                className={index === value ? 'active' : ''}
                onClick={() => {
                  onChange(index)
                  close()
                }}
                type="button"
              >
                <span className="model-label">
                  <strong>{model.label}</strong>
                  <em>{model.provider}</em>
                </span>
                {index === value && <span className="model-check" aria-label="Selected model">✓</span>}
              </button>
            ))}
            {visible.length === 0 && <p className="hint">No matching models.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function appVersion(): string {
  return APP_VERSION
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

function themeLabel(theme: ThemePreference): string {
  const labels: Record<ThemePreference, string> = {
    light: 'Paper',
    sakura: 'Sakura',
    antartika: 'Antartika',
    kraft: 'Kraft',
    dark: 'Stars',
    abyss: 'Abyss',
    'github-light': 'GitHub Light',
    'github-dark': 'GitHub Dark',
    system: 'System'
  }
  return labels[theme]
}

async function pick(mode: 'light' | 'dark', file: File, onAppearance: (appearance: Appearance) => void) {
  if (file.type && !['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) throw new Error('Use a PNG, JPEG, or WebP image.')
  if (file.size > 8 * 1024 * 1024) throw new Error('That image is larger than 8 MB.')
  const image = (await readFile(file)).replace(/^data:image\/jpg;/i, 'data:image/jpeg;')
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
