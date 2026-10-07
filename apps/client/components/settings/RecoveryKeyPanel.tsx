import * as Clipboard from 'expo-clipboard'
import { useCallback, useEffect, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { Button } from '@/components/common/Button'
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
  const [loaded, setLoaded] = useState(false)
  const [canUpdate, setCanUpdate] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [restorable, setRestorable] = useState(true)

  const loadStatus = useCallback(async () => {
    try {
      const status = await recoveryStatus()
      setAvailable(status.available)
      setUpdatedAt(status.updatedAt)
      setCanUpdate(status.canUpdate ?? false)
      setLastError(status.lastError ?? null)
      setRestorable(status.restorable ?? true)
      setLoaded(true)
    } catch (error) {
      setLoaded(false)
      setLastError(error instanceof Error ? error.message : 'Could not check backup status')
    }
  }, [])

  useEffect(() => {
    void loadStatus()
    const timer = setInterval(() => void loadStatus(), 15000)
    return () => clearInterval(timer)
  }, [loadStatus])

  const create = async () => {
    setBusy(true)
    setMessage('')
    try {
      const context = await getE2EContext()
      const generated = await createRecoveryKey(context)
      setKey(generated)
      await loadStatus()
      setMessage('Backup saved. Keep this key somewhere outside this device.')
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
      await loadStatus()
      setMessage('Encrypted backup updated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update recovery backup')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.detail}>
        Save this key outside your device. It unlocks an encrypted backup of this device’s chat keys
        and history. If you lose every linked device and the key, old encrypted chats cannot be
        recovered.
      </Text>
      {available && (
        <Text style={styles.status}>
          Backup: {updatedAt ? new Date(updatedAt).toLocaleString() : 'available'}
        </Text>
      )}
      <Text style={styles.detail}>
        {loaded && !available
          ? 'No saved backup yet.'
          : !loaded
            ? 'Backup status unavailable. Check again before relying on recovery.'
            : ''}
        {'\n'}Encrypted upload limit: 50 MB. Incomplete uploads expire after one hour. Only the
        backup owner can update it.
        {'\n'}Recovery restores the saved snapshot. Messages after that date may be lost. Sending
        starts fresh encryption sessions; the original device loses access.
      </Text>
      {loaded && available && !canUpdate && (
        <Text>This backup belongs to another linked device.</Text>
      )}
      {loaded && available && !restorable && (
        <Text>
          The backup's linked device was revoked. This backup cannot restore device access.
        </Text>
      )}
      {lastError && <Text>Last backup error: {lastError}</Text>}
      <Button title="Check backup status" variant="outline" onPress={() => void loadStatus()} />
      <Button
        disabled={busy || !loaded || !canUpdate}
        loading={busy}
        title={available ? 'Show recovery key' : 'Create recovery key'}
        onPress={() => void create()}
      />
      {key ? (
        <View style={styles.keyBox}>
          <Text selectable style={styles.key}>
            {key}
          </Text>
          <Button
            title="Copy key"
            variant="outline"
            onPress={() =>
              void Clipboard.setStringAsync(key).catch(() =>
                setMessage('Could not copy the key. Select it and save it manually.'),
              )
            }
          />
        </View>
      ) : null}
      {available && canUpdate && (
        <Button
          title="Update backup now"
          variant="outline"
          disabled={busy}
          onPress={() => void refresh()}
        />
      )}
      {message ? <Text style={styles.detail}>{message}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 18 },
  detail: { color: theme.colors.textSecondary, lineHeight: 23, fontSize: 14 },
  status: {
    color: theme.colors.success,
    fontSize: 14,
    lineHeight: 22,
    padding: 16,
    borderRadius: 14,
    backgroundColor: theme.colors.backgroundSecondary,
  },
  keyBox: {
    padding: theme.spacing.md,
    borderRadius: 16,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    gap: 16,
  },
  key: {
    color: theme.colors.primary,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    fontSize: 15,
    lineHeight: 24,
  },
})
