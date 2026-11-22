/** Three depth layers of CSS stars plus a few soft glow stars, matching the portfolio night sky. */
const STARS = [
  { left: 7, top: 16, size: 3, delay: 0.2 },
  { left: 13, top: 68, size: 2, delay: 1.1 },
  { left: 19, top: 37, size: 4, delay: 2.4 },
  { left: 25, top: 82, size: 2, delay: 0.7 },
  { left: 31, top: 12, size: 3, delay: 3.1 },
  { left: 37, top: 57, size: 2, delay: 1.8 },
  { left: 43, top: 29, size: 4, delay: 0.4 },
  { left: 49, top: 74, size: 2, delay: 2.7 },
  { left: 55, top: 44, size: 3, delay: 1.4 },
  { left: 61, top: 9, size: 2, delay: 3.6 },
  { left: 67, top: 63, size: 3, delay: 0.9 },
  { left: 73, top: 35, size: 2, delay: 2.1 },
  { left: 79, top: 79, size: 4, delay: 1.6 },
  { left: 85, top: 22, size: 3, delay: 0.5 },
  { left: 91, top: 54, size: 2, delay: 2.9 },
  { left: 11, top: 91, size: 2, delay: 1.3 },
  { left: 46, top: 6, size: 2, delay: 3.4 },
  { left: 58, top: 88, size: 3, delay: 2.2 },
]

export function Starfield() {
  return (
    <div className="starfield" aria-hidden="true">
      <span className="star-field star-far" />
      <span className="star-field star-mid" />
      <span className="star-field star-near" />
      {STARS.map((star, index) => (
        <i
          key={index}
          className={star.size >= 3 ? 'star-dot bright' : 'star-dot'}
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            animationDelay: `-${star.delay}s`,
          }}
        />
      ))}
      <span className="glow-star glow-star-1" />
      <span className="glow-star glow-star-2" />
      <span className="glow-star glow-star-3" />
      <span className="glow-star glow-star-4" />
      <span className="glow-star glow-star-5" />
    </div>
  )
}
