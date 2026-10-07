import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { openJournal } from '@/services/journal'
import { theme } from '@/theme/theme'
import type { Journal } from '@meapp/shared'
import { useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
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
    <View style={{ gap: 12 }}>
      <Text>
        This journal is encrypted on this device. It does not sync or belong to your chat recovery
        backup. Clearing local storage or restoring a backup removes it. Keep important notes in
        Saved messages.
      </Text>
      <Button
        title="Reload journal"
        disabled={busy}
        onPress={() => {
          void run('load')
        }}
      />
      <TextInput
        accessibilityLabel="Journal entry"
        multiline
        value={text}
        onChangeText={setText}
        maxLength={10000}
        placeholder="Write a private note"
        style={{
          minHeight: 120,
          padding: 12,
          color: theme.colors.text,
          borderWidth: 1,
          borderColor: theme.colors.secondary,
          borderRadius: 6,
        }}
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
      {!!error && <Text accessibilityLiveRegion="polite">{error}</Text>}
      {journal?.entries.map((entry) => (
        <View key={entry.id} style={{ gap: 8, paddingVertical: 12 }}>
          <Text>{new Date(entry.updatedAt).toLocaleString()}</Text>
          <Text selectable>{entry.text}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              title="Edit"
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
