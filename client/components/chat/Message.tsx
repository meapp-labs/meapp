import { StyleSheet, View } from 'react-native';
import { Text } from '../common/Text';

export default function Message(message: {
    index: string;
    fromOther: boolean;
    text: string;
}) {
    return (
        <View
            style={[
                styles.messageContainer,
                message.fromOther
                    ? styles.myMessageContainer
                    : styles.theirMessageContainer,
            ]}
            key={message.index}
        >
            <Text style={message.fromOther ? styles.myMessageText : undefined}>
                {message.text}
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
