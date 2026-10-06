# Profiles and private aliases

Display names are server-readable and available to signed-in users through the profile
API. Registration initializes the display name to the username. User IDs remain the
identity used for message attribution and private contact metadata; usernames stay
visible alongside presentation names. The old `users.nickname` field is not a contact
alias and is not exposed by the profile API.

Open profile settings by selecting your avatar above the conversation list. Change your
display name or avatar there. Private aliases can be edited there or from a direct
conversation's menu. Blank aliases restore the contact's public display name.

## Avatars

Avatars require the existing complete R2 configuration from the server's `.env.example`.
With storage unconfigured, names and aliases still work; avatar writes return a safe
503 response. No new deployment settings are required.

The client accepts images up to 10 MiB and 4096 × 4096 pixels, then prepares a small
JPEG. The API independently accepts at most 64 KiB of decoded input, with a maximum
of 4096 pixels per dimension and 16,777,216 pixels total. It verifies static JPEG,
PNG, or WebP content by decoding it and re-encodes a 256 × 256 WebP without source
metadata. Upload JSON uses base64 only for transport; the database stores URLs and
lifecycle records, never image bytes.

Each successful upload receives a new random `avatars/<uuid>.webp` object key and
public URL. It is separate from message attachments. Pending or superseded objects
are cleaned after one hour by a periodic sweep; failed deletions retain their records
for retry. Removing an avatar clears the current profile reference. Public URLs and
cached copies are not private or revocable, even after origin cleanup.

## Alias synchronization

Aliases belong to the owner's contact relationship and never modify the contact's
user row. The server authenticates the owner, requires an existing contact, and
stores only ciphertext with a revision. Concurrent edits with stale revisions fail
with 409 instead of silently overwriting another device's edit.

The client derives a separate 256-bit alias key by SHA-256 hashing a domain-separated
encoding of the account ID and the secret account identity key. AES-GCM uses fresh
nonces. The encrypted versioned payload binds both account ID and contact ID, so
copying ciphertext to another contact fails validation. Linked devices provisioned
with the same account identity can decrypt the synchronized aliases. A device with
different or lost identity keys must recover/link that identity; aliases are not
automatically re-encrypted after identity replacement. The server still knows the
contact relationship and revision, and this does not conceal those metadata.

Alias plaintext stays in the account-scoped query cache and is cleared by logout.
Other-device profile and alias changes refresh through polling. Profile reads use
`Cache-Control: no-store`; public avatar objects use immutable versioned caching.

## Development database

This change updates the initial schema snapshot rather than adding an incremental
migration. Rebuild only the current checkout's local development database before
running the updated server. Never delete another checkout's or a production database.
