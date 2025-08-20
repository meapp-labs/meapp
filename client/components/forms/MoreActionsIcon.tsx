import { theme } from '@/theme/theme';
import { Feather } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';

type Props = {
    setShowModal: (value: boolean) => void;
};

export default function MoreIcon({ setShowModal }: Props) {
    return (
        <TouchableOpacity
            onPress={() => setShowModal(true)}
            style={{
                marginRight: theme.spacing.md,
            }}
        >
            <Feather
                name="more-horizontal"
                size={24}
                color={theme.colors.secondary}
            />
        </TouchableOpacity>
    );
}
