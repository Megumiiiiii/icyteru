/** Persisted group order for the history pane (Telegram, Schedule, Jobs, …). */
export const GROUP_ORDER_KEY = 'icyteru.group-order.v1'

export const DEFAULT_GROUP_ORDER = [
  'Telegram', 'Discord', 'Slack', 'WhatsApp', 'Signal',
  'Schedule', 'Desktop', 'Jobs', 'Local', 'API', 'Editor'
]

/** Keep stored labels first, then append defaults so a new source appears at the end. */
export function normalizeGroupOrder(stored: unknown): string[] {
  const labels = Array.isArray(stored)
    ? stored.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
  return [...new Set([...labels, ...DEFAULT_GROUP_ORDER])]
}

/** Move `source` before/after `target`, preserving every other label. */
export function reorderGroups(order: string[], source: string, target: string, after: boolean): string[] {
  if (source === target) return order
  const next = order.filter(label => label !== source)
  const at = next.indexOf(target)
  if (at < 0) return order
  next.splice(at + (after ? 1 : 0), 0, source)
  return next
}
