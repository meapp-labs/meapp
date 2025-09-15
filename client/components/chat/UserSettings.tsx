import {
    View,
    Modal,
    StyleSheet,
    Pressable,
    TouchableOpacity,
} from 'react-native';
import { Text } from '../common/Text';
import Button from '../common/Button';
import { theme } from '@/theme/theme';
import Ionicons from '@expo/vector-icons/Ionicons';

type UserSettingsProps = {
    showSettings: boolean;
    setShowSettings: (value: boolean) => void;
};

const placeholder = [
    { id: '1', title: 'Language' },
    { id: '2', title: 'Theme' },
    { id: '3', title: 'Blocked list' },
    { id: '4', title: 'Credentials' },
    { id: '5', title: 'Sralala' },
];

export default function UserSettings({
    showSettings,
    setShowSettings,
}: UserSettingsProps) {
    return (
        <>
            <Button
                style={{ flex: 1 / 2 }}
                variant="primary"
                title="Settings"
                onPress={() => setShowSettings(true)}
            />
            {showSettings && (
                <Modal
                    onRequestClose={() => setShowSettings(false)}
                    visible={showSettings}
                    animationType="fade"
                    transparent={true}
                >
                    <View style={styles.container}>
                        <View style={styles.content}>
                            <Pressable
                                style={styles.closeIcon}
                                onPress={() => setShowSettings(false)}
                            >
                                <Ionicons
                                    name="close"
                                    size={24}
                                    color={theme.colors.secondary}
                                />
                            </Pressable>
                            {placeholder.map((item) => (
                                <TouchableOpacity
                                    key={item.id}
                                    style={{
                                        borderBottomWidth: 1,
                                        borderColor: theme.colors.card,
                                        paddingBottom: theme.spacing.xs,
                                        marginBottom: theme.spacing.sm,
                                    }}
                                    onPress={() => console.log('JOHN STAMP')}
                                >
                                    <Text style={theme.typography.h2}>
                                        {item.title}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                </Modal>
            )}
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    content: {
        minWidth: '10%',
        borderRadius: theme.spacing.lg,
        borderColor: theme.colors.secondary,
        borderWidth: 1,
        backgroundColor: theme.colors.surface,
        padding: theme.spacing.md,
    },
    closeIcon: {
        alignSelf: 'flex-end',
    },
});
