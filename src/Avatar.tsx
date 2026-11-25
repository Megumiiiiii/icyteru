import { useEffect, useState } from 'react'

export function Avatar({ label, initial, src, size = 32 }: { label: string; initial: string; src: string; size?: number }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [src])

  if (src && !failed) {
    return <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} onError={() => setFailed(true)} />
  }
  return (
    <span className="mark" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.max(12, size * 0.42) }}>
      {initial || label.slice(0, 1).toUpperCase() || 'H'}
    </span>
  )
}
