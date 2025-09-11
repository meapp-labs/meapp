import { StyleSheet, View } from 'react-native';
import { Text } from '../common/Text';
import { theme } from '@/theme/theme';

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
    messageContainer: {
        borderRadius: 20,
        padding: 15,
        marginVertical: 5,
        maxWidth: '80%',
    },
    myMessageContainer: {
        backgroundColor: theme.colors.primary,
        alignSelf: 'flex-end',
        borderBottomRightRadius: theme.spacing.xs,
        marginRight: theme.spacing.sm,
    },
    theirMessageContainer: {
        backgroundColor: theme.colors.card,
        alignSelf: 'flex-start',
        borderBottomLeftRadius: theme.spacing.xs,
    },
    myMessageText: {
        color: '#fff',
    },
});
