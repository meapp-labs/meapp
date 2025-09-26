import { FlatList, StyleSheet, View } from 'react-native';
import { Text } from '@/components/common/Text';
import { useEffect, useRef } from 'react';
import Message from '@/components/chat/Message';
import { theme } from '@/theme/theme';
import MessageBar from '@/components/chat/MessageBar';
import { useGetMessages } from '@/services/messages';
import { usePressedStore } from '@/stores/pressedFriendStore';
import { FriendHeader } from '@/components/chat/FriendHeader';

export type TMessage = {
    index: string;
    from: string;
    to: string;
    text: string;
    timestamp: string;
    prevTimestamp?: string;
};

export default function MessageList({ username }: { username: string }) {
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
                messagesSuccess && (
                    <>
                        <FlatList
                            ref={flatListRef}
                            data={messages}
                            renderItem={({ item, index }) => (
                                <Message.Wrapper
                                    message={{
                                        index: item.index,
                                        fromOther: username === item.from,
                                        text: item.text,
                                        timestamp: item.timestamp,
                                        prevTimestamp:
                                            index > 0
                                                ? messages[index - 1].timestamp
                                                : undefined,
                                    }}
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
                        {pressed && <MessageBar refetch={refetch} />}
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
