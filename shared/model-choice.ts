import { modelIdsMatch, type ModelChoice } from './protocol'

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

/** Provider ids and display names can differ only by case or a friendly suffix. */
export function providersMatch(left: string, right: string): boolean {
  const a = normalized(left)
  const b = normalized(right)
  if (!a || !b) return !a && !b
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * Resolve a model from both its id and provider. The inventory can contain the
 * same model id under several providers, so id-only selection is ambiguous.
 */
export function findModelChoiceIndex(
  models: readonly ModelChoice[],
  modelId: string,
  provider: string
): number {
  const candidates = models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => modelIdsMatch(model.id, modelId))
  if (candidates.length === 0) return models.length > 0 ? 0 : -1
  if (!provider) return candidates[0].index
  const exact = candidates.find(({ model }) =>
    providersMatch(model.providerId || model.provider, provider) ||
    providersMatch(model.provider, provider)
  )
  return exact?.index ?? candidates[0].index
}

/**
 * Android raises the soft keyboard for a programmatically focused input, which
 * hides half the model list as soon as the picker opens. Focus the search box
 * on desktop only and let a tap on Android bring up the keyboard.
 */
export function autoFocusSearch(platform: string): boolean {
  return platform !== 'android'
}
