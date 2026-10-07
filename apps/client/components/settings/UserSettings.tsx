import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { router } from 'expo-router'
import type React from 'react'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Text } from '@/components/common/Text'
import { theme } from '@/theme/theme'

import { AccountRecoveryPanel } from './AccountRecoveryPanel'
import { BlockedUsers } from './BlockedUsers'
import { DeviceLinkPanel } from './DeviceLinkPanel'
import { JournalPanel } from './JournalPanel'
import { Notifications } from './Notifications'
import { RecoveryKeyPanel } from './RecoveryKeyPanel'

type UserSettingsProps = {
  showSettings: boolean
  setShowSettings: (value: boolean) => void
}

const options: {
  name: string
  description: string
  icon: React.ComponentProps<typeof MaterialIcons>['name']
  component?: React.ComponentType
}[] = [
  {
    name: 'Your profile',
    description: 'Photo, name and a little about you',
    icon: 'person-outline',
  },
  {
    name: 'Account recovery',
    description: 'Email and password recovery',
    icon: 'key',
    component: AccountRecoveryPanel,
  },
  {
    name: 'Personal journal',
    description: 'Your private notes',
    icon: 'book',
    component: JournalPanel,
  },
  {
    name: 'Linked devices',
    description: 'Connect another device securely',
    icon: 'devices',
    component: () => <DeviceLinkPanel mode="approve" />,
  },
  {
    name: 'Recovery key',
    description: 'Keep access to your encrypted chats',
    icon: 'vpn-key',
    component: RecoveryKeyPanel,
  },
  {
    name: 'Notifications',
    description: 'Choose when you hear from us',
    icon: 'notifications-none',
    component: Notifications,
  },
  {
    name: 'Blocked users',
    description: 'Manage who can contact you',
    icon: 'block',
    component: BlockedUsers,
  },
]

export function UserSettings({ showSettings, setShowSettings }: UserSettingsProps) {
  const { width, height } = useWindowDimensions()
  const compact = width < 760
  const [active, setActive] = useState<string | null>(null)
  const selected = options.find((option) => option.name === active)
  const close = () => {
    setShowSettings(false)
    setActive(null)
  }
  const showNavigation = !compact || !selected

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        onPress={() => {
          setActive(null)
          setShowSettings(true)
        }}
      >
        <MaterialIcons name="settings" size={23} color={theme.colors.textSecondary} />
      </Pressable>
      <Modal visible={showSettings} animationType="fade" transparent onRequestClose={close}>
        <SafeAreaView style={[styles.backdrop, compact && { padding: 12 }]}>
          <Pressable
            accessibilityLabel="Close settings"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.content,
              { maxHeight: height - (compact ? 24 : 80) },
              compact && styles.compactContent,
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.titleRow}>
                {compact && selected && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to settings"
                    style={styles.iconButton}
                    onPress={() => setActive(null)}
                  >
                    <MaterialIcons name="arrow-back" size={22} color={theme.colors.text} />
                  </Pressable>
                )}
                <Text style={styles.title}>{compact && selected ? selected.name : 'Settings'}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close settings"
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                onPress={close}
              >
                <MaterialIcons name="close" size={23} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            <View style={styles.body}>
              {showNavigation && (
                <ScrollView
                  style={[styles.navigation, compact && styles.compactNavigation]}
                  contentContainerStyle={styles.navigationContent}
                >
                  <Text style={styles.eyebrow}>MAKE IT YOURS</Text>
                  {options.map((item) => {
                    const isSelected = active === item.name
                    return (
                      <Pressable
                        key={item.name}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        style={({ pressed }) => [
                          styles.option,
                          isSelected && styles.optionSelected,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => {
                          if (!item.component) {
                            close()
                            router.push('/profile')
                          } else setActive(item.name)
                        }}
                      >
                        <MaterialIcons
                          name={item.icon}
                          size={22}
                          color={isSelected ? theme.colors.primary : theme.colors.textSecondary}
                        />
                        <View style={styles.optionText}>
                          <Text style={[styles.optionName, isSelected && styles.activeText]}>
                            {item.name}
                          </Text>
                          {compact && <Text style={styles.description}>{item.description}</Text>}
                        </View>
                        <MaterialIcons
                          name="chevron-right"
                          size={20}
                          color={theme.colors.textTertiary}
                        />
                      </Pressable>
                    )
                  })}
                </ScrollView>
              )}
              {(!compact || selected) && (
                <ScrollView
                  style={styles.panel}
                  contentContainerStyle={styles.panelContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {selected?.component ? (
                    <>
                      {!compact && <Text style={styles.panelTitle}>{selected.name}</Text>}
                      <Text style={styles.panelDescription}>{selected.description}</Text>
                      <selected.component />
                    </>
                  ) : (
                    <View style={styles.emptyPanel}>
                      <View style={styles.welcomeIcon}>
                        <MaterialIcons name="tune" size={30} color={theme.colors.primary} />
                      </View>
                      <Text style={styles.panelTitle}>A space that feels like you</Text>
                      <Text style={styles.welcomeDescription}>
                        Manage your profile, privacy and preferences. Choose a setting to get
                        started.
                      </Text>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 960,
    height: 680,
    backgroundColor: theme.colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  compactContent: { borderRadius: 20 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingLeft: 24,
    borderBottomWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  title: { fontSize: 22, fontWeight: '700', flexShrink: 1 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: theme.colors.card, opacity: 0.85 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 },
  navigation: {
    width: 252,
    flexGrow: 0,
    borderRightWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  compactNavigation: { width: '100%', borderRightWidth: 0 },
  navigationContent: { padding: 12, gap: 4 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: theme.colors.textTertiary,
    padding: 12,
    marginBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    padding: 12,
    borderRadius: 12,
  },
  optionSelected: { backgroundColor: theme.colors.card },
  optionText: { flex: 1, gap: 5 },
  optionName: { fontSize: 14, fontWeight: '600' },
  activeText: { color: theme.colors.primary },
  description: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
  panel: { flex: 1, minWidth: 0 },
  panelContent: { padding: 24, flexGrow: 1 },
  panelTitle: { fontSize: 24, lineHeight: 32, fontWeight: '700', marginBottom: 8 },
  panelDescription: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: 24,
    lineHeight: 22,
  },
  emptyPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  welcomeIcon: {
    width: 68,
    height: 68,
    borderRadius: 22,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  welcomeDescription: {
    color: theme.colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 24,
  },
})
