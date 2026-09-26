export const NOTIFICATION_CHANNELS = {
  MESSAGES: 'messages',
} as const

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send'

export type ExpoPushNotificationOptions = {
  expoPushToken: string
  senderUsername: string
  messageText: string
  messageIndex: number
  timestamp: string
  conversationId?: string
  channelId?: string
  kind?: 'friend_request'
}

export const sendPushNotification = async (options: ExpoPushNotificationOptions): Promise<void> => {
  const {
    expoPushToken,
    senderUsername,
    messageText,
    messageIndex,
    timestamp,
    conversationId,
    channelId = NOTIFICATION_CHANNELS.MESSAGES,
    kind,
  } = options

  const payload = JSON.stringify({
    to: expoPushToken,
    title: senderUsername,
    body: messageText,
    data: {
      kind,
      from: senderUsername,
      text: messageText,
      index: messageIndex,
      timestamp,
      conversationId,
    },
    channelId,
  })

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: payload,
      })

      if (response.ok) {
        return
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
      }

      const errorText = await response.text().catch(() => 'unknown')
      console.warn(`[Push] Failed to send push notification (${response.status}): ${errorText}`)
      return
    } catch (err) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      console.warn('[Push] Network error sending push notification:', err)
    }
  }
}
