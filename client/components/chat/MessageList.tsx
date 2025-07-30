import { FlatList, StyleSheet, View } from 'react-native';
import { Text } from '../common/Text';
import { useEffect, useRef } from 'react';
import Message, { type TMessage } from './Message';

type TMessageList = {
    username: string;
    messages: TMessage[];
};

export default function MessageList({ username, messages }: TMessageList) {
    const flatListRef = useRef<FlatList>(null);

    useEffect(() => {
        if (flatListRef.current) {
            flatListRef.current.scrollToEnd({ animated: true });
        }
    }, [messages]);

    return (
        <View style={{ flex: 5 }}>
            <View style={styles.statusBar}>
                <Text style={styles.statusText}>{username + ' connected'}</Text>
            </View>
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
                contentContainerStyle={styles.messageList}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() =>
                    flatListRef.current?.scrollToEnd({ animated: true })
                }
                onLayout={() =>
                    flatListRef.current?.scrollToEnd({ animated: true })
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    statusBar: {
        padding: 10,
        backgroundColor: '#1C1C1E',
        alignItems: 'center',
    },
    statusText: {
        color: '#9BA1A6',
    },
    messageList: {
        paddingHorizontal: 10,
        paddingBottom: 10,
    },
    messageContainer: {
        borderRadius: 20,
        padding: 15,
        marginVertical: 5,
        maxWidth: '80%',
    },
    myMessageContainer: {
        backgroundColor: '#007AFF',
        alignSelf: 'flex-end',
        borderBottomRightRadius: 5,
    },
    theirMessageContainer: {
        backgroundColor: '#2C2C2E',
        alignSelf: 'flex-start',
        borderBottomLeftRadius: 5,
    },
    myMessageText: {
        color: '#fff',
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        borderTopWidth: 1,
        borderTopColor: '#2C2C2E',
    },
    messageInput: {
        flex: 1,
        backgroundColor: '#2C2C2E',
        borderRadius: 20,
        paddingHorizontal: 15,
        paddingVertical: 10,
        color: '#ffffff',
        marginRight: 10,
    },
    sendButton: {
        backgroundColor: '#007AFF',
        borderRadius: 20,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    sendButtonText: {
        color: '#fff',
        fontWeight: 'bold',
    },
});
