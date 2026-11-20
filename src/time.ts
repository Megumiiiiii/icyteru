export function ago(value: number | null): string {
  if (value == null) return ''
  const ms = value > 1e12 ? value : value * 1000
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

export function isRecent(value: number | null, windowMs = 5 * 60 * 1000): boolean {
  if (value == null) return false
  const ms = value > 1e12 ? value : value * 1000
  return Date.now() - ms < windowMs
}
