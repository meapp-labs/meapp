import { MaterialIcons } from '@expo/vector-icons'
import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import Toast from 'react-native-toast-message'

import { Text } from '@/components/common/Text'
import {
  useAddGroupMember,
  useCreateGroupInvite,
  useGetGroupMembers,
  useGroupInvites,
  useRemoveGroupMember,
  useRenameGroup,
  useRevokeGroupInvite,
  useTransferGroupAdmin,
} from '@/services/conversations'
import { theme } from '@/theme/theme'
import { GroupMemberIdentity } from './GroupMemberIdentity'

type GroupManageModalProps = {
  visible: boolean
  onClose: () => void
  roomId: string
  groupName: string
  currentUsername: string
}

export function GroupManageModal({
  visible,
  onClose,
  roomId,
  groupName,
  currentUsername,
}: GroupManageModalProps) {
  const { data: members = [], isLoading, error: memberError } = useGetGroupMembers(roomId, visible)
  const [newGroupName, setNewGroupName] = useState(groupName)
  const [addUsername, setAddUsername] = useState('')
  const [generatedInviteToken, setGeneratedInviteToken] = useState<string | null>(null)

  const renameMutation = useRenameGroup(roomId)
  const addMemberMutation = useAddGroupMember(roomId)
  const removeMemberMutation = useRemoveGroupMember(roomId)
  const transferAdminMutation = useTransferGroupAdmin(roomId)
  const createInviteMutation = useCreateGroupInvite(roomId)

  const currentMember = members.find((m) => m.username === currentUsername)
  const isAdmin = currentMember?.role === 'admin'
  const adminCount = members.filter((m) => m.role === 'admin').length
  const invites = useGroupInvites(roomId, visible && !!isAdmin)
  const revokeInvite = useRevokeGroupInvite(roomId)

  const handleRename = async () => {
    if (!newGroupName.trim() || newGroupName === groupName) return
    try {
      await renameMutation.mutateAsync({ name: newGroupName.trim() })
      Toast.show({ type: 'success', text1: 'Group renamed successfully' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Rename failed'
      Toast.show({ type: 'error', text1: 'Rename failed', text2: msg })
    }
  }

  const handleAddMember = async () => {
    if (!addUsername.trim()) return
    try {
      await addMemberMutation.mutateAsync({ username: addUsername.trim() })
      setAddUsername('')
      Toast.show({ type: 'success', text1: 'Member added successfully' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not add member'
      Toast.show({ type: 'error', text1: 'Failed', text2: msg })
    }
  }

  const handleRemoveMember = async (userId: string, username: string) => {
    try {
      await removeMemberMutation.mutateAsync({ userId })
      Toast.show({ type: 'success', text1: `Removed ${username}` })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not remove member'
      Toast.show({ type: 'error', text1: 'Failed', text2: msg })
    }
  }

  const handlePromoteAdmin = async (userId: string, username: string) => {
    try {
      await transferAdminMutation.mutateAsync({ newAdminUserId: userId })
      Toast.show({ type: 'success', text1: `Promoted ${username} to admin` })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Promotion failed'
      Toast.show({ type: 'error', text1: 'Failed', text2: msg })
    }
  }

  const handleCreateInvite = async () => {
    try {
      const invite = await createInviteMutation.mutateAsync({ expiresInHours: 48, maxUses: 10 })
      if (invite?.token) {
        setGeneratedInviteToken(invite.token)
        Toast.show({ type: 'success', text1: 'Invite token generated' })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not generate invite'
      Toast.show({ type: 'error', text1: 'Invite creation failed', text2: msg })
    }
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close group settings"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Group settings</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close group settings"
              style={styles.iconAction}
              onPress={onClose}
            >
              <MaterialIcons name="close" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Rename Group Section */}
            {isAdmin && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Group Name</Text>
                <View style={styles.row}>
                  <TextInput
                    style={styles.input}
                    accessibilityLabel="Group name"
                    maxLength={100}
                    value={newGroupName}
                    onChangeText={setNewGroupName}
                    placeholder="Enter group name"
                    placeholderTextColor={theme.colors.textTertiary}
                  />
                  <TouchableOpacity
                    style={[styles.smallBtn, renameMutation.isPending && styles.disabledBtn]}
                    disabled={
                      renameMutation.isPending ||
                      !newGroupName.trim() ||
                      newGroupName.trim() === groupName
                    }
                    onPress={handleRename}
                  >
                    {renameMutation.isPending ? (
                      <ActivityIndicator size="small" color={theme.colors.background} />
                    ) : (
                      <Text style={styles.smallBtnText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Add Member Section */}
            {isAdmin && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Add Member</Text>
                <View style={styles.row}>
                  <TextInput
                    style={styles.input}
                    accessibilityLabel="New member username"
                    value={addUsername}
                    onChangeText={setAddUsername}
                    placeholder="Username"
                    autoCapitalize="none"
                    placeholderTextColor={theme.colors.textTertiary}
                  />
                  <TouchableOpacity
                    style={[styles.smallBtn, addMemberMutation.isPending && styles.disabledBtn]}
                    disabled={addMemberMutation.isPending || !addUsername.trim()}
                    onPress={handleAddMember}
                  >
                    {addMemberMutation.isPending ? (
                      <ActivityIndicator size="small" color={theme.colors.background} />
                    ) : (
                      <Text style={styles.smallBtnText}>Add</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Invite Section */}
            {isAdmin && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Expiring Invite</Text>
                <TouchableOpacity
                  style={[
                    styles.secondaryBtn,
                    createInviteMutation.isPending && styles.disabledBtn,
                  ]}
                  disabled={createInviteMutation.isPending}
                  onPress={handleCreateInvite}
                >
                  <MaterialIcons name="link" size={18} color={theme.colors.primary} />
                  <Text style={styles.secondaryBtnText}>
                    {createInviteMutation.isPending ? 'Creating invite…' : 'Create invite token'}
                  </Text>
                </TouchableOpacity>
                {generatedInviteToken && (
                  <View style={styles.tokenBox}>
                    <Text style={styles.tokenLabel}>Share this token:</Text>
                    <Text selectable style={styles.tokenValue}>
                      {generatedInviteToken}
                    </Text>
                  </View>
                )}
                {invites.error && <Text>{invites.error.message}</Text>}
                {revokeInvite.error && <Text>{revokeInvite.error.message}</Text>}
                {invites.data?.map((invite) => (
                  <View key={invite.tokenHash} style={{ marginTop: 8 }}>
                    <Text>
                      {invite.maxUses - invite.usesCount} uses left · expires{' '}
                      {new Date(invite.expiresAt).toLocaleString()}
                    </Text>
                    <TouchableOpacity
                      style={styles.revokeButton}
                      disabled={revokeInvite.isPending}
                      onPress={() => {
                        void revokeInvite
                          .mutateAsync(invite.tokenHash)
                          .then(() => setGeneratedInviteToken(null))
                          .catch(() => undefined)
                      }}
                    >
                      <Text style={styles.revokeText}>Revoke invite</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Members List */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Members ({members.length})</Text>
              {memberError && <Text>{memberError.message}</Text>}
              {isLoading ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : (
                <View style={styles.memberList}>
                  {members.map((member) => {
                    const isSelf = member.username === currentUsername
                    const isMemberAdmin = member.role === 'admin'
                    const canRemove = isAdmin && !isSelf && (!isMemberAdmin || adminCount > 1)
                    const canPromote = isAdmin && !isSelf && !isMemberAdmin

                    return (
                      <View key={member.userId} style={styles.memberRow}>
                        <View style={styles.memberInfo}>
                          <GroupMemberIdentity member={member} isSelf={isSelf} />
                          <View
                            style={[
                              styles.roleBadge,
                              isMemberAdmin ? styles.adminBadge : styles.memberBadge,
                            ]}
                          >
                            <Text
                              style={[
                                styles.roleText,
                                isMemberAdmin ? styles.adminRoleText : styles.memberRoleText,
                              ]}
                            >
                              {isMemberAdmin ? 'Admin' : 'Member'}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.memberActions}>
                          {canPromote && (
                            <TouchableOpacity
                              style={styles.iconAction}
                              onPress={() => handlePromoteAdmin(member.userId, member.username)}
                              accessibilityLabel="Promote to admin"
                              disabled={transferAdminMutation.isPending}
                            >
                              <MaterialIcons
                                name="security"
                                size={18}
                                color={theme.colors.primary}
                              />
                            </TouchableOpacity>
                          )}
                          {canRemove && (
                            <TouchableOpacity
                              style={styles.iconAction}
                              onPress={() => handleRemoveMember(member.userId, member.username)}
                              accessibilityLabel="Remove member"
                              disabled={removeMemberMutation.isPending}
                            >
                              <MaterialIcons
                                name="person-remove"
                                size={18}
                                color={theme.colors.error}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    )
                  })}
                </View>
              )}
            </View>
          </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.md,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '95%',
    backgroundColor: theme.colors.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  content: {
    flexGrow: 0,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: theme.colors.card,
    fontSize: 15,
    color: theme.colors.text,
  },
  smallBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    minHeight: 46,
    paddingHorizontal: theme.spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallBtnText: {
    color: theme.colors.background,
    fontWeight: '600',
    fontSize: 14,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    alignSelf: 'flex-start',
  },
  secondaryBtnText: {
    color: theme.colors.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  tokenBox: {
    marginTop: theme.spacing.xs,
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 12,
  },
  tokenLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 2,
  },
  tokenValue: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: theme.colors.text,
  },
  memberList: {
    gap: theme.spacing.xs,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  memberInfo: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.text,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  adminBadge: {
    backgroundColor: '#F5BA3018',
  },
  memberBadge: {
    backgroundColor: 'rgba(107, 114, 128, 0.15)',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  adminRoleText: {
    color: theme.colors.primary,
  },
  memberRoleText: {
    color: theme.colors.textSecondary,
  },
  memberActions: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  iconAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  revokeButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  revokeText: { color: theme.colors.error, fontSize: 13, fontWeight: '600' },
  disabledBtn: {
    opacity: 0.5,
  },
})
