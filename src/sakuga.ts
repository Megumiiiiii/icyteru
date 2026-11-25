/**
 * Optional anime/manga UI VFX layer powered by Sakuga VFX (MIT, Justin Finkelman).
 * Off by default; lazy-loads `./sakuga-core.js` only when enabled by the user.
 */

const STORAGE_KEY = 'icyteru-sakuga'

interface SakugaPalette {
  fill: string
  shade: string
  line: string
  accent: string
  ink: string
  sfx: [string, string]
}

interface SakugaFxApi {
  P: SakugaPalette
  calm: boolean
  puff: (x: number, y: number, opts?: Record<string, unknown>) => void
  burst: (x: number, y: number, opts?: Record<string, unknown>) => void
  shards: (x: number, y: number, opts?: Record<string, unknown>) => void
  splash: (x: number, y: number, opts?: Record<string, unknown>) => void
  slash: (x: number, y: number, opts?: Record<string, unknown>) => void
  lines: (x: number, y: number, opts?: Record<string, unknown>) => void
  ticks: (x: number, y: number, opts?: Record<string, unknown>) => void
  kira: (x: number, y: number, opts?: Record<string, unknown>) => void
  sfx: (name: 'don' | 'gogo' | 'kachi' | 'pon' | 'shu' | 'zuza', x: number, y: number, opts?: Record<string, unknown>) => void
  hollow: () => Record<string, unknown>
  dotted: () => Record<string, unknown>
  at: (el: Element, fx?: number, fy?: number) => { x: number; y: number; w: number; h: number }
}

declare global {
  interface Window {
    SakugaFX?: SakugaFxApi
  }
}

const PALETTES: Record<string, SakugaPalette> = {
  sakura: {
    fill: '#fff7fb',
    shade: '#f8bdd6',
    line: '#a23b68',
    accent: '#ff5fa8',
    ink: '#5c1d3a',
    sfx: ['#a23b68', '#fff7fb']
  },
  antartika: {
    fill: '#f4fbff',
    shade: '#a9d8f2',
    line: '#286c94',
    accent: '#38bdf8',
    ink: '#133b56',
    sfx: ['#1c5578', '#f4fbff']
  },
  dark: {
    fill: '#ffffff',
    shade: '#c4b5fd',
    line: '#6d5ce7',
    accent: '#f472b6',
    ink: '#1e1b4b',
    sfx: ['#1e1b4b', '#f5f3ff']
  },
  abyss: {
    fill: '#ecfeff',
    shade: '#67e8f9',
    line: '#0e7490',
    accent: '#2dd4bf',
    ink: '#083344',
    sfx: ['#083344', '#ecfeff']
  },
  kraft: {
    fill: '#fffaf0',
    shade: '#e7c49a',
    line: '#8c5527',
    accent: '#e07a2f',
    ink: '#4a2910',
    sfx: ['#6b3d17', '#fffaf0']
  },
  light: {
    fill: '#ffffff',
    shade: '#d6cbb8',
    line: '#5c5243',
    accent: '#d97757',
    ink: '#2d261e',
    sfx: ['#2d261e', '#ffffff']
  },
  'github-dark': {
    fill: '#ffffff',
    shade: '#93c5fd',
    line: '#3b82f6',
    accent: '#f472b6',
    ink: '#0f172a',
    sfx: ['#0f172a', '#ffffff']
  },
  'github-light': {
    fill: '#ffffff',
    shade: '#b8b3ff',
    line: '#5a4fd8',
    accent: '#ff5fa8',
    ink: '#1d1a4a',
    sfx: ['#1d1a4a', '#ffffff']
  }
}

let activeTheme = 'github-light'
let installed = false
let loading: Promise<SakugaFxApi | null> | null = null
let progressLoading: Promise<boolean> | null = null
let lastSliderPuff = 0

export const SAKUGA_CHANGE_EVENT = 'icyteru:sakuga-change'

export function isSakugaEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

