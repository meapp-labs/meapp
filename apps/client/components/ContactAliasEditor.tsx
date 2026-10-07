import { Text } from '@/components/common/Text'
import { useEditAlias } from '@/services/profiles'
import { theme } from '@/theme/theme'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native'

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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            borderRadius: 24,
            borderWidth: 1,
            borderColor: theme.colors.borderSecondary,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MaterialIcons name="lock-outline" size={24} color={theme.colors.primary} />
            <Text style={{ fontSize: 22, fontWeight: '600', flex: 1 }}>Private contact name</Text>
          </View>
          <Text style={{ color: theme.colors.textSecondary }}>@{username}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 }}>
            Only you see this name. It syncs securely to linked devices. Leave it blank to use their
            public name.
          </Text>
          <Text style={{ fontSize: 13, fontWeight: '600' }}>Contact name</Text>
          <TextInput
            accessibilityLabel="Private contact alias"
            maxLength={80}
            value={alias}
            onChangeText={setAlias}
            placeholder="Enter a familiar name"
            placeholderTextColor={theme.colors.textTertiary}
            editable={!edit.isPending}
            style={{
              color: theme.colors.text,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.backgroundSecondary,
              borderRadius: 12,
              fontSize: 16,
              padding: 14,
            }}
          />
          {edit.error && (
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: theme.colors.error, fontSize: 14 }}
            >
              {edit.error.message}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: edit.isPending, disabled: edit.isPending }}
            disabled={edit.isPending}
            style={({ pressed }) => ({
              minHeight: 48,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.primary,
              opacity: edit.isPending || pressed ? 0.65 : 1,
            })}
            onPress={() => {
              void edit
                .mutateAsync({ contactId, revision: draftRevision, alias })
                .then(onClose)
                .catch(() => undefined)
            }}
          >
            {edit.isPending ? (
              <ActivityIndicator color="#17130A" />
            ) : (
              <Text style={{ color: '#17130A', fontWeight: '600' }}>Save private name</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={edit.isPending}
            onPress={onClose}
            style={({ pressed }) => ({
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed || edit.isPending ? 0.5 : 1,
            })}
          >
            <Text style={{ color: theme.colors.textSecondary }}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
