import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/** The vendored Sakuga components are custom elements, so JSX needs to know them. */
type SakugaProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  label?: string
  placeholder?: string
  value?: string
  duration?: string | number
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'sakuga-button': SakugaProps
      'sakuga-input': SakugaProps
      'sakuga-textarea': SakugaProps & { rows?: number | string }
      'sakuga-toast': SakugaProps
    }
  }
}

export {}
