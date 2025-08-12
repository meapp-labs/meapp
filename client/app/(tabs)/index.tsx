import FriendsScreen from '@/components/FriendsScreen';

import { useAuthStore } from '@/stores/authStore';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native';
import { theme } from '@/theme/theme';
import MessageContainer from '@/components/chat/MessageContainer';
import Toolbar from '@/components/Toolbar';

export default function ChatScreen() {
    const username = useAuthStore((state: any) => state.username);

    return (
        <SafeAreaView style={styles.container}>
            <FriendsScreen />
            <MessageContainer username={username} messages={[]} />
            <Toolbar />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: theme.colors.background,
        height: '100%',
        flexDirection: 'row',
        paddingRight: theme.spacing.sm,
    },
});
