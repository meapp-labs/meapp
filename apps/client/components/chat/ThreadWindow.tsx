import { Text } from '@/components/common/Text'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useChatColor } from '@/lib/stores'
import { theme } from '@/theme/theme'
import { MaterialIcons } from '@expo/vector-icons'
import { useEffect } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MessageInput } from './MessageInput'
import { MessageList } from './MessageList'
import { useThreadWindow } from './threadWindowStore'

export function ThreadWindow({ conversationId }: { conversationId: string }) {
  const backgroundColor = useChatColor(conversationId)
  const window = useThreadWindow()
  useEffect(
    () => () => {
      if (useThreadWindow.getState().roomId === conversationId) useThreadWindow.getState().close()
    },
    [conversationId],
  )
  const { isDesktop } = useBreakpoint()
  const rootId = window.roomId === conversationId ? window.rootId : null
  return (
    <Modal
      visible={Boolean(rootId)}
      transparent={isDesktop}
      animationType={isDesktop ? 'fade' : 'slide'}
      onRequestClose={window.close}
    >
      <View style={[styles.overlay, !isDesktop && styles.mobile]}>
        {isDesktop && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={window.close}
            accessibilityLabel="Close thread and return to chat"
          />
        )}
        <SafeAreaView
          style={[styles.panel, { backgroundColor }, isDesktop && styles.desktop]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Pressable
              onPress={window.close}
              accessibilityRole="button"
              accessibilityLabel="Back to chat"
              hitSlop={10}
            >
              <MaterialIcons
                name={isDesktop ? 'close' : 'arrow-back'}
                size={24}
                color={theme.colors.text}
              />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Thread</Text>
              <Text style={styles.subtitle}>Replies stay in this discussion</Text>
            </View>
            <MaterialIcons name="forum" size={24} color={theme.colors.primary} />
          </View>
          {rootId && (
            <KeyboardAvoidingView
              key={`${conversationId}:${rootId}`}
              behavior={Platform.OS === 'android' ? 'padding' : 'height'}
              style={styles.body}
            >
              <MessageList conversationId={conversationId} threadRootId={rootId} />
              <View style={styles.composer}>
                <MessageInput conversationId={conversationId} threadRootId={rootId} />
              </View>
            </KeyboardAvoidingView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  )
}

export function ConversationMessages({ conversationId }: { conversationId: string }) {
  const backgroundColor = useChatColor(conversationId)
  return (
    <View style={[styles.body, { backgroundColor }]}>
      <MessageList conversationId={conversationId} />
      <MessageInput conversationId={conversationId} />
      <ThreadWindow conversationId={conversationId} />
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: '#00000066',
  },
  mobile: { backgroundColor: theme.colors.background },
  panel: { flex: 1, backgroundColor: theme.colors.background },
  desktop: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: 540,
    maxWidth: '50%',
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.borderSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSecondary,
  },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
  body: { flex: 1, minHeight: 0 },
  composer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSecondary,
    paddingVertical: 12,
  },
})
