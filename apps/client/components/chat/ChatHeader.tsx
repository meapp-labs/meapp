import { MaterialIcons } from '@expo/vector-icons'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native'

import { DeleteFriend } from '@/components/chat/DeleteFriend'
import { Text } from '@/components/common/Text'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import { useSelectedConversation } from '@/services/conversations'
import {
  type SafetyNumber,
  confirmConversationSafetyNumber,
  getConversationSafetyNumber,
} from '@/services/e2e'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'

/**
 * Get display name for the conversation header
 */
function getDisplayName(
  conversation: {
    participants: string[]
    name?: string | undefined
    isGroup: boolean
  } | null,
  currentUsername: string,
): string {
  if (!conversation) return ''
  if (conversation.name) return conversation.name
  const other = conversation.participants.find((p) => p !== currentUsername)
  return other || 'Chat'
}

export function ChatHeader() {
  const { setSelectedConversationId } = useConversationStore()
  const selectedConversation = useSelectedConversation()
  const { username } = useAuthStore()
  const [showMenu, setShowMenu] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showSafetyModal, setShowSafetyModal] = useState(false)
  const [safetyNumber, setSafetyNumber] = useState<SafetyNumber | null>(null)
  const [safetyError, setSafetyError] = useState('')

  const handlePress = () => {
    setSelectedConversationId(null)
    void ConversationStorage.clear()
  }

  const handleDelete = () => {
    setShowMenu(false)
    setSelectedConversationId(null)
    void ConversationStorage.clear()
  }

  const displayName = getDisplayName(selectedConversation, username)
  const isGroup = selectedConversation?.isGroup ?? false
  // For DM, finding the other participant name for the delete modal
  const otherParticipant = selectedConversation?.participants.find((p) => p !== username) || ''

  const openSafetyNumber = () => {
    if (!selectedConversation?.id) return
    setShowMenu(false)
    setSafetyNumber(null)
    setSafetyError('')
    setShowSafetyModal(true)
    void getConversationSafetyNumber(selectedConversation.id)
      .then(setSafetyNumber)
      .catch((error: unknown) =>
        setSafetyError(error instanceof Error ? error.message : 'Could not load safety number'),
      )
  }

  return (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <TouchableOpacity onPress={handlePress}>
          <MaterialIcons name="arrow-back" size={34} color={theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.contactInfo}>
          <MaterialIcons name={isGroup ? 'groups' : 'face'} size={34} color={theme.colors.text} />
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
          <Pressable style={styles.menuOverlay} onPress={() => setShowMenu(false)}>
            <View style={styles.menuContainer}>
              {!isGroup && (
                <TouchableOpacity style={styles.menuItem} onPress={openSafetyNumber}>
                  <MaterialIcons name="verified-user" size={20} color={theme.colors.text} />
                  <Text>Verify encryption</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowMenu(false)
                  setShowDeleteModal(true)
                }}
              >
                <MaterialIcons name="person-remove" size={20} color={theme.colors.error} />
                <Text style={{ color: theme.colors.error }}>
                  {isGroup ? 'Leave Group' : 'Remove Friend'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>
        <Modal
          transparent
          visible={showSafetyModal}
          animationType="fade"
          onRequestClose={() => setShowSafetyModal(false)}
        >
          <View style={styles.safetyOverlay}>
            <View style={styles.safetyCard}>
              <Text style={styles.safetyTitle}>Compare safety numbers</Text>
              <Text>{`Compare this number with ${otherParticipant} using a separate trusted channel.`}</Text>
              {safetyNumber ? (
                <>
                  <Text selectable style={styles.safetyCode}>
                    {safetyNumber.numeric.match(/.{1,5}/g)?.join(' ') ?? safetyNumber.numeric}
                  </Text>
                  <Text>
                    {safetyNumber.trustState === 'VERIFIED' ? 'Verified' : 'Not verified yet'}
                  </Text>
                  {safetyNumber.trustState !== 'VERIFIED' && (
                    <TouchableOpacity
                      style={styles.safetyButton}
                      onPress={() => {
                        void confirmConversationSafetyNumber(safetyNumber)
                          .then(() => setSafetyNumber({ ...safetyNumber, trustState: 'VERIFIED' }))
                          .catch((error: unknown) =>
                            setSafetyError(
                              error instanceof Error ? error.message : 'Verification failed',
                            ),
                          )
                      }}
                    >
                      <Text>I compared it and it matches</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <Text>{safetyError || 'Loading encryption identity…'}</Text>
              )}
              {safetyError && safetyNumber && (
                <Text style={{ color: theme.colors.error }}>{safetyError}</Text>
              )}
              <TouchableOpacity
                style={styles.safetyButton}
                onPress={() => setShowSafetyModal(false)}
              >
                <Text>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>

      {showDeleteModal && (
        <DeleteFriend
          friend={otherParticipant}
          onChange={(_pressed: string | null, removed: string | null) => {
            if (removed) handleDelete()
            setShowDeleteModal(false)
          }}
        />
      )}
    </View>
  )
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
  safetyOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    padding: theme.spacing.lg,
  },
  safetyCard: {
    width: '100%',
    maxWidth: 440,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    gap: theme.spacing.md,
  },
  safetyTitle: { ...theme.typography.h1 },
  safetyCode: { lineHeight: 28, letterSpacing: 2 },
  safetyButton: { padding: theme.spacing.sm, alignSelf: 'flex-end' },
})
