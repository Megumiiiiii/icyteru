import type { CSSProperties } from 'react'

type Petal = {
  left: string
  size: number
  delay: number
  duration: number
  sway: number
  opacity: number
  tilt: number
}

const PETALS: Petal[] = Array.from({ length: 26 }, (_, index) => ({
  left: `${3 + (index * 17) % 94}%`,
  size: 18 + (index * 5) % 17,
  delay: -(index % 18) - 1,
  duration: 13 + (index % 9),
  sway: (index % 2 === 0 ? 1 : -1) * (14 + (index * 5) % 26),
  opacity: 0.68 + ((index * 3) % 22) / 100,
  tilt: (index * 13) % 50 - 25
}))

/** A quiet fall of sakura petals and a few distant blossoms; purely decorative and pointer-transparent. */
export function SakuraPetals() {
  return (
    <div className="sakura-petals">
      {BLOSSOMS.map((blossom, index) => (
        <svg
          key={`blossom-${index}`}
          className="sakura-blossom"
          viewBox="0 0 100 100"
          aria-hidden="true"
          style={{
            left: blossom.left,
            top: blossom.top,
            width: blossom.size,
            height: blossom.size,
            animationDelay: `${blossom.delay}s`,
            '--blossom-opacity': blossom.opacity
          } as CSSProperties}
        >
          {[0, 1, 2, 3, 4].map(petal => (
            <ellipse
              key={petal}
              cx="50"
              cy="27"
              rx="17"
              ry="25"
              fill="rgba(255, 228, 241, 0.92)"
              stroke="rgba(214, 99, 145, 0.28)"
              strokeWidth="1.2"
              transform={`rotate(${petal * 72} 50 50)`}
            />
          ))}
          <circle cx="50" cy="50" r="7.5" fill="#f4c95d" />
          <circle cx="47" cy="48" r="1.4" fill="#c9972f" />
          <circle cx="53" cy="52" r="1.4" fill="#c9972f" />
        </svg>
      ))}
      {PETALS.map((petal, index) => (
        <i
          key={index}
          style={{
            left: petal.left,
            width: petal.size,
            height: petal.size * 0.72,
            animationDelay: `${petal.delay}s`,
            animationDuration: `${petal.duration}s`,
            '--petal-opacity': petal.opacity,
            '--sway': `${petal.sway}px`,
            '--tilt': `${petal.tilt}deg`
          } as CSSProperties}
        />
      ))}
    </div>
  )
}

const BLOSSOMS = [
  { left: '9%', top: '22%', size: 54, opacity: 0.3, delay: -4 },
  { left: '82%', top: '64%', size: 42, opacity: 0.24, delay: -1 },
  { left: '72%', top: '13%', size: 30, opacity: 0.18, delay: -6 },
  { left: '28%', top: '78%', size: 34, opacity: 0.2, delay: -8 }
]
