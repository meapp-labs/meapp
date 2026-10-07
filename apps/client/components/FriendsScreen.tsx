import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native'

import { ConversationItem } from '@/components/ConversationItem'
import { Logout } from '@/components/Logout'
import { CreateGroup } from '@/components/chat/CreateGroup'
import { FriendRequests } from '@/components/chat/FriendRequests'
import { JoinGroupModal } from '@/components/chat/JoinGroupModal'
import { TopMenu } from '@/components/forms/TopMenu'
import { UserSettings } from '@/components/settings/UserSettings'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import { useGetConversations, useSavedMessages } from '@/services/conversations'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'
import type { Conversation } from '@meapp/shared'
import Toast from 'react-native-toast-message'

export function FriendsScreen() {
  const { isMobile } = useBreakpoint()
  const { username: currentUsername } = useAuthStore()
  const { selectedConversationId, setSelectedConversationId } = useConversationStore()
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [joiningGroup, setJoiningGroup] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { data: conversations = [], isPending } = useGetConversations()
  const saved = useSavedMessages()

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
    <View style={[styles.friendList, isMobile && styles.mobileList]}>
      {creatingGroup ? (
        <CreateGroup onClose={() => setCreatingGroup(false)} />
      ) : (
        <>
          <View style={styles.topMenu}>
            <Pressable
              accessibilityLabel="Open saved messages"
              disabled={saved.isPending}
              style={styles.groupTrigger}
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
              <MaterialIcons name="bookmark" size={24} color={theme.colors.text} />
            </Pressable>
            <TopMenu
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              unreadCount={conversations.reduce(
                (total, conversation) => total + (conversation.unreadCount ?? 0),
                0,
              )}
            />
            <Pressable
              accessibilityLabel="Create group"
              style={styles.groupTrigger}
              onPress={() => setCreatingGroup(true)}
            >
              <MaterialIcons name="group-add" size={24} color={theme.colors.text} />
            </Pressable>
            <Pressable
              accessibilityLabel="Join group with invite"
              style={styles.groupTrigger}
              onPress={() => setJoiningGroup(true)}
            >
              <MaterialIcons name="login" size={24} color={theme.colors.text} />
            </Pressable>
          </View>
          {isPending ? (
            <ActivityIndicator />
          ) : (
            <FlatList<Conversation>
              data={filteredConversations}
              renderItem={({ item }) => <ConversationItem conversation={item} />}
              keyExtractor={(item) => item.id}
              style={styles.conversations}
            />
          )}

          <View style={styles.buttons}>
            <UserSettings showSettings={showSettings} setShowSettings={setShowSettings} />
            <FriendRequests />
            <Logout />
          </View>
        </>
      )}
      {joiningGroup && <JoinGroupModal onClose={() => setJoiningGroup(false)} />}
    </View>
  )
}

const styles = StyleSheet.create({
  friendList: {
    backgroundColor: theme.colors.surface,
    width: 375,
    height: '100%',
    flexShrink: 0,
  },
  mobileList: { flex: 1, width: '100%' },
  conversations: { flex: 1 },
  buttons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    margin: theme.spacing.md,
    alignItems: 'center',
  },
  topMenu: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  groupTrigger: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
