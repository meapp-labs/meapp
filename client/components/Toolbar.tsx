import { ThemedView } from '@/components/ThemedView';
import styles from '@/styles';
import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable } from 'react-native';

export default function Toolbar() {
    const [isPressed, setPressed] = useState<string | null>(null);

    return (
        <ThemedView style={styles.toolbarContainer}>
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
        </ThemedView>
    );
}
