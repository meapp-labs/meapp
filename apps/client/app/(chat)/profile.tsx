import { ProfileContactRow } from '@/components/ProfileContactRow'
import { UserAvatar } from '@/components/UserAvatar'
import { Text } from '@/components/common/Text'
import { useGetFriends } from '@/services/others'
import { base64, useEditProfile, useOwnProfile } from '@/services/profiles'
import { theme } from '@/theme/theme'
import { AVATAR_MAX_BYTES } from '@meapp/shared'
import { File } from 'expo-file-system'
import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useState } from 'react'
import { Button, Platform, ScrollView, TextInput } from 'react-native'

export default function ProfileSettings() {
  const own = useOwnProfile()
  const edit = useEditProfile()
  const contacts = useGetFriends()
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [preparing, setPreparing] = useState(false)
  const run = async (action: Parameters<typeof edit.mutateAsync>[0]) => {
    setError('')
    try {
      await edit.mutateAsync(action)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile')
    }
  }
  const pick = async () => {
    setError('')
    setPreparing(true)
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      })
      const asset = result.assets?.[0]
      if (result.canceled || !asset) return
      if (
        (asset.fileSize ??
          asset.file?.size ??
          (Platform.OS === 'web' ? 0 : new File(asset.uri).size)) >
          10 * 1024 * 1024 ||
        asset.width > 4096 ||
        asset.height > 4096 ||
        asset.width * asset.height > 16_777_216
      )
        throw new Error('Choose an image up to 10 MiB and 4096 × 4096 pixels')
      const image = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: asset.width >= asset.height ? { width: 256 } : { height: 256 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      )
      const bytes =
        Platform.OS === 'web'
          ? new Uint8Array(await (await fetch(image.uri)).arrayBuffer())
          : await new File(image.uri).bytes()
      if (bytes.length > AVATAR_MAX_BYTES)
        throw new Error('Image is too large. Choose a simpler image.')
      await run({ image: base64(bytes) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare avatar')
    } finally {
      setPreparing(false)
    }
  }
  return (
    <ScrollView
      contentContainerStyle={{ padding: 24, gap: 16, backgroundColor: theme.colors.background }}
    >
      <Text style={theme.typography.h1}>Profile settings</Text>
      <Text>
        Display names are visible to signed-in users. Avatar URLs are public and cached; removing an
        avatar cannot revoke copies.
      </Text>
      <UserAvatar uri={own.data?.avatarUrl} />
      <Text>@{own.data?.username}</Text>
      <TextInput
        accessibilityLabel="Public display name"
        maxLength={80}
        value={name ?? own.data?.displayName ?? ''}
        onChangeText={setName}
        style={{
          color: theme.colors.text,
          padding: 12,
          borderWidth: 1,
          borderColor: theme.colors.textSecondary,
        }}
      />
      <Button
        title={edit.isPending ? 'Saving…' : 'Save display name'}
        disabled={!own.data || edit.isPending || preparing}
        onPress={() => void run({ displayName: name ?? own.data?.displayName ?? '' })}
      />
      <Button
        title="Choose avatar"
        disabled={edit.isPending || preparing || !own.data}
        onPress={() => void pick()}
      />
      <Button
        title="Remove avatar"
        disabled={!own.data?.avatarUrl || edit.isPending || preparing}
        onPress={() => void run({ removeAvatar: true })}
      />
      {(error || own.error) && <Text>{error || own.error?.message}</Text>}
      <Text style={theme.typography.h2}>Private contact aliases</Text>
      {contacts.data?.map((username) => (
        <ProfileContactRow key={username} username={username} />
      ))}
      {contacts.error && <Text>{contacts.error.message}</Text>}
      <Button title="Back to conversations" onPress={() => router.back()} />
    </ScrollView>
  )
}
