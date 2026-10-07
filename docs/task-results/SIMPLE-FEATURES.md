# Simple features — implementation and verification

Implemented 7 October 2026 in `D:/meapp`, baseline
`cb80a55a48daa961f8e1cdb2059f419b0e51e52f`, preserving the earlier uncommitted
portable recovery work. User steering excludes bots and requests simple features.
The feature document is reference material; its coordinator/agent directions were
not treated as user instructions. No agents or deployment changes were used.

## Delivered

| Feature | Behavior and boundary |
| --- | --- |
| Portable recovery, REC-03/04/05 | Native SQLCipher adapter, common web/native coordinator, native encryption/compression, native backup/key/status/restore controls. Atomic SQL identity/history/binding/pending-claim import. Destination database key stays in its keychain. Browser version-1 conversion retained. |
| Password recovery, AUTH-01/02/03 | Verified recovery-email enrollment/change, generic reset requests, 15-minute single-use hashed proofs, bounded abuse limits, password completion, login and ticket revocation, socket eviction. Keys/backups retained. Settings and forgot-password screens wired. |
| Notification controls, OPT-01 | Synchronized push category preferences, per-chat mute, IANA-time-zone quiet hours including overnight/DST ranges. Queue checks preferences before dispatch. Muting retains messages/unread state. No digests. |
| Saved messages, OPT-02 | Private singleton self-conversation. Empty encrypted recipient list works for one device; linked devices require complete envelopes. Group invitations/member edits rejected. A device linked later needs recovery/provisioned history for older notes. |
| Search, OPT-03 first stage | In-memory filtering of loaded decrypted chat history; normalize Unicode, deduplicate pages, exclude unavailable ciphertext. Explicit load-older control. No persistent full-history index. |
| Shared files, OPT-04 first stage | File-name filtering and attachment opening from accessible decrypted history, normal download/decryption/access checks. No tags, folders or pinning. |
| Personal journal, OPT-10 | Account-scoped encrypted local entries, create/edit/delete, revision checks and cross-tab serialization. No synchronization or recovery backup; restoration clears local entries. UI states this explicitly. |

## Architecture

Shared Zod contracts remain in `packages/shared`. Password hashing is shared by
login, registration and reset. Account recovery accepts an injectable delivery
interface; Resend is implemented with fetch and defaults to disabled. No test
codes are exposed through production responses. Sessions carry an account auth
version; older versionless tokens map to zero for compatibility. Reset increments
that version and clears push registration. Message insertion rechecks the version
inside its transaction to reject a request already in flight. WebSocket tickets
carry the version; active sockets close immediately in this process and other
processes check the database version during their five-second lease refresh.

Recovery storage adapters expose one version-2 logical format pinned to Signal
SDK 6.0.0. Private caches remain encrypted at rest using existing browser private
metadata encryption / native SQLCipher. Search adds no plaintext persistence.
All message insertion still uses `insertMessageWithSequence`. Redis remains
optional. Added maintained dependencies: Expo Clipboard (SDK-55-compatible)
and fflate; `bun.lock` updated.

## Schema and local database

Generated a replacement initial SQL/snapshot/journal in `drizzle-current` using
Drizzle Kit. No incremental migration and no edits to `packages/db/drizzle/*`.
Added verification/auth-version fields, recovery proofs, notification preferences,
room mute and the saved conversation type. Rebuilt only
`D:/meapp/apps/server/data/data.db`. The original development data was preserved
with SQLite `VACUUM INTO` at:

`D:/meapp/apps/server/data/schema-reset-backups/password-recovery-1791403561382.db`.

Subsequent schema iterations also preserved the intermediate local database.
Temporary generation artifacts were moved outside the workspace. Tests use
isolated databases; no production database or another checkout was changed.

## Checks

- Server suite: 97 tests passed.
- Client suite: 98 tests passed.
- Shared suite: 8 tests passed. Combined total: 203 passed, zero failed.
- All four workspace type checks passed; lint passed (301 files).
- Production Expo web export passed, using an HTTPS placeholder API only for
  build validation. Recovery screen rendered in the actual in-app browser.
- Production Android Hermes bundle export passed. This is a bundle check, not
  an installed APK/device acceptance check.
- Live loopback WebSocket test verified immediate eviction after reset and
  rejection of a previously issued ticket.
- Focused account/saved/thread regression checks passed after adding the
  transaction-time auth-version check. Stale message insertion was rejected.
- REC-03 tests use actual Bun SQLite with the pinned native SDK SQL schema;
  rollback, identity conflict, competing import, exact claim and reopen behavior
  passed. REC-06 combines real IndexedDB/SQLite adapters and web/native wire
  codecs; native Expo AES is substituted with Web Crypto in that fixture.
  Existing browser recovery tests retain fresh bidirectional encrypted exchange.

## External acceptance and remaining roadmap

Email delivery remains disabled until a provider account, verified sender and
credentials are configured and live delivery is exercised. Configure
`RECOVERY_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `RECOVERY_EMAIL_FROM` in the
server environment; startup rejects incomplete enabled configuration.
Provider API reference: https://resend.com/docs/api-reference/emails/send-email.
The user has not selected a provider; the optional adapter creates no account
and sends no live emails during validation.

Physical Android SQLCipher/keychain/Expo AES, restore after app interruption,
and real device-to-device exchange remain pending. REC-06 is development
interoperability evidence, not native release acceptance.

Full persistent local search indexing, pinned/tagged files, polls, presence,
standalone encrypted file export/import, fetched link previews and abuse-report
delivery remain unimplemented. Reports need a real operator destination.
Boards, events, public directories and bots were excluded from this simple
feature pass. The full roadmap is not marked complete.
