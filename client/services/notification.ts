import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Toast from 'react-native-toast-message';

import { BaseMessage } from '@/components/chat/MessageBubble';
import { postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import { queryClient } from '@/lib/queryInit';
import { MessagesResponse } from '@/services/messages';
import { theme } from '@/theme/theme';

export const NOTIFICATION_CHANNELS = {
  MESSAGES: 'messages',
} as const;

Notifications.setNotificationHandler({
  handleNotification: () => {
    // When app is in foreground, don't show system notification
    // You'll handle it in-app with listeners instead
    return Promise.resolve({
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    });
  },
});

export function handleIncomingNotification(
  notification: Notifications.Notification,
  currentFriendName?: string | null,
) {
  const { title, body, data } = notification.request.content;

  if (title && data) {
    const messageData = data as {
      from: string;
      text: string;
      index: number;
      timestamp: string;
    };

    const newMessage: BaseMessage = {
      from: messageData.from,
      text: messageData.text,
      index: messageData.index.toString(),
      timestamp: messageData.timestamp,
    };

    queryClient.setQueryData<{
      pages: MessagesResponse[];
      pageParams: { after?: number; before?: number }[];
    }>([Keys.Query.GET_MESSAGES, messageData.from], (old) => {
      if (!old || !old.pages[0]) {
        return {
          pages: [
            {
              messages: [newMessage],
              hasMore: false,
              totalCount: 1,
            },
          ],
          pageParams: [{}],
        };
      }

      const updatedMessages = [...old.pages[0].messages, newMessage];

      return {
        ...old,
        pages: [
          {
            messages: updatedMessages,
            hasMore: old.pages[0].hasMore,
            totalCount: old.pages[0].totalCount + 1,
          },
          ...old.pages.slice(1),
        ],
        pageParams: old.pageParams,
      };
    });

    if (currentFriendName === messageData.from) {
      return;
    }
  }

  Toast.show({
    type: 'info',
    text1: title || 'New message',
    text2: body || '',
    position: 'top',
    visibilityTime: 4000,
  });
}

export function setupNotificationListeners(
  onNotificationReceived: (notification: Notifications.Notification) => void,
) {
  const subscription = Notifications.addNotificationReceivedListener(
    onNotificationReceived,
  );

  return () => {
    subscription.remove();
  };
}

export async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(
      NOTIFICATION_CHANNELS.MESSAGES,
      {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 400, 100, 400],
        lightColor: theme.colors.primary,
        sound: 'default',
        enableLights: true,
        enableVibrate: true,
        showBadge: true,
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: false,
        description: 'Notifications for new messages',
      },
    );

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== Notifications.PermissionStatus.GRANTED) {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== Notifications.PermissionStatus.GRANTED) {
      return;
    }

    const expoConfig = Constants?.expoConfig as
      | { extra?: { eas?: { projectId?: string } } }
      | undefined;
    const easConfig = Constants?.easConfig as
      | { projectId?: string }
      | undefined;

    const projectId =
      expoConfig?.extra?.['eas']?.projectId ?? easConfig?.projectId;

    if (!projectId) {
      return;
    }
    try {
      const pushToken = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      console.log(pushToken);
      const pushTokenString = pushToken.data;

      await postFetcher(Keys.Mutation.PUSH_TOKEN, { token: pushTokenString });
    } catch {
      return;
    }
  }
}
