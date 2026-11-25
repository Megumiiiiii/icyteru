import { Channel, invoke } from '@tauri-apps/api/core'

type SocketEvent = { data?: unknown; code?: number; reason?: string }
type Listener = (event: SocketEvent) => void

type WsFrame =
  | { kind: 'open'; id?: number }
  | { kind: 'text'; data: string }
  | { kind: 'close'; code: number; reason: string }
  | { kind: 'error'; message: string }

class TauriWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = TauriWebSocket.CONNECTING
  private id: number | null = null
  private terminal = false
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(url: string | URL, protocols?: string | string[]) {
    const channel = new Channel<WsFrame>()
    channel.onmessage = frame => this.handle(frame)
    const selected = typeof protocols === 'string' ? [protocols] : protocols ?? []
    void invoke<number>('ws_open', {
      url: String(url),
      protocols: selected,
      onFrame: channel
    }).then(id => {
      this.id = id
      if (this.readyState === TauriWebSocket.CLOSING) void invoke('ws_close', { id })
    }).catch(error => {
      if (this.terminal) return
      this.emit('error', {})
      this.finish(1006, error instanceof Error ? error.message : String(error))
    })
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    if (this.readyState !== TauriWebSocket.OPEN || this.id == null) {
      throw new DOMException('WebSocket is not open.', 'InvalidStateError')
    }
    void invoke('ws_send', { id: this.id, data }).catch(() => {
      this.emit('error', {})
      this.finish(1006, 'The gateway connection dropped.')
    })
  }

  close(): void {
    if (this.readyState === TauriWebSocket.CLOSING || this.readyState === TauriWebSocket.CLOSED) return
    this.readyState = TauriWebSocket.CLOSING
    if (this.id != null) void invoke('ws_close', { id: this.id })
  }

  private handle(frame: WsFrame): void {
    if (this.terminal) return
    if (frame.kind === 'open') {
      if (this.id == null && typeof frame.id === 'number') this.id = frame.id
      if (this.readyState === TauriWebSocket.CLOSING) {
        if (this.id != null) void invoke('ws_close', { id: this.id })
        return
      }
      this.readyState = TauriWebSocket.OPEN
      this.emit('open', {})
      return
    }
    if (frame.kind === 'text') {
      this.emit('message', { data: frame.data })
      return
    }
    if (frame.kind === 'error') {
      this.emit('error', {})
      return
    }
    this.finish(frame.code, frame.reason)
  }

  private finish(code: number, reason: string): void {
    if (this.terminal) return
    this.terminal = true
    this.readyState = TauriWebSocket.CLOSED
    this.emit('close', { code, reason })
  }

  private emit(type: string, event: SocketEvent): void {
    this.listeners.get(type)?.forEach(listener => listener(event))
  }
}

export function installNativeWebSocket(): void {
  ;(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = TauriWebSocket as unknown as typeof WebSocket
}
