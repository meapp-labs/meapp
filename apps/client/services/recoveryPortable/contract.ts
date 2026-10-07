import {
  PORTABLE_RECOVERY_FORMAT,
  PORTABLE_RECOVERY_SDK,
  PORTABLE_RECOVERY_VERSION,
  type PortablePendingClaim,
  type PortableRecoverySnapshot,
  portablePendingClaimSchema,
  portableRecoverySnapshotSchema,
} from '@meapp/shared'
import { PortableCodecError, parsePortableValue, stringifyPortableValue } from './codec'

export type { PortablePendingClaim, PortableRecoverySnapshot }

export type PortableRecoveryErrorCode =
  | 'INVALID_SNAPSHOT'
  | 'INCOMPATIBLE_FORMAT'
  | 'ACCOUNT_MISMATCH'
  | 'IDENTITY_CONFLICT'
  | 'CLAIM_CONFLICT'
  | 'STORAGE_UNAVAILABLE'

export class PortableRecoveryError extends Error {
  constructor(
    readonly code: PortableRecoveryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PortableRecoveryError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Only detection; legacy rows MUST be decoded by the pinned browser adapter. */
export function detectRecoveryFormat(value: unknown): 'portable-v2' | 'legacy-web-v1' {
  const data = object(value)
  if (data?.format === PORTABLE_RECOVERY_FORMAT && data.version === PORTABLE_RECOVERY_VERSION) {
    if (data.sdkVersion !== PORTABLE_RECOVERY_SDK)
      throw new PortableRecoveryError('INCOMPATIBLE_FORMAT', 'Unsupported recovery SDK version')
    return 'portable-v2'
  }
  if (data?.format === undefined && data?.version === 1 && object(data.stores)) {
    if (data.storeVersion !== undefined && data.storeVersion !== 6)
      throw new PortableRecoveryError(
        'INCOMPATIBLE_FORMAT',
        'Unsupported legacy browser store version',
      )
    return 'legacy-web-v1'
  }
  throw new PortableRecoveryError('INCOMPATIBLE_FORMAT', 'Unsupported recovery backup format')
}

/** Returns a validated copy. No destination writes may precede this validation. */
export function validatePortableSnapshot(
  value: unknown,
  accountId: string,
): PortableRecoverySnapshot {
  if (detectRecoveryFormat(value) !== 'portable-v2')
    throw new PortableRecoveryError(
      'INCOMPATIBLE_FORMAT',
      'Legacy backup requires browser conversion',
    )
  const parsed = portableRecoverySnapshotSchema.safeParse(value)
  if (!parsed.success)
    throw new PortableRecoveryError('INVALID_SNAPSHOT', 'Invalid portable recovery backup')
  if (parsed.data.accountId !== accountId)
    throw new PortableRecoveryError(
      'ACCOUNT_MISMATCH',
      'Recovery backup belongs to another account',
    )
  return parsed.data
}

export function serializePortableSnapshot(snapshot: PortableRecoverySnapshot): string {
  return stringifyPortableValue(validatePortableSnapshot(snapshot, snapshot.accountId))
}

export function parsePortableSnapshot(text: string, accountId: string): PortableRecoverySnapshot {
  try {
    return validatePortableSnapshot(parsePortableValue(text), accountId)
  } catch (error) {
    if (error instanceof PortableCodecError)
      throw new PortableRecoveryError('INVALID_SNAPSHOT', 'Invalid portable recovery backup')
    throw error
  }
}

export function claimForSnapshot(
  snapshot: PortableRecoverySnapshot,
  newInstallId: string,
): PortablePendingClaim {
  return portablePendingClaimSchema.parse({
    version: 1,
    accountId: snapshot.accountId,
    oldInstallId: snapshot.sourceInstallId,
    newInstallId,
    proof: snapshot.proof,
  })
}

/**
 * Implementations serialize operations per account and export from a consistent
 * read transaction. Imports validate the complete snapshot and claim first, then
 * recheck identity absence INSIDE the destination write transaction.
 *
 * Commit imported data, new install/account binding, and the exact pending claim
 * together. Roll back all writes on failure. Never resume sessions, prekeys,
 * sender chains, auth tokens, outbox/media retries, or source storage keys.
 *
 * Native keychain changes require a durable prepare/commit journal; initialization
 * must finish/reconcile it before encryption becomes available. Import must not
 * report success while that reconciliation is unresolved.
 */
export interface PortableRecoveryAdapter {
  exportSnapshot(context: {
    accountId: string
    installId: string
    deviceId: number
    proof: string
    createdAt: number
  }): Promise<PortableRecoverySnapshot>
  importSnapshot(snapshot: PortableRecoverySnapshot, claim: PortablePendingClaim): Promise<void>
  readPendingClaim(accountId: string): Promise<PortablePendingClaim | null>
  /** Compare-and-delete exact claim only after the server acknowledges it. */
  completePendingClaim(claim: PortablePendingClaim): Promise<void>
}

/** Shared preflight; adapters still recheck identity and journal state atomically. */
export function validatePortableImport(
  value: unknown,
  pending: unknown,
  accountId: string,
): { snapshot: PortableRecoverySnapshot; claim: PortablePendingClaim } {
  const snapshot = validatePortableSnapshot(value, accountId)
  const claim = portablePendingClaimSchema.safeParse(pending)
  if (
    !claim.success ||
    claim.data.accountId !== accountId ||
    claim.data.oldInstallId !== snapshot.sourceInstallId ||
    claim.data.proof !== snapshot.proof
  )
    throw new PortableRecoveryError('CLAIM_CONFLICT', 'Recovery claim does not match this backup')
  return { snapshot, claim: claim.data }
}
