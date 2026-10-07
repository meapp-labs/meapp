import { theme } from '@/theme/theme'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { type ComponentProps, useState } from 'react'
import { ActivityIndicator, Keyboard, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type AttachmentOption = {
  label: string
  icon: ComponentProps<typeof MaterialIcons>['name']
  color: string
  action?: 'gallery' | 'document' | 'camera' | 'voice'
}

const options: AttachmentOption[] = [
  { label: 'Gallery', icon: 'photo-library', color: '#60A5FA', action: 'gallery' },
  { label: 'Camera', icon: 'photo-camera', color: '#F472B6', action: 'camera' },
  { label: 'Voice', icon: 'mic', color: '#34D399', action: 'voice' },
  { label: 'Location', icon: 'location-on', color: '#34D399' },
  { label: 'Contact', icon: 'person', color: '#38BDF8' },
  { label: 'Document', icon: 'description', color: '#A78BFA', action: 'document' },
  { label: 'Poll', icon: 'poll', color: '#FBBF24' },
  { label: 'Event', icon: 'event', color: '#FB7185' },
  { label: 'AI images', icon: 'auto-awesome', color: '#818CF8' },
]

export function Attachment({
  onPress,
  onImagePress,
  onCameraPress,
  onVoicePress,
  disabled,
}: {
  onPress: () => void
  onImagePress: () => void
  onCameraPress: () => void
  onVoicePress: () => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const insets = useSafeAreaInsets()
  const close = () => setOpen(false)

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add attachment"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          Keyboard.dismiss()
          setOpen(true)
        }}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        {disabled ? (
          <ActivityIndicator color={theme.colors.text} size="small" />
        ) : (
          <MaterialIcons name="attach-file" size={24} color={theme.colors.text} />
        )}
      </Pressable>
      <Modal visible={open && !disabled} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close attachment menu"
            onPress={close}
            style={styles.backdrop}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Attachments</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close attachment menu"
                onPress={close}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              >
                <MaterialIcons name="close" size={22} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.grid}>
              {options.map((option) => (
                <Pressable
                  key={option.label}
                  accessibilityRole="button"
                  accessibilityLabel={option.action ? option.label : `${option.label}, coming soon`}
                  accessibilityState={{ disabled: !option.action }}
                  disabled={!option.action}
                  onPress={() => {
                    close()
                    if (option.action === 'gallery') onImagePress()
                    else if (option.action === 'document') onPress()
                    else if (option.action === 'camera') onCameraPress()
                    else if (option.action === 'voice') onVoicePress()
                  }}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                >
                  <View style={[styles.icon, { backgroundColor: `${option.color}18` }]}>
                    <MaterialIcons name={option.icon} size={28} color={option.color} />
                  </View>
                  <Text style={[styles.label, !option.action && styles.futureLabel]}>
                    {option.label}
                  </Text>
                  <Text style={styles.caption}>{option.action ? ' ' : 'Soon'}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.footer}>
              Gallery for photos, GIFs & video · Document for any file
            </Text>
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  pressed: { backgroundColor: theme.colors.surfaceElevated },
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.colors.overlay },
  sheet: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
  },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '600' },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 8 },
  option: { width: '25%', alignItems: 'center', paddingVertical: 12, borderRadius: 16 },
  icon: { width: 56, height: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  label: { color: theme.colors.text, fontSize: 12, marginTop: 8 },
  futureLabel: { color: theme.colors.textSecondary },
  caption: { color: theme.colors.textTertiary, fontSize: 10, marginTop: 3 },
  footer: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginVertical: 8,
  },
})
