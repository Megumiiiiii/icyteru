import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { NotificationPayload } from '../shared/protocol'

const CHANNEL_ID = 'icyteru-messages'
let channelReady = false

function android(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function enableNotifications(): Promise<boolean> {
  if (android()) {
    try {
      let permission = await LocalNotifications.checkPermissions()
      if (permission.display !== 'granted') permission = await LocalNotifications.requestPermissions()
      if (permission.display !== 'granted') return false
      if (!channelReady) {
        await LocalNotifications.createChannel({
          id: CHANNEL_ID,
          name: 'Messages',
          description: 'Replies and questions from Hermes',
          importance: 4,
          visibility: 1,
          vibration: true
        })
        channelReady = true
      }
      return true
    } catch {
      return false
    }
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

export async function sendNotification(payload: NotificationPayload): Promise<void> {
  if (android()) {
    try {
      const permission = await LocalNotifications.checkPermissions()
      if (permission.display !== 'granted') return
      await LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Date.now() % 2_147_483_647),
          title: payload.title,
          body: payload.body,
          channelId: CHANNEL_ID
        }]
      })
    } catch {
      // A notification is a courtesy; never break the chat over it.
    }
    return
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  new Notification(payload.title, { body: payload.body })
}
