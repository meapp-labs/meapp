# REC-01 — Portable encrypted recovery foundation

Implemented 7 October 2026. Baseline commit: `cb80a55a48daa961f8e1cdb2059f419b0e51e52f`.
The working tree was clean before implementation; the master plan's statement
about existing uncommitted changes was out of date. No agents were delegated.

## Delivered scope

This is the portable format and adapter contract, not native recovery activation.
The existing browser recovery service, encryption, server transport and native
store remain on their existing implementation. No new backups are uploaded.

The architecture separates shared data validation, a platform-independent codec,
and an adapter port. Platform adapters will own physical storage translation;
the recovery coordinator will own encryption, transport and ownership claims.

Changed files:

- `packages/shared/src/schemas/recoveryPortable.ts`: strict Zod schemas and types.
- `packages/shared/src/schemas/index.ts`: exports the new shared contract.
- `apps/client/services/recoveryPortable/contract.ts`: format detection,
  validation, serialization, claim preflight and adapter port.
- `apps/client/services/recoveryPortable/codec.ts`: lossless typed-value codec.
- `apps/client/services/recoveryPortable/rec01.fixture.ts`: synthetic logical fixture.
- `apps/client/services/recoveryPortable/rec01.test.ts`: contract and SDK compatibility tests.
- This report.

The plaintext schemas live in `packages/shared`, following the repository's
single-contract rule rather than duplicating Zod definitions inside adapters.

## Fixed contract

Plaintext format: `format: "meapp-recovery"`, `version: 2`, `sdkVersion: "6.0.0"`.
This version is distinct from the server's existing version-1 ciphertext envelope.
Only the pinned SDK version is accepted; changing it requires explicit format
compatibility evidence or a converter. Unknown fields are rejected, not stripped.

Included logical data:

- Account ID, snapshot timestamp, source install UUID, source relay device ID and
  account ownership proof.
- Required ACI identity and optional PNI identity: canonical 32-byte base64 DH and
  signing key pairs, plus registration IDs.
- Per-user/per-identity-type contact trust, verification timestamps, revision,
  current public tuple and retired tuples for rollback detection. Contact records
  follow the pinned SDK's verification and retired-identity validation rules.
- SDK received-content history, including optional group IDs.
- Decrypted application cached history under `meapp:e2e:message-content:v1:*` and
  legacy `meapp:e2e:message:*`. Adapters must decrypt these values at export and
  encrypt with destination storage protection at import.

Explicit exclusions: sessions, SESAME device records, sender chains, skipped keys,
all prekeys, authentication tokens, browser database keys, SQLCipher keys,
private-metadata encryption keys, pending claims, receipts, outbox/pending sends,
media upload bytes, SDK resend records, security events, credential caches and
unrecognized metadata. SDK group/profile state is not part of this format.
Private aliases already derive their protection from the surviving account
identity and remain server-backed; they are not copied as local metadata.
Only backed-up cached history is promised. No old-session or post-snapshot history
guarantee is introduced.

All logical keys must be unique; ACI identity must exist; malformed keys, trust
state, timestamps and duplicate/current-retired identities are rejected.

## Public API

Shared exports: `portableRecoverySnapshotSchema`, `PortableRecoverySnapshot`,
`portablePendingClaimSchema`, `PortablePendingClaim`,
`portablePrivateMetadataKeySchema`, and `PORTABLE_RECOVERY_*` constants.

Client exports: `PortableRecoveryAdapter`, `PortableRecoveryError`,
`PortableRecoveryErrorCode`, `detectRecoveryFormat`, `validatePortableSnapshot`,
`serializePortableSnapshot`, `parsePortableSnapshot`, `claimForSnapshot`,
`validatePortableImport`; codec exports `encodePortableValue`,
`decodePortableValue`, `stringifyPortableValue`, `parsePortableValue`,
`PortableCodecError`, and limit constants.

