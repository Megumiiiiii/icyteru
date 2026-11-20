/**
 * Electron's main process is Node, which does not ship a browser WebSocket.
 * This wrapper lets the shared gateway client use the same call shape on desktop and Android.
 */
import WS from 'ws'

class NodeWebSocket {
  readyState = 0
  private readonly socket: WS
  private readonly listeners = new Map<string, Set<(event: { data?: unknown; code?: number; reason?: string }) => void>>()

  constructor(url: string, protocols?: string[]) {
    this.socket = protocols && protocols.length > 0 ? new WS(url, protocols) : new WS(url)
    this.readyState = this.socket.readyState
    this.socket.on('open', () => {
      this.readyState = WS.OPEN
      this.emit('open', {})
    })
    this.socket.on('message', data => {
      this.emit('message', { data: typeof data === 'string' ? data : data.toString() })
    })
    this.socket.on('error', () => {
      this.emit('error', {})
    })
    this.socket.on('close', (code, reason) => {
      this.readyState = WS.CLOSED
      this.emit('close', { code, reason: reason.toString() })
    })
  }

  addEventListener(type: string, listener: (event: { data?: unknown; code?: number; reason?: string }) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  send(data: string): void {
    this.socket.send(data)
  }

  close(): void {
    this.socket.close()
  }

  private emit(type: string, event: { data?: unknown; code?: number; reason?: string }): void {
    this.listeners.get(type)?.forEach(listener => listener(event))
  }
}

export function installNodeWebSocket(): void {
  const current = (globalThis as { WebSocket?: unknown }).WebSocket
  if (typeof current === 'function') return
  ;(globalThis as { WebSocket?: unknown }).WebSocket = NodeWebSocket
}
