import { expect, test } from 'bun:test'
import { portableRecoverySnapshotSchema } from '@meapp/shared'
import {
  createCompositeIdentityV1,
  createUnverifiedContactIdentityRecord,
  generateIdentityKeyPair,
  validateContactIdentityRecord,
} from '@open-e2ee/signal-protocol-sdk/keys'
import {
  PORTABLE_MAX_DEPTH,
  decodePortableValue,
  encodePortableValue,
  parsePortableValue,
  stringifyPortableValue,
} from './codec'
import {
  PortableRecoveryError,
  claimForSnapshot,
  detectRecoveryFormat,
  parsePortableSnapshot,
  serializePortableSnapshot,
  validatePortableImport,
  validatePortableSnapshot,
} from './contract'
import { rec01Snapshot } from './rec01.fixture'

test('real SDK identity and trust records survive the portable format', async () => {
  const snapshot = rec01Snapshot()
  const identity = await generateIdentityKeyPair()
  const peer = await generateIdentityKeyPair()
  snapshot.identities[0] = { identityType: 'aci', keyPair: identity }
  snapshot.contacts[0] = {
    userId: 'peer',
    identityType: 'aci',
    record: {
      ...createUnverifiedContactIdentityRecord(createCompositeIdentityV1(peer), 100),
      retiredIdentities: [],
    },
  }
  const restored = parsePortableSnapshot(serializePortableSnapshot(snapshot), snapshot.accountId)
  expect(restored).toEqual(snapshot)
  expect(() =>
    validateContactIdentityRecord(
      restored.contacts[0]?.record as unknown as Parameters<
        typeof validateContactIdentityRecord
      >[0],
    ),
  ).not.toThrow()
})

test('trust validation preserves SDK rollback and verification invariants', () => {
  const snapshot = rec01Snapshot()
  const contact = snapshot.contacts[0]
  if (!contact) throw new Error('Missing fixture contact')
  for (const change of [
    { revision: 0 },
    { firstSeenAt: 201 },
    { trustState: 'UNVERIFIED_TOFU' },
    { retiredIdentities: [contact.record.identity] },
    { identity: { ...contact.record.identity, x25519PublicKey: `${'A'.repeat(42)}B=` } },
  ])
    expect(
      portableRecoverySnapshotSchema.safeParse({
        ...snapshot,
        contacts: [{ ...contact, record: { ...contact.record, ...change } }],
      }).success,
    ).toBe(false)
})

test('logical snapshot survives serialization without physical store fields', () => {
  const snapshot = rec01Snapshot()
  expect(parsePortableSnapshot(serializePortableSnapshot(snapshot), snapshot.accountId)).toEqual(
    snapshot,
  )
  expect(detectRecoveryFormat(snapshot)).toBe('portable-v2')
})

test('codec preserves binary views, buffers, BigInt, maps, dates and undefined', () => {
  const value = {
    bytes: new Uint8Array([9, 1, 2, 8]).subarray(1, 3),
    buffer: new Uint8Array([3, 4]).buffer,
    integer: 9007199254740993n,
    map: new Map<unknown, unknown>([
      [1, undefined],
      ['one', new Uint8Array([5])],
    ]),
    date: new Date('2026-10-07T00:00:00.000Z'),
    missing: undefined,
    array: [undefined, 'bytes', ['$meappBytes', 'literal']],
    literal: { $meappBytes: 'literal', meappType: 'bigint', value: 'not-an-integer' },
  }
  expect(parsePortableValue(stringifyPortableValue(value))).toEqual(value)
})

test('codec safely preserves prototype-named properties', () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"constructor":"value"}')
  const result = decodePortableValue(encodePortableValue(source)) as Record<string, unknown>
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  expect(Object.hasOwn(result, '__proto__')).toBe(true)
  expect(result).toEqual(source)
  expect(Reflect.get({}, 'polluted')).toBeUndefined()
})

test('codec rejects malformed tuples, duplicate entries and noncanonical binary data', () => {
  for (const value of [
    ['unknown', []],
    ['bytes', 'AB=='],
    ['bytes', '!'],
    ['buffer', 'AAA'],
    ['bigint', '01'],
    ['bigint', '-0'],
    ['date', '2026-10-07'],
    ['undefined', null],
    [
      'object',
      [
        ['key', 1],
        ['key', 2],
      ],
    ],
    [
      'map',
      [
        [1, 'first'],
        [1, 'second'],
      ],
    ],
    ['object', [[1, 'value']]],
    ['array', {}],
    { unexpected: 'raw object' },
  ])
    expect(() => decodePortableValue(value)).toThrow()
  expect(() => parsePortableValue('{broken')).toThrow()
})

