import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { router } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'

import { ConversationItem } from '@/components/ConversationItem'
import { Logout } from '@/components/Logout'
import { UserAvatar } from '@/components/UserAvatar'
import { CreateGroup } from '@/components/chat/CreateGroup'
import { FriendRequests } from '@/components/chat/FriendRequests'
import { JoinGroupModal } from '@/components/chat/JoinGroupModal'
import { Text } from '@/components/common/Text'
import { UserSettings } from '@/components/settings/UserSettings'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import { useGetConversations, useSavedMessages } from '@/services/conversations'
import { useOwnProfile } from '@/services/profiles'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'
import type { Conversation } from '@meapp/shared'
import Toast from 'react-native-toast-message'

export function FriendsScreen() {
  const { isMobile, isTablet } = useBreakpoint()
  const profile = useOwnProfile()
  const { username: currentUsername } = useAuthStore()
  const { selectedConversationId, setSelectedConversationId } = useConversationStore()
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [joiningGroup, setJoiningGroup] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { data: conversations = [], isPending, isError, refetch } = useGetConversations()
  const saved = useSavedMessages()
  const entrance = useRef(new Animated.Value(1)).current

  useEffect(() => {
    let active = true
    let animation: Animated.CompositeAnimation | undefined
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (!active || reduceMotion) return
        entrance.setValue(0)
        animation = Animated.timing(entrance, { toValue: 1, duration: 220, useNativeDriver: true })
        animation.start()
      })
      .catch(() => undefined)
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduceMotion) => {
      if (reduceMotion) {
        animation?.stop()
        entrance.setValue(1)
      }
    })
    return () => {
      active = false
      animation?.stop()
      listener.remove()
    }
  }, [entrance])

  useEffect(() => {
    if (
      !isPending &&
      selectedConversationId &&
      !conversations.some((c) => c.id === selectedConversationId)
    ) {
      setSelectedConversationId(null)
      void ConversationStorage.clear()
    }
  }, [conversations, isPending, selectedConversationId, setSelectedConversationId])

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations

    const query = searchQuery.toLowerCase()
    return conversations.filter((c) => {
      // Check conversation name (custom name or group name)
      if (c.name?.toLowerCase().includes(query)) return true

      // Check participants (excluding current user)
      const others = c.participants.filter((p) => p !== currentUsername)
      return others.some((p) => p.toLowerCase().includes(query))
    })
  }, [conversations, searchQuery, currentUsername])

  return (
    <Animated.View
      style={[
        styles.friendList,
        isTablet && styles.tabletList,
        isMobile && styles.mobileList,
        {
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
          ],
        },
      ]}
    >
      {creatingGroup ? (
        <CreateGroup onClose={() => setCreatingGroup(false)} />
      ) : (
        <>
          <View style={styles.heading}>
            <View style={styles.brand}>
              <View style={styles.brandIcon}>
                <MaterialIcons name="chat-bubble-outline" size={22} color={theme.colors.primary} />
              </View>
              <Text style={styles.brandName}>MeApp</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open profile settings"
              onPress={() => router.push('/(chat)/profile')}
              style={({ pressed }) => [styles.profileTrigger, pressed && styles.pressed]}
            >
              <UserAvatar
                uri={profile.data?.avatarUrl}
                label={profile.data?.displayName || currentUsername}
                size={38}
              />
            </Pressable>
          </View>
          <View style={styles.sectionHeading}>
            <Text style={styles.title}>Messages</Text>
            <Text style={styles.count} accessibilityLabel={`${conversations.length} conversations`}>
              {conversations.length}
            </Text>
          </View>
          <View style={styles.search}>
            <MaterialIcons name="search" size={20} color={theme.colors.textSecondary} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search conversations"
              placeholderTextColor={theme.colors.textTertiary}
              accessibilityLabel="Search conversations"
              style={styles.searchInput}
            />
            {searchQuery.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                onPress={() => setSearchQuery('')}
                hitSlop={10}
              >
                <MaterialIcons name="close" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            )}
          </View>
          <View style={styles.topMenu}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open saved messages"
              disabled={saved.isPending}
              accessibilityState={{ disabled: saved.isPending }}
              style={({ pressed }) => [styles.groupTrigger, pressed && styles.pressed]}
              onPress={() => {
                void saved.mutateAsync().catch((error: unknown) =>
                  Toast.show({
                    type: 'error',
                    text1: 'Saved messages unavailable',
                    text2: error instanceof Error ? error.message : 'Try again',
                  }),
                )
              }}
            >
              <MaterialIcons name="bookmark-border" size={19} color={theme.colors.primary} />
              <Text style={styles.actionLabel}>Saved</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create group"
              style={({ pressed }) => [styles.groupTrigger, pressed && styles.pressed]}
              onPress={() => setCreatingGroup(true)}
            >
              <MaterialIcons name="group-add" size={19} color={theme.colors.textSecondary} />
              <Text style={styles.actionLabel}>Group</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Join group with invite"
              style={({ pressed }) => [styles.groupTrigger, pressed && styles.pressed]}
              onPress={() => setJoiningGroup(true)}
            >
              <MaterialIcons name="login" size={19} color={theme.colors.textSecondary} />
              <Text style={styles.actionLabel}>Join</Text>
            </Pressable>
          </View>
          {isPending ? (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : isError && conversations.length === 0 ? (
            <View style={[styles.empty, styles.loading]}>
              <MaterialIcons name="cloud-off" size={28} color={theme.colors.textSecondary} />
              <Text style={styles.emptyTitle}>Could not load conversations</Text>
              <Text style={styles.emptyDescription}>Check your connection and try again.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refetch()}
                style={styles.retry}
              >
                <Text style={styles.retryLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList<Conversation>
              data={filteredConversations}
              renderItem={({ item }) => <ConversationItem conversation={item} />}
              keyExtractor={(item) => item.id}
              style={styles.conversations}
              contentContainerStyle={styles.conversationContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <View style={styles.emptyIcon}>
                    <MaterialIcons
                      name={searchQuery ? 'search-off' : 'forum'}
                      size={28}
                      color={theme.colors.textSecondary}
                    />
                  </View>
                  <Text style={styles.emptyTitle}>
                    {searchQuery ? 'No conversations found' : 'Say hello'}
                  </Text>
                  <Text style={styles.emptyDescription}>
                    {searchQuery
                      ? 'Try another name or clear your search.'
                      : 'Add a friend below or create a group to start a conversation.'}
                  </Text>
                </View>
              }
            />
          )}

          <View style={styles.buttons}>
            <View style={styles.footerIdentity}>
              <Text numberOfLines={1} style={styles.footerName}>
                {profile.data?.displayName || currentUsername}
              </Text>
              <View style={styles.secureStatus}>
                <MaterialIcons name="lock-outline" size={12} color={theme.colors.success} />
                <Text style={styles.secureLabel}>Encrypted chats</Text>
              </View>
            </View>
            <UserSettings showSettings={showSettings} setShowSettings={setShowSettings} />
            <FriendRequests />
            <Logout />
          </View>
        </>
      )}
      {joiningGroup && <JoinGroupModal onClose={() => setJoiningGroup(false)} />}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  friendList: {
    backgroundColor: theme.colors.surface,
    width: 348,
    height: '100%',
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderSecondary,
  },
  tabletList: { width: 306 },
  mobileList: { flex: 1, width: '100%' },
  conversations: { flex: 1 },
  conversationContent: { paddingBottom: 12 },
  buttons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSecondary,
  },
  topMenu: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: theme.spacing.md,
    marginTop: 12,
    marginBottom: 18,
    gap: 8,
  },
  groupTrigger: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  pressed: { opacity: 0.7 },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    marginTop: 4,
  },
  retryLabel: { color: theme.colors.background, fontWeight: '600', fontSize: 13 },
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 24,
  },
  brand: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  brandIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#F5BA3014',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: { fontSize: 22, fontWeight: '700', letterSpacing: -0.6 },
  profileTrigger: { padding: 3, borderRadius: 24 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: { fontSize: 25, fontWeight: '700', letterSpacing: -0.7 },
  count: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: theme.colors.card,
    borderRadius: 10,
  },
  search: {
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.colors.card,
    borderRadius: 13,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.text,
    paddingVertical: 13,
    fontSize: 14,
  },
  actionLabel: { fontSize: 12, fontWeight: '500' },
  empty: { padding: 28, paddingTop: 40, alignItems: 'center', gap: 10 },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: theme.colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyDescription: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
  },
  loading: { flex: 1, justifyContent: 'center' },
  footerIdentity: { flex: 1, minWidth: 0, gap: 5 },
  footerName: { fontSize: 13, fontWeight: '600' },
  secureStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  secureLabel: { color: theme.colors.textSecondary, fontSize: 10 },
})
