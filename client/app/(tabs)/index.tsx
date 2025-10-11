import { useCallback, useEffect } from 'react';
import { BackHandler, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FriendsScreen from '@/components/FriendsScreen';
import MessageContainer from '@/components/chat/MessageContainer';
import useBreakpoint from '@/hooks/useBreakpoint';
import { usePressedStore } from '@/lib/stores';
import { theme } from '@/theme/theme';

export default function ChatScreen() {
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
          {pressed !== null && <MessageContainer />}
        </>
      ) : (
        <>
          <FriendsScreen />
          <MessageContainer />
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
