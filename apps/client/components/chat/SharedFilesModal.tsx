import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { loadMedia } from '@/services/media'
import { useGetMessages } from '@/services/messages'
import {
  type SharedFile,
  type SharedFileFilter,
  collectSharedFiles,
  filterSharedFiles,
  isPhoto,
} from '@/services/sharedFiles'
import { theme } from '@/theme/theme'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Image } from 'expo-image'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ViewToken,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { FileAttachment } from './FileAttachment'

const filters: { key: SharedFileFilter; label: string; icon: IconName }[] = [
  { key: 'all', label: 'All files', icon: 'apps' },
  { key: 'photos', label: 'Photos', icon: 'photo-library' },
  { key: 'video', label: 'Videos', icon: 'videocam' },
  { key: 'file', label: 'Documents', icon: 'description' },
  { key: 'audio', label: 'Audio', icon: 'headphones' },
]
type IconName = React.ComponentProps<typeof MaterialIcons>['name']
type Row = { key: string; day: string; month: string } & (
  | { type: 'date'; count: number }
  | { type: 'photos'; files: SharedFile[] }
  | { type: 'file'; file: SharedFile }
)
const dateLabel = (day: string, month = false) =>
  day === 'unknown'
    ? 'Date unavailable'
    : new Date(`${day}${month ? '-01' : ''}T12:00:00`).toLocaleDateString(
        undefined,
        month
          ? { month: 'short', year: 'numeric' }
          : { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' },
      )
const fileIcon = (file: SharedFile): IconName =>
  file.descriptor.kind === 'video'
    ? 'play-circle-outline'
    : file.descriptor.kind === 'audio'
      ? 'headphones'
      : 'description'
const fileSize = (file: SharedFile) => {
  const bytes = Math.max(
    0,
    (file.descriptor.variants.find((v) => v.name === 'orig')?.size ?? 28) - 28,
  )
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Photo({ file, full = false }: { file: SharedFile; full?: boolean }) {
  const [uri, setUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter intentionally restarts the download.
  useEffect(() => {
    const controller = new AbortController()
    setUri(null)
    setFailed(false)
    const variant =
      !full && file.descriptor.variants.some((v) => v.name === 'thumb') ? 'thumb' : 'orig'
    void loadMedia(file.descriptor, variant, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setUri(value)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [file.descriptor, full, attempt])
  return (
    <View style={styles.photoImage}>
      <Image
        source={uri ? { uri } : null}
        style={styles.photoImage}
        contentFit={full ? 'contain' : 'cover'}
        cachePolicy="none"
        recyclingKey={`${file.descriptor.id}-${full}`}
        placeholder={file.descriptor.blurhash ? { blurhash: file.descriptor.blurhash } : null}
        accessibilityLabel={file.descriptor.fileName ?? 'Shared photo'}
      />
      {!uri && (
        <View style={styles.photoStatus}>
          {failed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading photo"
              onPress={() => setAttempt((value) => value + 1)}
              style={styles.retryPhoto}
            >
              <MaterialIcons name="refresh" size={24} color={theme.colors.textSecondary} />
              <Text style={styles.muted}>Retry photo</Text>
            </Pressable>
          ) : (
            <ActivityIndicator color={theme.colors.primary} />
          )}
        </View>
      )}
    </View>
  )
}

export function SharedFilesModal({ roomId, onClose }: { roomId: string; onClose(): void }) {
  const history = useGetMessages({ conversationId: roomId })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SharedFileFilter>('all')
  const [oldestFirst, setOldestFirst] = useState(false)
  const [width, setWidth] = useState(320)
  const [activeMonth, setActiveMonth] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const list = useRef<FlatList<Row>>(null)
  const files = useMemo(
    () => collectSharedFiles(history.data?.pages.flatMap((page) => page.messages) ?? []),
    [history.data],
  )
  const matches = useMemo(() => {
    const result = filterSharedFiles(files, query, filter)
    return oldestFirst ? result.reverse() : result
  }, [files, query, filter, oldestFirst])
  const columns = width >= 680 ? 4 : width >= 440 ? 3 : 2
  const tileSize = (width - (columns - 1) * 8) / columns
  const { rows, months } = useMemo(() => {
    const rows: Row[] = []
    const months: { key: string; index: number; count: number }[] = []
    const days = new Map<string, SharedFile[]>()
    for (const file of matches) {
      const entries = days.get(file.day)
      if (entries) entries.push(file)
      else days.set(file.day, [file])
    }
    for (const [day, entries] of days) {
      const month = entries[0]?.month ?? 'unknown'
      const existingMonth = months.find((entry) => entry.key === month)
      if (existingMonth) existingMonth.count += entries.length
      else months.push({ key: month, index: rows.length, count: entries.length })
      rows.push({ type: 'date', key: day, day, month, count: entries.length })
      const photos = entries.filter((entry) => isPhoto(entry.descriptor))
      for (let i = 0; i < photos.length; i += columns)
        rows.push({
          type: 'photos',
          key: `${day}-photos-${i}`,
          day,
          month,
          files: photos.slice(i, i + columns),
        })
      for (const file of entries.filter((entry) => !isPhoto(entry.descriptor)))
        rows.push({ type: 'file', key: file.descriptor.id, day, month, file })
    }
    return { rows, months }
  }, [matches, columns])
  const layouts = useMemo(() => {
    let offset = 0
    return rows.map((row, index) => {
      const length = row.type === 'date' ? 68 : row.type === 'photos' ? tileSize + 8 : 104
      const layout = { index, length, offset }
      offset += length
      return layout
    })
  }, [rows, tileSize])
  const resetScroll = () => {
    list.current?.scrollToOffset({ offset: 0, animated: false })
    setActiveMonth('')
  }
  const updateQuery = (value: string) => {
    resetScroll()
    setQuery(value)
  }
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
      const first = viewableItems[0]?.item
      if (first) setActiveMonth(first.month)
    },
  ).current
  const selected = files.find((file) => file.descriptor.id === selectedId)
  const photos = matches.filter((file) => isPhoto(file.descriptor))
  const photoIndex = photos.findIndex((file) => file.descriptor.id === selectedId)
  const displayMonth = months.some((month) => month.key === activeMonth)
    ? activeMonth
    : months[0]?.key

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.brandIcon}>
              <MaterialIcons name="folder-open" size={25} color={theme.colors.primary} />
            </View>
            <View style={styles.grow}>
              <Text style={styles.eyebrow}>YOUR CONVERSATION, COLLECTED</Text>
              <Text style={styles.title}>Shared files</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close shared files"
              onPress={onClose}
              style={styles.iconButton}
            >
              <MaterialIcons name="close" size={24} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.search}>
            <MaterialIcons name="search" size={22} color={theme.colors.textSecondary} />
            <TextInput
              value={query}
              onChangeText={updateQuery}
              placeholder="Search files, people or captions"
              placeholderTextColor={theme.colors.textTertiary}
              accessibilityLabel="Search shared files by filename, sender, caption or date"
              style={styles.input}
              autoCorrect={false}
            />
            {!!query && (
              <Pressable
                onPress={() => updateQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                style={styles.iconButton}
              >
                <MaterialIcons name="cancel" size={19} color={theme.colors.textSecondary} />
              </Pressable>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filters}
            contentContainerStyle={styles.filterContent}
          >
            {filters.map((option) => {
              const count = filterSharedFiles(files, '', option.key).length
              const active = filter === option.key
              return (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    resetScroll()
                    setFilter(option.key)
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.filter, active && styles.filterActive]}
                >
                  <MaterialIcons
                    name={option.icon}
                    size={18}
                    color={active ? theme.colors.background : theme.colors.textSecondary}
                  />
                  <Text style={[styles.filterLabel, active && styles.darkText]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.filterCount, active && styles.darkText]}>{count}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
          <View style={styles.toolbar}>
            <Text style={styles.muted}>
              {matches.length} {matches.length === 1 ? 'item' : 'items'}
              {query ? ' found' : ' in loaded history'}
            </Text>
            <Pressable
              onPress={() => {
                resetScroll()
                setOldestFirst((value) => !value)
              }}
              accessibilityRole="button"
              accessibilityLabel={`Sort ${oldestFirst ? 'newest' : 'oldest'} first`}
              style={styles.sort}
            >
              <MaterialIcons name="swap-vert" size={18} color={theme.colors.primary} />
              <Text style={styles.sortText}>{oldestFirst ? 'Oldest first' : 'Newest first'}</Text>
            </Pressable>
          </View>
          <View style={styles.browser}>
            <View
              style={styles.grow}
              onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            >
              <FlatList
                ref={list}
                initialNumToRender={6}
                maxToRenderPerBatch={4}
                windowSize={5}
                data={rows}
                extraData={tileSize}
                keyExtractor={(row) => row.key}
                style={styles.list}
                keyboardShouldPersistTaps="handled"
                getItemLayout={(_, index) => layouts[index] ?? { index, length: 0, offset: 0 }}
                onViewableItemsChanged={onViewableItemsChanged}
                renderItem={({ item }) => {
                  if (item.type === 'date')
                    return (
                      <View style={styles.dateHeader}>
                        <Text style={styles.dateTitle}>{dateLabel(item.day)}</Text>
                        <Text style={styles.dateCount}>{item.count}</Text>
                      </View>
                    )
                  if (item.type === 'photos')
                    return (
                      <View style={[styles.photoRow, { height: tileSize + 8 }]}>
                        {item.files.map((file) => (
                          <Pressable
                            key={file.descriptor.id}
                            onPress={() => setSelectedId(file.descriptor.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${file.descriptor.fileName ?? 'photo'} from ${file.message.from ?? 'Unknown sender'}, ${dateLabel(file.day)}`}
                            style={[styles.tile, { width: tileSize, height: tileSize }]}
                          >
                            <Photo file={file} />
                            <View style={styles.photoCaption}>
                              <Text numberOfLines={1} style={styles.photoSender}>
                                {file.message.from ?? 'Shared photo'}
                              </Text>
                              {file.descriptor.kind === 'gif' && (
                                <Text style={styles.gif}>GIF</Text>
                              )}
                              <MaterialIcons name="fullscreen" size={17} color="white" />
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    )
                  return (
                    <View style={styles.fileRow}>
                      <Pressable
                        onPress={() => setSelectedId(item.file.descriptor.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${item.file.descriptor.fileName ?? 'Shared file'}`}
                        style={({ pressed }) => [styles.fileCard, pressed && styles.pressed]}
                      >
                        <View style={styles.fileIcon}>
                          <MaterialIcons
                            name={fileIcon(item.file)}
                            size={26}
                            color={theme.colors.primary}
                          />
                        </View>
                        <View style={styles.grow}>
                          <Text numberOfLines={1} style={styles.fileName}>
                            {item.file.descriptor.fileName ?? `Shared ${item.file.descriptor.kind}`}
                          </Text>
                          <Text numberOfLines={1} style={styles.fileMeta}>
                            {item.file.message.from ?? 'Unknown sender'} · {fileSize(item.file)}
                          </Text>
                        </View>
                        <MaterialIcons
                          name="chevron-right"
                          size={22}
                          color={theme.colors.textTertiary}
                        />
                      </Pressable>
                    </View>
                  )
                }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    {history.isPending ? (
                      <ActivityIndicator color={theme.colors.primary} />
                    ) : (
                      <View style={styles.emptyIcon}>
                        <MaterialIcons
                          name={query ? 'search-off' : 'perm-media'}
                          size={32}
                          color={theme.colors.primary}
                        />
                      </View>
                    )}
                    <Text style={styles.emptyTitle}>
                      {history.isPending
                        ? 'Gathering your files…'
                        : query || filter !== 'all'
                          ? 'No files match yet'
                          : 'Your shared files live here'}
                    </Text>
                    <Text style={styles.emptyText}>
                      {history.isPending
                        ? 'Loading the conversation history.'
                        : query || filter !== 'all'
                          ? 'Try another search or category. Older history may have more matches.'
                          : 'Photos, videos and documents from this conversation will appear here, organized by date.'}
                    </Text>
                    {(query || filter !== 'all') && (
                      <Button
                        title="Clear filters"
                        onPress={() => {
                          updateQuery('')
                          setFilter('all')
                        }}
                      />
                    )}
                  </View>
                }
                ListFooterComponent={
                  <View style={styles.footer}>
                    {history.isError || history.isFetchNextPageError ? (
                      <>
                        <Text style={styles.emptyText}>
                          Could not load more history. Your loaded files are still available.
                        </Text>
                        <Button
                          title="Try again"
                          onPress={() => {
                            void (history.isFetchNextPageError
                              ? history.fetchNextPage()
                              : history.refetch())
                          }}
                        />
                      </>
                    ) : history.hasNextPage ? (
                      <Button
                        title="Load older files"
                        loading={history.isFetchingNextPage}
                        onPress={() => {
                          void history.fetchNextPage()
                        }}
                      />
                    ) : matches.length > 0 ? (
                      <Text style={styles.muted}>You’re all caught up with available history</Text>
                    ) : null}
                  </View>
                }
              />
            </View>
            {months.length > 0 && (
              <View style={styles.rail}>
                <MaterialIcons name="calendar-month" size={18} color={theme.colors.textTertiary} />
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.railContent}
                >
                  {months.map((month) => (
                    <Pressable
                      key={month.key}
                      accessibilityRole="button"
                      accessibilityLabel={`Jump to ${dateLabel(month.key, true)}, ${month.count} files`}
                      accessibilityState={{ selected: displayMonth === month.key }}
                      onPress={() => {
                        setActiveMonth(month.key)
                        list.current?.scrollToIndex({ index: month.index, animated: true })
                      }}
                      style={[styles.month, displayMonth === month.key && styles.monthActive]}
                    >
                      <View
                        style={[
                          styles.monthDot,
                          displayMonth === month.key && styles.monthDotActive,
                        ]}
                      />
                      <Text
                        style={[
                          styles.monthLabel,
                          displayMonth === month.key && styles.monthLabelActive,
                        ]}
                      >
                        {dateLabel(month.key, true)}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
          <View style={styles.privacy}>
            <MaterialIcons name="lock-outline" size={13} color={theme.colors.textTertiary} />
            <Text style={styles.privacyText}>
              Private search on this device · Load older history to discover more
            </Text>
          </View>
        </View>
      </SafeAreaView>
      {selected && (
        <Modal visible animationType="fade" onRequestClose={() => setSelectedId(null)}>
          <SafeAreaView style={styles.screen}>
            <View style={styles.viewer}>
              <View style={styles.header}>
                <View style={styles.grow}>
                  <Text numberOfLines={1} style={styles.fileName}>
                    {selected.descriptor.fileName ?? 'Shared photo'}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {selected.message.from ?? 'Unknown sender'} · {dateLabel(selected.day)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close preview"
                  style={styles.iconButton}
                  onPress={() => setSelectedId(null)}
                >
                  <MaterialIcons name="close" size={25} color={theme.colors.text} />
                </Pressable>
              </View>
              {isPhoto(selected.descriptor) ? (
                <>
                  <View style={styles.fullPhoto}>
                    <Photo key={selected.descriptor.id} file={selected} full />
                  </View>
                  <View style={styles.viewerNavigation}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Previous photo"
                      disabled={photoIndex <= 0}
                      style={[styles.iconButton, photoIndex <= 0 && styles.disabled]}
                      onPress={() => setSelectedId(photos[photoIndex - 1]?.descriptor.id ?? null)}
                    >
                      <MaterialIcons name="chevron-left" size={28} color={theme.colors.text} />
                    </Pressable>
                    <Text style={styles.muted}>
                      {photoIndex + 1} / {photos.length}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Next photo"
                      disabled={photoIndex < 0 || photoIndex >= photos.length - 1}
                      style={[
                        styles.iconButton,
                        (photoIndex < 0 || photoIndex >= photos.length - 1) && styles.disabled,
                      ]}
                      onPress={() => setSelectedId(photos[photoIndex + 1]?.descriptor.id ?? null)}
                    >
                      <MaterialIcons name="chevron-right" size={28} color={theme.colors.text} />
                    </Pressable>
                  </View>
                </>
              ) : (
                <ScrollView contentContainerStyle={styles.fileDetail}>
                  <View style={styles.emptyIcon}>
                    <MaterialIcons
                      name={fileIcon(selected)}
                      size={40}
                      color={theme.colors.primary}
                    />
                  </View>
                  <FileAttachment key={selected.descriptor.id} descriptor={selected.descriptor} />
                </ScrollView>
              )}
              {!!selected.message.text && (
                <Text numberOfLines={3} style={styles.caption}>
                  {selected.message.text}
                </Text>
              )}
            </View>
          </SafeAreaView>
        </Modal>
      )}
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingTop: 20,
    gap: 18,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  brandIcon: {
    width: 50,
    height: 50,
    borderRadius: 17,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: theme.colors.textTertiary,
    marginBottom: 5,
  },
  title: { fontSize: 27, fontWeight: '700', letterSpacing: -0.8 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 15,
    paddingRight: 4,
    minHeight: 54,
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  input: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 14, paddingVertical: 15 },
  filters: { flexGrow: 0, flexShrink: 0 },
  filterContent: { gap: 8 },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 13,
    backgroundColor: theme.colors.surface,
  },
  filterActive: { backgroundColor: theme.colors.primary },
  filterLabel: { fontSize: 13, fontWeight: '600' },
  filterCount: { fontSize: 11, color: theme.colors.textTertiary },
  darkText: { color: theme.colors.background },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  muted: { color: theme.colors.textSecondary, fontSize: 12 },
  sort: { flexDirection: 'row', gap: 4, alignItems: 'center', minHeight: 36 },
  sortText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
  browser: { flex: 1, flexDirection: 'row', gap: 12 },
  list: { flex: 1 },
  dateHeader: { height: 68, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateTitle: { flex: 1, fontSize: 13, fontWeight: '600' },
  dateCount: { color: theme.colors.textTertiary, fontSize: 11 },
  photoRow: { flexDirection: 'row', gap: 8, paddingBottom: 8 },
  tile: { backgroundColor: theme.colors.card, borderRadius: 14, overflow: 'hidden' },
  photoImage: { flex: 1, width: '100%', height: '100%' },
  photoStatus: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  retryPhoto: { alignItems: 'center', gap: 4, padding: 8 },
  photoCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 9,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  photoSender: { flex: 1, color: 'white', fontSize: 10 },
  gif: { fontSize: 9, fontWeight: '700', color: 'white' },
  fileRow: { height: 104, paddingBottom: 8 },
  fileCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  pressed: { backgroundColor: theme.colors.card },
  fileIcon: {
    width: 44,
    height: 44,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileMeta: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 7 },
  rail: {
    width: 70,
    alignItems: 'center',
    paddingTop: 22,
    gap: 14,
    borderLeftWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  railContent: { gap: 6, paddingBottom: 12 },
  month: {
    minHeight: 48,
    width: 68,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: 'center',
    gap: 6,
  },
  monthActive: { backgroundColor: theme.colors.card },
  monthDot: { height: 4, width: 4, borderRadius: 2, backgroundColor: theme.colors.border },
  monthDotActive: { backgroundColor: theme.colors.primary, width: 18 },
  monthLabel: { fontSize: 10, textAlign: 'center', color: theme.colors.textTertiary },
  monthLabelActive: { color: theme.colors.primary, fontWeight: '700' },
  empty: { paddingVertical: 48, paddingHorizontal: 12, alignItems: 'center', gap: 16 },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptyText: {
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
    color: theme.colors.textSecondary,
    maxWidth: 340,
  },
  footer: { paddingVertical: 24, gap: 14, alignItems: 'center' },
  privacy: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingBottom: 14 },
  privacyText: { flex: 1, fontSize: 10, lineHeight: 16, color: theme.colors.textTertiary },
  viewer: { flex: 1, padding: 20, width: '100%', maxWidth: 1100, alignSelf: 'center', gap: 20 },
  fullPhoto: { flex: 1, minHeight: 100 },
  viewerNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  disabled: { opacity: 0.3 },
  caption: { textAlign: 'center', color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 },
  fileDetail: { paddingVertical: 40, gap: 24, alignItems: 'center' },
})
