import { Button } from '@/components/common/Button'
import { Text } from '@/components/common/Text'
import {
  enrollRecoveryEmail,
  getAccountRecoveryStatus,
  verifyRecoveryEmail,
} from '@/services/accountRecovery'
import { theme } from '@/theme/theme'
import type { AccountRecoveryStatus } from '@meapp/shared'
import { useEffect, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

export function AccountRecoveryPanel() {
  const [status, setStatus] = useState<AccountRecoveryStatus | null>(null)
  const [email, setEmail] = useState('')
  const [currentPassword, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    void getAccountRecoveryStatus()
      .then((value) => {
        if (live) setStatus(value)
      })
      .catch((error) => {
        if (live)
          setMessage(error instanceof Error ? error.message : 'Unable to load recovery settings')
      })
    return () => {
      live = false
    }
  }, [])
  const run = async (verify: boolean) => {
    setBusy(true)
    setMessage('')
    try {
      if (verify) {
        await verifyRecoveryEmail({ token: token.trim() })
        setToken('')
        setMessage('Recovery email verified.')
        setStatus(await getAccountRecoveryStatus())
      } else {
        const result = await enrollRecoveryEmail({ email, currentPassword })
        setPassword('')
        setMessage(result.message)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update recovery email')
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text>
        A verified email can recover account access. Keep your separate recovery key to restore
        encrypted messages.
      </Text>
      <Text>
        {status
          ? status.verified
            ? `Verified email: ${status.email}`
            : 'No verified recovery email'
          : 'Loading…'}
      </Text>
      {status && !status.enabled && <Text>Email delivery is not configured on this server.</Text>}
      <TextInput
        accessibilityLabel="Recovery email"
        placeholder="Recovery email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="Current password"
        placeholder="Current password"
        secureTextEntry
        value={currentPassword}
        onChangeText={setPassword}
        style={styles.input}
      />
      <Button
        title="Send verification code"
        disabled={!status?.enabled || busy}
        loading={busy}
        onPress={() => {
          void run(false)
        }}
      />
      <TextInput
        accessibilityLabel="Email verification code"
        placeholder="Code from the verification email"
        autoCapitalize="none"
        autoCorrect={false}
        value={token}
        onChangeText={setToken}
        style={styles.input}
      />
      <Button
        title="Verify email"
        disabled={busy || !token}
        onPress={() => {
          void run(true)
        }}
      />
      {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
    </View>
  )
}
const styles = StyleSheet.create({
  input: {
    color: theme.colors.text,
    borderColor: theme.colors.secondary,
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
  },
})