async function ensureCore(): Promise<SakugaFxApi | null> {
  if (typeof window === 'undefined') return null
  if (window.SakugaFX) return window.SakugaFX
  if (!loading) {
    loading = import('./sakuga-core.js')
      .then(() => window.SakugaFX ?? null)
      .catch(() => null)
  }
  const fx = await loading
  if (fx) applyPalette(fx, activeTheme)
  return fx
}

export async function ensureSakugaProgress(): Promise<boolean> {
  const fx = await ensureCore()
  if (!fx) return false
  if (typeof customElements !== 'undefined' && customElements.get('sakuga-progress')) return true
  if (!progressLoading) {
    progressLoading = import('./sakuga-progress.js')
      .then(mod => {
        mod.registerSakugaProgress()
        return Boolean(customElements.get('sakuga-progress'))
      })
      .catch(() => false)
  }
  return progressLoading
}

function applyPalette(fx: SakugaFxApi, mode: string): void {
  const palette = PALETTES[mode] || PALETTES['github-light']
  fx.P.fill = palette.fill
  fx.P.shade = palette.shade
  fx.P.line = palette.line
  fx.P.accent = palette.accent
  fx.P.ink = palette.ink
  fx.P.sfx = [...palette.sfx] as [string, string]
  if (typeof document !== 'undefined') {
    const root = document.documentElement.style
    root.setProperty('--sk-card', palette.fill)
    root.setProperty('--sk-ink', palette.ink)
    root.setProperty('--sk-soft', palette.shade)
    root.setProperty('--sk-acc', palette.accent)
    root.setProperty('--sk-fill', palette.accent)
  }
}

export function syncSakugaPalette(mode: string): void {
  activeTheme = mode
  if (typeof window !== 'undefined' && window.SakugaFX) {
    applyPalette(window.SakugaFX, mode)
  }
}

function handleClick(event: MouseEvent): void {
  const fx = window.SakugaFX
  if (!fx || fx.calm) return
  const target = event.target instanceof Element ? event.target.closest('button, a') : null
  if (!target || (target as HTMLButtonElement).disabled) return

  const pos = fx.at(target, 0.5, 0.5)
  const x = event.clientX ? event.clientX + window.scrollX : pos.x
  const y = event.clientY ? event.clientY + window.scrollY : pos.y

  if (target.closest('.theme-choices')) {
    fx.splash(pos.x, pos.y + pos.h * 0.2, { w: Math.min(48, pos.w * 0.6), h: 20, life: 0.55 })
    fx.kira(pos.x + pos.w * 0.35, pos.y - pos.h * 0.35, { r: 9 })
    fx.sfx('pon', pos.x, pos.y - pos.h * 0.85, { size: 44, ...fx.hollow() })
    return
  }

  if (target.closest('.pane-switch') || target.classList.contains('auth-tab')) {
    fx.puff(pos.x, pos.y, { n: 4, size: 9, vy: -14, life: 0.55 })
    fx.ticks(pos.x, pos.y, { n: 3, r: 14, len: 8, dir: -Math.PI / 2, life: 0.35 })
    fx.sfx('kachi', pos.x, pos.y - pos.h * 0.8, { size: 44, ...fx.hollow() })
    return
  }

  if (target.classList.contains('pin-button') || target.classList.contains('session-pin')) {
    fx.kira(pos.x, pos.y, { r: 11, life: 0.55 })
    fx.ticks(pos.x, pos.y, { n: 4, r: 10, len: 8, dir: -0.8, fan: 0.65, life: 0.35 })
    fx.sfx('pon', pos.x - 10, pos.y - 22, { size: 40, ...fx.hollow() })
    return
  }

  if (target.closest('.session-rename-form') && (target as HTMLButtonElement).type === 'submit') {
    fx.slash(pos.x, pos.y, { len: 74, ang: -0.45, thick: 11, life: 0.36 })
    fx.shards(pos.x, pos.y, { n: 5, speed: 150, size: 4, life: 0.55 })
    fx.sfx('zuza', pos.x - 12, pos.y - 24, { size: 44, ...fx.dotted() })
    return
  }

  if (target.classList.contains('send') || target.classList.contains('solid')) {
    fx.burst(pos.x, pos.y, { r: Math.min(44, Math.max(26, pos.w * 0.45)), spikes: 11, life: 0.32 })
    fx.puff(pos.x - pos.w * 0.3, pos.y, { n: 4, size: 10, vx: -24, vy: -12, life: 0.6 })
    fx.puff(pos.x + pos.w * 0.3, pos.y, { n: 4, size: 10, vx: 24, vy: -12, life: 0.6 })
    fx.sfx(target.classList.contains('send') ? 'shu' : 'don', pos.x, pos.y - pos.h * 0.85, { size: 50 })
    return
  }

  if (target.classList.contains('ghost') || target.classList.contains('top-action') || target.classList.contains('icon-button')) {
    fx.puff(x, y, { n: 3, size: 7, vy: -10, life: 0.45 })
    fx.ticks(x, y, { n: 3, r: 10, len: 7, dir: -Math.PI / 2, life: 0.32 })
    return
  }

  if (target.classList.contains('session') || target.classList.contains('bot-main')) {
    fx.lines(x, y, { n: 4, dir: 0, len: 28, spread: 12, life: 0.24 })
    fx.kira(x + 12, y - 6, { r: 7, life: 0.4 })
  }
}

