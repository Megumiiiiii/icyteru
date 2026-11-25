import assert from 'node:assert/strict'
import test from 'node:test'
import { chatActivityState } from './chat-activity'

test('a live background subagent does not keep the foreground turn running', () => {
  assert.deepEqual(chatActivityState(false, true), {
    turnRunning: false,
    backgroundSubagentsRunning: true
  })
})

test('foreground streaming still exposes the running turn controls', () => {
  assert.deepEqual(chatActivityState(true, false), {
    turnRunning: true,
    backgroundSubagentsRunning: false
  })
})

test('foreground and delegated work can both be active', () => {
  assert.deepEqual(chatActivityState(true, true), {
    turnRunning: true,
    backgroundSubagentsRunning: true
  })
})
