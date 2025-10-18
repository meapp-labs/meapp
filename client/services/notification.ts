import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { postFetcher } from '@/lib/axios';
import { Keys } from '@/lib/keys';
import { theme } from '@/theme/theme';

export const NOTIFICATION_CHANNELS = {
  MESSAGES: 'messages',
} as const;

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

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