function handleInput(event: Event): void {
  const fx = window.SakugaFX
  if (!fx || fx.calm) return
  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.type !== 'range') return
  const now = performance.now()
  if (now - lastSliderPuff < 110) return
  lastSliderPuff = now
  const min = Number(target.min || 0)
  const max = Number(target.max || 100)
  const val = Number(target.value || 0)
  const ratio = max > min ? (val - min) / (max - min) : 0.5
  const pos = fx.at(target, ratio, 0.5)
  fx.puff(pos.x, pos.y - 4, { n: 3, size: 7, vy: -14, life: 0.45 })
}

function handleChange(event: Event): void {
  const fx = window.SakugaFX
  if (!fx || fx.calm) return
  const target = event.target
  if (!(target instanceof HTMLInputElement) || target.type !== 'range') return
  const min = Number(target.min || 0)
  const max = Number(target.max || 100)
  const val = Number(target.value || 0)
  const ratio = max > min ? (val - min) / (max - min) : 0.5
  const pos = fx.at(target, ratio, 0.5)
  fx.ticks(pos.x, pos.y, { n: 3, r: 10, len: 8, dir: -Math.PI / 2, life: 0.35 })
}

function attachListeners(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('click', handleClick, true)
  document.addEventListener('input', handleInput, true)
  document.addEventListener('change', handleChange, true)
}

function detachListeners(): void {
  if (!installed || typeof document === 'undefined') return
  installed = false
  document.removeEventListener('click', handleClick, true)
  document.removeEventListener('input', handleInput, true)
  document.removeEventListener('change', handleChange, true)
}

export function initSakuga(themeMode: string): void {
  activeTheme = themeMode
  const enabled = isSakugaEnabled()
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.sakuga = enabled ? '1' : '0'
  }
  if (enabled) {
    attachListeners()
    void ensureCore()
  } else {
    detachListeners()
  }
}

export async function setSakugaEnabled(enabled: boolean, anchorEl?: HTMLElement | null): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Ignore storage quota/private mode errors.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.sakuga = enabled ? '1' : '0'
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SAKUGA_CHANGE_EVENT, { detail: enabled }))
  }
  if (!enabled) {
    detachListeners()
    return false
  }
  attachListeners()
  const fx = await ensureCore()
  if (fx && !fx.calm && anchorEl) {
    const pos = fx.at(anchorEl, 0.5, 0.5)
    fx.burst(pos.x, pos.y, { r: 42, spikes: 13, life: 0.36 })
    fx.puff(pos.x - 24, pos.y, { n: 4, size: 11, vx: -28, vy: -14, life: 0.65 })
    fx.puff(pos.x + 24, pos.y, { n: 4, size: 11, vx: 28, vy: -14, life: 0.65 })
    fx.sfx('don', pos.x, pos.y - 34, { size: 58 })
  }
  return true
}
