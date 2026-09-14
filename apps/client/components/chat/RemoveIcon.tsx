import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';

import { useConversationStore } from '@/lib/stores';
import { theme } from '@/theme/theme';
import type { Conversation } from '@/types/models';

export type RemoveIconProps = {
  conversation: Conversation;
  setRemoveId: (value: string) => void;
};

export function RemoveIcon({ conversation, setRemoveId }: RemoveIconProps) {
  const { selectedConversation } = useConversationStore();

  return (
    <TouchableOpacity
      style={[
        { marginRight: theme.spacing.xs },
        selectedConversation?.id === conversation.id && {
          marginLeft: theme.spacing.sm,
        },
      ]}
      onPress={() => setRemoveId(conversation.id)}
    >
      <Ionicons
        name="person-remove"
        size={22}
        color="white"
        style={{ opacity: 0.1 }}
      />
    </TouchableOpacity>
  );
}
