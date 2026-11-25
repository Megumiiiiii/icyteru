import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MEDIA_GEN_READY_MS,
  findMediaGen,
  mediaGenCard,
  mediaGenKind,
  mediaGenProgress
} from './media-gen'
import type { ToolCall, TranscriptMessage } from './protocol'

function tool(over: Partial<ToolCall> & { id: string; name: string }): ToolCall {
  return {
    argsText: '',
    resultText: '',
    status: 'running',
    ...over
  }
}

function turn(tools: ToolCall[], text = ''): TranscriptMessage {
  return { id: `m-${tools.map(item => item.id).join('-')}`, role: 'assistant', text, tools, pending: false }
}

test('recognizes the image and video generation tool names the gateway sends', () => {
  assert.equal(mediaGenKind('image_generate'), 'image')
  assert.equal(mediaGenKind('video_generate'), 'video')
  assert.equal(mediaGenKind('muse_image_generate'), 'image')
  assert.equal(mediaGenKind('generate_image'), 'image')
  assert.equal(mediaGenKind('generate_video'), 'video')
  assert.equal(mediaGenKind('text_to_video'), 'video')
  assert.equal(mediaGenKind('image/generate'), 'image')
  assert.equal(mediaGenKind('IMAGE_GENERATE'), 'image')
  for (const other of ['terminal', 'memory', 'image_analyze', 'video_analyze', 'delegate_task', 'image', 'generate']) {
    assert.equal(mediaGenKind(other), null, other)
  }
})

test('finds the newest running and newest finished generation', () => {
  const messages = [
    turn([tool({ id: 'old', name: 'image_generate', status: 'done', startedAt: 1, finishedAt: 2 })]),
    turn([tool({ id: 'live', name: 'video_generate', startedAt: 3 })]),
    turn([tool({ id: 'noise', name: 'terminal', status: 'done' })])
  ]
  const state = findMediaGen(messages)
  assert.equal(state.running?.id, 'live')
  assert.equal(state.running?.kind, 'video')
  assert.equal(state.finished?.id, 'old')
  assert.equal(state.finished?.kind, 'image')
})

test('progress grows toward its cap and video is slower than image', () => {
  const at10 = mediaGenProgress('image', 10_000)
  assert.ok(at10 > 0.12 && at10 < 0.94)
  assert.ok(mediaGenProgress('image', 60_000) > at10)
  assert.ok(mediaGenProgress('image', 60_000) <= 0.94)
  assert.ok(mediaGenProgress('video', 10_000) < at10)
})

test('a running generation keeps the card while it is in flight', () => {
  const state = findMediaGen([turn([tool({ id: 'live', name: 'image_generate', startedAt: 1_000 })])])
  const card = mediaGenCard(state, 11_000)
  assert.equal(card?.kind, 'image')
  assert.equal(card?.running, true)
  assert.ok((card?.progress ?? 0) > 0.12)
})

test('the ready card hides by time even when later transcript updates arrive', () => {
  const finishedAt = 5_000
  const state = findMediaGen([turn([tool({ id: 'gen', name: 'image_generate', status: 'done', startedAt: 1_000, finishedAt })])])
  assert.equal(mediaGenCard(state, finishedAt + 500)?.running, false)
  // A later assistant message (the usual case right after the tool) must not extend the window.
  const later = findMediaGen([
    turn([tool({ id: 'gen', name: 'image_generate', status: 'done', startedAt: 1_000, finishedAt })], 'Gambarnya sudah jadi.'),
    turn([], 'Mau lagi?')
  ])
  assert.equal(mediaGenCard(later, finishedAt + 500)?.running, false)
  assert.equal(mediaGenCard(later, finishedAt + 2_000)?.running, false)
  assert.equal(mediaGenCard(later, finishedAt + MEDIA_GEN_READY_MS - 1)?.running, false)
  assert.equal(mediaGenCard(later, finishedAt + MEDIA_GEN_READY_MS), null)
  assert.equal(mediaGenCard(later, finishedAt + 60_000), null)
})

test('a run without finishedAt uses the first time it was seen', () => {
  const state = findMediaGen([turn([tool({ id: 'gen', name: 'video_generate', status: 'done', startedAt: 1_000 })])])
  const seenAt = { id: 'gen', at: 9_000 }
  assert.equal(mediaGenCard(state, 9_500, seenAt)?.running, false)
  assert.equal(mediaGenCard(state, 9_000 + MEDIA_GEN_READY_MS, seenAt), null)
  assert.equal(mediaGenCard(state, 9_500, null), null)
})

test('a failed generation never shows a ready card', () => {
  const failed = findMediaGen([turn([tool({ id: 'gen', name: 'image_generate', status: 'done', startedAt: 1_000 })])])
  const ready = mediaGenCard(failed, 1_500, { id: 'gen', at: 1_400 })
  assert.equal(ready?.running, false)
  // An error leaves no finishedAt and no running row, so nothing lingers.
  const errored = { running: null, finished: { id: 'gen', kind: 'image' as const, name: 'image_generate', startedAt: 1_000, finishedAt: null } }
  assert.equal(mediaGenCard(errored, 1_500, { id: 'other', at: 1_400 }), null)
})
