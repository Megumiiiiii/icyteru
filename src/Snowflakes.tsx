import type { CSSProperties } from 'react'

type Flake = {
  left: string
  size: number
  delay: number
  duration: number
  sway: number
  spin: number
  opacity: number
}

const FLAKES: Flake[] = Array.from({ length: 28 }, (_, index) => ({
  left: `${4 + (index * 29) % 92}%`,
  size: 8 + (index * 7) % 14,
  delay: -(index % 20) - 1,
  duration: 14 + (index % 10),
  sway: (index % 2 === 0 ? 1 : -1) * (10 + (index * 4) % 30),
  spin: 180 + (index * 37) % 360,
  opacity: 0.45 + ((index * 5) % 40) / 100
}))

/** Light snow drifting over the Antartika backdrop; purely decorative. */
export function Snowflakes() {
  return (
    <div className="snowfall" aria-hidden="true">
      {FLAKES.map((flake, index) => (
        <i
          key={index}
          className="snowflake"
          style={{
            left: flake.left,
            width: flake.size,
            height: flake.size,
            animationDelay: `${flake.delay}s`,
            animationDuration: `${flake.duration}s`,
            '--sway': `${flake.sway}px`,
            '--spin': `${flake.spin}deg`,
            '--flake-opacity': flake.opacity
          } as CSSProperties}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
            <path d="M12 2v20M2 12h20M4.8 4.8l14.4 14.4M19.2 4.8L4.8 19.2" />
            <path d="M12 5.2 9.7 3M12 5.2 14.3 3M12 18.8l-2.3 2.2M12 18.8l2.3 2.2M5.2 12 3 9.7M5.2 12 3 14.3M18.8 12l2.2-2.3M18.8 12l2.2 2.3" />
          </svg>
        </i>
      ))}
    </div>
  )
}
