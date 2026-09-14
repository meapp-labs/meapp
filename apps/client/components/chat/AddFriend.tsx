import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Text } from '@/components/common/Text';
import { useConversationStore } from '@/lib/stores';
import { useAddFriend } from '@/services/others';
import { ConversationStorage } from '@/services/storage';
import { theme } from '@/theme/theme';

export default function AddFriend() {
  const [showModal, setShowModal] = useState(false);
  const [username, setUsername] = useState('');
  const { setSelectedConversation } = useConversationStore();

  const { mutate, isPending, isError, isSuccess, error, reset } = useAddFriend({
    onSuccess: (conversation) => {
      setSelectedConversation(conversation);
      void ConversationStorage.save(conversation.id);
      setShowModal(false);
      setUsername('');
      reset();
    },
  });

  const handleAdd = () => {
    if (username.trim()) {
      mutate(username);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.triggerButton}
        onPress={() => setShowModal(true)}
      >
        <MaterialIcons name="person-add" size={24} color={theme.colors.text} />
      </TouchableOpacity>

      <Modal transparent animationType="fade" visible={showModal}>
        <Pressable style={styles.overlay} onPress={() => setShowModal(false)}>
          <Pressable
            style={styles.modalContent}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.iconContainer}>
              <MaterialIcons
                name="person-add"
                size={42}
                color={theme.colors.primary}
              />
            </View>

            <Text style={styles.title}>Add Friend</Text>
            <Text style={styles.description}>
              Enter the username of the person you'd like to chat with.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={theme.colors.textTertiary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoFocus
            />

            {isError && (
              <Text style={styles.errorText}>
                {error?.response?.data?.message ??
                  'User not found or already added'}
              </Text>
            )}

            {isSuccess && (
              <Text style={styles.successText}>Friend added successfully!</Text>
            )}

            <View style={styles.buttonContainer}>
              <Pressable
                style={[styles.button, styles.cancelButton]}
                onPress={() => setShowModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[styles.button, styles.confirmButton]}
                onPress={handleAdd}
                disabled={isPending || !username.trim() || isSuccess}
              >
                <Text style={styles.confirmButtonText}>
                  {isPending ? 'Adding...' : 'Add'}
                </Text>
              </Pressable>
            </View>
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
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 186, 48, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  title: {
    ...theme.typography.h2,
    marginBottom: theme.spacing.sm,
    color: theme.colors.text,
  },
  description: {
    ...theme.typography.body,
    textAlign: 'center',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.lg,
    lineHeight: 22,
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    color: theme.colors.text,
    ...theme.typography.body,
    marginBottom: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.error,
    ...theme.typography.caption,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  successText: {
    color: theme.colors.success,
    ...theme.typography.caption,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  buttonContainer: {
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
});
