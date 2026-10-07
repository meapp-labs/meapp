import { type PortableRecoverySnapshot, portableRecoverySnapshotSchema } from '@meapp/shared'

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

export function rec01Snapshot(): PortableRecoverySnapshot {
  return portableRecoverySnapshotSchema.parse({
    format: 'meapp-recovery',
    version: 2,
    sdkVersion: '6.0.0',
    createdAt: 1_800_000_000_000,
    accountId: 'account-one',
    sourceInstallId: '58e86b60-e39d-4d21-b9f2-109614c3dd39',
    sourceDeviceId: 1,
    proof: 'p'.repeat(43),
    identities: [
      {
        identityType: 'aci',
        keyPair: {
          dhKey: { publicKey: key, privateKey: key },
          signingKey: { publicKey: key, privateKey: key },
          registrationId: 42,
        },
      },
    ],
    contacts: [
      {
        userId: 'peer',
        identityType: 'aci',
        record: {
          identity: { version: 1, x25519PublicKey: key, ed25519PublicKey: key },
          trustState: 'VERIFIED',
          firstSeenAt: 100,
          lastSeenAt: 200,
          verifiedAt: 150,
          revision: 1,
          retiredIdentities: [],
        },
      },
    ],
    receivedContent: [{ id: 'received', plaintext: 'Encrypted history ✓', receivedAt: 200 }],
    privateMetadata: [{ key: 'meapp:e2e:message-content:v1:sent', value: '{"text":"hello"}' }],
  })
}
