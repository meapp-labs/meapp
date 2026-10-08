import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { chatColors, useAuthStore, useChatAppearance, useChatColor } from '@/lib/stores'
import { theme } from '@/theme/theme'
import { MaterialIcons } from '@expo/vector-icons'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

export function ChatAppearanceModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const username = useAuthStore((state) => state.username)
  const color = useChatColor(roomId)
  const setColor = useChatAppearance((state) => state.setColor)
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Dismiss chat colors"
        />
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>Chat background</Text>
            <Text style={styles.description}>
              Give this conversation its own color. Also shown in your chat list. Just for you on
              this device.
            </Text>
            <View style={[styles.preview, { backgroundColor: color }]}>
              <View style={styles.bubble}>
                <Text>A little more you.</Text>
              </View>
              <View style={[styles.bubble, styles.sent]}>
                <Text>Your space, your color.</Text>
              </View>
            </View>
            <View style={styles.options}>
              {chatColors.map((option) => (
                <Pressable
                  key={option.name}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.name} background`}
                  accessibilityState={{ checked: color === option.color }}
                  aria-checked={color === option.color}
                  onPress={() => setColor(username, roomId, option.color)}
                  style={[styles.option, color === option.color && styles.selected]}
                >
                  <View style={[styles.swatch, { backgroundColor: option.color }]}>
                    {color === option.color && (
                      <MaterialIcons name="check" size={22} color={theme.colors.text} />
                    )}
                  </View>
                  <Text style={styles.label}>{option.name}</Text>
                </Pressable>
              ))}
            </View>
            <Button title="Done" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    padding: 20,
    backgroundColor: theme.colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    backgroundColor: theme.colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    overflow: 'hidden',
  },
  content: { padding: 24, gap: 20 },
  title: { fontSize: 24, fontWeight: '700' },
  description: { fontSize: 14, lineHeight: 22, color: theme.colors.textSecondary },
  preview: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bubble: {
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 12,
    alignSelf: 'flex-start',
  },
  sent: { alignSelf: 'flex-end', backgroundColor: '#443821' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    flexGrow: 1,
    flexBasis: '28%',
    alignItems: 'center',
    padding: 10,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.card },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 12, color: theme.colors.textSecondary },
})
