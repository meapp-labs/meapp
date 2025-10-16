import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';

import { useFriendStore } from '@/lib/stores';
import { theme } from '@/theme/theme';

import { Friend } from '../FriendsScreen';

type RemoveIconProps = {
  item: Friend;
  setRemoveId: (value: string) => void;
};

export function RemoveIcon({ item, setRemoveId }: RemoveIconProps) {
  const { selectedFriend } = useFriendStore();

  return (
    <TouchableOpacity
      style={[
        { marginRight: theme.spacing.xs },
        selectedFriend?.name === item.name && {
          marginLeft: theme.spacing.sm,
        },
      ]}
      onPress={() => setRemoveId(item.name)}
    >
      <Ionicons
        name="person-remove"
        size={22}
        color="white"
        style={{ opacity: 0.1 }}
      />
    </TouchableOpacity>
  );
}
