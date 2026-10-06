import { Text } from '@/components/common/Text'
import { useEditAlias } from '@/services/profiles'
import { theme } from '@/theme/theme'
import { useState } from 'react'
import { Button, Modal, TextInput, View } from 'react-native'

export function ContactAliasEditor({
  contactId,
  revision,
  initialAlias,
  username,
  onClose,
}: {
  contactId: string
  revision: number
  initialAlias: string | null
  username: string
  onClose: () => void
}) {
  const [alias, setAlias] = useState(initialAlias ?? '')
  // Preserve the revision of the draft, even if background polling finds a newer edit.
  const [draftRevision] = useState(revision)
  const edit = useEditAlias()
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.75)',
          padding: 24,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 440,
            padding: 24,
            gap: 16,
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
          }}
        >
          <Text style={theme.typography.h1}>Private contact alias</Text>
          <Text>@{username}</Text>
          <Text>
            Only your account sees this name. It syncs encrypted to linked devices. Leave blank to
            use their public name.
          </Text>
          <TextInput
            accessibilityLabel="Private contact alias"
            maxLength={80}
            value={alias}
            onChangeText={setAlias}
            style={{
              color: theme.colors.text,
              borderWidth: 1,
              borderColor: theme.colors.textSecondary,
              padding: 12,
            }}
          />
          {edit.error && <Text>{edit.error.message}</Text>}
          <Button
            title="Save alias"
            disabled={edit.isPending}
            onPress={() => {
              void edit
                .mutateAsync({ contactId, revision: draftRevision, alias })
                .then(onClose)
                .catch(() => undefined)
            }}
          />
          <Button title="Cancel" disabled={edit.isPending} onPress={onClose} />
        </View>
      </View>
    </Modal>
  )
}
