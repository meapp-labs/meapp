import { FlatList, StyleSheet, View } from 'react-native';
import { Text } from '../common/Text';
import { useEffect, useRef } from 'react';
import Message from './Message';
import { theme } from '@/theme/theme';
import MessageBar from './MessageBar';
import { useGetMessages } from '@/services/messages';
import { usePressedStore } from '@/stores/pressedFriendStore';

export type TMessage = {
    index: string;
    from: string;
    to: string;
    text: string;
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
        <View style={{ flex: 1 }}>
            <View style={styles.statusBar}>
                <Text>{username + ' connected'}</Text>
            </View>
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
    statusBar: {
        marginVertical: theme.spacing.sm,
        borderRadius: theme.spacing.sm,
        padding: theme.spacing.sm,
        marginRight: theme.spacing.sm,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
    },
});
