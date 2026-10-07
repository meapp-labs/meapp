import { MaterialIcons } from '@expo/vector-icons'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native'

import { ContactAliasEditor } from '@/components/ContactAliasEditor'
import { UserAvatar } from '@/components/UserAvatar'
import { DeleteFriend } from '@/components/chat/DeleteFriend'
import { GroupManageModal } from '@/components/chat/GroupManageModal'
import { LeaveGroupModal } from '@/components/chat/LeaveGroupModal'
import { Text } from '@/components/common/Text'
import { useAuthStore, useConversationStore } from '@/lib/stores'
import { useSelectedConversation } from '@/services/conversations'
import {
  type SafetyNumber,
  confirmConversationSafetyNumber,
  getConversationSafetyNumber,
} from '@/services/e2e'
import { useConversationMute } from '@/services/notificationPreferences'
import { useIgnoreFriendRequest, useIgnoredUsers, useUnignoreUser } from '@/services/others'
import { useContactPresentation } from '@/services/profiles'
import { ConversationStorage } from '@/services/storage'
import { theme } from '@/theme/theme'
import { HistoryToolsModal } from './HistoryToolsModal'

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
  const other = conversation.participants.find((p) => p !== currentUsername)
  if (!conversation.isGroup) return other || 'Chat'
  return conversation.name || conversation.participants.join(', ') || 'Group'
}

