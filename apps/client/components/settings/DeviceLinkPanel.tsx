import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import { getFetcher } from '@/lib/api'
import {
  approveDeviceLink,
  connectDeviceLink,
  copyHistoryToDevice,
  deviceLinkStatus,
  finishDeviceLink,
  linkVerificationCode,
  listLinkedDevices,
  revokeLinkedDevice,
  startDeviceLink,
} from '@/services/deviceLink'
import { ensureLinkedHistoryReady } from '@/services/deviceLink'
import { getE2EContext, resetE2EContext } from '@/services/e2e'
import { recoveryStatus, restoreRecoveryBackup } from '@/services/recovery'
import { theme } from '@/theme/theme'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

export function DeviceLinkPanel({
  mode,
  onLinked,
  onCancel,
}: { mode: 'approve' | 'recover'; onLinked?: () => void; onCancel?: () => void }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [recoverError, setRecoverError] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [recoveryAvailable, setRecoveryAvailable] = useState<boolean | null>(null)
  const [recoveryStatusError, setRecoveryStatusError] = useState('')
  const [recoveryRestorable, setRecoveryRestorable] = useState(true)
  const [recoveryDate, setRecoveryDate] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<Awaited<ReturnType<typeof startDeviceLink>> | null>(null)
  const [historyTargetId, setHistoryTargetId] = useState<number | null>(null)
  const [linkedDevices, setLinkedDevices] = useState<Awaited<
    ReturnType<typeof listLinkedDevices>
  > | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null)
  const [verificationCode, setVerificationCode] = useState<string | null>(null)
  const approved = useRef(false)
  const cancelled = useRef(false)

  useEffect(
    () => () => {
      cancelled.current = true
    },
    [],
  )

  useEffect(() => {
    if (mode !== 'approve') return
    void listLinkedDevices()
      .then(setLinkedDevices)
      .catch(() => {})
  }, [mode])

  useEffect(() => {
    if (mode !== 'recover') return
    void recoveryStatus()
      .then((status) => {
        setRecoveryAvailable(status.available)
        setRecoveryDate(status.updatedAt)
        setRecoveryRestorable(status.restorable ?? true)
      })
      .catch(() =>
        setRecoveryStatusError(
          'Could not check backup availability. You can retry recovery with your saved key.',
        ),
      )
  }, [mode])

  useEffect(() => {
    if (!session || mode !== 'approve') return
    let stopped = false
    const poll = async () => {
      try {
        const status = await deviceLinkStatus(session.sessionId)
        if (stopped || approved.current) return
        if (status.status === 'connected' && status.newDeviceEphemeralPublicKey) {
          setVerificationCode(
            await linkVerificationCode(
              session.sessionId,
              session.ephemeralKeyPair.publicKey,
              status.newDeviceEphemeralPublicKey,
            ),
          )
          setMessage(
            `New ${status.platform ?? 'browser'} connected. Compare the six-digit code on both devices before approving.`,
          )
        }
      } catch (error) {
        if (!stopped) setMessage(String(error))
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 1000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [session, mode])

  const start = async () => {
    setBusy(true)
    try {
      const created = await startDeviceLink()
      approved.current = false
      setVerificationCode(null)
      setSession(created)
      setMessage('Enter this link code on the new browser within five minutes.')
    } catch (error) {
      setMessage(String(error))
    } finally {
      setBusy(false)
    }
  }

  const approve = async () => {
    if (!session) return
    setBusy(true)
    let provisioned = false
    try {
      const status = await deviceLinkStatus(session.sessionId)
      if (status.status !== 'connected' || !status.newDeviceEphemeralPublicKey)
        throw new Error('No new device is waiting for approval')
      const currentCode = await linkVerificationCode(
        session.sessionId,
        session.ephemeralKeyPair.publicKey,
        status.newDeviceEphemeralPublicKey,
      )
      if (currentCode !== verificationCode) throw new Error('Device verification code changed')
      approved.current = true
      setMessage('Sending encrypted keys to the new device…')
      await approveDeviceLink(
        session.sessionId,
        session.ephemeralKeyPair,
        status.newDeviceEphemeralPublicKey,
      )
      provisioned = true
      setHistoryTargetId(status.deviceId)
      setMessage('Waiting for the new device to publish its keys…')
      for (let attempt = 0; attempt < 60; attempt++) {
        const devices = await deviceLinkStatus(session.sessionId).catch(() => null)
        if (!devices) break
        if (devices.status === 'linked_pending_ack' || devices.status === 'completed') break
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      // Acknowledgment removes the temporary session, so use the assigned ID.
      const result = await copyHistoryToDevice(status.deviceId)
      setMessage(
        `Device linked. Copied ${result.copied} older messages.${result.unavailable ? ` ${result.unavailable} messages could not be recovered from this device.` : ''}`,
      )
      setSession(null)
      setHistoryTargetId(null)
      setLinkedDevices(await listLinkedDevices())
    } catch (error) {
      setMessage(String(error))
      if (!provisioned) approved.current = false
    } finally {
      setBusy(false)
    }
  }

  const retryHistory = async (targetId: number | null) => {
    if (targetId === null) return
    setBusy(true)
    try {
      const result = await copyHistoryToDevice(targetId)
      setMessage(`Encrypted history transfer completed. Copied ${result.copied} more messages.`)
      setHistoryTargetId(null)
      setSession(null)
      setLinkedDevices(await listLinkedDevices())
    } catch (error) {
      setMessage(String(error))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (deviceId: number) => {
    setBusy(true)
    try {
      await revokeLinkedDevice(deviceId)
      setLinkedDevices(await listLinkedDevices())
      setConfirmRevoke(null)
      setMessage('Device removed. It will no longer receive new encrypted messages.')
    } catch (error) {
      setMessage(String(error))
    } finally {
      setBusy(false)
    }
  }

  const recover = async () => {
    cancelled.current = false
    setBusy(true)
    setRecoverError(false)
    try {
      setMessage('Connecting to the approving device…')
      const connected = await connectDeviceLink(code)
      if (cancelled.current) return
      const comparisonCode = await linkVerificationCode(
        connected.sessionId,
        connected.primaryEphemeralPublicKey,
        connected.ephemeralKeyPair.publicKey,
      )
      setMessage(
        `Waiting for approval. Confirm that ${comparisonCode} appears on the other device.`,
      )
      const result = await finishDeviceLink(
        connected,
        (progress) => {
          if (!cancelled.current) setMessage(progress)
        },
        () => cancelled.current,
      )
      if (cancelled.current) return
      setMessage(
        result.unavailable
          ? `Device linked. ${result.unavailable} older messages were unavailable on the approving device.`
          : 'Device linked. Encrypted history is ready.',
      )
      onLinked?.()
    } catch (error) {
      if (cancelled.current) return
      setRecoverError(true)
      setMessage(error instanceof Error ? error.message : 'Could not link this device. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const recoverFromKey = async () => {
    setBusy(true)
    setRecoverError(false)
    setMessage('Restoring encrypted chats…')
    try {
      const me = await getFetcher<{ id: string }>('me')
      await restoreRecoveryBackup(me.id, recoveryKey)
      resetE2EContext()
      await getE2EContext()
      await ensureLinkedHistoryReady()
      onLinked?.()
    } catch (error) {
      setRecoverError(true)
      setMessage(error instanceof Error ? error.message : 'Could not restore encrypted chats')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'recover') {
    return (
      <ScrollView
        style={styles.recoverScreen}
        contentContainerStyle={styles.recoverContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.recoverCard}>
          <View style={styles.recoverIcon}>
            <MaterialIcons name="enhanced-encryption" size={28} color={theme.colors.primary} />
          </View>
          <Text style={styles.recoverTitle}>Recover encrypted chats</Text>
          <Text style={styles.recoverSubtitle}>
            Link this device to access your conversations securely.
          </Text>

          <View style={styles.recoverSteps}>
            <View style={styles.recoverStep}>
              <Text style={styles.stepNumber}>1</Text>
              <Text style={styles.stepText}>
                On your existing device, open Settings → Linked devices.
              </Text>
            </View>
            <View style={styles.recoverStep}>
              <Text style={styles.stepNumber}>2</Text>
              <Text style={styles.stepText}>Generate a link code and paste it below.</Text>
            </View>
            <View style={styles.recoverStep}>
              <Text style={styles.stepNumber}>3</Text>
              <Text style={styles.stepText}>
                Compare the verification codes, then approve the link.
              </Text>
            </View>
          </View>

          <Text style={styles.inputLabel}>Link code</Text>
          <TextInput
            accessibilityLabel="Link code"
            value={code}
            onChangeText={(value) => {
              setCode(value)
              setMessage('')
              setRecoverError(false)
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste link code"
            placeholderTextColor={theme.colors.textTertiary}
            style={styles.recoverInput}
          />
          {message ? (
            <View style={[styles.statusBox, recoverError && styles.statusError]}>
              <MaterialIcons
                name={recoverError ? 'error-outline' : 'info-outline'}
                size={19}
                color={recoverError ? theme.colors.error : theme.colors.primary}
              />
              <Text style={styles.statusText}>{message}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={[styles.recoverButton, (busy || !code.trim()) && styles.disabledButton]}
            disabled={busy || !code.trim()}
            onPress={() => void recover()}
          >
            <Text style={styles.recoverButtonText}>{busy ? 'Connecting…' : 'Connect device'}</Text>
          </Pressable>
          {
            <View style={styles.recoveryOption}>
              <Text style={styles.inputLabel}>No linked device available?</Text>
              <Text style={styles.stepText}>
                Use a recovery key saved before the original device was lost.
              </Text>
              {recoveryStatusError && <Text>{recoveryStatusError}</Text>}
              {!recoveryRestorable && (
                <Text>
                  This backup's linked device was revoked. Connect through another linked device to
                  recover access.
                </Text>
              )}
              {recoveryDate && (
                <Text>Saved snapshot: {new Date(recoveryDate).toLocaleString()}</Text>
              )}
              <Text>
                Only the saved snapshot is recoverable. Later messages may be lost. The original
                device loses access and future messages use new encryption sessions.
              </Text>
              <Text>
                Send each contact a new message to restart the conversation. Messages sent on an old
                session may be unreadable.
              </Text>
              {recoveryAvailable === false ? (
                <Text style={styles.stepText}>
                  No recovery backup exists for this account yet. An old device is required to
                  create one.
                </Text>
              ) : (
                <>
                  <TextInput
                    accessibilityLabel="Recovery key"
                    value={recoveryKey}
                    onChangeText={setRecoveryKey}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Paste recovery key"
                    placeholderTextColor={theme.colors.textTertiary}
                    style={styles.recoverInput}
                    secureTextEntry
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || !recoveryRestorable || !recoveryKey.trim()}
                    style={[
                      styles.secondaryButton,
                      (busy || !recoveryKey.trim()) && styles.disabledButton,
                    ]}
                    onPress={() => void recoverFromKey()}
                  >
                    <Text style={styles.secondaryButtonText}>Recover with key</Text>
                  </Pressable>
                </>
              )}
            </View>
          }
          <Pressable
            accessibilityRole="button"
            style={styles.cancelButton}
            onPress={() => {
              cancelled.current = true
              onCancel?.()
            }}
          >
            <Text style={styles.cancelText}>Cancel and return to login</Text>
          </Pressable>
        </View>
      </ScrollView>
    )
  }

  return (
    <View style={styles.container}>
      {mode === 'approve' ? (
        <>
          <Text style={styles.detail}>
            Open this account on the new browser, then enter the code shown here.
          </Text>
          <Button title="Generate link code" loading={busy} onPress={() => void start()} />
          {session && (
            <>
              <TextInput
                accessibilityLabel="Generated device link code"
                value={session.qrCodeUrl}
                editable={false}
                selectTextOnFocus
                style={styles.code}
              />
              {verificationCode && (
                <Text style={styles.verification}>Verification code: {verificationCode}</Text>
              )}
              <Button
                title="Approve connected device"
                disabled={busy || !verificationCode}
                onPress={() => void approve()}
              />
            </>
          )}
          {historyTargetId !== null && (
            <Button
              title="Retry encrypted history transfer"
              variant="outline"
              disabled={busy}
              onPress={() => void retryHistory(historyTargetId)}
            />
          )}
          {linkedDevices && (
            <>
              <Text style={styles.sectionTitle}>Your devices</Text>
              {linkedDevices.devices.map((device) => (
                <View key={device.deviceId} style={styles.deviceRow}>
                  <View style={styles.deviceHeading}>
                    <MaterialIcons
                      name={device.platform === 'web' ? 'laptop' : 'smartphone'}
                      size={22}
                      color={theme.colors.textSecondary}
                    />
                    <Text style={styles.deviceName}>
                      {device.platform} · device {device.deviceId}
                      {device.deviceId === linkedDevices.currentDeviceId ? ' (this device)' : ''}
                    </Text>
                  </View>
                  {!device.historyComplete && device.deviceId !== linkedDevices.currentDeviceId && (
                    <Button
                      title="Resume history transfer"
                      variant="outline"
                      disabled={busy}
                      onPress={() => void retryHistory(device.deviceId)}
                    />
                  )}
                  {device.deviceId !== linkedDevices.currentDeviceId &&
                    (confirmRevoke === device.deviceId ? (
                      <>
                        <Text style={styles.detail}>Remove this device from encrypted chats?</Text>
                        <Button
                          title="Remove device"
                          variant="outline"
                          textStyle={{ color: theme.colors.error }}
                          disabled={busy}
                          onPress={() => void revoke(device.deviceId)}
                        />
                        <Button
                          title="Cancel"
                          variant="outline"
                          onPress={() => setConfirmRevoke(null)}
                        />
                      </>
                    ) : (
                      <Button
                        title="Remove device"
                        variant="outline"
                        textStyle={{ color: theme.colors.error }}
                        onPress={() => setConfirmRevoke(device.deviceId)}
                      />
                    ))}
                </View>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <Text>
            On your existing device, open Settings → Linked devices and generate a link code.
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste link code"
            placeholderTextColor="#888"
            style={styles.code}
          />
          <Pressable
            style={styles.button}
            disabled={busy || !code.trim()}
            onPress={() => void recover()}
          >
            <Text>Connect and wait for approval</Text>
          </Pressable>
        </>
      )}
      {!!message && (
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {message}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  recoverScreen: { flex: 1, width: '100%' },
  recoverContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  recoverCard: {
    width: '100%',
    maxWidth: 480,
    padding: theme.spacing.lg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
    backgroundColor: theme.colors.surface,
    gap: theme.spacing.md,
  },
  recoverIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recoverTitle: { ...theme.typography.h1, fontWeight: '700' },
  recoverSubtitle: { color: theme.colors.textSecondary, lineHeight: 22 },
  recoverSteps: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.borderSecondary,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  recoverStep: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 22,
    backgroundColor: theme.colors.card,
    color: theme.colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  stepText: { flex: 1, color: theme.colors.textSecondary, lineHeight: 22, fontSize: 14 },
  inputLabel: { color: theme.colors.text, fontWeight: '600', marginBottom: -8 },
  recoverInput: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.md,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    borderRadius: 12,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
  },
  statusError: { borderWidth: 1, borderColor: theme.colors.error },
  statusText: { flex: 1, color: theme.colors.textSecondary, lineHeight: 20, fontSize: 14 },
  recoverButton: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recoverButtonText: { color: '#111', fontWeight: '700' },
  recoveryOption: {
    borderTopWidth: 1,
    borderColor: theme.colors.borderSecondary,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: theme.colors.text, fontWeight: '600' },
  disabledButton: { opacity: 0.5 },
  cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: theme.colors.textSecondary, fontWeight: '600' },
  container: { gap: 18, width: '100%' },
  detail: { fontSize: 14, lineHeight: 23, color: theme.colors.textSecondary },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  verification: {
    padding: 16,
    backgroundColor: theme.colors.card,
    borderRadius: 14,
    fontWeight: '600',
    color: theme.colors.primary,
    lineHeight: 24,
  },
  message: {
    padding: 16,
    backgroundColor: theme.colors.card,
    borderRadius: 14,
    fontSize: 14,
    lineHeight: 23,
  },
  deviceHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  deviceName: { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 22 },
  button: { backgroundColor: theme.colors.surface, padding: 12, borderRadius: 8 },
  deviceRow: {
    padding: 18,
    gap: 12,
    backgroundColor: theme.colors.backgroundSecondary,
    borderColor: theme.colors.borderSecondary,
    borderWidth: 1,
    borderRadius: 16,
  },
  code: {
    color: theme.colors.text,
    backgroundColor: theme.colors.backgroundSecondary,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    minHeight: 50,
    fontSize: 14,
  },
})
