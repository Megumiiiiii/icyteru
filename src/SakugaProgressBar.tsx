import { useEffect, useRef, useState } from 'react'
import { ensureSakugaProgress, isSakugaEnabled, SAKUGA_CHANGE_EVENT } from './sakuga'

interface SakugaProgressElement extends HTMLElement {
  set?: (value: number, instant?: boolean) => void
  reset?: () => void
}

export function useSakugaEnabled(): boolean {
  const [enabled, setEnabled] = useState(isSakugaEnabled)
  useEffect(() => {
    const sync = () => setEnabled(isSakugaEnabled())
    window.addEventListener(SAKUGA_CHANGE_EVENT, sync)
    return () => window.removeEventListener(SAKUGA_CHANGE_EVENT, sync)
  }, [])
  return enabled
}

export function SakugaProgressBar({ value, label, doneLabel = 'Complete ✓' }: {
  value: number
  label: string
  doneLabel?: string
}) {
  const ref = useRef<SakugaProgressElement | null>(null)
  const [ready, setReady] = useState(() => typeof customElements !== 'undefined' && Boolean(customElements.get('sakuga-progress')))

  useEffect(() => {
    if (ready) return
    let cancelled = false
    void ensureSakugaProgress().then(ok => {
      if (!cancelled && ok) setReady(true)
    })
    return () => { cancelled = true }
  }, [ready])

  useEffect(() => {
    if (!ready || !ref.current?.set) return
    ref.current.set(Math.min(1, Math.max(0, value)))
  }, [ready, value])

  return (
    <div className="sakuga-progress-wrap">
      {/* @ts-expect-error custom element registered lazily by sakuga-progress.js */}
      <sakuga-progress ref={ref} label={label} done-label={doneLabel} />
    </div>
  )
}
