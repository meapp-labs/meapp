import { MaterialIcons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';

import { usePressedStore } from '@/lib/stores';
import { useLogoutUser } from '@/services/auth';
import { theme } from '@/theme/theme';

export function Logout() {
  const { setPressed } = usePressedStore();
  const { mutate: logout } = useLogoutUser({
    onSuccess: () => {
      setPressed(null);
    },
  });
  return (
    <TouchableOpacity onPress={() => logout()}>
      <MaterialIcons name="logout" size={24} color={theme.colors.text} />
    </TouchableOpacity>
  );
}
