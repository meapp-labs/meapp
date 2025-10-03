import { BackHandler, SafeAreaView, StyleSheet } from 'react-native';
import MessageContainer from '@/components/chat/MessageContainer';
import FriendsScreen from '@/components/FriendsScreen';
import useBreakpoint from '@/hooks/useBreakpoint';
import { useAuthStore, usePressedStore } from '@/lib/stores';
import { theme } from '@/theme/theme';
import { useCallback, useEffect } from 'react';

export default function ChatScreen() {
    const username = useAuthStore((state: any) => state.username);
    const { pressed, setPressed } = usePressedStore();
    const { isMobile } = useBreakpoint();

    const returnAction = useCallback((): boolean => {
        if (pressed !== null) {
            setPressed(null);
            return true;
        }
        return false;
    }, [pressed, setPressed]);

    useEffect(() => {
        const returnHandler = BackHandler.addEventListener(
            'hardwareBackPress',
            returnAction,
        );
        return () => returnHandler.remove();
    }, [returnAction]);

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
