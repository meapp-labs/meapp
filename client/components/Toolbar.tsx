import { theme } from '@/theme/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { TouchableOpacity, StyleSheet, View } from 'react-native';

export default function Toolbar() {
    return (
        <View style={styles.container}>
            <TouchableOpacity>
                <MaterialIcons name="settings" color={'white'} size={28} />
            </TouchableOpacity>
            <TouchableOpacity>
                <MaterialIcons name="attach-file" color={'white'} size={28} />
            </TouchableOpacity>
            <TouchableOpacity>
                <MaterialIcons name="info-outline" color={'white'} size={28} />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: 10,
        padding: 10,
        flexDirection: 'column-reverse',
        backgroundColor: theme.colors.surface,
        marginLeft: theme.spacing.sm,
        marginVertical: theme.spacing.sm,
        borderRadius: theme.spacing.sm,
    },
});
