import { useCallback, useEffect, useState } from 'react'
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { FriendsScreen } from '@/components/FriendsScreen'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { MessageInput } from '@/components/chat/MessageInput'
import { MessageList } from '@/components/chat/MessageList'
import { Text } from '@/components/common/Text'
import { DeviceLinkPanel } from '@/components/settings/DeviceLinkPanel'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useConversationStore } from '@/lib/stores'
import { DocumentTitle } from '@/misc/DocumentTitle'
import { useGetConversations } from '@/services/conversations'
import { ensureLinkedHistoryReady } from '@/services/deviceLink'
import { getE2EContext } from '@/services/e2e'
import {
  handleIncomingNotification,
  registerForPushNotificationsAsync,
  setupNotificationListeners,
} from '@/services/notification'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'

export default function ChatApp() {
  const [needsLink, setNeedsLink] = useState(false)
  const [e2eReady, setE2EReady] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupProgress, setSetupProgress] = useState('Preparing encrypted chats…')
  const { selectedConversationId, setSelectedConversationId } = useConversationStore()
  const { data: conversations } = useGetConversations()
  const visibleConversationId = conversations?.some(
    (conversation) => conversation.id === selectedConversationId,
  )
    ? selectedConversationId
    : null
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
    if (Platform.OS === 'web') return
    const returnHandler = BackHandler.addEventListener('hardwareBackPress', returnAction)
    return () => returnHandler.remove()
  }, [returnAction])

  const prepareE2E = useCallback(() => {
    setSetupError(null)
    setSetupProgress('Preparing encrypted chats…')
    void getE2EContext()
      .then(() => ensureLinkedHistoryReady(setSetupProgress))
      .then(() => setE2EReady(true))
      .catch((error: unknown) => {
        console.error('[E2E] Device key setup failed:', error)
        if (String(error).includes('Approve this browser from an already linked device'))
          setNeedsLink(true)
        else setSetupError(String(error))
      })
  }, [])

  useEffect(() => {
    void registerForPushNotificationsAsync()
    prepareE2E()
  }, [prepareE2E])

  useEffect(() => {
    const cleanup = setupNotificationListeners((notification) =>
      handleIncomingNotification(notification, selectedConversationId ?? undefined),
    )
    return cleanup
  }, [selectedConversationId])

  return (
    <SafeAreaView style={styles.container}>
      <DocumentTitle title="Chat" />
      {needsLink ? (
        <DeviceLinkPanel
          mode="recover"
          onLinked={() => {
            setNeedsLink(false)
            setE2EReady(true)
          }}
        />
      ) : setupError ? (
        <View style={styles.setup}>
          <Text>{setupError}</Text>
          <Pressable onPress={prepareE2E}>
            <Text>Retry encryption setup</Text>
          </Pressable>
        </View>
      ) : !e2eReady ? (
        <View style={styles.setup}>
          <Text>{setupProgress}</Text>
        </View>
      ) : isMobile ? (
        visibleConversationId === null ? (
          <FriendsScreen />
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'android' ? 'padding' : 'height'}
            keyboardVerticalOffset={5}
            style={styles.chatScreen}
          >
            <ChatHeader />
            <MessageList conversationId={visibleConversationId} />
            <MessageInput conversationId={visibleConversationId} />
          </KeyboardAvoidingView>
        )
      ) : (
        <>
          <FriendsScreen />
          {visibleConversationId ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'android' ? 'padding' : 'height'}
              keyboardVerticalOffset={5}
              style={styles.chatScreen}
            >
              <ChatHeader />
              <MessageList conversationId={visibleConversationId} />
              <MessageInput conversationId={visibleConversationId} />
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
  setup: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
})
