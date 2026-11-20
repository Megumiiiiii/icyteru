import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export type BackdropMode = 'light' | 'dark'

export interface Appearance {
  dim: number
  blur: number
  light: string | null
  dark: string | null
}

const MAX_BYTES = 8 * 1024 * 1024

function folder(): string {
  return path.join(app.getPath('userData'), 'backgrounds')
}

function metaPath(): string {
  return path.join(folder(), 'appearance.json')
}

export function loadAppearance(): Appearance {
  const meta = readMeta()
  return { dim: meta.dim, blur: meta.blur, light: readImage('light'), dark: readImage('dark') }
}

export function saveBackdrop(dim: number, blur: number): Appearance {
  fs.mkdirSync(folder(), { recursive: true })
  fs.writeFileSync(metaPath(), JSON.stringify({
    dim: clamp(dim, 0, 0.75, 0.4),
    blur: clamp(blur, 0, 28, 12)
  }))
  return loadAppearance()
}

export function saveBackground(mode: BackdropMode, base64: string): Appearance {
  const bytes = decodeImage(base64)
  const kind = sniff(bytes)
  if (!kind) throw new Error('Use a PNG, JPEG, or WebP image.')
  if (bytes.length > MAX_BYTES) throw new Error('That image is larger than 8 MB.')
  fs.mkdirSync(folder(), { recursive: true })
  clearFiles(mode)
  fs.writeFileSync(path.join(folder(), `${mode}.${kind}`), bytes)
  return loadAppearance()
}

export function clearBackground(mode: BackdropMode): Appearance {
  clearFiles(mode)
  return loadAppearance()
}

function readMeta(): { dim: number; blur: number } {
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath(), 'utf8')) as { dim?: unknown; blur?: unknown }
    return { dim: clamp(parsed.dim, 0, 0.75, 0.22), blur: clamp(parsed.blur, 0, 28, 10) }
  } catch {
    return { dim: 0.22, blur: 10 }
  }
}

function readImage(mode: BackdropMode): string | null {
  for (const ext of ['png', 'jpg', 'webp'] as const) {
    const file = path.join(folder(), `${mode}.${ext}`)
    if (!fs.existsSync(file)) continue
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp'
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
  }
  return null
}

function clearFiles(mode: BackdropMode): void {
  for (const ext of ['png', 'jpg', 'webp']) {
    const file = path.join(folder(), `${mode}.${ext}`)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
}

function decodeImage(value: string): Buffer {
  const trimmed = value.trim()
  const data = trimmed.includes(',') ? trimmed.slice(trimmed.indexOf(',') + 1) : trimmed
  return Buffer.from(data, 'base64')
}

function sniff(bytes: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}
