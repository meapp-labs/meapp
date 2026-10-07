import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { searchHistory } from '@/services/historyTools'
import { useGetMessages } from '@/services/messages'
import { theme } from '@/theme/theme'
import { useMemo, useState } from 'react'
import { FlatList, Modal, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FileAttachment } from './FileAttachment'
export function HistoryToolsModal({
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
        <View style={{ flex: 1, padding: 20, gap: 12 }}>
          <Text style={theme.typography.h2}>{filesOnly ? 'Shared files' : 'Search chat'}</Text>
          <Text>
            Search runs on this device over decrypted history loaded below. Load older messages to
            expand results. Messages unavailable to this device cannot be searched.
          </Text>
          <TextInput
            accessibilityLabel="Search loaded history"
            placeholder={filesOnly ? 'Filter file names' : 'Find a word or phrase'}
            value={query}
            onChangeText={setQuery}
            style={{
              padding: 12,
              color: theme.colors.text,
              borderWidth: 1,
              borderColor: theme.colors.secondary,
              borderRadius: 6,
            }}
          />
          <Text>{messages.length} results in loaded history</Text>
          {history.isError ? (
            <Button
              title="Retry loading history"
              onPress={() => {
                void history.refetch()
              }}
            />
          ) : (
            <FlatList
              data={messages}
              keyExtractor={(message) => message.id}
              renderItem={({ item }) => (
                <View style={{ paddingVertical: 14, gap: 8 }}>
                  <Text>
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
                <Text>{history.isPending ? 'Loading history…' : 'No matching messages'}</Text>
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
          <Button title="Close" variant="outline" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  )
}
