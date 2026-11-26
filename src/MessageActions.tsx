import { useEffect, useRef, useState } from 'react'
import { copyText } from './Markdown'

const REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '🔥']
const STORAGE_KEY = 'icyteru-reactions.v1'

type Store = Record<string, string>

function readStore(): Store {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Store
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // A quirk in storage must never break the transcript.
  }
}

/**
 * Copy / react controls pinned to the middle edge of a bubble: the assistant's
 * sit on its right, the user's copy sits on the left. Positions are CSS-only so
 * nothing reflows while they fade in.
 */
export function MessageActions({ id, role, text }: { id: string; role: 'user' | 'assistant'; text: string }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [reaction, setReaction] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setReaction(readStore()[id] || '')
  }, [id])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (emoji: string) => {
    const store = readStore()
    const next = reaction === emoji ? '' : emoji
    if (next) store[id] = next
    else delete store[id]
    writeStore(store)
    setReaction(next)
    setOpen(false)
  }

  return (
    <div className={`msg-actions ${role}`} ref={root}>
      <button
        className="msg-action"
        type="button"
        title={copied ? 'Copied' : 'Copy message'}
        aria-label={copied ? 'Copied' : 'Copy message'}
        onClick={() => {
          void copyText(text).then(ok => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
        }}
      >
        {copied ? '✓' : '⧉'}
      </button>
      {role === 'assistant' && (
        <button
          className="msg-action"
          type="button"
          title="Add a reaction"
          aria-label="Add a reaction"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          ☺
        </button>
      )}
      {reaction && (
        <button
          className="msg-reaction"
          type="button"
          title="Remove reaction"
          aria-label={`Remove reaction ${reaction}`}
          onClick={() => choose(reaction)}
        >
          {reaction}
        </button>
      )}
      {open && (
        <div className="msg-react-menu" role="menu" aria-label="Pick a reaction">
          {REACTIONS.map(emoji => (
            <button key={emoji} type="button" role="menuitem" onClick={() => choose(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
