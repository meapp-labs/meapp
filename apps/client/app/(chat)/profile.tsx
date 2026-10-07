import { ProfileContactRow } from '@/components/ProfileContactRow'
import { UserAvatar } from '@/components/UserAvatar'
import { Text } from '@/components/common/Text'
import { DocumentTitle } from '@/misc/DocumentTitle'
import { useGetFriends } from '@/services/others'
import { base64, useEditProfile, useOwnProfile } from '@/services/profiles'
import { theme } from '@/theme/theme'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { AVATAR_MAX_BYTES } from '@meapp/shared'
import { File } from 'expo-file-system'
import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

function Action({
  title,
  onPress,
  disabled,
  loading,
  secondary = false,
}: {
  title: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  secondary?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
      ]}
    >
      {loading && (
        <ActivityIndicator size="small" color={secondary ? theme.colors.text : '#17130A'} />
      )}
      <Text style={[styles.buttonText, secondary && { color: theme.colors.text }]}>{title}</Text>
    </Pressable>
  )
}

export default function ProfileSettings() {
  const own = useOwnProfile()
  const edit = useEditProfile()
  const contacts = useGetFriends()
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [success, setSuccess] = useState('')
  const [photo, setPhoto] = useState<{ uri: string; image: string } | null>(null)
  const [focused, setFocused] = useState(false)
  const { width } = useWindowDimensions()
  const entrance = useRef(new Animated.Value(1)).current
  const busy = edit.isPending || preparing
  const displayName = name ?? own.data?.displayName ?? ''
  const changedName = displayName !== (own.data?.displayName ?? '')
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!active || reduced) return
      entrance.setValue(0)
      Animated.timing(entrance, { toValue: 1, duration: 220, useNativeDriver: true }).start()
    })
    return () => {
      active = false
    }
  }, [entrance])
  const run = async (action: Parameters<typeof edit.mutateAsync>[0]) => {
    setError('')
    setSuccess('')
    try {
      await edit.mutateAsync(action)
      setSuccess(
        'image' in action
          ? 'Profile photo updated.'
          : 'removeAvatar' in action
            ? 'Profile photo removed.'
            : 'Display name saved.',
      )
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile')
      return false
    }
  }
  const pick = async () => {
    setError('')
    setSuccess('')
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
      setPhoto({ uri: image.uri, image: base64(bytes) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare avatar')
    } finally {
      setPreparing(false)
    }
  }
  return (
    <SafeAreaView style={styles.screen}>
      <DocumentTitle title="Your profile" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, width < 600 && { padding: 20 }]}
        >
          <Animated.View style={[styles.container, { opacity: entrance }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
            >
              <MaterialIcons name="arrow-back" size={20} color={theme.colors.textSecondary} />
              <Text style={styles.muted}>Conversations</Text>
            </Pressable>
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>MAKE IT YOURS</Text>
              <Text style={styles.title}>Your profile</Text>
              <Text style={styles.subtitle}>A familiar face. A name that feels like you.</Text>
            </View>
            {own.isPending && (
              <View style={styles.notice}>
                <ActivityIndicator color={theme.colors.primary} />
                <Text style={styles.muted}>Loading your profile…</Text>
              </View>
            )}
            {(error || own.error) && (
              <View accessibilityLiveRegion="polite" style={[styles.notice, styles.errorNotice]}>
                <MaterialIcons name="error-outline" size={20} color={theme.colors.error} />
                <Text style={{ color: theme.colors.error, flex: 1 }}>
                  {error || own.error?.message}
                </Text>
              </View>
            )}
            {!!success && (
              <View accessibilityLiveRegion="polite" style={styles.notice}>
                <MaterialIcons name="check-circle-outline" size={20} color={theme.colors.success} />
                <Text style={{ color: theme.colors.success }}>{success}</Text>
              </View>
            )}
            <View style={[styles.profileGrid, width < 760 && { flexDirection: 'column' }]}>
              <View style={[styles.card, styles.photoCard, width >= 760 && { width: 300 }]}>
                <Text style={styles.sectionTitle}>Profile photo</Text>
                <View style={styles.avatarRing}>
                  <UserAvatar
                    uri={photo?.uri ?? own.data?.avatarUrl}
                    size={104}
                    label="Your profile photo"
                  />
                </View>
                <Text style={styles.previewName} numberOfLines={2}>
                  {displayName || own.data?.username || 'Your name'}
                </Text>
                <Text style={styles.muted}>{own.data ? `@${own.data.username}` : ' '}</Text>
                <View style={styles.photoActions}>
                  <Action
                    title={
                      preparing
                        ? 'Preparing photo…'
                        : photo
                          ? 'Choose another photo'
                          : own.data?.avatarUrl
                            ? 'Change photo'
                            : 'Choose a photo'
                    }
                    secondary
                    disabled={!own.data || busy}
                    loading={preparing}
                    onPress={() => void pick()}
                  />
                  {photo && (
                    <>
                      <Action
                        title="Save photo"
                        disabled={busy}
                        loading={edit.isPending}
                        onPress={() =>
                          void run({ image: photo.image }).then((saved) => {
                            if (saved) setPhoto(null)
                          })
                        }
                      />
                      <Action
                        title="Discard photo"
                        secondary
                        disabled={busy}
                        onPress={() => setPhoto(null)}
                      />
                    </>
                  )}
                  {!photo && !!own.data?.avatarUrl && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void run({ removeAvatar: true })}
                      style={[styles.remove, busy && { opacity: 0.4 }]}
                    >
                      <Text style={styles.muted}>Remove photo</Text>
                    </Pressable>
                  )}
                </View>
                <Text style={styles.photoHint}>
                  Choose an image up to 10 MB. Preview it here before saving.
                </Text>
              </View>
              <View style={[styles.card, { flex: 1 }]}>
                <View style={styles.sectionHeader}>
                  <View style={styles.iconBadge}>
                    <MaterialIcons name="person-outline" size={22} color={theme.colors.primary} />
                  </View>
                  <Text style={styles.sectionTitle}>Public profile</Text>
                </View>
                <Text style={styles.subtitle}>This is how you appear in conversations.</Text>
                <View style={styles.field}>
                  <Text style={styles.label}>Display name</Text>
                  <TextInput
                    accessibilityLabel="Public display name"
                    maxLength={80}
                    value={displayName}
                    onChangeText={(value) => {
                      setName(value)
                      setSuccess('')
                    }}
                    placeholder="How should people know you?"
                    placeholderTextColor={theme.colors.textTertiary}
                    editable={!!own.data && !busy}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={[styles.input, focused && { borderColor: theme.colors.primary }]}
                  />
                  <View style={styles.fieldMeta}>
                    <Text style={styles.helper}>Visible to signed-in users.</Text>
                    <Text style={styles.helper}>{displayName.length}/80</Text>
                  </View>
                  {name !== null && !displayName.trim() && (
                    <Text style={{ color: theme.colors.error, fontSize: 12 }}>
                      Add a display name before saving.
                    </Text>
                  )}
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Username</Text>
                  <View style={styles.readOnly}>
                    <Text style={styles.muted}>
                      {own.data ? `@${own.data.username}` : 'Loading…'}
                    </Text>
                    <MaterialIcons
                      name="lock-outline"
                      size={16}
                      color={theme.colors.textTertiary}
                    />
                  </View>
                  <Text style={styles.helper}>Your unique account name.</Text>
                </View>
                <View style={styles.saveRow}>
                  <Action
                    title={edit.isPending && !photo ? 'Saving…' : 'Save changes'}
                    disabled={!own.data || busy || !changedName || !displayName.trim()}
                    onPress={() =>
                      void run({ displayName }).then((saved) => {
                        if (saved) setName(null)
                      })
                    }
                  />
                </View>
                <View style={styles.privacy}>
                  <MaterialIcons name="info-outline" size={18} color={theme.colors.textSecondary} />
                  <Text style={[styles.helper, { flex: 1 }]}>
                    Profile photos are public and may be cached. Removing a photo cannot remove
                    copies already saved by others.
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <View style={styles.iconBadge}>
                  <MaterialIcons name="lock-outline" size={22} color={theme.colors.primary} />
                </View>
                <Text style={styles.sectionTitle}>Private contact names</Text>
              </View>
              <Text style={styles.subtitle}>
                Give your contacts a name only you can see. Synced securely across linked devices.
              </Text>
              {contacts.isPending && (
                <ActivityIndicator style={{ padding: 20 }} color={theme.colors.primary} />
              )}
              {contacts.data?.map((username) => (
                <ProfileContactRow key={username} username={username} />
              ))}
              {contacts.data?.length === 0 && (
                <View style={styles.empty}>
                  <MaterialIcons
                    name="people-outline"
                    size={30}
                    color={theme.colors.textTertiary}
                  />
                  <Text style={styles.muted}>Your contacts will appear here.</Text>
                </View>
              )}
              {contacts.error && (
                <Text style={{ color: theme.colors.error }}>{contacts.error.message}</Text>
              )}
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 36, paddingBottom: 56 },
  container: { width: '100%', maxWidth: 960, alignSelf: 'center', gap: 24 },
  back: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  heading: { gap: 8 },
  eyebrow: { color: theme.colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  title: { fontSize: 34, lineHeight: 42, fontWeight: '700', letterSpacing: -1 },
  subtitle: { fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 },
  muted: { color: theme.colors.textSecondary, fontSize: 14 },
  profileGrid: { flexDirection: 'row', gap: 20 },
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    borderRadius: 22,
    padding: 24,
    gap: 18,
  },
  photoCard: { alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBadge: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,186,48,0.08)',
    borderRadius: 12,
  },
  avatarRing: {
    padding: 8,
    borderRadius: 70,
    borderWidth: 1,
    borderColor: 'rgba(245,186,48,0.3)',
    backgroundColor: theme.colors.card,
    marginTop: 8,
  },
  previewName: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: -12 },
  photoActions: { alignSelf: 'stretch', gap: 10, marginTop: 4 },
  button: {
    minHeight: 46,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  buttonText: { color: '#17130A', fontSize: 14, fontWeight: '600' },
  remove: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  photoHint: {
    color: theme.colors.textTertiary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  field: { gap: 9 },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    color: theme.colors.text,
    fontSize: 16,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 48,
  },
  fieldMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  helper: { fontSize: 12, color: theme.colors.textSecondary, lineHeight: 19 },
  readOnly: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  saveRow: { alignItems: 'flex-start', marginTop: 2 },
  privacy: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSecondary,
    paddingTop: 18,
    marginTop: 4,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
  },
  errorNotice: { borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  empty: { padding: 24, alignItems: 'center', gap: 12 },
})
