import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, TextInput, View } from 'react-native';

import { UserAvatar } from '@/components/UserAvatar';
import { theme } from '@/theme/theme';

type TopMenuProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
};

export default function TopMenu({ searchQuery, onSearchChange }: TopMenuProps) {
  return (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <UserAvatar />
        <View style={styles.inputContainer}>
          <TextInput
            value={searchQuery}
            placeholder="Search conversations..."
            placeholderTextColor={theme.colors.textSecondary}
            style={styles.textInput}
            onChangeText={onSearchChange}
          />
          <View style={styles.searchIcon}>
            <MaterialIcons
              name="search"
              size={24}
              color={theme.colors.textSecondary}
            />
          </View>
        </View>
      </View>
    </View>
  );
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
});
