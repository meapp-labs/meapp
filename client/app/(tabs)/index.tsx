import { SafeAreaView, StyleSheet } from 'react-native';
import MessageContainer from '@/components/chat/MessageContainer';
import FriendsScreen from '@/components/FriendsScreen';
import useBreakpoint from '@/hooks/useBreakpoint';
import { useAuthStore, usePressedStore } from '@/lib/stores';
import { theme } from '@/theme/theme';

export default function ChatScreen() {
    const username = useAuthStore((state: any) => state.username);
    const { pressed } = usePressedStore();
    const { isMobile } = useBreakpoint();

    return (
        <SafeAreaView style={styles.container}>
            {isMobile ? (
                <>
                    {pressed === null && <FriendsScreen />}
                    {pressed !== null && (
                        <MessageContainer username={username} />
                    )}
                </>
            ) : (
                <>
                    <FriendsScreen />
                    <MessageContainer username={username} />
                </>
            )}
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
