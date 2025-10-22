import { useCallback, useEffect } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FriendsScreen from '@/components/FriendsScreen';
import { ChatHeader } from '@/components/chat/ChatHeader';
import MessageInput from '@/components/chat/MessageInput';
import { MessageList } from '@/components/chat/MessageList';
import { Text } from '@/components/common/Text';
import useBreakpoint from '@/hooks/useBreakpoint';
import { useFriendStore } from '@/lib/stores';
import { DocumentTitle } from '@/misc/DocumentTitle';
import { registerForPushNotificationsAsync } from '@/services/notification';
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

  return (
    <SafeAreaView style={styles.container}>
      <DocumentTitle title="Chat" />
      {isMobile ? (
        selectedFriend === null ? (
          <FriendsScreen />
        ) : (
          <View style={styles.chatScreen}>
            <ChatHeader />
            <MessageList selectedFriendName={selectedFriend.name} />
            <MessageInput selectedFriendName={selectedFriend.name} />
          </View>
        )
      ) : (
        <>
          <FriendsScreen />
          {selectedFriend ? (
            <View style={styles.chatScreen}>
              <ChatHeader />
              <MessageList selectedFriendName={selectedFriend.name} />
              <MessageInput selectedFriendName={selectedFriend.name} />
            </View>
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
