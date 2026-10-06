import { useOwnProfile } from '@/services/profiles'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { router } from 'expo-router'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'

import { UserAvatar } from '@/components/UserAvatar'
import { Text } from '@/components/common/Text'
import { theme } from '@/theme/theme'

type TopMenuProps = {
  searchQuery: string
  onSearchChange: (query: string) => void
  unreadCount: number
}

export function TopMenu({ searchQuery, onSearchChange, unreadCount }: TopMenuProps) {
  const profile = useOwnProfile()
  return (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <TouchableOpacity
          accessibilityLabel="Open profile settings"
          onPress={() => router.push('/(chat)/profile')}
        >
          <UserAvatar uri={profile.data?.avatarUrl} label={profile.data?.displayName} />
        </TouchableOpacity>
        {unreadCount > 0 && (
          <Text accessibilityLabel={`${unreadCount} unread messages in all conversations`}>
            {unreadCount > 99 ? '99+ unread' : `${unreadCount} unread`}
          </Text>
        )}
        <View style={styles.inputContainer}>
          <TextInput
            value={searchQuery}
            placeholder="Search conversations..."
            placeholderTextColor={theme.colors.textSecondary}
            style={styles.textInput}
            onChangeText={onSearchChange}
          />
          <View style={styles.searchIcon}>
            <MaterialIcons name="search" size={24} color={theme.colors.textSecondary} />
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    flex: 1,
  },
  innerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  inputContainer: {
    flexDirection: 'row',
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.md,
    marginHorizontal: theme.spacing.sm,
  },
  textInput: {
    flexGrow: 1,
    color: theme.colors.text,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    borderRadius: theme.spacing.lg,
    paddingRight: 48,
  },
  searchIcon: {
    alignSelf: 'center',
    position: 'absolute',
    right: theme.spacing.md,
  },
})
