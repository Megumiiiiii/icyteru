/**
 * Loader + glue for the vendored Sakuga UI components (button, input, toast).
 * Everything is lazy: nothing here downloads until Sakuga mode is on, and a
 * failure quietly leaves the plain React controls in place.
 */
import { isSakugaEnabled } from './sakuga'

type SakugaTag = 'sakuga-button' | 'sakuga-input' | 'sakuga-textarea' | 'sakuga-toast'

const loaders: Record<SakugaTag, () => Promise<unknown>> = {
  'sakuga-button': () => import('./sakuga-button.js'),
  'sakuga-input': () => import('./sakuga-input.js'),
  'sakuga-textarea': () => import('./sakuga-textarea.js'),
  'sakuga-toast': () => import('./sakuga-toast.js')
}

const pending = new Map<SakugaTag, Promise<boolean>>()

export function sakugaElementReady(tag: SakugaTag): boolean {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return false
  return Boolean(customElements.get(tag))
}

export async function ensureSakugaElement(tag: SakugaTag): Promise<boolean> {
  if (typeof window === 'undefined' || !isSakugaEnabled()) return false
  if (sakugaElementReady(tag)) return true
  const running = pending.get(tag)
  if (running) return running
  const task = (async () => {
    await import('./sakuga-core.js')
    if (!window.SakugaFX) return false
    await loaders[tag]()
    return sakugaElementReady(tag)
  })().catch(() => false)
  pending.set(tag, task)
  return task
}

interface SakugaToastElement extends HTMLElement {
  show(text?: string): void
  hide(): void
}

let toastHost: SakugaToastElement | null = null

/** Same message, but as a Sakuga toast. Returns false when it is not available. */
export async function showSakugaToast(text: string): Promise<boolean> {
  if (!(await ensureSakugaElement('sakuga-toast'))) return false
  try {
    if (!toastHost || !toastHost.isConnected) {
      toastHost = document.createElement('sakuga-toast') as SakugaToastElement
      toastHost.style.position = 'fixed'
      toastHost.style.left = '22px'
      toastHost.style.bottom = '22px'
      toastHost.style.zIndex = '2147483001'
      document.body.appendChild(toastHost)
    }
    toastHost.show(text)
    return true
  } catch {
    return false
  }
}

/**
 * The send button plays its burst on a real click. Enter submits the composer
 * without one, so play the same effect by hand or the key looks dead while
 * every other button pops.
 */
export function playSendEffect(anchor: Element | null): void {
  const fx = window.SakugaFX
  if (!fx || fx.calm || !anchor || !isSakugaEnabled()) return
  const pos = fx.at(anchor, 0.5, 0.5)
  fx.burst(pos.x, pos.y, { r: Math.min(44, Math.max(26, pos.w * 0.45)), spikes: 11, life: 0.32 })
  fx.puff(pos.x - pos.w * 0.3, pos.y, { n: 4, size: 10, vx: -24, vy: -12, life: 0.6 })
  fx.puff(pos.x + pos.w * 0.3, pos.y, { n: 4, size: 10, vx: 24, vy: -12, life: 0.6 })
  fx.sfx('shu', pos.x, pos.y - pos.h * 0.85, { size: 50 })
}
