import assert from 'node:assert/strict'
import test from 'node:test'

import { autoFocusSearch, findModelChoiceIndex, providersMatch } from './model-choice'
import type { ModelChoice } from './protocol'

const models: ModelChoice[] = [
  { id: 'deepseek-v4.1-flash', label: 'deepseek-v4.1-flash', provider: 'Nous Portal', providerId: 'nous' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'deepseek-v4.1-flash', provider: 'CommandCode', providerId: 'commandcode' },
  { id: 'grok-4.7', label: 'grok-4.7', provider: 'OpenRouter', providerId: 'openrouter' }
]

test('matches provider ids and friendly labels tolerantly', () => {
  assert.equal(providersMatch('CommandCode', 'commandcode'), true)
  assert.equal(providersMatch('custom:openrouter', 'openrouter'), true)
  assert.equal(providersMatch('Nous Portal', 'commandcode'), false)
})

test('finds a duplicate model id under the authoritative provider', () => {
  assert.equal(findModelChoiceIndex(models, 'deepseek-v4.1-flash', 'nous'), 0)
  assert.equal(findModelChoiceIndex(models, 'deepseek-v4.1-flash', 'CommandCode'), 1)
})

test('falls back predictably when the model or provider is missing', () => {
  assert.equal(findModelChoiceIndex(models, 'deepseek-v4.1-flash', ''), 0)
  assert.equal(findModelChoiceIndex(models, 'missing', 'openrouter'), 0)
  assert.equal(findModelChoiceIndex([], 'missing', 'openrouter'), -1)
})

test('the model search box only grabs focus where no soft keyboard exists', () => {
  assert.equal(autoFocusSearch('android'), false)
  assert.equal(autoFocusSearch('web'), true)
  assert.equal(autoFocusSearch('electron'), true)
})
