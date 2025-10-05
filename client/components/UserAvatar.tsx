import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { TouchableOpacity } from 'react-native';
import { theme } from '@/theme/theme';
//later the avatar menu and logic will be implemented here, icon placeholder for visualization atm
export function UserAvatar() {
    return (
        <TouchableOpacity>
            <MaterialIcons name="face-5" size={48} color={theme.colors.text} />
        </TouchableOpacity>
    );
}
