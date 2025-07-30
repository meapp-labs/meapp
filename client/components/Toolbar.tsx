import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

export default function Toolbar() {
    const [isPressed, setPressed] = useState<string | null>(null);

    return (
        <View style={styles.container}>
            <Pressable
                onPressIn={() => setPressed('settings')}
                onPressOut={() => setPressed(null)}
            >
                <MaterialIcons
                    name="settings"
                    color={isPressed === 'settings' ? 'gray' : 'white'}
                    size={28}
                />
            </Pressable>
            <Pressable
                onPressIn={() => setPressed('attach-file')}
                onPressOut={() => setPressed(null)}
            >
                <MaterialIcons
                    name="attach-file"
                    color={isPressed === 'attach-file' ? 'gray' : 'white'}
                    size={28}
                />
            </Pressable>
            <Pressable
                onPressIn={() => setPressed('info-outline')}
                onPressOut={() => setPressed(null)}
            >
                <MaterialIcons
                    name="info-outline"
                    color={isPressed === 'info-outline' ? 'gray' : 'white'}
                    size={28}
                />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: 10,
        padding: 10,
        flexDirection: 'column-reverse',
        flex: 1,
        borderLeftWidth: 1,
        borderColor: '#2c2c2e',
    },
});
