import { MaterialIcons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';

import { useAuthStore, useFriendStore } from '@/lib/stores';
import { useLogoutUser } from '@/services/auth';
import { RememberMeStorage } from '@/services/storage';
import { theme } from '@/theme/theme';

export function Logout() {
  const { setSelectedFriend } = useFriendStore();
  const { setUsername } = useAuthStore();

  const { mutate: logout } = useLogoutUser({
    onSuccess: () => {
      void RememberMeStorage.clear();
      setSelectedFriend(null);
      setUsername('');
    },
  });
  return (
    <TouchableOpacity onPress={() => logout()}>
      <MaterialIcons name="logout" size={24} color={theme.colors.text} />
    </TouchableOpacity>
  );
}