test('codec rejects cyclic, sparse, accessor and unsupported values', () => {
  const cycle: unknown[] = []
  cycle.push(cycle)
  const accessor = Object.defineProperty({}, 'secret', {
    enumerable: true,
    get: () => {
      throw new Error('getter executed')
    },
  })
  for (const value of [
    cycle,
    new Array(2),
    accessor,
    new Set(),
    new Uint16Array([1]),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -0,
    Symbol(),
    () => 1,
  ])
    expect(() => encodePortableValue(value)).toThrow()
})

test('codec enforces recursion limits on both untrusted decode and export', () => {
  let encoded: unknown = null
  let decoded: unknown = null
  for (let index = 0; index <= PORTABLE_MAX_DEPTH; index++) {
    encoded = ['array', [encoded]]
    decoded = [decoded]
  }
  expect(() => decodePortableValue(encoded)).toThrow('complexity')
  expect(() => encodePortableValue(decoded)).toThrow('complexity')
})

test('unsupported format and SDK versions stay distinct from invalid snapshots', () => {
  const snapshot = rec01Snapshot()
  for (const change of [{ version: 3 }, { sdkVersion: '7.0.0' }, { format: 'other' }]) {
    try {
      validatePortableSnapshot({ ...snapshot, ...change }, snapshot.accountId)
      throw new Error('Expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(PortableRecoveryError)
      expect((error as PortableRecoveryError).code).toBe('INCOMPATIBLE_FORMAT')
    }
  }
  expect(() => validatePortableSnapshot(snapshot, 'another-account')).toThrow('another account')
  expect(() =>
    validatePortableSnapshot({ ...snapshot, proof: 'invalid' }, snapshot.accountId),
  ).toThrow('Invalid portable')
})

test('legacy detection is pinned and never imports database rows as portable data', () => {
  for (const storeVersion of [undefined, 6]) {
    const legacy = {
      version: 1,
      stores: { identity: [] },
      ...(storeVersion === undefined ? {} : { storeVersion }),
    }
    expect(detectRecoveryFormat(legacy)).toBe('legacy-web-v1')
    expect(() => validatePortableSnapshot(legacy, 'account-one')).toThrow('browser conversion')
  }
  expect(() => detectRecoveryFormat({ version: 1, storeVersion: 7, stores: {} })).toThrow(
    'legacy browser',
  )
})

test('snapshots reject stale security state and unsupported private metadata', () => {
  const snapshot = rec01Snapshot()
  for (const key of ['sessions', 'prekeys', 'sesameUsers', 'senderKeys', 'outbox', 'databaseKey'])
    expect(portableRecoverySnapshotSchema.safeParse({ ...snapshot, [key]: [] }).success).toBe(false)
  for (const key of [
    'meapp:e2e:restore-pending',
    'meapp:e2e:outbox',
    'meapp:e2e:pending:x',
    'meapp:media:uploads:v1',
    'meapp:e2e:private-metadata-key',
  ])
    expect(
      portableRecoverySnapshotSchema.safeParse({
        ...snapshot,
        privateMetadata: [{ key, value: 'secret' }],
      }).success,
    ).toBe(false)
})

test('invalid identity, trust and duplicate logical keys are rejected before import', () => {
  const snapshot = rec01Snapshot()
  expect(portableRecoverySnapshotSchema.safeParse({ ...snapshot, identities: [] }).success).toBe(
    false,
  )
  for (const collection of [
    'identities',
    'contacts',
    'receivedContent',
    'privateMetadata',
  ] as const)
    expect(
      portableRecoverySnapshotSchema.safeParse({
        ...snapshot,
        [collection]: [...snapshot[collection], ...snapshot[collection]],
      }).success,
    ).toBe(false)
  const contact = snapshot.contacts[0]
  expect(contact).toBeDefined()
  expect(
    portableRecoverySnapshotSchema.safeParse({
      ...snapshot,
      contacts: [{ ...contact, record: { ...contact?.record, verifiedAt: undefined } }],
    }).success,
  ).toBe(false)
})

test('pending claims bind account, proof and both install IDs to the snapshot', () => {
  const snapshot = rec01Snapshot()
  const claim = claimForSnapshot(snapshot, 'cb29db52-fd66-49a5-ac72-4171d11fb185')
  expect(validatePortableImport(snapshot, claim, snapshot.accountId)).toEqual({ snapshot, claim })
  for (const change of [
    { accountId: 'other' },
    { proof: 'q'.repeat(43) },
    { oldInstallId: claim.newInstallId },
  ])
    expect(() =>
      validatePortableImport(snapshot, { ...claim, ...change }, snapshot.accountId),
    ).toThrow('does not match')
  expect(() => claimForSnapshot(snapshot, snapshot.sourceInstallId)).toThrow()
})
