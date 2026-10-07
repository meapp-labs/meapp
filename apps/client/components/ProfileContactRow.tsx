import { ContactAliasEditor } from '@/components/ContactAliasEditor'
import { UserAvatar } from '@/components/UserAvatar'
import { Text } from '@/components/common/Text'
import { useContactPresentation } from '@/services/profiles'
import { theme } from '@/theme/theme'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

export function ProfileContactRow({ username }: { username: string }) {
  const contact = useContactPresentation(username)
  const [editing, setEditing] = useState(false)
  return (
    <View
      style={{
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.borderSecondary,
        paddingTop: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ padding: 4, borderRadius: 28, backgroundColor: theme.colors.card }}>
          <UserAvatar uri={contact.profile?.avatarUrl} size={36} label={contact.name} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>
            {contact.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.textSecondary }}>
            @{username}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit private name for ${username}`}
          accessibilityState={{
            disabled: !contact.profile || !contact.alias || !!contact.aliasError,
          }}
          disabled={!contact.profile || !contact.alias || !!contact.aliasError}
          onPress={() => setEditing(true)}
          style={({ pressed }) => ({
            minWidth: 44,
            minHeight: 44,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? theme.colors.surfaceElevated : theme.colors.card,
            opacity: !contact.profile || !contact.alias || contact.aliasError ? 0.4 : 1,
          })}
        >
          <MaterialIcons name="edit" size={18} color={theme.colors.primary} />
        </Pressable>
      </View>
      {contact.aliasError && (
        <Text style={{ color: theme.colors.error, fontSize: 12 }}>
          Private names unavailable. Link this device or retry.
        </Text>
      )}
      {editing && contact.profile && contact.alias && (
        <ContactAliasEditor
          key={contact.profile.id}
          contactId={contact.profile.id}
          revision={contact.alias.revision}
          initialAlias={contact.alias.alias}
          username={username}
          onClose={() => setEditing(false)}
        />
      )}
    </View>
  )
}
