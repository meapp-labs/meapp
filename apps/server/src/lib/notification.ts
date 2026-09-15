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
  channelId?: string
}

export const sendPushNotification = async (options: ExpoPushNotificationOptions): Promise<void> => {
  const {
    expoPushToken,
    senderUsername,
    messageText,
    messageIndex,
    timestamp,
    channelId = NOTIFICATION_CHANNELS.MESSAGES,
  } = options

  await fetch(EXPO_PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: expoPushToken,
      title: senderUsername,
      body: messageText,
      data: {
        from: senderUsername,
        text: messageText,
        index: messageIndex,
        timestamp,
      },
      channelId,
    }),
  })
}
