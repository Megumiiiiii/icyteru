/**
 * JSON-RPC client for the Hermes `/api/ws` socket.
 *
 * Frame rules match Nous Research hermes-agent `apps/shared/src/json-rpc-channel.ts`
 * (MIT): client calls carry an id, events are `{method:"event"}` notifications,
 * and approval/clarify questions are server requests answered with the same id.
 * The browser WebSocket and the Node wrapper installed by Electron both speak this shape.
 */

import { redactSecrets } from './protocol'
import type { GatewayEventFrame, PendingQuestion } from './protocol'
import { questionFromRequest } from './protocol'

const OPEN = 1

interface GatewayWebSocket {
  readonly readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: string, listener: (event: { data?: unknown; code?: number; reason?: string }) => void): void
}

interface GatewayWebSocketCtor {
  new (url: string, protocols?: string[]): GatewayWebSocket
}

export interface RpcHandlers {
  onEvent: (event: GatewayEventFrame) => void
  onQuestion: (question: PendingQuestion) => void
  onClose: (message: string) => void
}

export class HermesSocket {
  private socket: GatewayWebSocket | null = null
  private nextId = 1
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private opened = false

  constructor(private readonly handlers: RpcHandlers) {}

  connect(url: string, protocols: string[] = []): Promise<void> {
    this.close()
    const Ctor = (globalThis as { WebSocket?: GatewayWebSocketCtor }).WebSocket
    if (!Ctor) return Promise.reject(new Error('WebSocket is not available in this process.'))
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }
      const socket = protocols.length > 0 ? new Ctor(url, protocols) : new Ctor(url)
      this.socket = socket
      const timer = setTimeout(() => {
        fail(new Error('The gateway did not open a chat connection in time.'))
        socket.close()
      }, 12000)

      socket.addEventListener('open', () => {
        this.opened = true
        clearTimeout(timer)
        if (!settled) {
          settled = true
          resolve()
        }
        this.heartbeat = setInterval(() => {
          void this.request('gateway.ping', {}, 10000).catch(() => undefined)
        }, 15000)
      })
      socket.addEventListener('message', event => {
        const data = event.data
        this.handleText(typeof data === 'string' ? data : String(data ?? ''))
      })
      socket.addEventListener('error', () => {
        // The close event that follows carries the gateway's code and reason.
        // Failing here would replace a useful 4403/origin_mismatch with a
        // generic browser error, so let close (or the open timeout) settle it.
      })
      socket.addEventListener('close', event => {
        const why = closeMessage(event.code || 1006, event.reason || '')
        clearTimeout(timer)
        this.stopHeartbeat()
        this.rejectAll(new Error(why))
        if (!settled) fail(new Error(why))
        else if (this.socket === socket) this.handlers.onClose(why)
      })
    })
  }

  async request(method: string, params: Record<string, unknown>, timeoutMs = 120000): Promise<unknown> {
    const id = `i${this.nextId++}`
    const socket = this.socket
    if (!socket || socket.readyState !== OPEN) {
      throw new Error('Icyteru is not connected to Hermes.')
    }
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
    socket.send(frame)
    return result
  }

  respond(id: string, result: unknown): void {
    this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }

  respondError(id: string, message: string): void {
    this.socket?.send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message }
    }))
  }

  close(): void {
    this.stopHeartbeat()
    const socket = this.socket
    this.socket = null
    this.opened = false
    if (socket && socket.readyState === OPEN) socket.close()
    this.rejectAll(new Error('Disconnected.'))
  }

  get isOpen(): boolean {
    return this.opened && this.socket?.readyState === OPEN
  }

  private handleText(text: string): void {
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        continue
      }
      if (frame.method === 'event' && frame.params && typeof frame.params === 'object') {
        const params = frame.params as Record<string, unknown>
        if (typeof params.type === 'string') {
          this.handlers.onEvent({
            type: params.type,
            session_id: typeof params.session_id === 'string' ? params.session_id : undefined,
            payload: params.payload && typeof params.payload === 'object' ? params.payload as Record<string, unknown> : {},
            seq: typeof params.seq === 'number' ? params.seq : undefined,
            authority_epoch: typeof params.authority_epoch === 'number' ? params.authority_epoch : undefined,
            execution_generation: typeof params.execution_generation === 'number' ? params.execution_generation : undefined
          })
        }
        continue
      }
      const id = frame.id != null ? String(frame.id) : ''
      if (id && typeof frame.method === 'string' && !('result' in frame) && !('error' in frame)) {
        const question = questionFromRequest(id, frame.method, frame.params)
        if (question) this.handlers.onQuestion(question)
        else this.respondError(id, `Icyteru does not answer ${frame.method}.`)
        continue
      }
      if (!id || !this.pending.has(id)) continue
      const waiter = this.pending.get(id)
      if (!waiter) continue
      this.pending.delete(id)
      clearTimeout(waiter.timer)
      if (frame.error && typeof frame.error === 'object') {
        const error = frame.error as { message?: string }
        waiter.reject(new Error(error.message || 'Hermes rejected the request.'))
      } else {
        waiter.resolve(frame.result)
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.pending.clear()
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }
}

export function closeMessage(code: number, reason: string): string {
  if (code === 4401 || code === 1008) return 'Hermes refused the session token.'
  if (code === 4403 || code === 403) {
    return reason ? `Hermes refused the chat connection: ${redactSecrets(reason)}` : 'Hermes refused the chat connection.'
  }
  if (code === 1000 || code === 1001) return 'The gateway closed the connection.'
  if (reason) return redactSecrets(reason)
  if (code === 1006) return 'The chat connection dropped before Hermes answered.'
  return `The chat connection closed (${code}).`
}
