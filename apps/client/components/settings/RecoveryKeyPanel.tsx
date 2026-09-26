import { useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/common/Text'
import { getE2EContext } from '@/services/e2e'
import { createRecoveryKey, recoveryStatus, uploadRecoveryBackup } from '@/services/recovery'
import { theme } from '@/theme/theme'

export function RecoveryKeyPanel() {
  const [key, setKey] = useState('')
  const [available, setAvailable] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (Platform.OS !== 'web') return
    void recoveryStatus()
      .then((status) => {
        setAvailable(status.available)
        setUpdatedAt(status.updatedAt)
      })
      .catch(() => undefined)
  }, [])

  if (Platform.OS !== 'web') {
    return <Text>Recovery keys are currently available in the web app.</Text>
  }

  const create = async () => {
    setBusy(true)
    setMessage('')
    try {
      const context = await getE2EContext()
      const generated = await createRecoveryKey(context)
      setKey(generated)
      setAvailable(true)
      setUpdatedAt(Date.now())
      setMessage('Backup saved. Keep this key somewhere outside this browser.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create recovery backup')
    } finally {
      setBusy(false)
    }
  }

  const refresh = async () => {
    setBusy(true)
    setMessage('')
    try {
      await uploadRecoveryBackup(await getE2EContext())
      setUpdatedAt(Date.now())
      setMessage('Encrypted backup updated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update recovery backup')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Recovery key</Text>
      <Text style={styles.detail}>
        Save this key outside your browser. It unlocks an encrypted backup of this device’s chat
        keys and history. If you lose every linked device and the key, old encrypted chats cannot be
        recovered.
      </Text>
      {available && (
        <Text style={styles.status}>
          Backup: {updatedAt ? new Date(updatedAt).toLocaleString() : 'available'}
        </Text>
      )}
      <Pressable disabled={busy} style={styles.button} onPress={() => void create()}>
        <Text style={styles.buttonText}>
          {busy ? 'Working…' : available ? 'Show recovery key' : 'Create recovery key'}
        </Text>
      </Pressable>
      {key ? (
        <View style={styles.keyBox}>
          <Text selectable style={styles.key}>
            {key}
          </Text>
          <Pressable onPress={() => void navigator.clipboard?.writeText(key)}>
            <Text style={styles.copy}>Copy key</Text>
          </Pressable>
        </View>
      ) : null}
      {available && (
        <Pressable disabled={busy} style={styles.secondaryButton} onPress={() => void refresh()}>
          <Text style={styles.secondaryText}>Update backup now</Text>
        </Pressable>
      )}
      {message ? <Text style={styles.detail}>{message}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.md, gap: theme.spacing.md },
  title: { ...theme.typography.h2, fontWeight: '700' },
  detail: { color: theme.colors.textSecondary, lineHeight: 21 },
  status: { color: theme.colors.success },
  button: {
    padding: theme.spacing.md,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
  },
  buttonText: { color: '#111', fontWeight: '700' },
  secondaryButton: {
    padding: theme.spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  secondaryText: { color: theme.colors.text },
  keyBox: {
    padding: theme.spacing.md,
    borderRadius: 10,
    backgroundColor: theme.colors.card,
    gap: theme.spacing.sm,
  },
  key: {
    color: theme.colors.primary,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    fontSize: 15,
  },
  copy: { color: theme.colors.primary, fontWeight: '600' },
})
