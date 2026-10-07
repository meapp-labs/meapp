export const NOTIFICATION_CHANNELS = {
  MESSAGES: 'messages',
} as const

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
  pushQueue.enqueue(options)
}
