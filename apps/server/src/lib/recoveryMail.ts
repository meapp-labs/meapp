import type { RecoveryMailDelivery } from './accountRecovery'
import { env } from './config'

export const recoveryMail: RecoveryMailDelivery = {
  enabled: env.RECOVERY_EMAIL_PROVIDER === 'resend',
  async send({ email, token, purpose }) {
    if (!this.enabled) throw new Error('Recovery mail disabled')
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RECOVERY_EMAIL_FROM,
        to: [email],
        subject:
          purpose === 'enroll' ? 'Verify your MeApp recovery email' : 'Reset your MeApp password',
        text: `Open MeApp ${purpose === 'enroll' ? 'Settings > Emails & Password' : 'Forgot password > Enter recovery code'} and paste this code:\n\n${token}\n\nThis code expires in 15 minutes and can be used once. If you did not request it, ignore this email. Resetting your password does not restore encrypted chat history; keep your recovery key.`,
      }),
    })
    if (!response.ok) throw new Error('Recovery mail provider rejected delivery')
  },
}
