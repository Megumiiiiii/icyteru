/**
 * Derives the image/video generation status card from the transcript.
 *
 * The card is a pure function of the messages plus the clock, so a stray
 * transcript update can never keep a finished card on screen: the hide
 * deadline comes from the tool's own `finishedAt`, not from a timer that a
 * re-render might cancel.
 */

import type { ToolCall, TranscriptMessage } from './protocol'

export type MediaGenKind = 'image' | 'video'

export interface MediaGenRun {
  id: string
  kind: MediaGenKind
  name: string
  startedAt: number | null
  finishedAt: number | null
}

export interface MediaGenCard {
  kind: MediaGenKind
  running: boolean
  progress: number
}

export interface MediaGenState {
  running: MediaGenRun | null
  finished: MediaGenRun | null
}

/** How long the "ready" card stays after a generation finishes. */
export const MEDIA_GEN_READY_MS = 3200

const VIDEO_MS = 75_000
const IMAGE_MS = 28_000

export function mediaGenKind(name: string): MediaGenKind | null {
  const n = name.toLowerCase()
  if (/(?:^|[_\-.\s/])(video[_\-\s/]?gen|gen(?:erate)?[_\-\s/]?video|text[_\-\s/]?to[_\-\s/]?video|t2v|i2v|img2vid)/.test(n)) return 'video'
  if (/(?:^|[_\-.\s/])(image[_\-\s/]?gen|gen(?:erate)?[_\-\s/]?image|text[_\-\s/]?to[_\-\s/]?image|t2i|txt2img|img2img|muse[_\-\s/]?image)/.test(n)) return 'image'
  return null
}

function toRun(tool: ToolCall): MediaGenRun | null {
  const kind = mediaGenKind(tool.name)
  if (!kind) return null
  return {
    id: tool.id,
    kind,
    name: tool.name,
    startedAt: typeof tool.startedAt === 'number' ? tool.startedAt : null,
    finishedAt: typeof tool.finishedAt === 'number' ? tool.finishedAt : null
  }
}

/** Newest in-flight generation and the newest completed one, in transcript order. */
export function findMediaGen(messages: readonly TranscriptMessage[]): MediaGenState {
  let running: MediaGenRun | null = null
  let finished: MediaGenRun | null = null
  for (const message of messages) {
    for (const tool of message.tools) {
      const run = toRun(tool)
      if (!run) continue
      if (tool.status === 'running') running = run
      else finished = run
    }
  }
  return { running, finished }
}

/** Fake but monotonic progress: an asymptote that never reaches its cap. */
export function mediaGenProgress(kind: MediaGenKind, elapsed: number, cap = 0.94): number {
  const span = kind === 'video' ? VIDEO_MS : IMAGE_MS
  const ratio = 1 - Math.exp(-Math.max(0, elapsed) / span)
  return Math.min(cap, 0.12 + ratio * 0.82)
}

/**
 * The card to render, or null. `seenAt` is the first moment a finished run was
 * observed, used when the gateway sent no `finishedAt`.
 */
export function mediaGenCard(
  state: MediaGenState,
  now: number,
  seenAt?: { id: string; at: number } | null
): MediaGenCard | null {
  if (state.running) {
    const startedAt = state.running.startedAt ?? now
    return {
      kind: state.running.kind,
      running: true,
      progress: mediaGenProgress(state.running.kind, now - startedAt)
    }
  }
  if (!state.finished) return null
  const endedAt = state.finished.finishedAt
    ?? (seenAt && seenAt.id === state.finished.id ? seenAt.at : null)
  if (endedAt === null) return null
  if (now - endedAt >= MEDIA_GEN_READY_MS) return null
  return { kind: state.finished.kind, running: false, progress: 1 }
}
