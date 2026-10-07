import type { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { ACCOUNT_PROOF_TTL_MS } from '@meapp/shared'
import { ApiError, ErrorCode, createAuthError, createRateLimitError } from './errors'
import { makePasswordHash, verifyPassword } from './passwords'

export interface RecoveryMailDelivery {
  readonly enabled: boolean
  send(message: { email: string; token: string; purpose: 'enroll' | 'reset' }): Promise<void>
}
type User = {
  id: string
  username: string
  password_hash: string
  email: string | null
  email_verified_at: number | null
  auth_version: number
}
type Proof = {
  token_hash: string
  user_id: string
  purpose: 'enroll' | 'reset'
  email: string
  auth_version: number
  expires_at: number
}
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const accepted = {
  accepted: true as const,
  message: 'If the address is eligible, a recovery email will arrive shortly.',
}

export class AccountRecoveryService {
  private readonly limits = new Map<string, { count: number; expires: number }>()
  constructor(
    private readonly db: Database,
    private readonly delivery: RecoveryMailDelivery,
    private readonly revokeSockets: (userId: string) => void = () => {},
    private readonly now = Date.now,
  ) {}

  private limit(key: string, maximum: number): void {
    const now = this.now()
    for (const [name, bucket] of this.limits) if (bucket.expires <= now) this.limits.delete(name)
    const previous = this.limits.get(key)
    if ((previous?.count ?? 0) >= maximum || (!previous && this.limits.size >= 10_000))
      throw createRateLimitError('Too many recovery attempts. Try again later.')
    this.limits.set(key, {
      count: (previous?.count ?? 0) + 1,
      expires: previous?.expires ?? now + 60 * 60 * 1000,
    })
  }
  private available(): void {
    if (!this.delivery.enabled)
      throw new ApiError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Email recovery is not configured on this server',
        503,
      )
  }
  private user(userId: string): User {
    const user = this.db.query('SELECT * FROM users WHERE id = ?').get(userId) as User | null
    if (!user) throw createAuthError('Account unavailable')
    return user
  }
  status(userId: string) {
    const user = this.user(userId)
    return {
      enabled: this.delivery.enabled,
      email: user.email,
      verified: user.email_verified_at !== null,
    }
  }
  private issue(user: User, email: string, purpose: 'enroll' | 'reset'): void {
    const token = randomBytes(32).toString('base64url')
    const tokenHash = hashToken(token)
    this.db.transaction(() => {
      this.db
        .query(
          'DELETE FROM account_recovery_proofs WHERE expires_at <= ? OR (user_id = ? AND purpose = ?)',
        )
        .run(this.now(), user.id, purpose)
      this.db
        .query(
          'INSERT INTO account_recovery_proofs (token_hash, user_id, purpose, email, auth_version, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          tokenHash,
          user.id,
          purpose,
          email,
          user.auth_version,
          this.now() + ACCOUNT_PROOF_TTL_MS,
        )
    })()
    // Return uniformly without waiting for a provider's account-dependent latency.
    // Failed delivery invalidates the proof; never log or return the raw token.
    void this.delivery.send({ email, token, purpose }).catch(() => {
      this.db.query('DELETE FROM account_recovery_proofs WHERE token_hash = ?').run(tokenHash)
      console.warn('[Recovery] Email delivery failed')
    })
  }
  async enroll(userId: string, email: string, password: string, ip: string) {
    this.available()
    this.limit(`enroll:${ip}:${userId}`, 5)
    const user = this.user(userId)
    if (!(await verifyPassword(password, user.password_hash)))
      throw createAuthError('Current password is incorrect')
    const occupied = this.db
      .query('SELECT id FROM users WHERE email = ? AND id != ?')
      .get(email, userId)
    if (!occupied) this.issue(user, email, 'enroll')
    return accepted
  }
  requestReset(email: string, ip: string) {
    this.available()
    this.limit(`reset-ip:${ip}`, 20)
    this.limit(`reset-email:${hashToken(email)}`, 5)
    const user = this.db
      .query('SELECT * FROM users WHERE email = ? AND email_verified_at IS NOT NULL')
      .get(email) as User | null
    if (user) this.issue(user, email, 'reset')
    return accepted
  }
  private proof(token: string, purpose: 'enroll' | 'reset'): Proof {
    const row = this.db
      .query('SELECT * FROM account_recovery_proofs WHERE token_hash = ? AND purpose = ?')
      .get(hashToken(token), purpose) as Proof | null
    if (!row || row.expires_at <= this.now())
      throw createAuthError('Recovery proof is invalid or expired')
    const user = this.user(row.user_id)
    if (
      user.auth_version !== row.auth_version ||
      (purpose === 'reset' && (user.email !== row.email || user.email_verified_at === null))
    )
      throw createAuthError('Recovery proof is invalid or expired')
    return row
  }
  verifyEmail(token: string, ip: string) {
    this.limit(`verify:${ip}`, 30)
    this.db.transaction(() => {
      const row = this.proof(token, 'enroll')
      if (
        this.db
          .query('SELECT id FROM users WHERE email = ? AND id != ?')
          .get(row.email, row.user_id)
      )
        throw createAuthError('Recovery proof is invalid or expired')
      this.db
        .query('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?')
        .run(row.email, this.now(), row.user_id)
      this.db.query('DELETE FROM account_recovery_proofs WHERE user_id = ?').run(row.user_id)
    })()
    return { verified: true }
  }
  async resetPassword(token: string, password: string, ip: string) {
    this.limit(`complete:${ip}`, 30)
    const initial = this.proof(token, 'reset')
    const user = this.user(initial.user_id)
    if (password.includes(user.username))
      throw new ApiError(ErrorCode.VALIDATION_ERROR, 'Password cannot contain the username', 400)
    const passwordHash = await makePasswordHash(password)
    const userId = this.db.transaction(() => {
      // Recheck after password hashing: concurrent reset/verification must invalidate this proof.
      const row = this.proof(token, 'reset')
      this.db
        .query(
          'UPDATE users SET password_hash = ?, auth_version = auth_version + 1, push_token = NULL WHERE id = ?',
        )
        .run(passwordHash, row.user_id)
      this.db.query('DELETE FROM account_recovery_proofs WHERE user_id = ?').run(row.user_id)
      return row.user_id
    })()
    this.revokeSockets(userId)
    return { reset: true }
  }
}
