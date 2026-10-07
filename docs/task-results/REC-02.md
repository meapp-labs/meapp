# REC-02 — Browser portable recovery, with browser lifecycle integration

Implemented 7 October 2026, starting from commit
`cb80a55a48daa961f8e1cdb2059f419b0e51e52f` plus the uncommitted REC-01 foundation.
Preserved that work. No additional dependencies, schema/database rebuilds,
deployment changes or agents were required.

## Delivered behavior

Browser recovery controls now create version-2 portable encrypted backups.
Restoration accepts those backups and converts supported version-1 browser
backups in memory. The server's ciphertext envelope and chunk/commit/claim APIs
remain unchanged. The native service still reports its existing limitation.

The adapter translates SDK-6 storage into logical account identities, contact
trust/rollback history, received content and decrypted private cached history.
Import encrypts data with the destination database key and a fresh private
metadata key. Source database/private-metadata keys, sessions, prekeys, sender
chains, outbox, pending sends, upload bytes and resend state are excluded.

Account/install/device/proof binding is checked against the consistent source
read. The pinned SDK sometimes leaves its separate registration-ID metadata
cache absent. The identity key pair's registration ID remains authoritative;
contradictory metadata is rejected when present. Imports populate both.

## Architecture and public API

`BrowserRecoveryAdapter(accountId, initializedStore)` implements the REC-01 port:
`exportSnapshot`, `importSnapshot`, `readPendingClaim`, `completePendingClaim`.
The coordinator supplies account-scoped storage; the adapter does not initialize
another account or use transport APIs itself.

`convertLegacyBrowserSnapshot(authenticatedPayload, accountId, createdAt)` reads
the complete pinned legacy store set without opening/writing a destination. It
validates keys, duplicate rows, inline-key binding, account/install/device/proof
binding, encrypted history and contact revisions, and produces the strict logical
contract. Store versions other than 6 (or the documented omitted legacy version)
and unknown/missing stores are rejected.

Legacy metadata must use the existing encrypted private-metadata representation.
Unencrypted cached-history values are rejected; current application writes use
the encrypted representation. The legacy acceptance fixture was updated to use
that real application format rather than its former plaintext test shortcut.

`encryptPortableRecovery` and `decryptRecoverySnapshot` extend the existing
AES-GCM/account-bound/gzip codec without changing its legacy codec exports.
Portable serialization remains collision-free typed tuples. Decompression now
stops beyond the contract's plaintext-size limit instead of buffering an
unbounded decompressed response.

Browser lifecycle integration is complete for this branch: `recovery.web.ts`
exports portable snapshots for upload, dispatches restore by format, imports
through the adapter, resets/reopens the SDK store, resumes the exact persisted
claim, saves the supplied recovery key after server acknowledgment, and updates
the backup. This is a partial REC-04 implementation for browser only, not a claim
that native or combined recovery integration is complete.

The shared received-content timestamp was tightened to positive integers after
inspection showed the pinned SDK rejects zero. No other format revision was
introduced.

## Atomicity and retry

Export reads identity, trust and metadata in one IDB transaction before doing
asynchronous cryptography. Import precomputes ciphertext before opening its
transaction, then rechecks identity absence, account binding, pending recovery
and database-key stability inside a transaction covering every SDK store.
Clearing stale data, writing identity/history, setting account/device/new-install
binding and persisting the exact claim commit together. A late failure aborts all
changes. Competing connections cannot both import into an empty destination.

Claims persist across close/reopen. Completing a mismatched proof or install
cannot erase a pending claim. Existing E2E initialization remains blocked by the
same pending marker until ownership is acknowledged. The encrypted browser
regression proves new sessions communicate after peer sessions have advanced.

## Files

- Added `apps/client/services/recoveryPortable/browser.ts`.
- Added `rec02.test.ts`, isolated `rec02.fixture.ts` and real-browser
  `rec02.browser.fixture.ts` in that directory.
- Updated `apps/client/services/recovery.web.ts` and `recoveryCodec.ts`.
- Extended `apps/client/services/recoveryBrowser.fixture.ts` to retain explicit
  legacy coverage and add portable upload/restore/retry/fresh-exchange coverage.
- Tightened `packages/shared/src/schemas/recoveryPortable.ts` received timestamps.
- Added this report. REC-01 artifacts from the prior turn remain present.

## Evidence and limitations

Client suite: 92 passed. Shared suite: 7 passed (99 total).
All four workspace type checks and repository lint pass.
The isolated adapter fixture covers generated SDK identity/trust, received and
private history, new encryption keys, transient exclusions, exact journal
completion, reopen, late-write rollback, competing imports, legacy conversion,
account/version mismatch, duplicate rows and inline-key mismatch. Portable
transport tests cover round trip, fresh nonces, wrong keys, account replay and
ciphertext tampering. The lifecycle fixture exercises both legacy and portable
restore, interrupted claim/restart, stale sessions, fresh bidirectional SDK
exchange and failed-upload status.

Real browser evidence: the Codex in-app browser on this Windows host displayed
`PASS: real IndexedDB round trip; identity, trust and encrypted history; concurrent
connections; claim persistence and completion.` The harness used generated
disposable identities and two connections to the same IDB database. Its databases
were removed during cleanup. It ran at loopback port 18762; generated build/server
files live under ignored `.expo/rec02-browser`. This verifies actual browser IDB
and WebCrypto behavior, rather than only fake IndexedDB. Late-write fault
injection remains an automated fixture result, not a real-browser power-loss
claim. No real-device, native, production-origin, live server ownership or peak
memory acceptance claim is made.

New version-2 backups require the updated client. Older clients retain their
existing incompatibility behavior and cannot read new portable backups. The
supported older-client matrix remains ACCEPT-02 work. Snapshot age and old-session
history limits still apply; SDK group/profile state is excluded per REC-01.

## Next work

Implement REC-03 against native SQLCipher/keychain storage, with durable
initialization/reconciliation before enabling native encryption. Then integrate
that adapter into the recovery lifecycle and add REC-05 native controls. REC-06
physical web/native interoperability remains required for a native release claim.
