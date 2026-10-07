export const NOTIFICATION_CHANNELS = {
  MESSAGES: 'messages',
} as const

import { getDbInstance } from '@meapp/db'
import { notificationAllowed } from './notificationPreferences'
import { pushQueue } from './pushQueue.ts'

export type ExpoPushNotificationOptions = {
  expoPushToken: string
  senderUsername: string
  messageText: string
  messageIndex: number
  timestamp: string
  threadRootId?: string
  conversationId?: string
  channelId?: string
  kind?: 'friend_request'
}

export const sendPushNotification = async (options: ExpoPushNotificationOptions): Promise<void> => {
  if (!notificationAllowed(getDbInstance().sqlite, options)) return
  pushQueue.enqueue(options)
}
