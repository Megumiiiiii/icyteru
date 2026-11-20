import { createContext } from 'react'

export type PhoneView = 'roster' | 'chat' | 'panel'

export const PhoneNav = createContext<{
  view: PhoneView
  setView: (view: PhoneView) => void
}>({ view: 'roster', setView: () => undefined })

export function initialPhone(): PhoneView {
  const shot = new URLSearchParams(location.search).get('shot') || ''
  if (shot === 'history' || shot === 'profile' || shot === 'dark-history') return 'panel'
  if (shot === 'chat' || shot === 'dark-chat' || shot === 'settings') return 'chat'
  return 'roster'
}
