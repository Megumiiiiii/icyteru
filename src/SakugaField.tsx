import { useEffect, useRef, useState } from 'react'
import { ensureSakugaElement, sakugaElementReady } from './sakuga-ui'

/**
 * A single-line field that becomes <sakuga-input> once Sakuga mode is on and the
 * element has upgraded. Before that (or with the mode off) it is a plain input,
 * so nothing flickers and forms keep working.
 */
export function SakugaField({ value, onChange, placeholder, label, type = 'text', disabled = false, className }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  type?: 'text' | 'password' | 'email' | 'search' | 'url' | 'tel'
  disabled?: boolean
  className?: string
}) {
  const [ready, setReady] = useState(() => sakugaElementReady('sakuga-input'))
  const ref = useRef<HTMLElement & { value: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void ensureSakugaElement('sakuga-input').then(ok => {
      if (!cancelled) setReady(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const node = ref.current
    if (node && node.value !== value) node.value = value
  }, [value, ready])

  if (!ready) {
    return (
      <input
        className={className}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
      />
    )
  }

  return (
    <sakuga-input
      ref={node => {
        ref.current = node as unknown as HTMLElement & { value: string } | null
      }}
      type={type}
      placeholder={placeholder}
      label={label}
      disabled={disabled}
      onInput={event => onChange((event.target as unknown as { value: string }).value)}
    />
  )
}
