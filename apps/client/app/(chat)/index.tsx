import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Toast from 'react-native-toast-message'

import { FriendsScreen } from '@/components/FriendsScreen'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { MessageInput } from '@/components/chat/MessageInput'
import { MessageList } from '@/components/chat/MessageList'
import { Text } from '@/components/common/Text'
import { DeviceLinkPanel } from '@/components/settings/DeviceLinkPanel'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { isApiHttpError } from '@/lib/api'
import { useConversationStore } from '@/lib/stores'
import { DocumentTitle } from '@/misc/DocumentTitle'
import { useLogoutUser } from '@/services/auth'
import { useGetConversations } from '@/services/conversations'
import { ensureLinkedHistoryReady } from '@/services/deviceLink'
import { getE2EContext } from '@/services/e2e'
import {
  handleIncomingNotification,
  registerForPushNotificationsAsync,
  setupNotificationListeners,
} from '@/services/notification'
import { useFriendRequests } from '@/services/others'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'

export default function ChatApp() {
  const [needsLink, setNeedsLink] = useState(false)
  const [e2eReady, setE2EReady] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupProgress, setSetupProgress] = useState('Preparing encrypted chats…')
  const logout = useLogoutUser()
  const { selectedConversationId, setSelectedConversationId } = useConversationStore()
  const { data: conversations } = useGetConversations()
  const { data: friendRequests } = useFriendRequests()
  const seenRequests = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!friendRequests) return
    const incoming = new Set(friendRequests.incoming)
    if (Platform.OS === 'web') {
      const newSenders = friendRequests.incoming.filter(
        (sender) => !seenRequests.current?.has(sender),
      )
      if (newSenders.length > 0) {
        Toast.show({
          type: 'info',
          text1: newSenders.length === 1 ? 'New friend request' : 'New friend requests',
          text2:
            newSenders.length === 1
              ? `${newSenders[0]} sent you a friend request`
              : `${newSenders.length} people sent you friend requests`,
          position: 'top',
        })
      }
    }
    seenRequests.current = incoming
  }, [friendRequests])
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
        if (
          isApiHttpError(error) &&
          error.status === 409 &&
          error.response?.data?.message === 'Approve this browser from an already linked device'
        ) {
          setNeedsLink(true)
          return
        }
        console.error('[E2E] Device key setup failed:', error)
        setSetupError(error instanceof Error ? error.message : 'Could not prepare encrypted chats')
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
          onCancel={() => logout.mutate()}
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
