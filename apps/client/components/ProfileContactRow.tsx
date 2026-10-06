import { ContactAliasEditor } from '@/components/ContactAliasEditor'
import { UserAvatar } from '@/components/UserAvatar'
import { Text } from '@/components/common/Text'
import { useContactPresentation } from '@/services/profiles'
import { useState } from 'react'
import { Button, View } from 'react-native'

export function ProfileContactRow({ username }: { username: string }) {
  const contact = useContactPresentation(username)
  const [editing, setEditing] = useState(false)
  return (
    <View style={{ gap: 8 }}>
      <UserAvatar uri={contact.profile?.avatarUrl} size={32} label={contact.name} />
      <Text>
        {contact.name} · @{username}
      </Text>
      <Button
        title="Edit private alias"
        disabled={!contact.profile || !contact.alias || !!contact.aliasError}
        onPress={() => setEditing(true)}
      />
      {contact.aliasError && <Text>Private aliases unavailable. Link this device or retry.</Text>}
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
