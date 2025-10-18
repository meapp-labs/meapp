export const NOTIFICATION_CHANNELS = {
  MESSAGES: 'messages',
} as const;

export type ExpoPushMessage = {
  to: string | string[];
  data?: Record<string, unknown>;
  title?: string;
  body?: string;
  channelId?: string;
};

export type ExpoPushNotificationOptions = {
  expoPushToken: string;
  senderUsername: string;
  messageText: string;
  channelId?: string;
};

export async function sendPushNotification(
  options: ExpoPushNotificationOptions,
): Promise<void> {
  const {
    expoPushToken,
    senderUsername,
    messageText,
    channelId = NOTIFICATION_CHANNELS.MESSAGES,
  } = options;

  const message: ExpoPushMessage = {
    to: expoPushToken,
    title: senderUsername,
    body: messageText,
    data: { from: senderUsername },
    channelId,
  };

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });
}
