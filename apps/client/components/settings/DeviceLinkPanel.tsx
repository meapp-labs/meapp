import { Text } from '@/components/common/Text'
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
import { theme } from '@/theme/theme'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'

export function DeviceLinkPanel({
  mode,
  onLinked,
}: { mode: 'approve' | 'recover'; onLinked?: () => void }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<Awaited<ReturnType<typeof startDeviceLink>> | null>(null)
  const [historyTargetId, setHistoryTargetId] = useState<number | null>(null)
  const [linkedDevices, setLinkedDevices] = useState<Awaited<
    ReturnType<typeof listLinkedDevices>
  > | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null)
  const [verificationCode, setVerificationCode] = useState<string | null>(null)
  const approved = useRef(false)

  useEffect(() => {
    if (mode !== 'approve') return
    void listLinkedDevices()
      .then(setLinkedDevices)
      .catch(() => {})
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
    setBusy(true)
    try {
      setMessage('Connecting to the approving device…')
      const connected = await connectDeviceLink(code)
      const comparisonCode = await linkVerificationCode(
        connected.sessionId,
        connected.primaryEphemeralPublicKey,
        connected.ephemeralKeyPair.publicKey,
      )
      setMessage(
        `Waiting for approval. Confirm that ${comparisonCode} appears on the other device.`,
      )
      const result = await finishDeviceLink(connected, setMessage)
      setMessage(
        result.unavailable
          ? `Device linked. ${result.unavailable} older messages were unavailable on the approving device.`
          : 'Device linked. Encrypted history is ready.',
      )
      onLinked?.()
    } catch (error) {
      setMessage(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {mode === 'approve' ? 'Link another browser' : 'Recover encrypted chats'}
      </Text>
      {mode === 'approve' ? (
        <>
          <Text>Open this account on the new browser, then enter the code shown here.</Text>
          <Pressable style={styles.button} disabled={busy} onPress={() => void start()}>
            <Text>Generate link code</Text>
          </Pressable>
          {session && (
            <>
              <TextInput
                value={session.qrCodeUrl}
                editable={false}
                selectTextOnFocus
                style={styles.code}
              />
              {verificationCode && <Text>Verification code: {verificationCode}</Text>}
              <Pressable
                style={styles.button}
                disabled={busy || !verificationCode}
                onPress={() => void approve()}
              >
                <Text>Approve connected device</Text>
              </Pressable>
            </>
          )}
          {historyTargetId !== null && (
            <Pressable
              style={styles.button}
              disabled={busy}
              onPress={() => void retryHistory(historyTargetId)}
            >
              <Text>Retry encrypted history transfer</Text>
            </Pressable>
          )}
          {linkedDevices && (
            <>
              <Text>Linked devices</Text>
              {linkedDevices.devices.map((device) => (
                <View key={device.deviceId} style={styles.deviceRow}>
                  <Text>
                    {device.platform} · device {device.deviceId}
                    {device.deviceId === linkedDevices.currentDeviceId ? ' (this device)' : ''}
                  </Text>
                  {!device.historyComplete && device.deviceId !== linkedDevices.currentDeviceId && (
                    <Pressable disabled={busy} onPress={() => void retryHistory(device.deviceId)}>
                      <Text>Resume encrypted history transfer</Text>
                    </Pressable>
                  )}
                  {device.deviceId !== linkedDevices.currentDeviceId &&
                    (confirmRevoke === device.deviceId ? (
                      <>
                        <Text>Remove this device from encrypted chats?</Text>
                        <Pressable
                          style={styles.button}
                          disabled={busy}
                          onPress={() => void revoke(device.deviceId)}
                        >
                          <Text>Remove device</Text>
                        </Pressable>
                        <Pressable onPress={() => setConfirmRevoke(null)}>
                          <Text>Cancel</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Pressable onPress={() => setConfirmRevoke(device.deviceId)}>
                        <Text>Remove</Text>
                      </Pressable>
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
      {!!message && <Text>{message}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, maxWidth: 560 },
  title: { ...theme.typography.h2 },
  button: { backgroundColor: theme.colors.surface, padding: 12, borderRadius: 8 },
  deviceRow: { padding: 12, gap: 8, borderBottomColor: theme.colors.surface, borderBottomWidth: 1 },
  code: {
    color: theme.colors.text,
    borderColor: theme.colors.secondary,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
  },
})
