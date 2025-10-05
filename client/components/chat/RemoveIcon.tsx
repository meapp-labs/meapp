import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';

import { usePressedStore } from '@/lib/stores';
import { theme } from '@/theme/theme';

import { Friend } from '../FriendsScreen';

type RemoveIconProps = {
  item: Friend;
  setRemoveId: (value: string) => void;
};

export function RemoveIcon({ item, setRemoveId }: RemoveIconProps) {
  const { pressed } = usePressedStore();
  return (
    <TouchableOpacity
      style={[
        { marginRight: theme.spacing.xs },
        pressed?.name === item.name && {
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
