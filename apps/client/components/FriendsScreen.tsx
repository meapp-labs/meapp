import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native'

import { ConversationItem } from '@/components/ConversationItem'
import { Logout } from '@/components/Logout'
import { CreateGroup } from '@/components/chat/CreateGroup'
import { FriendRequests } from '@/components/chat/FriendRequests'
import { TopMenu } from '@/components/forms/TopMenu'
import { UserSettings } from '@/components/settings/UserSettings'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import { useGetConversations } from '@/services/conversations'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'
import type { Conversation } from '@meapp/shared'

export function FriendsScreen() {
  const { isMobile } = useBreakpoint()
  const { username: currentUsername } = useAuthStore()
  const { selectedConversationId, setSelectedConversationId } = useConversationStore()
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState('')
  const { data: conversations = [], isPending } = useGetConversations()

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
    <View style={[styles.friendList, isMobile && { flex: 1 }]}>
      <View style={styles.topMenu}>
        <TopMenu searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      </View>
      {isPending ? (
        <ActivityIndicator />
      ) : (
        <FlatList<Conversation>
          data={filteredConversations}
          renderItem={({ item }) => <ConversationItem conversation={item} />}
          keyExtractor={(item) => item.id}
        />
      )}

      <View style={styles.buttons}>
        <UserSettings showSettings={showSettings} setShowSettings={setShowSettings} />
        <FriendRequests />
        <CreateGroup />
        <Logout />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  friendList: {
    backgroundColor: theme.colors.surface,
  },
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
})
