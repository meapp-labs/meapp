import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Text } from '@/components/common/Text';
import { useConversationStore } from '@/lib/stores';
import { useCreateConversation } from '@/services/conversations';
import { useGetFriends } from '@/services/others';
import { ConversationStorage } from '@/services/storage';
import { theme } from '@/theme/theme';

export default function CreateGroup() {
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');

  const { data: friends = [] } = useGetFriends();
  const { setSelectedConversation } = useConversationStore();
  const { mutate: createGroup, isPending } = useCreateConversation();

  const handleToggleFriend = (friend: string) => {
    setSelectedFriends((prev) =>
      prev.includes(friend)
        ? prev.filter((f) => f !== friend)
        : [...prev, friend],
    );
  };

  const handleCreate = () => {
    if (!groupName.trim() || selectedFriends.length === 0) return;

    createGroup(
      {
        type: 'group',
        participants: selectedFriends,
        name: groupName.trim(),
      },
      {
        onSuccess: (conversation) => {
          setSelectedConversation(conversation);
          void ConversationStorage.save(conversation.id);
          handleClose();
        },
      },
    );
  };

  const handleClose = () => {
    setShowModal(false);
    setStep(1);
    setSelectedFriends([]);
    setGroupName('');
  };

  const renderFriend = ({ item: friend }: { item: string }) => {
    const isSelected = selectedFriends.includes(friend);
    return (
      <TouchableOpacity
        style={[styles.friendItem, isSelected && styles.friendItemSelected]}
        onPress={() => handleToggleFriend(friend)}
      >
        <MaterialIcons
          name={isSelected ? 'check-box' : 'check-box-outline-blank'}
          size={24}
          color={isSelected ? theme.colors.primary : theme.colors.textSecondary}
        />
        <Text style={styles.friendName}>{friend}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <TouchableOpacity
        style={styles.triggerButton}
        onPress={() => setShowModal(true)}
      >
        <MaterialIcons name="groups" size={24} color={theme.colors.text} />
      </TouchableOpacity>

      <Modal transparent animationType="fade" visible={showModal}>
        <Pressable style={styles.overlay} onPress={handleClose}>
          <Pressable
            style={styles.modalContent}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.header}>
              <Text style={styles.title}>
                {step === 1 ? 'New Group' : 'Group Details'}
              </Text>
            </View>

            {step === 1 ? (
              <View style={styles.stepContainer}>
                <Text style={styles.description}>
                  Select friends to add to the new group chat.
                </Text>
                <View style={styles.listContainer}>
                  <FlatList
                    data={friends}
                    renderItem={renderFriend}
                    keyExtractor={(item) => item}
                    style={styles.friendList}
                    ListEmptyComponent={
                      <Text style={styles.emptyText}>No friends found.</Text>
                    }
                  />
                </View>
                <Text style={styles.counter}>
                  {selectedFriends.length} friend(s) selected
                </Text>
                <View style={styles.footerButtons}>
                  <Pressable
                    style={[styles.button, styles.cancelButton]}
                    onPress={handleClose}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.button,
                      styles.confirmButton,
                      selectedFriends.length === 0 && styles.disabledButton,
                    ]}
                    onPress={() => setStep(2)}
                    disabled={selectedFriends.length === 0}
                  >
                    <Text style={styles.confirmButtonText}>Next</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.stepContainer}>
                <View style={styles.iconPreview}>
                  <MaterialIcons
                    name="groups"
                    size={42}
                    color={theme.colors.primary}
                  />
                </View>
                <Text style={styles.description}>
                  Give your group a name to get started.
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Group Name"
                  placeholderTextColor={theme.colors.textTertiary}
                  value={groupName}
                  onChangeText={setGroupName}
                  autoFocus
                />
                <View style={styles.footerButtons}>
                  <Pressable
                    style={[styles.button, styles.cancelButton]}
                    onPress={() => setStep(1)}
                  >
                    <Text style={styles.cancelButtonText}>Back</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.button,
                      styles.confirmButton,
                      (!groupName.trim() || isPending) && styles.disabledButton,
                    ]}
                    onPress={handleCreate}
                    disabled={!groupName.trim() || isPending}
                  >
                    <Text style={styles.confirmButtonText}>
                      {isPending ? 'Creating...' : 'Create'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  triggerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.xl,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    marginBottom: theme.spacing.md,
    alignItems: 'center',
  },
  title: {
    ...theme.typography.h2,
    color: theme.colors.text,
  },
  description: {
    ...theme.typography.body,
    textAlign: 'center',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.lg,
    lineHeight: 20,
  },
  stepContainer: {
    width: '100%',
    alignItems: 'center',
  },
  listContainer: {
    width: '100%',
    maxHeight: 200,
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.md,
  },
  friendList: {
    width: '100%',
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  friendItemSelected: {
    backgroundColor: 'rgba(245, 186, 48, 0.05)',
  },
  friendName: {
    ...theme.typography.body,
    color: theme.colors.text,
  },
  counter: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.lg,
  },
  iconPreview: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 186, 48, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    color: theme.colors.text,
    ...theme.typography.body,
    marginBottom: theme.spacing.lg,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    width: '100%',
  },
  button: {
    flex: 1,
    height: 50,
    borderRadius: theme.spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.card,
  },
  confirmButton: {
    backgroundColor: theme.colors.primary,
  },
  cancelButtonText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  confirmButtonText: {
    ...theme.typography.body,
    color: 'black',
    fontWeight: '600',
  },
  emptyText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    padding: theme.spacing.xl,
  },
});
