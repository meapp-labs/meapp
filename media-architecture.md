# Media Architecture (images · GIFs · videos · audio · files)

**Status:** phase 1 implemented; local checks and live R2 web sending verified; Android device verification remains external
**Decisions:** Cloudflare R2 (free tier) · media always E2EE · capability-URL read path ·
client-side-only dedup · phased delivery
**Updated:** 2026-10-06 (phase 1 implementation review)

---

## Implementation handoff

Phase 1 supports images, retained GIFs, original video/audio files, and arbitrary
file extensions, up to four per encrypted message. The limit is 100 MB encrypted
per attachment (original plus any thumbnail), with a default per-user quota of
2 GB. Video streaming/transcoding and phases 2–3 remain planned. Media requires E2E messaging; existing
relay sessions cover recipients and the sender's other registered devices.
Avatars remain outside this protocol.

Implementation decisions that supersede the original design below:

- Shared upload, commit, descriptor, and decrypted-content contracts live in
  `packages/shared/src/schemas/media.ts`. Unknown descriptor extensions are
  ignored; unsupported explicit encryption schemes fail closed. Upload payloads
  reject plaintext metadata. Descriptor IDs and envelope IDs form the same unique set.
- File names, original MIME types, attachment kinds, and any dimensions are inside
  the encrypted descriptors only. Video/audio and general files preserve their
  original bytes; ordinary images retain WebP optimization. Unknown formats use
  the file-download path. General files are downloaded as octet-stream Blobs on
  web; HTML/SVG and other active formats are never embedded. Audio/video controls
  use browser-supported codecs, with download always available. Native uses the
  system share/save sheet. One paperclip opens an attachment menu: Gallery uses
  the image picker and Document accepts any file. Camera, Location, Contact, Poll,
  Event, and AI images are disabled placeholders marked Soon. Native clients need
  a rebuild for DocumentPicker and Sharing.
- SigV4 PUTs bind the object, exact Content-Length, octet-stream type,
  immutable Cache-Control, and `If-None-Match: *`. A lost PUT response retries
  safely; commit verifies each object's existence and byte count.
