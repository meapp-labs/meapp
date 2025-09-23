import { FlatList, StyleSheet, View } from 'react-native';
import { Text } from '../common/Text';
import { useEffect, useRef } from 'react';
import Message from './Message';
import { theme } from '@/theme/theme';
import MessageBar from './MessageBar';
import { useGetMessages } from '@/services/messages';
import { usePressedStore } from '@/stores/pressedFriendStore';
import { FriendHeader } from './FriendHeader';

export type TMessage = {
    index: string;
    from: string;
    to: string;
    text: string;
    timestamp: string;
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
                    <Text>Loading...</Text>
                ) : (
                    <Text>Select a friend.</Text>
                )
            ) : (
                messagesSuccess && (
                    <>
                        <FlatList
                            ref={flatListRef}
                            data={messages}
                            renderItem={({ item }) => (
                                <Message
                                    index={item.index}
                                    fromOther={username === item.from}
                                    text={item.text}
                                    timestamp={item.timestamp}
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
        margin: theme.spacing.sm,
        marginTop: 0,
    },
});
