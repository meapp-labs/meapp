import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
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
import { MediaDropZone } from '@/components/chat/MediaDropZone'
import { ConversationMessages } from '@/components/chat/ThreadWindow'
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
import { flushReceiptQueue } from '@/services/receipts'
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
    if (!e2eReady) return
    const timer = setInterval(() => void flushReceiptQueue().catch(() => undefined), 5000)
    return () => clearInterval(timer)
  }, [e2eReady])

  useEffect(() => {
    const cleanup = setupNotificationListeners((notification) =>
      handleIncomingNotification(notification, selectedConversationId ?? undefined),
    )
    return cleanup
  }, [selectedConversationId])

  return (
    <SafeAreaView style={styles.container}>
      <DocumentTitle
        title={`${conversations?.reduce((total, conversation) => total + (conversation.unreadCount ?? 0), 0) || ''} Chat`.trim()}
      />
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
          <MaterialIcons name="lock-outline" size={32} color={theme.colors.primary} />
          <Text>{setupError}</Text>
          <Pressable accessibilityRole="button" style={styles.retryButton} onPress={prepareE2E}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : !e2eReady ? (
        <View style={styles.setup}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
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
            <MediaDropZone key={visibleConversationId} conversationId={visibleConversationId}>
              <ChatHeader />
              <ConversationMessages conversationId={visibleConversationId} />
            </MediaDropZone>
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
              <MediaDropZone key={visibleConversationId} conversationId={visibleConversationId}>
                <ChatHeader />
                <ConversationMessages conversationId={visibleConversationId} />
              </MediaDropZone>
            </KeyboardAvoidingView>
          ) : (
            <View style={styles.welcome}>
              <View style={styles.welcomeIcon}>
                <MaterialIcons name="forum" size={40} color={theme.colors.primary} />
              </View>
              <Text style={styles.welcomeTitle}>Your people. Your space.</Text>
              <Text style={styles.welcomeDescription}>
                Pick a conversation to catch up, share something, or simply say hello.
              </Text>
              <View style={styles.security}>
                <MaterialIcons name="lock-outline" size={14} color={theme.colors.textSecondary} />
                <Text style={styles.securityText}>Personal chats are end-to-end encrypted</Text>
              </View>
            </View>
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
    minWidth: 0,
  },
  setup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: 20,
  },
  retryButton: {
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 13,
  },
  retryLabel: { color: theme.colors.background, fontWeight: '600' },
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, minWidth: 0 },
  welcomeIcon: {
    width: 94,
    height: 94,
    borderRadius: 32,
    backgroundColor: '#F5BA3012',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
    borderWidth: 1,
    borderColor: '#F5BA3025',
  },
  welcomeTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.8, textAlign: 'center' },
  welcomeDescription: {
    maxWidth: 340,
    marginTop: 12,
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    color: theme.colors.textSecondary,
  },
  security: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 48,
    flexWrap: 'wrap',
  },
  securityText: { fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center' },
})
