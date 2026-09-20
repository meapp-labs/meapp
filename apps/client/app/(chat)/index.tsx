import { useCallback, useEffect } from 'react'
import { BackHandler, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { FriendsScreen } from '@/components/FriendsScreen'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { MessageInput } from '@/components/chat/MessageInput'
import { MessageList } from '@/components/chat/MessageList'
import { Text } from '@/components/common/Text'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useConversationStore } from '@/lib/stores'
import { DocumentTitle } from '@/misc/DocumentTitle'
import {
  handleIncomingNotification,
  registerForPushNotificationsAsync,
  setupNotificationListeners,
} from '@/services/notification'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'

export function ChatApp() {
  const { selectedConversationId, setSelectedConversationId } = useConversationStore()
  const { isMobile } = useBreakpoint()

  const returnAction = useCallback((): boolean => {
    if (selectedConversationId !== null) {
      setSelectedConversationId(null)
      void ConversationStorage.clear()
      return true
    }
    return false
  }, [selectedConversationId, setSelectedConversationId])

  useEffect(() => {
    const returnHandler = BackHandler.addEventListener('hardwareBackPress', returnAction)
    return () => returnHandler.remove()
  }, [returnAction])

  useEffect(() => {
    void registerForPushNotificationsAsync()
  }, [])

  useEffect(() => {
    const cleanup = setupNotificationListeners((notification) =>
      handleIncomingNotification(notification, selectedConversationId ?? undefined),
    )
    return cleanup
  }, [selectedConversationId])

  return (
    <SafeAreaView style={styles.container}>
      <DocumentTitle title="Chat" />
      {isMobile ? (
        selectedConversationId === null ? (
          <FriendsScreen />
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'android' ? 'padding' : 'height'}
            keyboardVerticalOffset={5}
            style={styles.chatScreen}
          >
            <ChatHeader />
            <MessageList conversationId={selectedConversationId} />
            <MessageInput conversationId={selectedConversationId} />
          </KeyboardAvoidingView>
        )
      ) : (
        <>
          <FriendsScreen />
          {selectedConversationId ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'android' ? 'padding' : 'height'}
              keyboardVerticalOffset={5}
              style={styles.chatScreen}
            >
              <ChatHeader />
              <MessageList conversationId={selectedConversationId} />
              <MessageInput conversationId={selectedConversationId} />
            </KeyboardAvoidingView>
          ) : (
            <Text>{'Select a conversation'}</Text>
          )}
        </>
      )}
    </SafeAreaView>
  )
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
})
