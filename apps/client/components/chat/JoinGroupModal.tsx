import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { useJoinGroupInvite } from '@/services/conversations'
import { theme } from '@/theme/theme'
import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, ScrollView, TextInput } from 'react-native'

export function JoinGroupModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState('')
  const join = useJoinGroupInvite()
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 16,
          backgroundColor: theme.colors.overlay,
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 24, gap: 16 }}
          style={{
            width: '100%',
            maxWidth: 440,
            backgroundColor: theme.colors.surface,
            maxHeight: '95%',
            flexGrow: 0,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: theme.colors.borderSecondary,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: '700', letterSpacing: -0.5 }}>Join a group</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 }}>
            Have an invitation? Paste the token shared by a group admin to join the conversation.
          </Text>
          <Text style={{ fontSize: 13, fontWeight: '600' }}>Invite token</Text>
          <TextInput
            accessibilityLabel="Group invite token"
            value={token}
            onChangeText={setToken}
            maxLength={256}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste your invite token"
            placeholderTextColor={theme.colors.textTertiary}
            style={{
              padding: 12,
              color: theme.colors.text,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              backgroundColor: theme.colors.card,
              minHeight: 48,
            }}
          />
          {join.error && (
            <Text style={{ color: theme.colors.error, fontSize: 13 }}>{join.error.message}</Text>
          )}
          <Button
            title={join.isPending ? 'Joining…' : 'Join group'}
            loading={join.isPending}
            disabled={join.isPending || !token.trim()}
            onPress={() => {
              void join
                .mutateAsync({ token: token.trim() })
                .then(onClose)
                .catch(() => undefined)
            }}
          />
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={join.isPending} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}
