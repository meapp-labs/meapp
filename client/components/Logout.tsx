import { useLogoutUser } from '@/services/auth';
import { usePressedStore } from '@/lib/stores';
import { theme } from '@/theme/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';

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
