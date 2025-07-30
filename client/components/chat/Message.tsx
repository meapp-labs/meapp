import { StyleSheet, View } from 'react-native';
import { Text } from '../common/Text';

export type TMessage = {
    id: string;
    text: string;
    sender: string;
};

export default function Message({ id, text, sender }: TMessage) {
    return (
        <View
            style={[
                styles.messageContainer,
                sender === 'me'
                    ? styles.myMessageContainer
                    : styles.theirMessageContainer,
            ]}
            id={id}
        >
            <Text style={sender === 'me' ? styles.myMessageText : undefined}>
                {text}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
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
});
