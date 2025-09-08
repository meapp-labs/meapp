import { FlatList, StyleSheet, View } from 'react-native';
import { Text } from '../common/Text';
import { useEffect, useRef } from 'react';
import Message, { type TMessage } from './Message';
import { theme } from '@/theme/theme';
import MessageBar from './MessageBar';
import { useQuery } from '@tanstack/react-query';
import { getMessages } from '@/services/messages';

type TMessageList = {
    username: string;
    messages: TMessage[];
};

export default function MessageList({ username }: TMessageList) {
    const flatListRef = useRef<FlatList>(null);
    const {
        data: messages,
        isPending: messagesPending,
        isSuccess: messagesSuccess,
    } = useQuery({
        queryKey: ['messages'],
        queryFn: async () => await getMessages('Dawid'), // hardcoded
    });

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
                <Text>Loading...</Text>
            ) : (
                messagesSuccess && (
                    <>
                        <FlatList
                            ref={flatListRef}
                            data={messages}
                            renderItem={({ item }) => (
                                <Message
                                    id={item.id}
                                    text={item.text}
                                    sender={item.sender}
                                />
                            )}
                            keyExtractor={(item) => item.id}
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
                        <MessageBar />
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
