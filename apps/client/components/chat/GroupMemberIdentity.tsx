import { UserAvatar } from '@/components/UserAvatar'
import { Text } from '@/components/common/Text'
import { useAliases } from '@/services/profiles'
import { theme } from '@/theme/theme'
import type { GroupMember } from '@meapp/shared'
import { StyleSheet, View } from 'react-native'

export function GroupMemberIdentity({
  member,
  isSelf = false,
}: {
  member: GroupMember
  isSelf?: boolean
}) {
  const aliases = useAliases()
  const alias = aliases.data?.find((row) => row.contactId === member.userId)
  const name = alias?.alias || member.displayName || member.username
  return (
    <View style={styles.row}>
      <UserAvatar uri={member.avatarUrl} label={name} size={32} />
      <View style={styles.labels}>
        <Text>
          {name}
          {isSelf ? ' (You)' : ''}
        </Text>
        <Text style={styles.username}>@{member.username}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexShrink: 1 },
  labels: { flexShrink: 1 },
  username: { color: theme.colors.textSecondary, fontSize: 12 },
})
