import { z } from 'zod'

// Client plaintext format. The server continues to transport opaque ciphertext.
export const PORTABLE_RECOVERY_FORMAT = 'meapp-recovery'
export const PORTABLE_RECOVERY_VERSION = 2
export const PORTABLE_RECOVERY_SDK = '6.0.0'

const id = z.string().min(1).max(512)
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const key = z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/)
const keyPair = z.strictObject({ publicKey: key, privateKey: key })
const identityType = z.enum(['aci', 'pni'])
const compositeIdentity = z.strictObject({
  version: z.literal(1),
  x25519PublicKey: key,
  ed25519PublicKey: key,
})
const contact = z.strictObject({
  userId: id,
  identityType,
  record: z.strictObject({
    identity: compositeIdentity,
    trustState: z.enum(['UNVERIFIED_TOFU', 'VERIFIED']),
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    verifiedAt: timestamp.optional(),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    retiredIdentities: z.array(compositeIdentity).max(1000),
  }),
})

// Values are decrypted by the source adapter and re-encrypted by the destination.
// Do not carry the browser's private-metadata key or encrypted metadata strings.
export const portablePrivateMetadataKeySchema = z
  .string()
  .regex(/^meapp:e2e:(?:message-content:v1:|message:)[^\s]{1,512}$/)

export const portableRecoverySnapshotSchema = z
  .strictObject({
    format: z.literal(PORTABLE_RECOVERY_FORMAT),
    version: z.literal(PORTABLE_RECOVERY_VERSION),
    sdkVersion: z.literal(PORTABLE_RECOVERY_SDK),
    createdAt: timestamp,
    accountId: id,
    sourceInstallId: z.string().uuid(),
    sourceDeviceId: z.number().int().min(1).max(2_147_483_647),
    proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    identities: z
      .array(
        z.strictObject({
          identityType,
          keyPair: z.strictObject({
            dhKey: keyPair,
            signingKey: keyPair,
            registrationId: z.number().int().min(1).max(65535),
          }),
        }),
      )
      .min(1)
      .max(2),
    contacts: z.array(contact).max(100_000),
    receivedContent: z
      .array(
        z.strictObject({
          id,
          plaintext: z.string(),
          receivedAt: timestamp.min(1),
          groupId: id.optional(),
        }),
      )
      .max(100_000),
    privateMetadata: z
      .array(
        z.strictObject({
          key: portablePrivateMetadataKeySchema,
          value: z.string(),
        }),
      )
      .max(100_000),
  })
  .superRefine((snapshot, context) => {
    const unique = (values: string[], path: string) => {
      if (new Set(values).size !== values.length)
        context.addIssue({ code: 'custom', path: [path], message: 'Duplicate recovery record' })
    }
    unique(
      snapshot.identities.map((row) => row.identityType),
      'identities',
    )
    if (!snapshot.identities.some((row) => row.identityType === 'aci'))
      context.addIssue({
        code: 'custom',
        path: ['identities'],
        message: 'Account identity is required',
      })
    unique(
      snapshot.contacts.map((row) => JSON.stringify([row.identityType, row.userId])),
      'contacts',
    )
    unique(
      snapshot.receivedContent.map((row) => row.id),
      'receivedContent',
    )
    unique(
      snapshot.privateMetadata.map((row) => row.key),
      'privateMetadata',
    )
    for (const [index, { record }] of snapshot.contacts.entries()) {
      if (
        record.lastSeenAt < record.firstSeenAt ||
        (record.trustState === 'VERIFIED' && record.verifiedAt === undefined) ||
        (record.trustState === 'UNVERIFIED_TOFU' && record.verifiedAt !== undefined)
      )
        context.addIssue({
          code: 'custom',
          path: ['contacts', index],
          message: 'Invalid trust history',
        })
      const tuples = [record.identity, ...record.retiredIdentities].map((identity) =>
        JSON.stringify([identity.x25519PublicKey, identity.ed25519PublicKey]),
      )
      if (new Set(tuples).size !== tuples.length)
        context.addIssue({
          code: 'custom',
          path: ['contacts', index, 'record', 'retiredIdentities'],
          message: 'Current and retired identities must be distinct',
        })
    }
  })

export type PortableRecoverySnapshot = z.infer<typeof portableRecoverySnapshotSchema>

// Device-local journal, NEVER part of a snapshot. Persist with the imported data.
export const portablePendingClaimSchema = z
  .strictObject({
    version: z.literal(1),
    accountId: id,
    oldInstallId: z.string().uuid(),
    newInstallId: z.string().uuid(),
    proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .refine((claim) => claim.oldInstallId !== claim.newInstallId, {
    message: 'Recovery must transfer to a new install',
  })
export type PortablePendingClaim = z.infer<typeof portablePendingClaimSchema>
