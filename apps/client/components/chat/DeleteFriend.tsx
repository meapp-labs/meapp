import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Text } from '@/components/common/Text'
import { Keys } from '@/lib/keys'
import { queryClient } from '@/lib/queryInit'
import { useRemoveFriend } from '@/services/others'
import { theme } from '@/theme/theme'

type DeleteFriendProps = {
  friend: string
  onChange: (pressed: string | null, removed: string | null) => void
}

export function DeleteFriend({ friend, onChange }: DeleteFriendProps) {
  const { mutate, isPending, error } = useRemoveFriend({
    onSuccess: () => {
      void queryClient.refetchQueries({
        queryKey: [Keys.Query.GET_FRIENDS],
      })
      onChange(null, friend)
    },
  })

  return (
    <Modal
      transparent
      animationType="fade"
      visible={true}
      onRequestClose={() => onChange(friend, null)}
    >
      <Pressable style={styles.overlay} onPress={() => onChange(friend, null)}>
        <Pressable style={styles.modalContent} onPress={(event) => event.stopPropagation()}>
          <ScrollView
            style={{ width: '100%', flexGrow: 0 }}
            contentContainerStyle={{ alignItems: 'center' }}
          >
            <View style={styles.iconContainer}>
              <MaterialIcons name="person-remove" size={42} color={theme.colors.error} />
            </View>

            <Text style={styles.title}>Remove Friend?</Text>
            <Text style={styles.description}>
              Are you sure you want to remove <Text style={styles.name}>{friend}</Text>? This action
              will hide the conversation from your list.
            </Text>

            {error && (
              <Text style={styles.error}>{error.response?.data?.message ?? error.message}</Text>
            )}
            <View style={styles.buttonContainer}>
              <Pressable
                accessibilityRole="button"
                disabled={isPending}
                style={[styles.button, styles.cancelButton]}
                onPress={() => onChange(friend, null)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                style={[styles.button, styles.confirmButton]}
                onPress={() => mutate(friend)}
                disabled={isPending}
              >
                <Text style={styles.confirmButtonText}>{isPending ? 'Removing...' : 'Remove'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
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
    padding: theme.spacing.lg,
    width: '100%',
    maxWidth: 340,
    maxHeight: '95%',
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
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
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  title: {
    ...theme.typography.h2,
    marginBottom: theme.spacing.sm,
    color: theme.colors.text,
    fontWeight: '700',
  },
  description: {
    ...theme.typography.body,
    textAlign: 'center',
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xl,
    lineHeight: 22,
  },
  name: {
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    width: '100%',
  },
  error: {
    color: theme.colors.error,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16,
    textAlign: 'center',
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
    backgroundColor: theme.colors.error,
  },
  cancelButtonText: {
    ...theme.typography.body,
    color: theme.colors.textSecondary,
  },
  confirmButtonText: {
    ...theme.typography.body,
    color: 'white',
    fontWeight: '600',
  },
})
