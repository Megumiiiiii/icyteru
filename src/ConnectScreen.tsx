import { useEffect, useRef, useState } from 'react'
import type { AuthDiscovery } from '../shared/protocol'
import type { Snapshot } from '../shared/snapshot'

type Method = 'password' | 'token'

export function ConnectScreen({ snapshot }: { snapshot: Snapshot }) {
  const [url, setUrl] = useState(snapshot.connection.url || (window.matchMedia('(max-width: 760px)').matches ? '' : 'http://127.0.0.1:9119'))
  const [method, setMethod] = useState<Method>(snapshot.connection.method || (snapshot.connection.authMode === 'token' ? 'token' : 'password'))
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [discovery, setDiscovery] = useState<AuthDiscovery | null>(null)
  const [probing, setProbing] = useState(false)
  const [busy, setBusy] = useState<'test' | 'save' | ''>('')
  const [result, setResult] = useState(snapshot.error)
  const [ok, setOk] = useState(false)
  const picked = useRef(false)

  // Leaving a long chat leaves the document scrolled, which parks the sign-in
  // card above the viewport and shows only the last button.
  useEffect(() => {
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
  }, [])

  // A gateway advertises its login options in /api/status. Preselect the right
  // tab, but never fight a choice the user has already made.
  useEffect(() => {
    const target = url.trim()
    picked.current = false
    if (!/^https?:\/\//i.test(target)) {
      setDiscovery(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setProbing(true)
      try {
        const found = await window.icyteru.probeAuth({ url: target })
        if (cancelled) return
        setDiscovery(found)
        if (!found.ok) return
        if (!picked.current) {
          if (found.mode === 'token') setMethod('token')
          else if (found.mode === 'password') setMethod('password')
        }
        setResult(found.message)
      } catch (error) {
        if (!cancelled) setDiscovery({
          ok: false,
          mode: 'unknown',
          providers: [],
          authRequired: false,
          message: error instanceof Error ? error.message : 'Could not read the gateway auth mode.'
        })
      } finally {
        if (!cancelled) setProbing(false)
      }
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [url])

  function choose(next: Method) {
    picked.current = true
    setMethod(next)
    invalidate()
  }

  function invalidate() {
    setOk(false)
    setResult('')
  }

  const payload = method === 'password'
    ? { url, method, username, password, token: '' }
    : { url, method, token, username: '', password: '' }

  async function test() {
    setBusy('test')
    setOk(false)
    try {
      const response = await window.icyteru.testConnection(payload)
      setResult(response.message)
      setOk(response.ok)
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'Could not reach Hermes.')
      setOk(false)
    } finally {
      setBusy('')
    }
  }

  async function save() {
    setBusy('save')
    try {
      await window.icyteru.saveConnection(payload)
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'Could not save the connection.')
      setOk(false)
    } finally {
      setBusy('')
    }
  }

  return (
    <main className="connect">
      <section className="connect-card">
        <span className="mark large" aria-hidden="true">I</span>
        <h1>Sign in to Hermes</h1>
        <p className="lede">
          Chats, memory, tools, and skills stay on your Hermes. Icyteru is only a window onto the gateway you already use from Telegram and Discord.
        </p>
        <label>
          Gateway URL
          <input
            autoFocus
            value={url}
            onChange={event => { setUrl(event.target.value); invalidate() }}
            placeholder="http://100.x.x.x:9119"
            spellCheck={false}
          />
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
        {probing && <p className="hint">Checking how this gateway signs you in…</p>}
        {discovery?.ok && <p className="hint">{discovery.message}</p>}
        {method === 'password' ? (
          <>
            <label>
              Username
              <input
                value={username}
                onChange={event => { setUsername(event.target.value); invalidate() }}
                placeholder="Your dashboard username"
                spellCheck={false}
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={event => { setPassword(event.target.value); invalidate() }}
                placeholder="Your dashboard password"
                autoComplete="current-password"
              />
            </label>
          </>
        ) : (
          <label>
            Session token
            <input
              type="password"
              value={token}
              onChange={event => { setToken(event.target.value); invalidate() }}
              placeholder="Paste your gateway's session token"
              spellCheck={false}
            />
          </label>
        )}
        <p className="hint">
          A phone cannot use <code>127.0.0.1</code>, because that means the phone itself. Use the computer's LAN address or its Tailscale address, such as <code>http://100.x.x.x:9119</code>. A Telegram or Discord pairing code is not a session token.
        </p>
        {result && <p className={ok ? 'banner ok' : 'banner'}>{result}</p>}
        <div className="row">
          <button className="ghost" disabled={Boolean(busy)} onClick={() => void test()} type="button">
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <button className="solid" disabled={!ok || Boolean(busy)} onClick={() => void save()} type="button">
            {busy === 'save' ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </section>
    </main>
  )
}
