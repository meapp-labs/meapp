import { Text } from '@/components/common/Text'
import { useJoinGroupInvite } from '@/services/conversations'
import { theme } from '@/theme/theme'
import { useState } from 'react'
import { Button, Modal, TextInput, View } from 'react-native'

export function JoinGroupModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState('')
  const join = useJoinGroupInvite()
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
          backgroundColor: 'rgba(0,0,0,0.6)',
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 440,
            backgroundColor: theme.colors.surface,
            padding: 24,
            gap: 16,
            borderRadius: 12,
          }}
        >
          <Text style={theme.typography.h1}>Join a group</Text>
          <Text>Paste the invite token shared by a group admin.</Text>
          <TextInput
            accessibilityLabel="Group invite token"
            value={token}
            onChangeText={setToken}
            maxLength={256}
            autoCapitalize="none"
            style={{
              padding: 12,
              color: theme.colors.text,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          />
          {join.error && <Text>{join.error.message}</Text>}
          <Button
            title={join.isPending ? 'Joining…' : 'Join group'}
            disabled={join.isPending || !token.trim()}
            onPress={() => {
              void join
                .mutateAsync({ token: token.trim() })
                .then(onClose)
                .catch(() => undefined)
            }}
          />
          <Button title="Cancel" onPress={onClose} disabled={join.isPending} />
        </View>
      </View>
    </Modal>
  )
}
