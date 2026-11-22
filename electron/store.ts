import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { isThemePreference, type ThemePreference } from '../shared/snapshot'

export interface SavedGateway {
  id: string
  url: string
  token: string
  username: string
  password: string
}

export interface SavedConnection {
  url: string
  token: string
  username: string
  password: string
  method?: 'password' | 'token'
  theme: ThemePreference
  gateways: SavedGateway[]
}

interface StoredToken {
  encoding: 'safeStorage' | 'plain'
  value: string
}

interface StoredFile {
  url: string
  token: StoredToken
  username?: StoredToken
  password?: StoredToken
  method?: string
  theme: ThemePreference
  gateways?: Array<{ id: string; url: string; token: StoredToken; username?: StoredToken; password?: StoredToken }>
}

const FILE = 'connection.json'

function filePath(): string {
  return path.join(app.getPath('userData'), FILE)
}

export function loadConnection(): SavedConnection {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as StoredFile
    return {
      url: typeof parsed.url === 'string' ? parsed.url : '',
      token: decodeToken(parsed.token),
      username: decodeToken(parsed.username),
      password: decodeToken(parsed.password),
      method: parsed.method === 'password' || parsed.method === 'token' ? parsed.method : undefined,
      theme: isThemePreference(parsed.theme) ? parsed.theme : 'system',
      gateways: Array.isArray(parsed.gateways)
        ? parsed.gateways.flatMap(gateway => {
          if (!gateway || typeof gateway.url !== 'string' || !gateway.url) return []
          return [{
            id: String(gateway.id || gateway.url),
            url: gateway.url,
            token: decodeToken(gateway.token),
            username: decodeToken(gateway.username),
            password: decodeToken(gateway.password)
          }]
        })
        : []
    }
  } catch {
    return { url: '', token: '', username: '', password: '', theme: 'system', gateways: [] }
  }
}

export function saveConnection(next: SavedConnection): void {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  const body: StoredFile = {
    url: next.url,
    token: encodeToken(next.token),
    username: encodeToken(next.username || ''),
    password: encodeToken(next.password || ''),
    method: next.method,
    theme: next.theme,
    gateways: (next.gateways || []).map(gateway => ({
      id: gateway.id,
      url: gateway.url,
      token: encodeToken(gateway.token),
      username: encodeToken(gateway.username || ''),
      password: encodeToken(gateway.password || '')
    }))
  }
  const target = filePath()
  fs.writeFileSync(target, JSON.stringify(body), { mode: 0o600 })
  try {
    fs.chmodSync(target, 0o600)
  } catch {
    // Windows has no POSIX mode bits.
  }
}

export function clearConnection(): void {
  saveConnection({ url: '', token: '', username: '', password: '', theme: loadConnection().theme, gateways: [] })
}

function encodeToken(token: string): StoredToken {
  if (!token) return { encoding: 'plain', value: '' }
  if (safeStorage.isEncryptionAvailable()) {
    return { encoding: 'safeStorage', value: safeStorage.encryptString(token).toString('base64') }
  }
  return { encoding: 'plain', value: token }
}

function decodeToken(token: StoredToken | undefined): string {
  if (!token || typeof token.value !== 'string' || !token.value) return ''
  if (token.encoding === 'safeStorage') {
    try {
      return safeStorage.decryptString(Buffer.from(token.value, 'base64'))
    } catch {
      return ''
    }
  }
  return token.value
}
