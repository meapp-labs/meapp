import { Text } from '@/components/common/Text'
import { useIgnoredUsers, useUnignoreUser } from '@/services/others'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

export function BlockedUsers() {
  const users = useIgnoredUsers()
  const unblock = useUnignoreUser()
  const [error, setError] = useState('')
  return (
    <View style={{ gap: 16 }}>
      <Text>
        Blocked accounts cannot contact you directly. Existing history is retained. Shared groups
        remain accessible to both of you.
      </Text>
      {users.isPending ? <Text>Loading blocked accounts…</Text> : null}
      {users.error ? (
        <Pressable onPress={() => void users.refetch()}>
          <Text>Could not load blocked accounts. Retry.</Text>
        </Pressable>
      ) : null}
      {!users.isPending && !users.error && !users.data?.length ? (
        <Text>No blocked accounts.</Text>
      ) : null}
      {users.data?.map((username) => (
        <View key={username} style={{ flexDirection: 'row', gap: 16 }}>
          <Text>@{username}</Text>
          <Pressable
            disabled={unblock.isPending}
            onPress={() => {
              setError('')
              void unblock.mutateAsync(username).catch((error) => setError(error.message))
            }}
          >
            <Text>Unblock</Text>
          </Pressable>
        </View>
      ))}
      {error ? <Text>{error}</Text> : null}
    </View>
  )
}
