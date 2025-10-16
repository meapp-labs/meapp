import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Text } from '@/components/common/Text';
import { useFriendStore } from '@/lib/stores';
import { theme } from '@/theme/theme';

export function ChatHeader() {
  const { selectedFriend, setSelectedFriend } = useFriendStore();
  const handlePress = () => {
    setSelectedFriend(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.innerContainer}>
        <TouchableOpacity onPress={handlePress}>
          <MaterialIcons
            name="arrow-back"
            size={34}
            color={theme.colors.text}
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.contactInfo}>
          <MaterialIcons name="face" size={34} color={theme.colors.text} />
          <Text style={styles.contactName}>{selectedFriend?.name}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity>
        <MaterialIcons name="more-vert" size={34} color={theme.colors.text} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    margin: theme.spacing.md,
    marginVertical: theme.spacing.lg,
  },
  contactInfo: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  contactName: {
    ...theme.typography.h1,
  },
  innerContainer: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
});
