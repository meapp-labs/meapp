import { MaterialIcons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/common/Text'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import { useConversationPreview } from '@/services/conversations'
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

  const others = conversation.participants.filter(
    (participant) => participant && participant !== username,
  )
  const displayName = conversation.isGroup
    ? conversation.name || others.join(', ') || 'Group'
    : others[0] || 'Unknown'
  const preview = useConversationPreview(conversation)
  const incomingMessagePreview = conversation.lastIncomingMessageEncrypted
    ? (preview.data ??
      (preview.isPending ? 'Loading message…' : 'Message unavailable on this device'))
    : conversation.lastIncomingMessagePreview
  const isSelected = selectedConversationId === conversation.id

  const handleSelect = () => {
    if (!isSelected) {
      setSelectedConversationId(conversation.id)
      void ConversationStorage.save(conversation.id)
    }
  }

  return (
    <Pressable
      onPress={handleSelect}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.item, hovered && styles.itemHovered, isSelected && styles.itemSelected]}
    >
      <View style={styles.container}>
        <MaterialIcons
          name={conversation.isGroup ? 'groups' : 'face'}
          size={38}
          color={theme.colors.text}
        />
        <View style={styles.content}>
          <Text>{displayName}</Text>
          {incomingMessagePreview && (
            <Text style={theme.typography.caption} numberOfLines={1}>
              {incomingMessagePreview}
            </Text>
          )}
        </View>
        <Text style={styles.timestamp}>
          {conversation.lastIncomingMessageAt
            ? new Date(conversation.lastIncomingMessageAt).toLocaleDateString()
            : ''}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: theme.spacing.sm,
    marginVertical: theme.spacing.xs,
    borderRadius: theme.spacing.sm,
    borderColor: theme.colors.surface,
    borderWidth: 1,
  },
  itemHovered: {
    borderColor: theme.colors.secondary,
  },
  itemSelected: {
    backgroundColor: theme.colors.card,
  },
  content: {
    flex: 1,
    flexShrink: 1,
    flexDirection: 'column',
    margin: theme.spacing.sm,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    padding: theme.spacing.sm,
  },
  timestamp: {
    ...theme.typography.caption,
    marginRight: theme.spacing.xs,
  },
})
