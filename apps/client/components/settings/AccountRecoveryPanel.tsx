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
    <View style={styles.container}>
      <Text style={styles.description}>
        A verified email can recover account access. Keep your separate recovery key to restore
        encrypted messages.
      </Text>
      <Text style={styles.status}>
        {status
          ? status.verified
            ? `Verified email: ${status.email}`
            : 'No verified recovery email'
          : 'Loading…'}
      </Text>
      {status && !status.enabled && (
        <Text style={styles.description}>Email delivery is not configured on this server.</Text>
      )}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Add a recovery email</Text>
        <Text style={styles.label}>Email address</Text>
        <TextInput
          accessibilityLabel="Recovery email"
          placeholder="Recovery email"
          placeholderTextColor={theme.colors.textTertiary}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />
        <Text style={styles.label}>Current password</Text>
        <TextInput
          accessibilityLabel="Current password"
          placeholder="Current password"
          placeholderTextColor={theme.colors.textTertiary}
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
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Verify your email</Text>
        <Text style={styles.description}>
          Paste the code from your verification email to finish setting up recovery.
        </Text>
        <Text style={styles.label}>Verification code</Text>
        <TextInput
          accessibilityLabel="Email verification code"
          placeholder="Code from the verification email"
          placeholderTextColor={theme.colors.textTertiary}
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
      </View>
      {!!message && (
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {message}
        </Text>
      )}
    </View>
  )
}
const styles = StyleSheet.create({
  container: { gap: 20 },
  description: { color: theme.colors.textSecondary, lineHeight: 23, fontSize: 14 },
  status: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    lineHeight: 22,
    fontSize: 14,
  },
  card: {
    gap: 12,
    padding: 18,
    borderRadius: 18,
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderSecondary,
  },
  sectionTitle: { fontWeight: '600', fontSize: 16, marginBottom: 4 },
  label: { fontSize: 13, color: theme.colors.textSecondary, fontWeight: '500' },
  input: {
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    minHeight: 50,
    fontSize: 15,
  },
})
