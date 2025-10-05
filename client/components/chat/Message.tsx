import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/common/Text';
import useBreakpoint from '@/hooks/useBreakpoint';
import { useAuthStore } from '@/lib/stores';
import { theme } from '@/theme/theme';

export type BaseMessage = {
  index: string;
  from: string;
  text: string;
  timestamp: string;
};

type MessageProps = {
  message: BaseMessage;
  time: string;
};

const Message = {
  Received: function ({ message, time }: MessageProps) {
    const { isDesktop, width } = useBreakpoint();
    return (
      <View
        style={[
          styles.messageGroupContainer,
          isDesktop && { maxWidth: width * 0.35 },
        ]}
      >
        <MaterialIcons name="face" color={theme.colors.text} size={34} />
        <Text style={styles.receivedMessageContainer}>{message.text}</Text>
        <Text style={styles.time}>{time}</Text>
      </View>
    );
  },
  Sent: function ({ message, time }: MessageProps) {
    const { isDesktop, width } = useBreakpoint();
    return (
      <View
        style={[
          styles.messageGroupContainer,
          isDesktop && { maxWidth: width * 0.35 },
          { alignSelf: 'flex-end' },
        ]}
      >
        <Text style={styles.time}>{time}</Text>
        <Text style={styles.sentMessageContainer}>{message.text}</Text>
      </View>
    );
  },
  Wrapper: function ({
    message,
    prevTimestamp,
  }: {
    message: BaseMessage;
    prevTimestamp: string | undefined;
  }) {
    const { username } = useAuthStore();
    const iso = message.timestamp;
    const date = new Date(iso);
    const prevDate = prevTimestamp ? new Date(prevTimestamp) : null;

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
          <Text style={styles.messageDate}>{messageDate}</Text>
        )}
        {message.from === username ? (
          <Message.Sent message={message} time={time} />
        ) : (
          <Message.Received message={message} time={time} />
        )}
      </>
    );
  },
};

const styles = StyleSheet.create({
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
  },
  time: {
    ...theme.typography.caption,
    alignSelf: 'center',
    color: 'gray',
  },
  sentMessageContainer: {
    backgroundColor: theme.colors.surface,
    borderBottomRightRadius: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: 20,
  },
  receivedMessageContainer: {
    backgroundColor: theme.colors.card,
    borderBottomLeftRadius: theme.spacing.sm,
    borderRadius: 20,
    padding: theme.spacing.md,
  },
});

export default Message;
