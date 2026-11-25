export type ChatActivityState = {
  /** The parent agent is still handling the current turn. */
  turnRunning: boolean
  /** Delegated children may continue after the parent turn has finished. */
  backgroundSubagentsRunning: boolean
}

/**
 * Keep foreground turn controls independent from background delegation.
 * A live child remains visible, but it must not turn Send into Stop or route a
 * new message through the foreground steer/queue menu after the parent ends.
 */
export function chatActivityState(
  transcriptStreaming: boolean,
  hasLiveSubagent: boolean
): ChatActivityState {
  return {
    turnRunning: transcriptStreaming,
    backgroundSubagentsRunning: hasLiveSubagent
  }
}
