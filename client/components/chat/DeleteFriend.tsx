import { theme } from '@/theme/theme';
import { Text } from '@/components/common/Text';
import { View, StyleSheet, Pressable } from 'react-native';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { useRemoveFriend } from '@/services/others';
import { queryClient } from '@/lib/queryInit';
import { Keys } from '@/lib/keys';

type DeleteFriendProps = {
  friend: string;
  onChange: (pressed: string | null, removed: string | null) => void;
};

export default function DeleteFriend({ friend, onChange }: DeleteFriendProps) {
  const { mutate, error, isError } = useRemoveFriend({
    onSuccess: () =>
      queryClient.refetchQueries({
        queryKey: [Keys.Query.GET_FRIENDS],
      }),
  });

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Remove this contact?</Text>
      <View style={styles.icons}>
        <Pressable
          onPress={() => {
            mutate(friend);
            onChange(null, null);
          }}
        >
          <FontAwesome6
            name="check-circle"
            size={24}
            color={theme.colors.success}
          />
        </Pressable>
        <Pressable onPress={() => onChange(friend, null)}>
          <FontAwesome6
            name="xmark-circle"
            size={24}
            color={theme.colors.error}
          />
        </Pressable>
      </View>
      {isError && `${error.message}`}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginTop: theme.spacing.sm,
  },
  text: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
  },
  icons: {
    alignItems: 'center',
    margin: theme.spacing.sm,
    flexDirection: 'row',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.spacing.lg,
  },
});
