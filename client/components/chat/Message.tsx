import { Dimensions, StyleSheet } from 'react-native';
import { Text } from '../common/Text';
import { theme } from '@/theme/theme';
import { ReceivedMessage } from './ReceivedMessage';
import { SentMessage } from './SentMessage';

export default function Message(message: {
    index: string;
    fromOther: boolean;
    text: string;
    timestamp: string;
    prevTimestamp?: string;
}) {
    const iso = message.timestamp;
    const date = new Date(iso);
    const prevDate = message.prevTimestamp
        ? new Date(message.prevTimestamp)
        : null;

    const time = new Intl.DateTimeFormat('default', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(date);

    const messageDate = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
    }).format(date);

    const isDifferentDay =
        !prevDate ||
        prevDate.getFullYear() !== date.getFullYear() ||
        prevDate.getMonth() !== date.getMonth() ||
        prevDate.getDate() !== date.getDate();

    return (
        <>
            {isDifferentDay && (
                <Text style={sharedStyles.messageDate}>{messageDate}</Text>
            )}
            {message.fromOther ? (
                <SentMessage message={message} time={time} />
            ) : (
                <ReceivedMessage message={message} time={time} />
            )}
        </>
    );
}

const SCREEN_WIDTH = Dimensions.get('screen').width;

export const sharedStyles = StyleSheet.create({
    messageDate: {
        alignSelf: 'center',
        ...theme.typography.caption,
        marginTop: theme.spacing.sm,
        marginBottom: theme.spacing.xs,
    },
    messageGroupContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: theme.spacing.sm,
        gap: theme.spacing.sm,
        marginVertical: theme.spacing.xs,
        maxWidth: SCREEN_WIDTH * 0.35,
    },
    time: {
        ...theme.typography.caption,
        alignSelf: 'center',
        color: 'gray',
    },
});
