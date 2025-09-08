import FriendsScreen from '@/components/FriendsScreen';
import { useAuthStore } from '@/stores/authStore';
import { SafeAreaView, StyleSheet } from 'react-native';
import MessageContainer from '@/components/chat/MessageContainer';
import { theme } from '@/theme/theme';

export default function ChatScreen() {
    const username = useAuthStore((state: any) => state.username);

    return (
        <SafeAreaView style={styles.container}>
            <FriendsScreen />
            <MessageContainer username={username} messages={[]} />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: theme.colors.background,
        flexDirection: 'row',
        flex: 1,
    },
});
