import { useEffect, useRef } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { FriendHeader } from '@/components/chat/FriendHeader';
import Message, { BaseMessage } from '@/components/chat/Message';
import MessageBar from '@/components/chat/MessageBar';
import { Text } from '@/components/common/Text';
import { usePressedStore } from '@/lib/stores';
import { useGetMessages } from '@/services/messages';
import { theme } from '@/theme/theme';

export default function MessageList() {
  const { pressed } = usePressedStore();
  const flatListRef = useRef<FlatList>(null);

  const {
    data: messages,
    isPending: messagesPending,
    isSuccess: messagesSuccess,
    refetch,
  } = useGetMessages({ from: pressed?.name });

  useEffect(() => {
    if (flatListRef.current) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  return (
    <View style={styles.container}>
      {pressed && (
        <View>
          <FriendHeader />
        </View>
      )}

      {messagesPending ? (
        pressed ? (
          <Text style={styles.tooltip}>Loading...</Text>
        ) : (
          <Text style={styles.tooltip}>Select a friend.</Text>
        )
      ) : (
        messagesSuccess &&
        messages && (
          <>
            <FlatList<BaseMessage>
              ref={flatListRef}
              data={messages}
              renderItem={({ item, index }) => (
                <Message.Wrapper
                  message={item}
                  prevTimestamp={
                    messages[index - 1] && messages[index - 1]?.timestamp
                  }
                />
              )}
              keyExtractor={(item) => item.index}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() =>
                flatListRef.current?.scrollToEnd({
                  animated: true,
                })
              }
              onLayout={() =>
                flatListRef.current?.scrollToEnd({
                  animated: true,
                })
              }
            />
            {pressed && (
              <MessageBar
                refetch={() => {
                  void refetch();
                }}
              />
            )}
          </>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: 0,
    marginBottom: theme.spacing.sm,
  },
  tooltip: {
    alignSelf: 'center',
    marginTop: theme.spacing.sm,
  },
});
