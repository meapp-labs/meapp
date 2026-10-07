import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { openJournal } from '@/services/journal'
import { theme } from '@/theme/theme'
import type { Journal } from '@meapp/shared'
import { useEffect, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
export function JournalPanel() {
  const [journal, setJournal] = useState<Journal | null>(null)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: 'load' | 'save' | 'delete', id?: string) => {
    setBusy(true)
    setError('')
    try {
      const repository = await openJournal()
      const value =
        action === 'load'
          ? await repository.read()
          : action === 'delete' && id
            ? await repository.remove(journal?.revision ?? 0, id)
            : await repository.save(journal?.revision ?? 0, text, editing)
      setJournal(value)
      if (action !== 'load') {
        setText('')
        setEditing(undefined)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Journal unavailable')
    } finally {
      setBusy(false)
    }
  }
  // The panel is scoped to the signed-in settings session.
  useEffect(() => {
    let live = true
    void openJournal()
      .then((repository) => repository.read())
      .then((value) => {
        if (live) setJournal(value)
      })
      .catch((error) => {
        if (live) setError(error instanceof Error ? error.message : 'Journal unavailable')
      })
    return () => {
      live = false
    }
  }, [])
  return (
    <View style={styles.container}>
      <Text style={styles.description}>
        This journal is encrypted on this device. It does not sync or belong to your chat recovery
        backup. Clearing local storage or restoring a backup removes it. Keep important notes in
        Saved messages.
      </Text>
      <Button
        title="Reload journal"
        variant="outline"
        disabled={busy}
        onPress={() => {
          void run('load')
        }}
      />
      <Text style={styles.sectionTitle}>
        {editing ? 'Edit your entry' : 'A moment for yourself'}
      </Text>
      <TextInput
        accessibilityLabel="Journal entry"
        multiline
        value={text}
        onChangeText={setText}
        maxLength={10000}
        placeholder="Write a private note"
        placeholderTextColor={theme.colors.textTertiary}
        textAlignVertical="top"
        style={styles.input}
      />
      <Button
        title={editing ? 'Save changes' : 'Add entry'}
        loading={busy}
        disabled={!journal || !text.trim()}
        onPress={() => {
          void run('save')
        }}
      />
      {editing && (
        <Button
          title="Cancel editing"
          variant="outline"
          onPress={() => {
            setEditing(undefined)
            setText('')
          }}
        />
      )}
      {!!error && (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      {journal && journal.entries.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.description}>
            Your journal is a clean page. Add your first note above.
          </Text>
        </View>
      )}
      {journal?.entries.map((entry) => (
        <View key={entry.id} style={styles.entry}>
          <Text style={styles.timestamp}>{new Date(entry.updatedAt).toLocaleString()}</Text>
          <Text selectable style={styles.entryText}>
            {entry.text}
          </Text>
          <View style={styles.actions}>
            <Button
              title="Edit"
              variant="outline"
              disabled={busy}
              onPress={() => {
                setEditing(entry.id)
                setText(entry.text)
              }}
            />
            <Button
              title="Delete"
              variant="outline"
              disabled={busy}
              onPress={() => {
                void run('delete', entry.id)
              }}
            />
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 18 },
  description: { fontSize: 14, lineHeight: 23, color: theme.colors.textSecondary },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 6 },
  input: {
    minHeight: 160,
    padding: 16,
    fontSize: 15,
    lineHeight: 24,
    color: theme.colors.text,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
  },
  error: { color: theme.colors.error, fontSize: 14, lineHeight: 22 },
  empty: {
    padding: 18,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    borderRadius: 16,
  },
  entry: {
    gap: 14,
    padding: 18,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    borderRadius: 16,
  },
  timestamp: { fontSize: 12, color: theme.colors.textTertiary },
  entryText: { fontSize: 15, lineHeight: 24 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
})
