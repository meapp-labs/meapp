import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { searchHistory } from '@/services/historyTools'
import { useGetMessages } from '@/services/messages'
import { theme } from '@/theme/theme'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FileAttachment } from './FileAttachment'
import { SharedFilesModal } from './SharedFilesModal'
export function HistoryToolsModal({
  roomId,
  filesOnly,
  onClose,
}: { roomId: string; filesOnly: boolean; onClose(): void }) {
  return filesOnly ? (
    <SharedFilesModal roomId={roomId} onClose={onClose} />
  ) : (
    <ChatSearchModal roomId={roomId} filesOnly={false} onClose={onClose} />
  )
}

function ChatSearchModal({
  roomId,
  filesOnly,
  onClose,
}: { roomId: string; filesOnly: boolean; onClose(): void }) {
  const [query, setQuery] = useState('')
  const history = useGetMessages({ conversationId: roomId })
  const messages = useMemo(
    () =>
      searchHistory(history.data?.pages.flatMap((page) => page.messages) ?? [], query, filesOnly),
    [history.data, query, filesOnly],
  )
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.heading}>
              <View style={styles.icon}>
                <MaterialIcons
                  name={filesOnly ? 'folder-open' : 'search'}
                  size={22}
                  color={theme.colors.primary}
                />
              </View>
              <Text style={styles.title}>{filesOnly ? 'Shared files' : 'Search chat'}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close chat history"
              style={styles.close}
              onPress={onClose}
            >
              <MaterialIcons name="close" size={23} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.description}>
            Search your loaded chat history. Load older messages below to find more.
          </Text>
          <TextInput
            accessibilityLabel="Search loaded history"
            placeholder={filesOnly ? 'Filter file names' : 'Find a word or phrase'}
            value={query}
            onChangeText={setQuery}
            placeholderTextColor={theme.colors.textTertiary}
            style={styles.input}
          />
          <Text style={styles.count}>
            {messages.length} {messages.length === 1 ? 'result' : 'results'}
          </Text>
          {history.isError ? (
            <Button
              title="Retry loading history"
              onPress={() => {
                void history.refetch()
              }}
            />
          ) : (
            <FlatList
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              data={messages}
              keyExtractor={(message) => message.id}
              renderItem={({ item }) => (
                <View style={styles.message}>
                  <Text style={styles.metadata}>
                    {item.from ?? 'Message'} ·{' '}
                    {item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}
                  </Text>
                  {!!item.text && <Text selectable>{item.text}</Text>}
                  {item.media?.map((descriptor) => (
                    <FileAttachment key={descriptor.id} descriptor={descriptor} />
                  ))}
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  {history.isPending ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : (
                    <MaterialIcons name="search-off" size={30} color={theme.colors.textTertiary} />
                  )}
                  <Text style={styles.emptyTitle}>
                    {history.isPending ? 'Loading history…' : 'No matching messages'}
                  </Text>
                  {!history.isPending && (
                    <Text style={styles.description}>
                      Try another search or load older messages.
                    </Text>
                  )}
                </View>
              }
            />
          )}
          {history.hasNextPage && (
            <Button
              title="Load older messages"
              loading={history.isFetchingNextPage}
              onPress={() => {
                void history.fetchNextPage()
              }}
            />
          )}
          <View style={styles.privacy}>
            <MaterialIcons name="lock-outline" size={14} color={theme.colors.textSecondary} />
            <Text style={styles.privacyText}>
              Search stays on this device. Unavailable messages cannot be searched.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  close: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 21 },
  input: {
    minHeight: 48,
    padding: 13,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 13,
  },
  count: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
  list: { flex: 1 },
  message: {
    padding: 16,
    gap: 10,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  metadata: { color: theme.colors.textSecondary, fontSize: 12 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 44, gap: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '600' },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  privacyText: { flex: 1, color: theme.colors.textSecondary, fontSize: 11, lineHeight: 17 },
})