export function ChatHeader() {
  const { setSelectedConversationId } = useConversationStore()
  const selectedConversation = useSelectedConversation()
  const mute = useConversationMute(selectedConversation?.id)
  const { username } = useAuthStore()
  const [showMenu, setShowMenu] = useState(false)
  const [historyMode, setHistoryMode] = useState<'search' | 'files' | null>(null)
  const [showAlias, setShowAlias] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showGroupManageModal, setShowGroupManageModal] = useState(false)
  const [showSafetyModal, setShowSafetyModal] = useState(false)
  const [safetyNumber, setSafetyNumber] = useState<SafetyNumber | null>(null)
  const [safetyError, setSafetyError] = useState('')
  const [blockError, setBlockError] = useState('')

  const handlePress = () => {
    setSelectedConversationId(null)
    void ConversationStorage.clear()
  }

  const handleDelete = () => {
    setShowMenu(false)
    setSelectedConversationId(null)
    void ConversationStorage.clear()
  }

  const isGroup = selectedConversation?.isGroup ?? false
  const isSaved = selectedConversation?.type === 'saved'
  // For DM, finding the other participant name for the delete modal
  const otherParticipant = selectedConversation?.participants.find((p) => p !== username) || ''
  const contact = useContactPresentation(isGroup ? '' : otherParticipant)
  const blockedUsers = useIgnoredUsers()
  const block = useIgnoreFriendRequest()
  const unblock = useUnignoreUser()
  const isBlocked = blockedUsers.data?.includes(otherParticipant) ?? false
  const displayName = isSaved
    ? 'Saved messages'
    : isGroup
      ? getDisplayName(selectedConversation, username)
      : contact.name

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
        <TouchableOpacity
          style={styles.contactInfo}
          onPress={() => {
            if (isGroup) setShowGroupManageModal(true)
          }}
        >
          {isGroup ? (
            <MaterialIcons name="groups" size={34} color={theme.colors.text} />
          ) : (
            <UserAvatar uri={contact.profile?.avatarUrl} size={34} label={displayName} />
          )}
          <View>
            <Text style={styles.contactName}>{displayName}</Text>
            {!isGroup && !isSaved && <Text>@{otherParticipant}</Text>}
          </View>
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
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowMenu(false)
                  setHistoryMode('search')
                }}
              >
                <MaterialIcons name="search" size={20} color={theme.colors.text} />
                <Text>Search chat</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowMenu(false)
                  setHistoryMode('files')
                }}
              >
                <MaterialIcons name="folder" size={20} color={theme.colors.text} />
                <Text>Shared files</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                disabled={!mute.data || mute.update.isPending}
                onPress={() => {
                  if (mute.data)
                    void mute.update.mutateAsync(!mute.data.muted).catch(() => undefined)
                }}
              >
                <MaterialIcons
                  name={mute.data?.muted ? 'notifications-off' : 'notifications'}
                  size={20}
                  color={theme.colors.text}
                />
                <Text>{mute.data?.muted ? 'Unmute chat' : 'Mute chat'}</Text>
              </TouchableOpacity>
              {(mute.isError || mute.update.isError) && (
                <Text>Unable to update chat notifications. Try again.</Text>
              )}
              {!isGroup && contact.profile && contact.alias && !contact.aliasError && (
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    setShowMenu(false)
                    setShowAlias(true)
                  }}
                >
                  <Text>Edit private alias</Text>
                </TouchableOpacity>
              )}
              {contact.aliasError && (
                <Text>Private aliases unavailable. Link this device or retry.</Text>
              )}
              {isGroup ? (
                <>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      setShowMenu(false)
                      setShowGroupManageModal(true)
                    }}
                  >
                    <MaterialIcons name="settings" size={20} color={theme.colors.text} />
                    <Text>Group Settings</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      setShowMenu(false)
                      setShowLeaveModal(true)
                    }}
                  >
                    <MaterialIcons name="exit-to-app" size={20} color={theme.colors.error} />
                    <Text style={{ color: theme.colors.error }}>Leave Group</Text>
                  </TouchableOpacity>
                </>
              ) : !isSaved ? (
                <>
                  <TouchableOpacity
                    style={styles.menuItem}
                    disabled={
                      block.isPending ||
                      unblock.isPending ||
                      blockedUsers.isPending ||
                      blockedUsers.isError
                    }
                    onPress={() => {
                      setBlockError('')
                      void (isBlocked ? unblock : block)
                        .mutateAsync(otherParticipant)
                        .then(() => setShowMenu(false))
                        .catch((error: unknown) =>
                          setBlockError(
                            error instanceof Error ? error.message : 'Could not update blocking',
                          ),
                        )
                    }}
                  >
                    <MaterialIcons name="block" size={20} color={theme.colors.error} />
                    <Text>{isBlocked ? 'Unblock account' : 'Block account'}</Text>
                  </TouchableOpacity>
                  {(blockError || blockedUsers.isError) && (
                    <Text>
                      {blockError || 'Could not load blocked accounts. Retry in settings.'}
                    </Text>
                  )}
                  <TouchableOpacity style={styles.menuItem} onPress={openSafetyNumber}>
                    <MaterialIcons name="verified-user" size={20} color={theme.colors.text} />
                    <Text>Verify encryption</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      setShowMenu(false)
                      setShowDeleteModal(true)
                    }}
                  >
                    <MaterialIcons name="person-remove" size={20} color={theme.colors.error} />
                    <Text style={{ color: theme.colors.error }}>Remove Friend</Text>
                  </TouchableOpacity>
                </>
              ) : null}
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

      {!isGroup && showDeleteModal && (
        <DeleteFriend
          friend={otherParticipant}
          onChange={(_pressed: string | null, removed: string | null) => {
            if (removed) handleDelete()
            setShowDeleteModal(false)
          }}
        />
      )}
      {historyMode && selectedConversation?.id && (
        <HistoryToolsModal
          key={selectedConversation.id}
          roomId={selectedConversation.id}
          filesOnly={historyMode === 'files'}
          onClose={() => setHistoryMode(null)}
        />
      )}
      {showAlias && contact.profile && contact.alias && (
        <ContactAliasEditor
          key={contact.profile.id}
          contactId={contact.profile.id}
          revision={contact.alias.revision}
          initialAlias={contact.alias.alias}
          username={contact.profile.username}
          onClose={() => setShowAlias(false)}
        />
      )}

      {isGroup && selectedConversation?.id && showLeaveModal && (
        <LeaveGroupModal
          visible={showLeaveModal}
          onClose={() => setShowLeaveModal(false)}
          roomId={selectedConversation.id}
          currentUsername={username}
        />
      )}

      {isGroup && selectedConversation?.id && showGroupManageModal && (
        <GroupManageModal
          visible={showGroupManageModal}
          onClose={() => setShowGroupManageModal(false)}
          roomId={selectedConversation.id}
          groupName={selectedConversation.name || displayName}
          currentUsername={username}
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
