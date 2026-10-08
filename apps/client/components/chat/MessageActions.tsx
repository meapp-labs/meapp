import { Text } from '@/components/common/Text'
import { theme } from '@/theme/theme'
import { MaterialIcons } from '@expo/vector-icons'
import type { Message, ReactionEntry, ReactionOperation } from '@meapp/shared'
import { REACTION_EMOJI } from '@meapp/shared'
import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { MessageBubble } from './MessageBubble'

const names = [
  'love heart',
  'like thumbs up',
  'laugh joy',
  'surprised wow',
  'sad',
  'fire',
  'celebrate party',
  'thanks pray',
  'clap applause',
  'hundred perfect',
  'think',
  'eyes look',
  'love heart eyes',
  'party birthday',
  'cool sunglasses',
  'yes check done',
  'strong muscle',
  'sparkles',
  'raised hands',
  'handshake agree',
  'heart hands',
  'smile sweat',
  'cry tears',
  'broken heart',
]
const emojiName = (emoji: string) =>
  names[REACTION_EMOJI.indexOf(emoji as (typeof REACTION_EMOJI)[number])] ?? emoji

export function MessageInteraction({
  children,
  onReply,
  onOpen,
  enabled,
}: {
  children: React.ReactNode
  onReply: () => void
  onOpen: () => void
  enabled: boolean
}) {
  const offset = useRef(new Animated.Value(0)).current
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const { width } = useWindowDimensions()
  const desktopActions = Platform.OS === 'web' && width >= 768
  const callbacks = useRef({ onReply, enabled })
  callbacks.current = { onReply, enabled }
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        callbacks.current.enabled && gesture.dx > 12 && Math.abs(gesture.dy) < 8,
      onPanResponderMove: (_, gesture) => offset.setValue(Math.max(0, Math.min(gesture.dx, 88))),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx >= 60 && callbacks.current.enabled) callbacks.current.onReply()
        Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start()
      },
      onPanResponderTerminate: () =>
        Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start(),
    }),
  ).current
  return (
    <Pressable
      accessible={false}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{ paddingVertical: 4 }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.swipeHint,
          {
            opacity: offset.interpolate({
              inputRange: [0, 45],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            }),
          },
        ]}
      >
        <MaterialIcons name="reply" size={24} color={theme.colors.primary} />
      </Animated.View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: offset }] }}>
        <Pressable
          onLongPress={enabled ? onOpen : undefined}
          {...(Platform.OS === 'web'
            ? {
                onContextMenu: (event: { preventDefault: () => void }) => {
                  if (enabled) {
                    event.preventDefault()
                    onOpen()
                  }
                },
              }
            : {})}
          delayLongPress={350}
          accessibilityLabel="Message. Hold for actions or swipe right to reply"
          accessibilityActions={[
            { name: 'activate', label: 'Message actions' },
            { name: 'reply', label: 'Reply' },
          ]}
          onAccessibilityAction={(event) => {
            if (!enabled) return
            if (event.nativeEvent.actionName === 'reply') onReply()
            else onOpen()
          }}
        >
          {children}
        </Pressable>
      </Animated.View>
      {enabled && desktopActions && (
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel="Open message actions"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          hitSlop={8}
          style={[styles.more, { opacity: hovered || focused ? 1 : 0 }]}
        >
          <MaterialIcons name="add-reaction" size={20} color={theme.colors.text} />
        </Pressable>
      )}
    </Pressable>
  )
}

export function ReplyQuote({
  target,
  onPress,
}: { target?: Message | undefined; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go to replied message"
      style={styles.quote}
    >
      <Text style={styles.quoteAuthor}>{target?.from ?? 'Reply'}</Text>
      <Text numberOfLines={2} style={styles.quoteText}>
        {target?.text ??
          (target?.media?.length ? 'Attachment' : 'Original message unavailable on this device')}
      </Text>
    </Pressable>
  )
}

