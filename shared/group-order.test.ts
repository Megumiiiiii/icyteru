import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_GROUP_ORDER, normalizeGroupOrder, reorderGroups } from './group-order'

test('group order keeps custom labels and appends new default groups', () => {
  assert.deepEqual(normalizeGroupOrder(['Jobs', 'Telegram']), [
    'Jobs', 'Telegram', 'Discord', 'Slack', 'WhatsApp', 'Signal',
    'Schedule', 'Desktop', 'Local', 'API', 'Editor'
  ])
  assert.deepEqual(normalizeGroupOrder('not an array'), DEFAULT_GROUP_ORDER)
})

test('group reorder moves a source before or after the target', () => {
  const order = ['Telegram', 'Schedule', 'Desktop', 'Jobs']
  assert.deepEqual(reorderGroups(order, 'Jobs', 'Telegram', false), ['Jobs', 'Telegram', 'Schedule', 'Desktop'])
  assert.deepEqual(reorderGroups(order, 'Telegram', 'Desktop', true), ['Schedule', 'Desktop', 'Telegram', 'Jobs'])
  assert.deepEqual(reorderGroups(order, 'Telegram', 'Telegram', true), order)
  assert.deepEqual(reorderGroups(order, 'Telegram', 'Missing', true), order)
})
