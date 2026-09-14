import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import DeleteFriend from '@/components/chat/DeleteFriend';
import { Text } from '@/components/common/Text';
import { useAuthStore, useConversationStore } from '@/lib/stores';
import { ConversationStorage } from '@/services/storage';
import { theme } from '@/theme/theme';

/**
 * Get display name for the conversation header
 */
function getDisplayName(
  conversation: {
    participants: string[];
    name?: string;
    isGroup: boolean;
  } | null,
  currentUsername: string,
): string {
  if (!conversation) return '';
  if (conversation.name) return conversation.name;
  const other = conversation.participants.find((p) => p !== currentUsername);
  return other || 'Chat';
}

export function ChatHeader() {
  const { selectedConversation, setSelectedConversation } =
    useConversationStore();
  const { username } = useAuthStore();
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handlePress = () => {
    setSelectedConversation(null);
    void ConversationStorage.clear();
  };

  const handleDelete = () => {
    setShowMenu(false);
    setSelectedConversation(null);
    void ConversationStorage.clear();
  };

  const displayName = getDisplayName(selectedConversation, username);
  const isGroup = selectedConversation?.isGroup ?? false;
  // For DM, finding the other participant name for the delete modal
  const otherParticipant =
    selectedConversation?.participants.find((p) => p !== username) || '';

  return (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <TouchableOpacity onPress={handlePress}>
          <MaterialIcons
            name="arrow-back"
            size={34}
            color={theme.colors.text}
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.contactInfo}>
          <MaterialIcons
            name={isGroup ? 'groups' : 'face'}
            size={34}
            color={theme.colors.text}
          />
          <Text style={styles.contactName}>{displayName}</Text>
        </TouchableOpacity>
      </View>

      <View>
        <TouchableOpacity onPress={() => setShowMenu(true)}>
          <MaterialIcons name="more-vert" size={34} color={theme.colors.text} />
        </TouchableOpacity>

        <Modal
          transparent
          visible={showMenu}
          animationType="fade"
          onRequestClose={() => setShowMenu(false)}
        >
          <Pressable
            style={styles.menuOverlay}
            onPress={() => setShowMenu(false)}
          >
            <View style={styles.menuContainer}>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowMenu(false);
                  setShowDeleteModal(true);
                }}
              >
                <MaterialIcons
                  name="person-remove"
                  size={20}
                  color={theme.colors.error}
                />
                <Text style={{ color: theme.colors.error }}>
                  {isGroup ? 'Leave Group' : 'Remove Friend'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>
      </View>

      {showDeleteModal && (
        <DeleteFriend
          friend={otherParticipant}
          onChange={(_, removed) => {
            if (removed) handleDelete();
            setShowDeleteModal(false);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    margin: theme.spacing.md,
    marginVertical: theme.spacing.lg,
    zIndex: 1,
  },
  contactInfo: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  contactName: {
    ...theme.typography.h1,
  },
  innerContainer: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  menuContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    minWidth: 150,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
  },
});