export function ReactionPills({
  entries,
  username,
  onReact,
  onOpen,
  disabled,
}: {
  entries: ReactionEntry[]
  username: string
  onReact: (emoji: ReactionOperation['emoji']) => void
  onOpen: () => void
  disabled: boolean
}) {
  const active = entries.filter((entry) => entry.emoji)
  const groups = [...new Set(active.map((entry) => entry.emoji))]
  if (groups.length === 0) return null
  return (
    <View style={styles.pills}>
      {groups.map((emoji) => {
        const people = active.filter((entry) => entry.emoji === emoji)
        const mine = people.some((entry) => entry.username === username)
        return (
          <Pressable
            key={emoji}
            disabled={disabled}
            onPress={() => onReact(mine ? null : emoji)}
            onLongPress={onOpen}
            accessibilityRole="button"
            accessibilityState={{ selected: mine, disabled }}
            accessibilityLabel={`${emojiName(emoji ?? '')}, ${people.length} reactions${mine ? ', including yours. Tap to remove' : '. Tap to react'}`}
            style={[styles.pill, mine && styles.selected]}
          >
            <Text>
              {emoji} <Text style={styles.count}>{people.length}</Text>
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function MessageActions({
  message,
  entries,
  username,
  pending,
  showPeople = false,
  statusText,
  onRetry,
  onViewThread,
  inThread = false,
  onClose,
  onReply,
  onReact,
}: {
  message: Message | null
  entries: ReactionEntry[]
  username: string
  pending: boolean
  showPeople?: boolean
  statusText?: string | undefined
  onRetry?: () => void
  onViewThread?: () => void
  inThread?: boolean
  onClose: () => void
  onReply: () => void
  onReact: (emoji: ReactionOperation['emoji']) => void
}) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'popular' | 'all' | 'people'>('popular')
  useEffect(() => {
    if (!message) return
    setTab(showPeople ? 'people' : 'popular')
    setSearch('')
  }, [message, showPeople])
  const mine = entries.find((entry) => entry.username === username)?.emoji
  const close = () => {
    setSearch('')
    setTab('popular')
    onClose()
  }
  return (
    <Modal visible={Boolean(message)} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityLabel="Close message actions"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title}>Message</Text>
            <Pressable onPress={close} accessibilityLabel="Close" hitSlop={12}>
              <MaterialIcons name="close" size={24} color={theme.colors.text} />
            </Pressable>
          </View>
          <ScrollView style={styles.messagePreview}>
            {message && <MessageBubble.Received message={message} time="" maxWidth={null} />}
          </ScrollView>
          <Pressable
            onPress={() => {
              onReply()
              close()
            }}
            accessibilityRole="button"
            style={styles.replyButton}
          >
            <MaterialIcons name="reply" size={24} color={theme.colors.primary} />
            <Text style={styles.replyLabel}>
              {inThread ? 'Reply to this message' : 'Reply in thread'}
            </Text>
          </Pressable>
          {onViewThread && (
            <Pressable
              onPress={() => {
                onViewThread()
                close()
              }}
              accessibilityRole="button"
              style={[styles.replyButton, { marginTop: 8 }]}
            >
              <MaterialIcons name="forum" size={22} color={theme.colors.primary} />
              <Text style={styles.replyLabel}>View thread</Text>
            </Pressable>
          )}
          <View style={styles.tabs}>
            {(['popular', 'all', 'people'] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => {
                  setTab(value)
                  setSearch('')
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === value }}
                style={[styles.tab, tab === value && styles.selected]}
              >
                <Text style={styles.tabLabel}>
                  {value === 'popular'
                    ? 'Quick reactions'
                    : value === 'all'
                      ? 'All reactions'
                      : `People · ${entries.filter((e) => e.emoji).length}`}
                </Text>
              </Pressable>
            ))}
          </View>
          {tab === 'all' && (
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search reactions…"
              placeholderTextColor={theme.colors.textSecondary}
              accessibilityLabel="Search reactions"
              style={styles.search}
            />
          )}
          <ScrollView style={styles.picker} keyboardShouldPersistTaps="handled">
            {tab === 'people' ? (
              entries
                .filter((entry) => entry.emoji)
                .map((entry) => (
                  <View key={entry.userId} style={styles.person}>
                    <Text>{entry.emoji}</Text>
                    <Text>{entry.username === username ? 'You' : `@${entry.username}`}</Text>
                  </View>
                ))
            ) : (
              <View style={styles.grid}>
                {(tab === 'popular' ? REACTION_EMOJI.slice(0, 8) : REACTION_EMOJI)
                  .filter(
                    (emoji) => emojiName(emoji).includes(search.toLowerCase()) || emoji === search,
                  )
                  .map((emoji) => (
                    <Pressable
                      key={emoji}
                      disabled={pending}
                      onPress={() => onReact(mine === emoji ? null : emoji)}
                      accessibilityLabel={`${emojiName(emoji)}${mine === emoji ? ', remove your reaction' : ''}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: mine === emoji, disabled: pending }}
                      style={[styles.emoji, mine === emoji && styles.selected]}
                    >
                      <Text style={styles.emojiText}>{emoji}</Text>
                    </Pressable>
                  ))}
              </View>
            )}
            {tab === 'people' && !entries.some((entry) => entry.emoji) && (
              <Text style={styles.note}>Be the first to react.</Text>
            )}
          </ScrollView>
          <Text style={styles.note}>
            {statusText ??
              (pending
                ? 'Saving reaction…'
                : mine
                  ? 'Tap your selected reaction to remove it.'
                  : 'Choose a reaction. You can change it anytime.')}
          </Text>
          {onRetry && (
            <Pressable onPress={onRetry} accessibilityRole="button">
              <Text style={styles.quoteAuthor}>Retry loading reactions</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  swipeHint: { position: 'absolute', left: 20, top: 24 },
  more: {
    position: 'absolute',
    right: 10,
    top: 0,
    width: 40,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
    backgroundColor: '#ffffff09',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  quoteAuthor: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  quoteText: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 3 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: 52, marginBottom: 4 },
  pill: {
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    borderRadius: 18,
    backgroundColor: theme.colors.card,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  selected: { borderColor: theme.colors.primary, backgroundColor: '#F5BA301A', borderWidth: 1 },
  count: { fontSize: 12, fontWeight: '700' },
  overlay: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '90%',
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: '700' },
  messagePreview: { maxHeight: 300, marginBottom: 12 },
  replyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.card,
  },
  replyLabel: { fontWeight: '600' },
  tabs: { flexDirection: 'row', gap: 6, marginVertical: 14, flexWrap: 'wrap' },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  tabLabel: { fontSize: 12 },
  search: {
    color: theme.colors.text,
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  picker: { maxHeight: 210 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emoji: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    backgroundColor: theme.colors.card,
  },
  emojiText: { fontSize: 26 },
  person: { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  note: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 12 },
})
