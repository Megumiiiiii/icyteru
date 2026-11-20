import { useEffect, useRef } from 'react'

const NIGHT = '#1c1233'

/** A cheap night sky. Stars are drawn once; a few CSS dots twinkle, and that animation stops when the user asks for less motion. */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    let frame = 0

    const paint = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(width * ratio))
      canvas.height = Math.max(1, Math.floor(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.fillStyle = NIGHT
      context.fillRect(0, 0, width, height)
      const count = Math.round((width * height) / 3800)
      let seed = 20261119
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296
        return seed / 4294967296
      }
      for (let i = 0; i < count; i += 1) {
        const x = rand() * width
        const y = rand() * height
        const roll = rand()
        const size = roll < 0.72 ? 0.8 + rand() * 0.7 : roll < 0.94 ? 1.7 + rand() * 0.9 : 2.8 + rand() * 1.1
        const lavender = rand() > 0.62
        const alpha = 0.62 + rand() * 0.38
        if (size > 1.6) {
          context.fillStyle = lavender ? `rgba(214, 190, 255, ${alpha * 0.45})` : `rgba(255, 255, 255, ${alpha * 0.35})`
          context.beginPath()
          context.arc(x, y, size * 2.6, 0, Math.PI * 2)
          context.fill()
        }
        context.fillStyle = lavender ? `rgba(226, 210, 255, ${alpha})` : `rgba(255, 255, 255, ${alpha})`
        context.beginPath()
        context.arc(x, y, size, 0, Math.PI * 2)
        context.fill()
      }
    }

    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    }
    paint()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div className="starfield" aria-hidden="true">
      <canvas ref={canvasRef} />
      {TWINKLES.map(star => <i key={star.id} className="twinkle" style={star} />)}
    </div>
  )
}

const TWINKLES = [
  { id: 1, left: '8%', top: '14%', width: 3, height: 3, animationDelay: '0s' },
  { id: 2, left: '22%', top: '58%', width: 4, height: 4, animationDelay: '1.2s' },
  { id: 3, left: '41%', top: '20%', width: 2, height: 2, animationDelay: '2.1s' },
  { id: 4, left: '57%', top: '74%', width: 3, height: 3, animationDelay: '0.6s' },
  { id: 5, left: '70%', top: '12%', width: 4, height: 4, animationDelay: '1.8s' },
  { id: 6, left: '84%', top: '42%', width: 2, height: 2, animationDelay: '2.8s' },
  { id: 7, left: '16%', top: '84%', width: 3, height: 3, animationDelay: '0.4s' },
  { id: 8, left: '90%', top: '80%', width: 2, height: 2, animationDelay: '1.5s' },
  { id: 9, left: '33%', top: '36%', width: 2, height: 2, animationDelay: '2.4s' },
  { id: 10, left: '51%', top: '88%', width: 3, height: 3, animationDelay: '0.9s' }
]
