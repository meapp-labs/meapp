import { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import Toast from 'react-native-toast-message'

import { Text } from '@/components/common/Text'
import { useGetGroupMembers, useLeaveGroup } from '@/services/conversations'
import { theme } from '@/theme/theme'
import { GroupMemberIdentity } from './GroupMemberIdentity'

type LeaveGroupModalProps = {
  visible: boolean
  onClose: () => void
  roomId: string
  currentUsername: string
}

export function LeaveGroupModal({
  visible,
  onClose,
  roomId,
  currentUsername,
}: LeaveGroupModalProps) {
  const { data: members = [], isLoading, error: memberError } = useGetGroupMembers(roomId, visible)
  const leaveGroupMutation = useLeaveGroup()
  const [selectedNewAdminId, setSelectedNewAdminId] = useState<string | null>(null)

  const currentMember = members.find((m) => m.username === currentUsername)
  const isCurrentAdmin = currentMember?.role === 'admin'
  const adminCount = members.filter((m) => m.role === 'admin').length
  const otherMembers = members.filter((m) => m.username !== currentUsername)
  const isSoleAdminWithOthers = isCurrentAdmin && adminCount === 1 && otherMembers.length > 0

  const handleLeave = async () => {
    if (isSoleAdminWithOthers && !selectedNewAdminId) {
      Toast.show({
        type: 'error',
        text1: 'Select an admin',
        text2: 'You must select a new admin before leaving.',
      })
      return
    }

    try {
      await leaveGroupMutation.mutateAsync({
        roomId,
        ...(selectedNewAdminId ? { data: { transferToUserId: selectedNewAdminId } } : {}),
      })
      Toast.show({ type: 'success', text1: 'Left group successfully' })
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not leave group'
      Toast.show({ type: 'error', text1: 'Error', text2: msg })
    }
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 16 }}>
            <Text style={styles.title}>Leave this group?</Text>
            {memberError && <Text>{memberError.message}</Text>}

            {isLoading ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : isSoleAdminWithOthers ? (
              <View style={styles.content}>
                <Text style={styles.warningText}>
                  You are the only admin. You must choose a new admin from the remaining members
                  before leaving:
                </Text>
                <ScrollView style={styles.memberList} nestedScrollEnabled>
                  {otherMembers.map((member) => {
                    const isSelected = selectedNewAdminId === member.userId
                    return (
                      <TouchableOpacity
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected }}
                        key={member.userId}
                        style={[styles.memberItem, isSelected && styles.selectedMemberItem]}
                        onPress={() => setSelectedNewAdminId(member.userId)}
                      >
                        <GroupMemberIdentity member={member} />
                        {isSelected && <Text style={styles.checkText}>Selected</Text>}
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>
              </View>
            ) : (
              <Text style={styles.confirmText}>
                Are you sure you want to leave this group? You will no longer receive messages.
              </Text>
            )}

            <View style={styles.actions}>
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.cancelBtn}
                disabled={leaveGroupMutation.isPending}
                onPress={onClose}
              >
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.leaveBtn, leaveGroupMutation.isPending && styles.disabledBtn]}
                disabled={
                  leaveGroupMutation.isPending ||
                  isLoading ||
                  !!memberError ||
                  (isSoleAdminWithOthers && !selectedNewAdminId)
                }
                onPress={handleLeave}
              >
                {leaveGroupMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.leaveBtnText}>
                    {isSoleAdminWithOthers ? 'Transfer & Leave' : 'Leave Group'}
                  </Text>
                )}
              </TouchableOpacity>
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.md,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '95%',
    backgroundColor: theme.colors.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    gap: theme.spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  content: {
    gap: theme.spacing.sm,
  },
  warningText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  confirmText: {
    fontSize: 15,
    color: theme.colors.textSecondary,
    lineHeight: 23,
  },
  memberList: {
    maxHeight: 200,
    marginVertical: theme.spacing.xs,
  },
  memberItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    minHeight: 56,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.xs,
  },
  selectedMemberItem: {
    borderColor: theme.colors.primary,
    backgroundColor: '#F5BA3010',
  },
  memberName: {
    fontSize: 15,
    fontWeight: '500',
  },
  selectedText: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
  checkText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  cancelBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
  },
  leaveBtn: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: theme.colors.error,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 12,
    alignItems: 'center',
  },
  leaveBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
})
