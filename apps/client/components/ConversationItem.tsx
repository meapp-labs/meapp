import { MaterialIcons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { UserAvatar } from '@/components/UserAvatar'
import { Text } from '@/components/common/Text'
import { chatColors, useAuthStore, useChatColor, useConversationStore } from '@/lib/stores'
import { useConversationPreview } from '@/services/conversations'
import { useContactPresentation } from '@/services/profiles'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'
import type { Conversation } from '@meapp/shared'

type ConversationItemProps = {
  conversation: Conversation
}

export function ConversationItem({ conversation }: ConversationItemProps) {
  const [hovered, setHovered] = useState<boolean>(false)
  const { selectedConversationId, setSelectedConversationId } = useConversationStore()
  const { username } = useAuthStore()
  const chatColor = useChatColor(conversation.id)
  const customized = chatColor !== chatColors[0].color

  const others = conversation.participants.filter(
    (participant) => participant && participant !== username,
  )
  const contact = useContactPresentation(conversation.isGroup ? '' : (others[0] ?? ''))
  const displayName =
    conversation.type === 'saved'
      ? 'Saved messages'
      : conversation.isGroup
        ? conversation.name || others.join(', ') || 'Group'
        : contact.name || 'Unknown'
  const preview = useConversationPreview(conversation)
  const incomingMessagePreview = conversation.lastIncomingMessageEncrypted
    ? (preview.data ??
      (preview.isPending ? 'Loading message…' : 'Message unavailable on this device'))
    : conversation.lastIncomingMessagePreview
  const isSelected = selectedConversationId === conversation.id
  const messageDate = conversation.lastIncomingMessageAt
    ? new Date(conversation.lastIncomingMessageAt)
    : null
  const timestamp = messageDate
    ? messageDate.toDateString() === new Date().toDateString()
      ? messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : messageDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : ''

  const handleSelect = () => {
    if (!isSelected) {
      setSelectedConversationId(conversation.id)
      void ConversationStorage.save(conversation.id)
    }
  }

  return (
    <Pressable
      onPress={handleSelect}
      accessibilityRole="button"
      accessibilityLabel={`Open ${displayName}${conversation.unreadCount ? `, ${conversation.unreadCount} unread messages` : ''}`}
      accessibilityState={{ selected: isSelected }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.item,
        hovered && styles.itemHovered,
        isSelected && styles.itemSelected,
        customized && {
          backgroundColor: chatColor,
          borderColor: isSelected ? theme.colors.primary : theme.colors.border,
          borderLeftWidth: 3,
        },
        pressed && styles.itemPressed,
      ]}
    >
      <View style={styles.container}>
        {conversation.isGroup || conversation.type === 'saved' ? (
          <View style={styles.groupAvatar}>
            <MaterialIcons
              name={conversation.type === 'saved' ? 'bookmark-border' : 'groups'}
              size={24}
              color={theme.colors.primary}
            />
          </View>
        ) : (
          <UserAvatar uri={contact.profile?.avatarUrl} size={46} label={displayName} />
        )}
        <View style={styles.content}>
          <Text
            style={[styles.name, !!conversation.unreadCount && styles.unreadName]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>
            {incomingMessagePreview ||
              (conversation.type === 'saved'
                ? 'A little space for yourself'
                : conversation.isGroup
                  ? `${conversation.participants.length} members · Start the conversation`
                  : `@${contact.profile?.username ?? others[0]}`)}
          </Text>
        </View>
        <View style={styles.metadata}>
          <Text style={styles.timestamp}>{timestamp}</Text>
          {!!conversation.unreadCount && (
            <View style={styles.unreadBadge}>
              <Text
                style={styles.unreadCount}
                accessibilityLabel={`${conversation.unreadCount} unread messages`}
              >
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount} new
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: theme.spacing.sm,
    marginVertical: 3,
    borderRadius: 16,
    borderColor: 'transparent',
    borderWidth: 1,
  },
  itemHovered: {
    backgroundColor: theme.colors.card,
  },
  itemSelected: {
    backgroundColor: '#F5BA3012',
    borderColor: '#F5BA3033',
  },
  itemPressed: { opacity: 0.75 },
  groupAvatar: {
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: '#F5BA3014',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 14, fontWeight: '600', marginBottom: 5 },
  unreadName: { color: theme.colors.text },
  preview: { fontSize: 12, color: theme.colors.textSecondary, lineHeight: 18 },
  content: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'column',
    marginLeft: 12,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    padding: 12,
    minHeight: 78,
  },
  timestamp: {
    fontSize: 10,
    color: theme.colors.textSecondary,
  },
  metadata: {
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: theme.spacing.xs,
    marginLeft: theme.spacing.xs,
  },
  unreadBadge: {
    backgroundColor: '#263B55',
    minWidth: 24,
    minHeight: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#476588',
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
})
