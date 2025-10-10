import { MaterialIcons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';

import { useAuthStore, usePressedStore } from '@/lib/stores';
import { useLogoutUser } from '@/services/auth';
import { RememberMeStorage } from '@/services/storage';
import { theme } from '@/theme/theme';

export function Logout() {
  const { setPressed } = usePressedStore();
  const setUsername = useAuthStore((state) => state.setUsername);
  const { mutate: logout } = useLogoutUser({
    onSuccess: () => {
      setPressed(null);
      setUsername('');
      void RememberMeStorage.clear();
    },
  });
  return (
    <TouchableOpacity onPress={() => logout()}>
      <MaterialIcons name="logout" size={24} color={theme.colors.text} />
    </TouchableOpacity>
  );
}
