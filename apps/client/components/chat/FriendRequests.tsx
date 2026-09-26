import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'

import { Text } from '@/components/common/Text'
import { useConversationStore } from '@/lib/stores'
import { useCreateConversation } from '@/services/conversations'
import {
  useAcceptFriendRequest,
  useAddFriend,
  useCancelFriendRequest,
  useFriendRequests,
  useIgnoreFriendRequest,
  useIgnoredUsers,
  useUnignoreUser,
} from '@/services/others'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'

type RequestTab = 'received' | 'sent' | 'ignored'

export function FriendRequests() {
  const [visible, setVisible] = useState(false)
  const [activeTab, setActiveTab] = useState<RequestTab>('received')
  const [username, setUsername] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const {
    data: requests,
    isError: requestsError,
    isPending: requestsPending,
    refetch: refetchRequests,
  } = useFriendRequests()
  const {
    data: ignored = [],
    isError: ignoredError,
    isPending: ignoredPending,
    refetch: refetchIgnored,
  } = useIgnoredUsers()
  const add = useAddFriend()
  const accept = useAcceptFriendRequest()
  const cancel = useCancelFriendRequest()
  const ignore = useIgnoreFriendRequest()
  const unignore = useUnignoreUser()
  const createConversation = useCreateConversation()
  const setSelectedConversationId = useConversationStore((state) => state.setSelectedConversationId)

  const busy =
    add.isPending ||
    accept.isPending ||
    cancel.isPending ||
    ignore.isPending ||
    unignore.isPending ||
    createConversation.isPending
  const actionError =
    activeTab === 'received'
      ? (accept.error ?? ignore.error ?? createConversation.error)
      : activeTab === 'sent'
        ? cancel.error
        : unignore.error

  const openChat = (other: string) => {
    createConversation.mutate(
      { type: 'dm', participants: [other] },
      {
        onSuccess: (conversation) => {
          setSelectedConversationId(conversation.id)
          void ConversationStorage.save(conversation.id)
          setVisible(false)
        },
      },
    )
  }

  const sendRequest = () => {
    const other = username.trim()
    if (!other || busy) return
    add.mutate(other, {
      onSuccess: () => {
        setUsername('')
        setSentTo(other)
        setActiveTab('sent')
      },
    })
  }

  const open = () => {
    setVisible(true)
    void refetchRequests()
    void refetchIgnored()
  }

  const close = () => {
    setVisible(false)
    setSentTo(null)
    add.reset()
  }

  const tabs: { id: RequestTab; label: string; count: number }[] = [
    { id: 'received', label: 'Received', count: requests?.incoming.length ?? 0 },
    { id: 'sent', label: 'Sent', count: requests?.outgoing.length ?? 0 },
    { id: 'ignored', label: 'Ignored', count: ignored.length },
  ]

  return (
    <>
      <Pressable
        accessibilityLabel={`Friend requests${requests?.incoming.length ? `, ${requests.incoming.length} pending` : ''}`}
        style={styles.trigger}
        onPress={open}
      >
        <MaterialIcons name="person-add-alt" size={24} color={theme.colors.text} />
        {!!requests?.incoming.length && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{requests.incoming.length}</Text>
          </View>
        )}
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <View style={styles.panel}>
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <MaterialIcons name="people-outline" size={24} color={theme.colors.primary} />
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>Friend requests</Text>
                <Text style={styles.subtitle}>Connect with people you know</Text>
              </View>
              <Pressable
                accessibilityLabel="Close friend requests"
                style={styles.closeButton}
                onPress={close}
              >
                <MaterialIcons name="close" size={22} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.sendCard}>
              <Text style={styles.sectionLabel}>Send a request</Text>
              <View style={styles.sendRow}>
                <TextInput
                  accessibilityLabel="Friend username"
                  style={styles.input}
                  placeholder="Enter a username"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={username}
                  onChangeText={(value) => {
                    setUsername(value)
                    setSentTo(null)
                    add.reset()
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={sendRequest}
                />
                <Pressable
                  disabled={busy || !username.trim()}
                  style={[styles.sendButton, (busy || !username.trim()) && styles.disabledButton]}
                  onPress={sendRequest}
                >
                  <Text style={styles.sendButtonText}>{add.isPending ? 'Sending…' : 'Send'}</Text>
                </Pressable>
              </View>
              {add.error && (
                <Text style={styles.error}>
                  {add.error.response?.data?.message ?? add.error.message}
                </Text>
              )}
              {sentTo && <Text style={styles.success}>Request sent to {sentTo}.</Text>}
            </View>

            <View style={styles.tabs}>
              {tabs.map((tab) => (
                <Pressable
                  key={tab.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activeTab === tab.id }}
                  style={[styles.tab, activeTab === tab.id && styles.activeTab]}
                  onPress={() => setActiveTab(tab.id)}
                >
                  <Text style={[styles.tabText, activeTab === tab.id && styles.activeTabText]}>
                    {tab.label}
                  </Text>
                  {tab.count > 0 && (
                    <View style={[styles.count, activeTab === tab.id && styles.activeCount]}>
                      <Text
                        style={[styles.countText, activeTab === tab.id && styles.activeCountText]}
                      >
                        {tab.count}
                      </Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {activeTab === 'received' &&
                (requestsError ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.error}>Could not load requests.</Text>
                    <Pressable onPress={() => void refetchRequests()}>
                      <Text style={styles.retry}>Retry</Text>
                    </Pressable>
                  </View>
                ) : requestsPending ? (
                  <Text style={styles.emptyText}>Loading requests…</Text>
                ) : requests?.incoming.length ? (
                  requests.incoming.map((other) => (
                    <View key={other} style={styles.requestRow}>
                      <View style={styles.avatar}>
                        <MaterialIcons name="person" size={22} color={theme.colors.primary} />
                      </View>
                      <View style={styles.requestCopy}>
                        <Text style={styles.name}>{other}</Text>
                        <Text style={styles.detail}>Wants to add you</Text>
                      </View>
                      <View style={styles.actions}>
                        <Pressable
                          disabled={busy}
                          style={styles.acceptButton}
                          onPress={() => accept.mutate(other, { onSuccess: () => openChat(other) })}
                        >
                          <Text style={styles.acceptText}>Accept</Text>
                        </Pressable>
                        <Pressable
                          disabled={busy}
                          style={styles.outlineButton}
                          onPress={() => ignore.mutate(other)}
                        >
                          <Text style={styles.outlineText}>Ignore</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <MaterialIcons
                      name="mark-email-read"
                      size={30}
                      color={theme.colors.textTertiary}
                    />
                    <Text style={styles.emptyTitle}>No requests received</Text>
                    <Text style={styles.emptyText}>New requests will appear here.</Text>
                  </View>
                ))}

              {activeTab === 'sent' &&
                (requestsError ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.error}>Could not load requests.</Text>
                    <Pressable onPress={() => void refetchRequests()}>
                      <Text style={styles.retry}>Retry</Text>
                    </Pressable>
                  </View>
                ) : requestsPending ? (
                  <Text style={styles.emptyText}>Loading requests…</Text>
                ) : requests?.outgoing.length ? (
                  requests.outgoing.map((other) => (
                    <View key={other} style={styles.requestRow}>
                      <View style={styles.avatar}>
                        <MaterialIcons name="person" size={22} color={theme.colors.primary} />
                      </View>
                      <View style={styles.requestCopy}>
                        <Text style={styles.name}>{other}</Text>
                        <Text style={styles.detail}>Waiting for a response</Text>
                      </View>
                      <Pressable
                        disabled={busy}
                        style={styles.outlineButton}
                        onPress={() =>
                          cancel.mutate(other, {
                            onSuccess: () => {
                              if (sentTo === other) setSentTo(null)
                            },
                          })
                        }
                      >
                        <Text style={styles.outlineText}>
                          {cancel.isPending && cancel.variables === other
                            ? 'Cancelling…'
                            : 'Cancel'}
                        </Text>
                      </Pressable>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <MaterialIcons
                      name="outgoing-mail"
                      size={30}
                      color={theme.colors.textTertiary}
                    />
                    <Text style={styles.emptyTitle}>No requests pending</Text>
                    <Text style={styles.emptyText}>Send a request to add someone.</Text>
                  </View>
                ))}

              {activeTab === 'ignored' &&
                (ignoredError ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.error}>Could not load ignored users.</Text>
                    <Pressable onPress={() => void refetchIgnored()}>
                      <Text style={styles.retry}>Retry</Text>
                    </Pressable>
                  </View>
                ) : ignoredPending ? (
                  <Text style={styles.emptyText}>Loading ignored users…</Text>
                ) : ignored.length ? (
                  ignored.map((other) => (
                    <View key={other} style={styles.requestRow}>
                      <View style={styles.avatar}>
                        <MaterialIcons
                          name="person-off"
                          size={22}
                          color={theme.colors.textSecondary}
                        />
                      </View>
                      <View style={styles.requestCopy}>
                        <Text style={styles.name}>{other}</Text>
                        <Text style={styles.detail}>Requests are silenced</Text>
                      </View>
                      <Pressable
                        disabled={busy}
                        style={styles.outlineButton}
                        onPress={() => unignore.mutate(other)}
                      >
                        <Text style={styles.outlineText}>Unignore</Text>
                      </Pressable>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <MaterialIcons name="block" size={30} color={theme.colors.textTertiary} />
                    <Text style={styles.emptyTitle}>No ignored users</Text>
                    <Text style={styles.emptyText}>Ignored requests will appear here.</Text>
                  </View>
                ))}
              {actionError && (
                <Text style={styles.error}>
                  {actionError.response?.data?.message ?? actionError.message}
                </Text>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: theme.colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: 'white', fontSize: 11, fontWeight: '700' },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.overlay,
  },
  panel: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '90%',
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.borderSecondary,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.md,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1 },
  title: { ...theme.typography.h2, color: theme.colors.text, fontWeight: '700' },
  subtitle: { color: theme.colors.textSecondary, marginTop: 2, fontSize: 13 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.card,
  },
  sendCard: {
    marginHorizontal: theme.spacing.lg,
    padding: theme.spacing.md,
    borderRadius: 14,
    backgroundColor: theme.colors.card,
  },
  sectionLabel: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
  },
  sendRow: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  sendButton: {
    minWidth: 76,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.primary,
  },
  sendButtonText: { color: '#111', fontWeight: '700' },
  disabledButton: { opacity: 0.5 },
  tabs: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSecondary,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: { borderBottomColor: theme.colors.primary },
  tabText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  activeTabText: { color: theme.colors.primary },
  count: {
    backgroundColor: theme.colors.card,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  activeCount: { backgroundColor: theme.colors.primary },
  countText: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: '700' },
  activeCountText: { color: '#111' },
  list: { maxHeight: 300 },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    minHeight: 145,
  },
  emptyState: { minHeight: 145, alignItems: 'center', justifyContent: 'center', gap: 5 },
  emptyTitle: { color: theme.colors.text, fontWeight: '600', marginTop: 5 },
  emptyText: { color: theme.colors.textSecondary, fontSize: 13, textAlign: 'center' },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 70,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSecondary,
    gap: theme.spacing.sm,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestCopy: { flex: 1, minWidth: 0 },
  name: { color: theme.colors.text, fontWeight: '600' },
  detail: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 3 },
  actions: { flexDirection: 'row', gap: 5 },
  acceptButton: {
    minHeight: 34,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: { color: '#111', fontSize: 12, fontWeight: '700' },
  outlineButton: {
    minHeight: 34,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineText: { color: theme.colors.text, fontSize: 12, fontWeight: '600' },
  error: { color: theme.colors.error, fontSize: 13, marginTop: theme.spacing.sm },
  success: { color: theme.colors.success, fontSize: 13, marginTop: theme.spacing.sm },
  retry: { color: theme.colors.primary, fontWeight: '600', marginTop: theme.spacing.sm },
})
