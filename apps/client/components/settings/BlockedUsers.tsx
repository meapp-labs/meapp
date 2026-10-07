import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { useIgnoredUsers, useUnignoreUser } from '@/services/others'
import { theme } from '@/theme/theme'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

export function BlockedUsers() {
  const users = useIgnoredUsers()
  const unblock = useUnignoreUser()
  const [error, setError] = useState('')
  return (
    <View style={styles.container}>
      <Text style={styles.description}>
        Blocked accounts cannot contact you directly. Existing history is retained. Shared groups
        remain accessible to both of you.
      </Text>
      {users.isPending ? <Text style={styles.description}>Loading blocked accounts…</Text> : null}
      {users.error ? (
        <View style={styles.empty}>
          <Text style={styles.description}>Could not load blocked accounts.</Text>
          <Button title="Try again" variant="outline" onPress={() => void users.refetch()} />
        </View>
      ) : null}
      {!users.isPending && !users.error && !users.data?.length ? (
        <View style={styles.empty}>
          <MaterialIcons name="verified-user" size={30} color={theme.colors.textTertiary} />
          <Text style={styles.emptyTitle}>No blocked accounts</Text>
          <Text style={styles.description}>
            You can block someone from their profile whenever you need to.
          </Text>
        </View>
      ) : null}
      {users.data?.map((username) => (
        <View key={username} style={styles.userRow}>
          <View style={styles.avatar}>
            <Text style={styles.initial}>{username.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.username}>@{username}</Text>
          <Button
            title="Unblock"
            variant="outline"
            disabled={unblock.isPending}
            onPress={() => {
              setError('')
              void unblock.mutateAsync(username).catch((error) => setError(error.message))
            }}
          />
        </View>
      ))}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 18 },
  description: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 23 },
  empty: {
    gap: 14,
    padding: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  userRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { color: theme.colors.primary, fontWeight: '600', fontSize: 17 },
  username: { flex: 1, minWidth: 80, fontSize: 14, fontWeight: '500' },
  error: { color: theme.colors.error, fontSize: 14, lineHeight: 22 },
})
