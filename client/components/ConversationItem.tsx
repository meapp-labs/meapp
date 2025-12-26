import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/common/Text';
import { useAuthStore, useConversationStore } from '@/lib/stores';
import { ConversationStorage } from '@/services/storage';
import { theme } from '@/theme/theme';
import type { Conversation } from '@/types/models';

type ConversationItemProps = {
  conversation: Conversation;
};

function ConversationItem({ conversation }: ConversationItemProps) {
  const [hovered, setHovered] = useState<boolean>(false);
  const { selectedConversation, setSelectedConversation } =
    useConversationStore();
  const { username } = useAuthStore();

  // Filter out current user from display name
  const displayName =
    conversation.name ||
    conversation.participants
      .filter((p) => p !== username && p !== '')
      .join(', ') ||
    'Unknown';
  const isSelected = selectedConversation?.id === conversation.id;

  const handleSelect = () => {
    if (!isSelected) {
      setSelectedConversation(conversation);
      void ConversationStorage.save(conversation.id);
    }
  };

  return (
    <>
      <Pressable
        onPress={handleSelect}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[
          styles.item,
          hovered && styles.itemHovered,
          isSelected && styles.itemSelected,
        ]}
      >
        <View style={styles.container}>
          <MaterialIcons
            name={conversation.isGroup ? 'groups' : 'face'}
            size={38}
            color={theme.colors.text}
          />
          <View style={styles.content}>
            <Text>{displayName}</Text>
            {conversation.lastMessagePreview && (
              <Text style={theme.typography.caption} numberOfLines={1}>
                {conversation.lastMessagePreview}
              </Text>
            )}
          </View>
          <Text style={styles.timestamp}>
            {conversation.lastMessageAt
              ? new Date(conversation.lastMessageAt).toLocaleDateString()
              : ''}
          </Text>
        </View>
      </Pressable>
    </>
  );
}

export default ConversationItem;

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
});