- Wire bytes use the [Expo AES combined format](https://docs.expo.dev/versions/v55.0.0/sdk/crypto/):
  12-byte IV, ciphertext, 16-byte GCM tag. Descriptor `iv` must match that prefix;
  `size` includes all 28 bytes of framing. Absent `enc` means this format.
- GC uses a durable `deleting` claim **before remote I/O**, with eligibility
  rechecked in its conditional UPDATE. Commit/send reject claimed objects with
  410. Failed deletes remain retryable; successful deletes become tombstones.
  Every signed variant key is deleted; phase 1 only permits those exact keys.
  Pending candidates wait beyond the latest PUT expiry plus a 10-minute grace;
  recent tombstones receive late-upload cleanup for 24 hours. Passes cannot overlap.
- Linkage, sequence insertion, and all recipient envelopes share one SQLite
  transaction. `linked_to` stores the message client ID. Exact duplicate sends
  return the original message. `messages.attachment_ids` persists the correlation
  set for history and WebSocket delivery.
- Account-scoped private metadata stores frozen upload jobs before network writes:
  keys, nonces, and exact encrypted bytes survive restart. Foreground retries and
  the next attachment-button press resume them. A 410 creates fresh message and
  attachment IDs, keys, nonces, and ciphertext. Persistent send receipts prevent
  re-encryption after a confirmed send whose response was lost locally.
- Upload bytes are excluded from encrypted recovery snapshots to preserve the
  recovery API's body budget. Message descriptors and Signal state retain their
  existing recovery behavior.
- Receivers verify GCM and SHA-512 before rendering. Web uses memory Blob URLs;
  native uses `Paths.cache/meapp-media`, excluded from OS backups, before local-file
  rendering. Both use a 100 MB LRU cache, clear on logout, and reject old-session
  download writes. Upload jobs also stop across logout/account switches; receiver
  downloads enforce the manifest byte limit while streaming. Concurrent downloads
  are coalesced; late thumbnails cannot overwrite originals. Native images include
  blurhash placeholders. GIF frame
  extraction is omitted when unreliable.
- Local dedup cannot reuse a linked descriptor in a second message. A future
  optimization may reuse prepared plaintext bytes, but every new send still
  requires a fresh intent and key.

### Operations and validation

Configure all five R2 variables in `apps/server/.env.local` for development or
the `MEAPP_R2_*` variables in the production compose environment. Partial settings
fail startup validation; absent settings disable media. Use Standard storage and
a public bucket domain. Bucket CORS must allow the actual app origins, methods
`PUT`, `GET`, `HEAD`, and headers `Content-Type`, `If-None-Match`, `Cache-Control`;
expose `Content-Length` if needed. Fetch derives Content-Length from the Blob.
See [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) and
[R2 conditional PUT support](https://developers.cloudflare.com/r2/api/s3/api/).
Never apply an age-based lifecycle rule to `cap/`. Origin deletion does not
immediately revoke ciphertext already cached by an edge or recipient.

Validation: all workspace type checks, Biome, 37 server tests, 22 client tests,
5 shared-contract tests, and production Expo web and Android bundle exports.
The production container builds and starts with a read-only filesystem as a
non-root user. Initial and repeat migrations, health checks, registration/login
with Redis offline, and disabled-media error responses pass. An invalid database
path stops startup before the server starts. Storage tests simulate R2;
live R2 credentials and browser upload/download CORS were checked, and the user
confirmed image sending works on web. Android picker/rendering remains unverified
without a device. Friend-list previews summarize decrypted media and distinguish
sent from received instead of mistaking media-only content for unavailable text.
Web users can drop up to four files of any extension onto the chat window;
empty, oversized, or excess files are rejected together. Dropped files use the
same encrypted preparation and retry queue as the picker. Rebuild native clients for the
new Expo modules. The development database was backed up under
`apps/server/data/schema-reset-backups/` and rebuilt from the updated initial
snapshot; no incremental migration was added.
Transfers allow ten minutes before timeout. The 100 MB plaintext cache still
evicts older files; it does not grow with the 2 GB server quota. Web private-job
base64 encoding uses bounded chunks for large uploads. Whole-file encryption and
frozen-job persistence require memory proportional to file size; this is not
chunked streaming. Actual native file picking/sharing remains unverified without
a device. Larger-than-10-MB acceptance and exact 100-MB boundaries are tested;
a full 100-MB device transfer has not been exercised.

**Dependency validation:** regenerated `bun.lock` includes the media modules and
passes `bun install --frozen-lockfile --ignore-scripts`, including the server-only
workspace layout used by the container. Shared-contract tests now run in the
standard root test command. The image build context excludes local credentials,
SQLite databases/backups, and development/build output.
The server explicitly requires a compatible TypeBox release, and the container
includes migrations at the location resolved by the bundled migration runner.

The remaining sections preserve the design rationale and pre-implementation
baseline. Where they differ, the implementation decisions above take precedence.

---

## 0. Protocol invariants (the migration-proof rules)

Once a message references a stored object, **both the reference and everything
around it are frozen forever** — the server cannot rewrite anything inside
Signal ciphertext, and old messages must be parseable by every client forever.
These rules exist so no v1 decision forecloses a v2 option:

1. **Versioned descriptor.** Everything media-related travels inside the
   ciphertext with `"v": 1`. Clients MUST ignore unknown fields; the server
   never parses it.
2. **Immutable storage key scheme.** Keys are server-assigned random
   **capability prefixes** (`cap/<128-bit>`) created at intent time and never
   moved. No plaintext hashes, no sender/room ids in keys.
3. **Plaintext half is bookkeeping only.** The server cannot query ciphertext,
   so the message envelope carries a plaintext `attachmentIds[]` — used only
   for bookkeeping: GC linkage, one-message enforcement (§2.6), and recipient
   tamper correlation. The **encrypted descriptor is
   authoritative for where bytes live**; server tampering with plaintext fields
   can at worst break bookkeeping (detectable DoS), never redirect a recipient
   to attacker bytes.
4. **No message may reference a missing object — by construction.** Ordering
   (intent → upload → commit → validated send) + state machine + conditional
   transitions, not timers — **and the link UPDATE shares one SQLite
   transaction with `insertMessageWithSequence()`**, so a crash can never leave
   a live message whose object is sweeper-eligible.
5. **Never auto-delete committed objects on a timer.** Offline outbox retries
   legitimately exceed any short TTL. `pending` expires by age; `committed`
   expires only when unreferenced (proved by state, set at send); `linked`
   never expires.
6. **One `clientId` per attachment, shared by intent → commit.** The message
   keeps its own `clientId` (existing idempotency) and references attachments
   via `attachmentIds[]`. All steps idempotent under their keys.

---

## 1. Current state

Media support is greenfield. Relevant facts about the existing system:

| Area | Fact | Source |
|---|---|---|
| Upload route | None — "There is no /uploads route" | `apps/server/src/plugins/rateLimit.test.ts:138` |
| Attachment schema | `attachmentSchema` exists but is dead code (type re-export only) | `packages/shared/src/schemas/message.ts:34` |
| UI | `Attachment.tsx` modal is placeholder with dummy options | `apps/client/components/chat/Attachment.tsx` |
| Message contract | `text XOR ciphertext` refine; `createMessageSchema` requires `text.min(1)` — attachment-only messages impossible | `packages/shared/src/schemas/message.ts` |
| Idempotency | `sendMessageSchema.clientId` is **optional** — must become mandatory for media sends | `packages/shared/src/schemas/message.ts` |
| Body caps | 100 KB global, 700 KB E2E-batch, socket `maxRequestBodySize: 700KB` | `plugins/rateLimit.ts:192`, `src/index.ts` |
| E2EE | Signal relay, `ciphertext` max 12 KB, per-recipient envelopes | `packages/shared/src/schemas/e2e.ts` |
| Infra | Read-only server container, single SQLite data volume, Caddy proxy, Redis optional, no ffmpeg in image | `compose.prod.yaml`, `Containerfile` |
| Message writes | Single writer: `insertMessageWithSequence()` | `packages/db/src/sequence.ts` |

**Implication:** media bytes must never pass through Elysia's JSON pipeline.
Only small JSON intent/commit/send calls cross the API; bytes go client → R2
directly. The 100 KB / 700 KB caps stay untouched (no carve-outs needed).

---

## 2. Decisions

### 2.1 Storage: Cloudflare R2 (free tier), capability-read bucket

Verified free-tier limits (2026):

| Metric | Free | Paid |
|---|---|---|
| Storage | **10 GB-month** | $0.015 / GB-month |
| Class A ops (writes) | **1 M / month** | $4.50 / M |
| Class B ops (reads) | **10 M / month** | $0.36 / M |
| Egress | **$0 always** | $0 always |

Why this fits a hobby/private app:

- **Zero egress** → serving media is never billed per byte.
- 10 000 images × ~150 KB ≈ **1.5 GB**; a heavy user sends ~30 MB/day →
  ~1 GB/month. Both far under free caps; per-user quota (§2.3) keeps it that way.
- 10 M reads/month ≈ 330 k image loads/day — beyond this app's scale.
- S3-compatible API → standard SigV4 presigned PUTs; portable to MinIO or paid
  R2 without changing the client contract.

**Bucket layout:**

```
cap/<128-bit-random>/orig.enc      encrypted original (≤2048 px WebP)
cap/<128-bit-random>/thumb.enc     encrypted static ≤160 px thumbnail
cap/<128-bit-random>/poster.enc    encrypted video poster frame (phase 2)
```

- **Key = capability.** 128 random bits, server-generated at intent time,
  embedded only in the encrypted descriptor. The server holds the key in its
  table by construction (it minted it) — the capability model means *reads
  bypass the server* (no read-pattern logging, no per-read RTT) and
  *third parties cannot enumerate* (2^128). Anyone who obtains a link through
  the ciphertext can read that object; revocation = delete object.
- **Bearer-token access — the full implications, stated.** Possession of the
  URL *is* the credential: no session, no origin/referrer check, no
  per-request auth (identical for presigned GETs — same class, shorter
  lifetime). Consequences accepted: URL leaked via logs, crash reports, or a
  screenshot ⇒ that one object is readable by whoever holds it; there is no
  “kick a reader out” short of deleting the object. Blast radius is bounded
  by construction — 128 random bits, one capability per attachment, never a
  directory or bucket handle — and the plaintext behind the URL is still
  AES-GCM ciphertext, so a leaked *download* link without the message key
  yields opaque bytes. The link + the message are separate compromises.
- **Storage class: Standard only — never Infrequent Access.** IA charges
  per-Class-B read (kills the free read path), enforces a 30-day minimum
  duration, and bills early-deletion fees — which is precisely what an
  application GC on 24 h / 7 d schedules does routinely. At ≤ 10 GB Standard
  is free anyway; tiering buys nothing here. Revisit only past the free tier,
  and only for objects GC would never touch.
- **Public-read via `r2.dev` or custom domain** (writes still require
  credentials). `Cache-Control: public, max-age=31536000, immutable` — keys
  never change, so cache forever; stable URLs → no client cache-key churn.
- **Dedup: client-side only.** Plaintext SHA-256 never leaves the device
  (server-side dedup would enable known-file membership tests against user
  uploads). Storage is irrelevant at 10 GB free — same file twice = two keys.
- **`thumb` is always a static frame**, even for GIF/video — an animated
  thumbnail costs nearly as much as the original and defeats variants.

### 2.2 Encryption: always E2EE (Signal-style encrypt-then-upload)

**Descriptor v1 — the frozen contract.** Travels inside the existing Signal
`ciphertext`; server never sees it:

```json
{
  "v": 1,
  "id": "<uuidv7 — same value as attachments.id / plaintext attachmentIds[]>",
  "kind": "image",
  "base": "cap/<128-bit>",
  "key": "<base64 AES-256-GCM attachment key>",
  "blurhash": "L6PZfSjE…",
  "fileName": "beach.webp",
  "width": 1080,
  "height": 720,
  "durationMs": null,
  "variants": [
    { "name": "thumb", "path": "thumb.enc", "iv": "<b64 12B>", "size": 2100,
      "digest": "<b64 SHA-512>", "mime": "image/webp" },
    { "name": "orig",  "path": "orig.enc",  "iv": "<b64 12B>", "size": 180000,
      "digest": "<b64 SHA-512>", "mime": "image/webp" }
  ]
}
```

Field-by-field rationale (every field is here for a migration reason):

- **`id`** — lets the encrypted half correlate with the plaintext
  `attachmentIds[]` half. Without it, recipients can't tell which descriptor
  belongs to which bookkeeping row (breaks replies, local dedup and tamper
  detection); with ignore-unknown-fields, old messages without it still parse.
- **`base`** — full capability prefix so recipients can construct
  `<public-origin>/<base>/<path>` themselves. Without it, relative `path`s are
  unresolvable; with it, the plaintext half never needs to carry a URL.
- **per-variant `digest`** (not one top-level) — each variant decrypts and
  verifies independently; a single digest cannot cover an array, and old
  messages can't be re-serialized to move it later.
- **per-variant explicit `iv`** — one attachment key across variants is safe
  only if nonce uniqueness is guaranteed by construction.
- **optional per-variant `enc` / `chunkSize` / `ivDerivation`** (absent ⇒
  `aes-256-gcm-whole`) — freezes the *decryptability contract*. Whole-object
  GCM permits no tag-verified partial recovery: a Range on the ciphertext is
  undecryptable-with-integrity until the full object is present. Chunked AEAD
  (fixed-size chunks, per-chunk IV derived from the base IV + chunk index,
  tag per chunk) enables range decryption and streaming proxies. Phase 1 omits
  the field (whole-object is the default); phase-2 video declares chunked.
  Additive under ignore-unknown-fields — **shipped descriptors never need
  rewriting**, which is the whole point of deciding it now.
- **`kind` + `durationMs` + `variants[]`** — GIF/video/thumbs/posters/AVIF are
  pure additive changes; old messages just carry fewer entries.
- **`v` + ignore-unknown-fields** — additive evolution without forking.
- **`digest` = SHA-512 of plaintext variant bytes** (post-compression,
  pre-encryption) → integrity check after decrypt.
- Size leakage: cipher size visible to storage (accepted; padding would be an
  additive field later). mime/width/filename/blurhash stay inside ciphertext.
- ≈ 600–900 B base64 total → comfortably inside `E2E_CIPHERTEXT_MAX = 12 KB`;
  several attachments per message fit.

**Field split: plaintext vs encrypted**

| Plaintext envelope (server-visible) | Encrypted descriptor (recipients-only) |
|---|---|
| `attachmentIds: uuid[]` — bookkeeping | `base` + `key` + digests + IVs |
| message `clientId`, `roomId`, sequence | blurhash, fileName, dims, duration, kind |
| *(no URLs, no sizes beyond R2 object size)* | variant sizes, mimes, paths |

**Divergence rule:** the descriptor is authoritative for bytes. If a
compromised server alters `attachmentIds`, recipients detect it via
`descriptor.id` mismatch (every plaintext id must resolve to a decrypted
descriptor id, and vice versa); it corrupts GC bookkeeping and can cause a
detectable failure (fetch fails digest/GCM verification) but **cannot redirect
recipients to attacker-controlled bytes** — locations and keys only exist
inside ciphertext.

**Attachment-only message shape** (shared-contract change): media messages use
the `ciphertext` field — even in rooms that normally carry plaintext text, the
descriptor never rides plaintext `text` (a plaintext descriptor would hand the
server the decryption key). `messageSchema`'s `text XOR ciphertext` refine
already allows this; `createMessageSchema.text.min(1)` needs an
attachment-aware variant.

**Crypto hygiene — frozen manifest.** Key, IVs, paths, and sizes are generated
once per attachment **at intent time** and persisted in the client outbox
alongside the ciphertext. Retries reuse them verbatim. GCM rules enforced by
construction:

- Never encrypt different plaintext under the same key+IV (nonce reuse).
- Re-picking the file → **new intent** (new `clientId`, new key), never a
  re-encrypt under an existing manifest.
- The manifest freezes before the first byte leaves the device.

### 2.3 Upload flow: intent → PUT → commit → send

```
pick media
  → client: resize (≤2048 px) + WebP recompress + strip EXIF
    (GIF: no transcode in phase 1 — size cap + frame-0 thumb only, §2.5)
  → client: local dedup (plaintext SHA-256 already uploaded? → reuse descriptor
             from local cache — server never involved)
  → client: generate manifest (key, IVs, sizes) — FROZEN — encrypt each variant
  │
  ▼
POST /api/media/intent              (JSON ≤100 KB — existing caps untouched)
  { clientId /*attachment*/, roomId, cipherTotal, variants: [{name, size}] }
  → auth + room membership + per-user media rate limit
  → size caps: cipherTotal ≤ ATTACHMENT_MAX (10 MB images/GIFs;
    100 MB video in phase 2) — else 413 distinct from quota errors
  → per-user quota: SUM(cipher_total) of non-expired attachments ≤ quota
  → INSERT attachments (state='pending', storage_key=cap/<random>)
    ON CONFLICT (sender_id, client_id) DO NOTHING   ← idempotent
  → presigned PUT per variant (expires 10 min)
  ← { attachmentId, uploads: [{name, url, headers}] }
  │
  ▼
client PUT ciphertext → R2 directly (server never sees bytes)
  │
  ▼
POST /api/media/:id/commit          (same attachment clientId; idempotent)
  → HEAD each object: exists ∧ size matches variant manifest
    (deliberately nothing more — see "verification division of labor" below)
  → UPDATE attachments SET state='committed'
      WHERE id=? AND state='pending'                ← conditional; 0 rows →
                                                      already committed (ok)
                                                      or swept (410, see
                                                      failure matrix below)
  ← ok
  │
  ▼
send message via existing path (WS/REST) with:
  - clientId (MANDATORY for media — message idempotency, existing UNIQUE)
  - attachmentIds: [attachmentId, …]   ← plaintext, one per attachment
  - ciphertext: Signal payload containing descriptor(s), one per attachment
  → server validates ALL attachmentIds:
      state IN ('committed','linked') ∧ sender owns ∧ room matches
      (a 'linked' row is acceptable only if linked_to = this message's clientId)
  → ATOMIC — one SQLite transaction (the same BEGIN IMMEDIATE as the sequence
    insert; extends insertMessageWithSequence() with an attachment step):
      UPDATE attachments SET state='linked', linked_at=now(), linked_to=?
        WHERE id IN (…) AND state='committed'
      insertMessageWithSequence()
  → WS broadcast existing envelope
  │
  ▼
receiver: Signal-decrypt message → descriptor + blurhash → paint placeholder
  (synchronous, zero requests) → fetch <origin>/<base>/<path> (ciphertext)
  → AES-GCM decrypt → verify per-variant SHA-512 → render
  → persist only to the backup-excluded local cache (§2.6) —
    expo-image renders the local file, never the capability URL
```

**Multi-attachment:** intent/commit are **per attachment** (independent
retries, one `clientId` each — this is what keeps
`UNIQUE(sender_id, client_id)` sound); one message send references the
collected `attachmentIds[]`. Send validation is all-or-nothing.

**Verification division of labor (commit checks, stated exactly).**

- **Transport integrity** → TLS on the direct client → R2 hop.
- **Commit-time** → existence + exact byte count per variant (catches
  truncation and wrong-object). **The ETag is observed but never required and
  never compared to anything**: S3/R2 ETags are MD5 for single-part PUTs,
  `md5-N-parts` composites for multipart, and opaque under some configs —
  nothing there is a SHA-256. No hash-based server verification exists **by
  design**: plaintext hashes never leave the device (§2.1), and the server
  verifying a ciphertext hash would add nothing recipients don't already
  check.
- **Content integrity** → the per-variant SHA-512 digests + GCM tags inside
  the descriptor, verified by every recipient after download. Corruption that
  slips past byte-count (bit rot, bad proxy) surfaces as “media unavailable”,
  never as silently wrong pixels — recovery is a re-send (new intent).

**Plaintext-metadata rule — the privacy claim, stated exactly.** The server's
(total) view of an attachment is: *it exists, in this room, from this sender,
with this cipher size and variant structure*. Never outside the ciphertext:
mime, dimensions, blurhash, filename, duration, plaintext hash. Enforced by:

- intent/commit payloads carry only `{name, size}` per variant — no mime,
  no dims, no blurhash, no hash (v3's `mime` field removed);
- presigned PUTs are signed for a fixed `Content-Type:
  application/octet-stream` with no `Content-Disposition` — storage-side logs
  and object metadata don't learn the type or filename either;
- cipher *size* leakage remains (unavoidable without padding; padding is
  reserved as an additive descriptor field if it ever matters).

**State machine** (`attachments.state`):

```
pending ──commit──▶ committed ──validated send──▶ linked
   │                     │
   └──24 h sweeper──▶    └──7 d AND state='committed' (never sent)──▶ expired
   (missing/never                    (row kept as tombstone: re-attempts
    completed)                        get 410, not resurrection)
```

- **Linkage proof = the state itself**, set by send-time validation. No join
  against `messages` needed (and none possible for multi-attachment anyway).
- **Link UPDATE + `insertMessageWithSequence()` execute in ONE SQLite
  transaction** (extend `sequence.ts`'s existing BEGIN IMMEDIATE with an
  optional attachment step — packages/db change). SQLite atomicity is what
  makes the state-only sweeper sound: a crash leaves either *message + linked*
  or *nothing* — never a live message whose object sits at `committed` and is
  7-day eligible, and never a `linked` row without its message.
- **All transitions are conditional UPDATEs** (`WHERE id=? AND state=?`) —
  sweeper racing commit/send loses or wins atomically; the loser observes
  0 rows and follows the defined path (commit → idempotent-ok; send → 410).
- **`linked` → never auto-deleted.** Future message deletion must explicitly
  unreferenced-mark first.
- **Application GC — fully specified (chosen over prefix-staging):**
  - In-process interval on the single server (same pattern as
    `startPubsub`) + one pass at start-up — no new infra, no Redis.
  - **Deletion is prefix-based**: for each expirable row, delete *everything*
    under `<storage_key>/` — i.e. the whole `cap/<128-bit>/` prefix (`storage_key`
    already includes `cap/`; no double-prefixing) — which also covers partial
    variant uploads where the client died mid-PUT; 404 tolerated (already
    gone = ok).
  - **Order: object first, state second.** `state='expired'` is written only
    after the prefix delete succeeds. Crash between the two → row still
    `pending`/`committed` → next tick retries → delete is 404-tolerant →
    converges. The reverse order would strand bytes no future tick ever
    looks at.
  - Deletion failures (R2 error / rate limit) → row stays expirable, retried
    next tick; the tombstone appears only after the bytes are provably gone.
  - **App-down window is safe, not a hole**: while the sweeper isn't running,
    expired candidates accumulate — by construction they are unreferenced
    (no message exists), so nothing can dangle; quota + rate limits bound the
    accumulation, and start-up pass clears it on recovery.
  - **R2-native lifecycle rules are never applied to `cap/`** — R2 cannot see
    SQLite state, so a rule on the final prefix would eventually delete live
    objects. A `tmp/` staging prefix (PUT → promote on commit) with an R2
    lifecycle floor remains a phase-3 backstop option, not the primary.
    Application GC is primary because the DB is the only referential
    authority.

**Failure/retry matrix:**

| Failure | Recovery |
|---|---|
| intent, upload never happens | 24 h sweeper expires `pending` |
| upload ok, commit times out | retry commit, same `clientId` → conditional UPDATE → idempotent-ok |
| intent retries against an existing row | conflict returns the existing row: `pending` → re-sign PUT URLs (the 10-min ones may have lapsed); `committed`/`linked` → idempotent success; `expired` → **410 → client generates a new `clientId` + fresh manifest, re-uploads** |
| commit ok, send fails / client offline | outbox retries send later; `committed` grace is state-based, not a race with any timer |
| **send finds attachment expired (410)** | client restarts pipeline: new intent, new manifest, re-encrypt, re-upload, re-send (descriptor was never transmitted, so re-encryption is safe) |
| duplicate send (ack lost) | message `(user_id, client_id)` UNIQUE returns the original; validation accepts `state IN ('committed','linked')` when `linked_to` = this `clientId` → not a 409; link UPDATE is a no-op (`WHERE state='committed'`) |
| send references `pending`/missing attachment | 409 — client must commit first; ordering enforced server-side |
| send reusing another message's `attachmentIds` | 409 — `linked_to` points at a different message `clientId`; forward requires a new intent (§2.6) |
| WS broadcast lost | existing sequence-cursor catch-up (unchanged) |

### 2.4 Video (phase 2) — same skeleton, chunked

- R2 **S3 multipart upload** → presigned part URLs (5 MB), resumable; no tus.
- Encryption: per-part subkeys `HKDF(attKey, partIndex)` — decided in v1's
  scheme so chunking needs no descriptor change; per-variant `size` already
  supports part planning.
- Delivery — **E2EE reality check: no player can consume the capability URL**
  (it serves ciphertext), so “progressive + Range” needs restating:
  1. **Phase 2 default: download → decrypt → play.** Fetch the whole
     ciphertext (ranged GETs are fine for *progress UI*, not for plaintext),
     decrypt into the backup-excluded cache (§2.6), play the local file.
     Correct for ≤60 s clips; faststart is irrelevant on this path.
  2. **Phase 3 option: in-app loopback proxy** serving plaintext ranges to
     `expo-video` while fetching ciphertext ranges from R2 — only possible
     with the chunked `enc` scheme (§2.2).
  - **HTTP Range against R2/Caddy applies to ciphertext only** — never plan
     playback on it. Either way: not HLS (ABR complexity earns nothing for
     ≤60 s clips).
- Poster frame = normal image variant; `expo-video` shows it until explicit
  play (`preload: none`) so feeds never pull video bytes unprompted.

### 2.5 GIFs — phase 1 retains GIF; conversion is a client-encoder problem

- **Phase 1: upload the GIF as-is** (post size cap). Animated GIF → animated
  WebP needs a real multi-frame encoder: `expo-image-manipulator` is
  single-frame, neither OS encodes animated WebP, and ffmpeg-kit was retired
  (Jan 2025) — “just convert it” is not a phase-1 item.
- **Server-side transcode is structurally impossible under E2EE** — at rest,
  bytes are ciphertext; any “real animated transcoder” must live client-side
  (native libwebp/wasm encoder — a phase-3 dependency decision) or not happen.
- GIF variants: `orig` + static first-frame `thumb` (frame 0 via the platform
  loader); omit the thumb when frame extraction isn't reliable — v1's
  `variants[]` already tolerates fewer entries (§2.1: thumb never animated).
- `kind: "gif"` reserved in v1. Phase 3 options: client-side animated-WebP
  encoder, or GIF → muted autoplay MP4 (~10×) if ffmpeg re-enters the stack
  (Containerfile/deploy change).

### 2.6 Delivery & rendering efficiency

| Layer | Approach |
|---|---|
| URL | `base` inside descriptor → stable capability URL, never expires → disk cache valid forever |
| Cache | Cloudflare edge for ciphertext (`immutable`); plaintext only in the backup-excluded local cache (§2.6); thumb/orig variants |
| Placeholder | Blurhash decoded synchronously from decrypted payload — zero extra requests |
| List | Lazy load on visibility; `expo-image` recycling + crossfade |
| Formats | WebP baseline (both platforms); AVIF later for web only |
| Server role | Zero bytes on the read path; only intent/commit/send JSON |

**Local cache layer — part of E2EE, not an implementation detail.** The
capability URL serves ciphertext; rendering needs plaintext. Where decrypted
bytes live is protocol-relevant because, like EXIF, *nothing can ever be
scrubbed or audited after the fact*:

- **Memory-first**: decrypt → decode → render; first paint touches no disk.
- **Disk cache (the encrypted cache layer)**: persisted only to a dedicated
  cache directory that is OS-sandboxed, **excluded from OS cloud backups**
  (iOS `isExcludedFromBackup`, Android cache rules — otherwise decrypted
  media silently leaves the device via iCloud/Android Auto Backup, defeating
  E2EE in the one place it matters most), at-rest-encrypted by the OS (iOS
  data protection / Android FBE), LRU-capped (~100 MB), cleared on logout.
- **`expo-image` never sees the capability URL.** Its network loader can't
  decrypt — pointing it at the URL only caches useless ciphertext, and
  rendering via plaintext data-URIs would spill decoded bytes into shared
  cache paths. Flow: own downloader → decrypt → memory or cache file →
  `expo-image` handles blurhash placeholder + local `file://` results only.
- **No keys in the cache dir.** Attachment keys exist only inside Signal
  message ciphertext; a stolen cache yields what the unlocked screen already
  showed — the bar is backup exclusion + OS at-rest encryption in phase 1.
- **Phase 3 hardening**: app-level AES-GCM on cache files with a device key
  from `expo-secure-store` (new dependency) for platforms where OS-level
  at-rest encryption is weak or absent.

**Forwarding & replies (semantics fixed now):**

- Attachment is bound to **exactly one message**, enforced server-side via
  `linked_to` (the UNIQUE constraint alone does *not* block reuse — it keys
  the attachment's own `client_id`, not the message's). **Forward** = client
  downloads, re-compresses if desired, runs a **new intent** (new key, new
  `clientId`); re-linking an existing `linked` attachment is rejected 409 at
  send validation.
- **Reply** quotes the original message's `sequence`/`id` — no media operation.

### 2.7 Data model (requires `schema.ts` approval — not yet applied)

```sql
attachments (
  id            TEXT PRIMARY KEY,       -- uuidv7
  client_id     TEXT NOT NULL,          -- attachment-scoped idempotency: intent=commit
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id     TEXT NOT NULL REFERENCES users(id),
  storage_key   TEXT NOT NULL UNIQUE,   -- cap/<128-bit>, assigned at intent, immutable
  state         TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','committed','linked','expired')),
  cipher_total  INTEGER NOT NULL,       -- quota accounting + audit
  created_at    INTEGER NOT NULL,
  committed_at  INTEGER,
  linked_at     INTEGER,
  linked_to     TEXT,                   -- message.client_id recorded at link time:
                                      -- exact retry validation + server-enforced
                                      -- one-message-per-attachment (§2.6)
  UNIQUE (sender_id, client_id)         -- idempotent intent, per attachment
)
-- messages: no new columns. Link = attachments.state (set at send validation)
--           + plaintext attachmentIds[] on the envelope.
-- NOTE: no plaintext SHA-256 column — dedup never reaches the server.
-- NOTE: per-attachment client_id (not the message's) keeps multi-attach sound.
```

Per-user quota: `SUM(cipher_total) WHERE sender_id=? AND state<>'expired' ≤
MEDIA_USER_QUOTA_BYTES` (env, default 500 MB) — checked at intent. One query
now; meaningless to retrofit once rows exist in production.

Shared-contract changes (`packages/shared/src/schemas/`):

- `createMessageSchema` / `sendMessageSchema`: add optional
  `attachmentIds: uuid[]`; **require `clientId` whenever `attachmentIds` is
  present**; allow text-less messages when `attachmentIds` present.
- New `mediaIntentSchema` / `mediaCommitSchema` (per-attachment) — **size
  bounds live here**: per-variant and per-attachment maxima, enforced at the
  schema layer so a huge "image" can't sit under the total quota.
- `messageSchema` unchanged (descriptor rides inside existing `ciphertext`).
- Descriptor `id` (§2.2) MUST equal the `attachments.id` returned by intent —
  validated client-side on decrypt; server can't check it (can't see inside)
  but doesn't need to: it's the recipient's tamper-detector.

---

## 3. Why not the alternatives

| Alternative | Rejected because |
|---|---|
| Proxy bytes through Elysia | 700 KB cap, read-only container, server pays bandwidth; needs multipart dep |
| Blobs in SQLite | WAL + single-writer; bloats checkpoints and `VACUUM INTO` backups |
| MinIO self-hosted | Extra stateful service + backup story — overkill at hobby scale |
| Caddy `file_server` volume | No presigned writes, no lifecycle, separate backup story |
| Presigned-GET reads (private bucket) | Expiring URLs thrash disk caches; server mediates every read → logs patterns, extra RTT |
| Server-side dedup by plaintext hash | Leaks content equality; enables known-file membership tests |
| Plaintext-hash storage keys | Server can't verify them; leak cross-context equality via shared keys |
| Timer-only orphan GC | Offline retries exceed any short TTL → permanently dangling references |
| Link via `attachments.client_id ↔ messages.client_id` join | Breaks multi-attachment (one message clientId, N attachments); state-based linkage at send is simpler and race-safe |
| Single top-level `digest` in descriptor | Variants decrypt independently; frozen messages could never be moved to per-variant verification |
| HLS for video | ABR complexity earns nothing for ≤60 s chat clips |
| R2 lifecycle rules on `cap/` as primary GC | R2 can't see SQLite state → any age rule eventually deletes live objects; the DB is the only referential authority |
| Requiring ETag/checksum match at commit | ETag is MD5 or an `md5-N` composite, never SHA-256; server-side hash checks add false confidence — recipients' descriptor digests are the real integrity layer |
| R2 Infrequent Access tiering | Per-Class-B read fees kill the free read path; 30-day minimum + early-delete fees directly fight the 24 h/7 d GC. Standard is free at this scale |
| Planning playback on HTTP Range against the capability URL | The URL serves ciphertext; whole-object GCM can't tag-verify partial ranges — plaintext streaming needs decrypt-to-local (phase 2) or a chunked-`enc` loopback proxy (phase 3) |

---

## 4. Open questions (resolve before implementation)

1. **Plaintext rooms' key transport** — media descriptors always ride
   `ciphertext` (§2.2), so media needs a Signal session even in plaintext
   rooms. Confirm: media unavailable in non-E2E conversations until they get
   sessions, or media sends always open one?
2. **Non-room media** — `users.avatar_url` isn't room-scoped/per-message;
   needs a `profile-media` key prefix + descriptor variant, or the same state
   machine without a room.
3. **R2 credentials & config** — `R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /
   R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_URL` in
   `apps/server/.env.example` + zod validation in `config.ts`; CI secrets when
   implementation starts.
4. **Public-read exposure** — `r2.dev` subdomain vs custom domain (nicer URLs,
   one DNS step, same capability model).
5. **Sender multi-device history** — a newly linked device needs sender-side
   envelopes (or equivalent) to decrypt old media descriptors; confirm how
   `message_envelopes` treats the sender's other devices.
6. **Dependency approvals** at implementation time: `expo-image-picker`,
   `expo-image-manipulator`, (phase 2) `expo-video`, an S3 SigV4 presigner
   (~100-line Bun-native signer preferred over the AWS SDK).

---

## 5. Phasing

| Phase | Scope | Touches boundaries? |
|---|---|---|
| **0** | This doc | none |
| **1** | images + GIFs (GIF retained as-is — no conversion in phase 1): intent/commit/link routes, `attachments` table + sweeper, atomic link step in `sequence.ts`, client pick/compress/encrypt (frozen manifest), descriptor v1, blurhash rendering, backup-excluded encrypted cache, quota | `schema.ts` ✔ `sequence.ts` ✔ deps ✔ shared schemas ✔ |
| **2** | video: multipart upload, HKDF part keys, chunked `enc` descriptor field, download→decrypt→play pipeline, poster frames, `expo-video` | deps ✔ |
| **3** | optional: imgproxy variants, client-side animated-WebP encoder (GIF conversion), ffmpeg GIF→MP4, operation-count alerting, R2 lifecycle-rule floor on a `tmp/` staging prefix, app-level AES cache encryption, loopback range-decrypting video proxy | `compose.*` ✔ `deploy/` ✔ |

Nothing in phase 1 requires changes to `compose.*`, `Caddyfile`, or `deploy/` —
R2 is reached outbound over HTTPS; Caddy already proxies `/api/*`.
