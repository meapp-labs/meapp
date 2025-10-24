import { useCallback, useEffect } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FriendsScreen from '@/components/FriendsScreen';
import { ChatHeader } from '@/components/chat/ChatHeader';
import MessageInput from '@/components/chat/MessageInput';
import { MessageList } from '@/components/chat/MessageList';
import { Text } from '@/components/common/Text';
import useBreakpoint from '@/hooks/useBreakpoint';
import { useFriendStore } from '@/lib/stores';
import { DocumentTitle } from '@/misc/DocumentTitle';
import {
  handleIncomingNotification,
  registerForPushNotificationsAsync,
  setupNotificationListeners,
} from '@/services/notification';
import { theme } from '@/theme/theme';

export default function ChatApp() {
  const { selectedFriend, setSelectedFriend } = useFriendStore();
  const { isMobile } = useBreakpoint();

  const returnAction = useCallback((): boolean => {
    if (selectedFriend !== null) {
      setSelectedFriend(null);
      return true;
    }
    return false;
  }, [selectedFriend, setSelectedFriend]);

  useEffect(() => {
    const returnHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      returnAction,
    );
    return () => returnHandler.remove();
  }, [returnAction]);

  useEffect(() => {
    void registerForPushNotificationsAsync();
  }, []);

  useEffect(() => {
    const cleanup = setupNotificationListeners((notification) =>
      handleIncomingNotification(notification, selectedFriend?.name),
    );
    return cleanup;
  }, [selectedFriend]);

  return (
    <SafeAreaView style={styles.container}>
      <DocumentTitle title="Chat" />
      {isMobile ? (
        selectedFriend === null ? (
          <FriendsScreen />
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'android' ? 'padding' : 'height'}
            keyboardVerticalOffset={5}
            style={styles.chatScreen}
          >
            <ChatHeader />
            <MessageList selectedFriendName={selectedFriend.name} />
            <MessageInput selectedFriendName={selectedFriend.name} />
          </KeyboardAvoidingView>
        )
      ) : (
        <>
          <FriendsScreen />
          {selectedFriend ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'android' ? 'padding' : 'height'}
              keyboardVerticalOffset={5}
              style={styles.chatScreen}
            >
              <ChatHeader />
              <MessageList selectedFriendName={selectedFriend.name} />
              <MessageInput selectedFriendName={selectedFriend.name} />
            </KeyboardAvoidingView>
          ) : (
            <Text>{'something'}</Text>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background,
    flexDirection: 'row',
    flex: 1,
  },
  chatScreen: {
    flex: 1,
    marginBottom: theme.spacing.sm,
  },
});
