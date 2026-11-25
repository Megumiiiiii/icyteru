import { invoke } from '@tauri-apps/api/core'

declare global {
  // Presence is read by HermesClient before it chooses browser-cookie behavior.
  // eslint-disable-next-line no-var
  var __ICYTERU_NATIVE_TRANSPORT__: boolean | undefined
}

globalThis.__ICYTERU_NATIVE_TRANSPORT__ = true

interface GatewayResponse {
  status: number
  headers: Array<[string, string]>
  setCookie: string[]
  body: string
  bodyB64?: string | null
}

const webFetch = globalThis.fetch.bind(globalThis)

function decodeBase64(value: string): ArrayBuffer {
  const raw = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes.buffer
}

export function installNativeFetch(): void {
  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!/^https?:/i.test(url) || url.startsWith(location.origin)) return webFetch(input, init)
    const source = input instanceof Request ? input : null
    const headers: Record<string, string> = {}
    new Headers(init.headers ?? source?.headers).forEach((value, name) => { headers[name] = value })
    const body = typeof init.body === 'string' ? init.body : undefined
    const response = await invoke<GatewayResponse>('gateway_request', {
      method: init.method ?? source?.method ?? 'GET',
      url,
      headers,
      body
    })
    const outgoing = new Headers()
    for (const [name, value] of response.headers) outgoing.append(name, value)
    for (const cookie of response.setCookie || []) outgoing.append('x-icyteru-set-cookie', cookie)
    const payload = response.bodyB64 ? decodeBase64(response.bodyB64) : response.body
    return new Response(payload, { status: response.status, headers: outgoing })
  }
}
