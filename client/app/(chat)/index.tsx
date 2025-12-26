import React, { useCallback, useEffect } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Conversation from '@/components/Conversation';
import { ChatHeader } from '@/components/chat/ChatHeader';
import MessageInput from '@/components/chat/MessageInput';
import { MessageList } from '@/components/chat/MessageList';
import { Text } from '@/components/common/Text';
import useBreakpoint from '@/hooks/useBreakpoint';
import { useConversationStore } from '@/lib/stores';
import { DocumentTitle } from '@/misc/DocumentTitle';
import {
  handleIncomingNotification,
  registerForPushNotificationsAsync,
  setupNotificationListeners,
} from '@/services/notification';
import { ConversationStorage } from '@/services/storage';
import { theme } from '@/theme/theme';

export default function ChatApp() {
  const { selectedConversation, setSelectedConversation } =
    useConversationStore();
  const { isMobile } = useBreakpoint();

  const returnAction = useCallback((): boolean => {
    if (selectedConversation !== null) {
      setSelectedConversation(null);
      void ConversationStorage.clear();
      return true;
    }
    return false;
  }, [selectedConversation, setSelectedConversation]);

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
      handleIncomingNotification(notification, selectedConversation?.id),
    );
    return cleanup;
  }, [selectedConversation]);

  const conversationId = selectedConversation?.id;

  return (
    <SafeAreaView style={styles.container}>
      <DocumentTitle title="Chat" />
      {isMobile ? (
        selectedConversation === null ? (
          <Conversation />
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'android' ? 'padding' : 'height'}
            keyboardVerticalOffset={5}
            style={styles.chatScreen}
          >
            <ChatHeader />
            {conversationId && (
              <>
                <MessageList conversationId={conversationId} />
                <MessageInput conversationId={conversationId} />
              </>
            )}
          </KeyboardAvoidingView>
        )
      ) : (
        <>
          <Conversation />
          {selectedConversation && conversationId ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'android' ? 'padding' : 'height'}
              keyboardVerticalOffset={5}
              style={styles.chatScreen}
            >
              <ChatHeader />
              <MessageList conversationId={conversationId} />
              <MessageInput conversationId={conversationId} />
            </KeyboardAvoidingView>
          ) : (
            <Text>{'Select a conversation'}</Text>
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