Codec tuples distinguish data objects from type markers without reserved-name
collisions. Supported values: null, strings, booleans, finite numbers except
negative zero, undefined, BigInt, Uint8Array views, ArrayBuffer, Date, dense arrays,
plain data objects and Map. Unknown classes, other typed-array kinds, sparse
arrays, accessors, symbols, cycles and nonfinite numbers fail explicitly.
Objects are reconstructed without prototype mutation. Duplicate object/map
entries, malformed base64 and invalid type tuples fail. Object reference identity
is not retained; map keys containing objects remain values rather than shared
references. Snapshot schemas themselves contain only ordinary JSON-compatible
data. Maximum depth is 64, maximum visited nodes is 1,000,000, and serialized
UTF-8 plaintext is limited to 64,000,000 bytes. The existing 50,000,000-character
encoded ciphertext transport limit still applies independently after encryption.

## Adapter transaction and error behavior

`exportSnapshot(context)` must check account/install binding and pending recovery,
then read a consistent snapshot. Browser adapters should read all needed raw rows
in one read transaction before asynchronous decryption; cryptography must not
accidentally end a transaction before all rows have been read.

`importSnapshot(snapshot, claim)` calls shared preflight before writes and rechecks
existing identity inside the destination transaction. It refuses to overwrite any
existing identity. Data, account/device/new-install binding and the exact pending
claim commit together or all roll back. Source device ID survives ownership
transfer; destination install ID changes. Destination storage keys are fresh and
never imported. Encryption and backup stay blocked until the server accepts the
claim and local reconciliation completes.

`readPendingClaim(accountId)` returns the persisted exact claim across restart.
`completePendingClaim(claim)` compares every field before clearing it; stale
completion cannot erase another claim. Import is not an overwrite-based retry:
the coordinator resumes the persisted matching claim without importing again.

Native keychain and SQLCipher cannot be assumed to share a transaction. Any
required keychain/install update must use a durable prepare/commit journal and
startup reconciliation before encryption can initialize. A crash in that sequence
must leave a resumable pending claim, never an active partially imported identity.
No platform atomicity is claimed by these contract tests.

Error codes distinguish invalid snapshots, unsupported format/SDK, wrong account,
identity conflicts, claim conflicts and storage availability. Wrong recovery keys
remain the responsibility of authenticated decryption before these functions run.

## Legacy browser migration policy

`detectRecoveryFormat` recognizes version-1 raw browser snapshots only when they
have a stores object, no portable format marker, and store version 6 or an omitted
store version (the documented pinned legacy version). This is classification,
not acceptance or permission to import. Other versions fail as incompatible.

The existing browser service retains legacy restore behavior during this stage.
The future browser adapter must validate the complete expected SDK-6 store set,
all row keys and account/install/proof binding, decode the existing codec, recover
the embedded browser database key to decrypt logical records, and decrypt cached
private metadata with its source key. It then emits the strict version-2 logical
snapshot, discarding excluded state. Do not open an account's active store or
write destination state to perform conversion. Native must never interpret raw
IndexedDB rows as SQLCipher rows. Until a browser converter is implemented and
tested, native rejects legacy backups with an actionable browser-upgrade message.
This stage does not claim an implemented converter.

## Validation evidence

- Client suite: 89 tests passed, including 13 new portable tests and the existing
  encrypted browser recovery regression.
- Shared suite: 7 tests passed.
- All four workspace type checks: passed after correcting the new test's SDK
  readonly/branded-type bridge.
- Repository lint: passed.

The new tests include a real pinned-SDK generated identity/contact record, typed
binary/BigInt/Map round trips, prototype-property safety, invalid and incompatible
fixtures, depth limits, logical uniqueness, account mismatch, transient-state
exclusion and exact claim binding. Synthetic fixture keys are not real accounts.
No Android, native transaction, cross-platform restoration or live delivery result
is claimed. Size/node limits are implemented but their full boundary resource
measurements are not part of these tests.

## Next integration steps

REC-02: browser logical adapter and legacy conversion; actual IndexedDB export,
import rollback, identity-conflict and pending-claim tests.

REC-03: native SQLCipher adapter, destination key management and interruption-safe
initialization journal, with native/device evidence reported separately.

REC-04: wire accepted adapters into one recovery coordinator, encrypt/decrypt
version-2 plaintext using the existing account-bound transport, retain legacy web
restoration, and integrate fresh-session initialization and claim retry. Existing
`encryptSnapshot`/`decryptSnapshot` accept only the legacy plaintext shape and must
be extended deliberately during integration. No server API change is required by
this foundation. Follow with native controls and interoperability acceptance.
