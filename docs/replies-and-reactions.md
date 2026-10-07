# Replies and reactions

The first message actions are Reply and React. Editing and delete-for-everyone are
not implemented by this change. They require their own durable content mutation
contract, deletion retention policy, cache/backup purging, and attachment cleanup.

## Replies

Replies create ordinary messages through `insertMessageWithSequence()`. The
original ID and sequence remain unchanged. `replyTo` is inside the authenticated
encrypted content and is also routing metadata validated against the sender's
addressed device and the target room. Receiving devices check the encrypted
reference against the stored reference. Retries retain the original ciphertext.
Private content caches, recovery metadata, and linked-device history preserve
the reference. Attachment upload jobs retain the reply reference across retries.

Quotes resolve only from content available locally in that conversation. A reply
never forwards original text, author labels, attachment keys, or media capabilities
to the current room membership. A new member sees an unavailable reference until
they receive legitimate original history. Tapping the reference loads earlier
pages and highlights the original message when it is available.

## Reactions

Reactions use a separate durable revision cursor and synchronization API:
`GET /api/reactions?conversationId&installId&after`. This is independent of message
sequences. `POST /api/reactions` includes a unique operation ID and the predecessor
revision for that message/author. One user has at most one active reaction on a
message; another emoji replaces it, and null removes it. Removal operations retain
ordering. The database transaction validates the predecessor before inserting.
Exact retries return the original revision. Changed payloads under the same ID and
stale linked-device operations return 409. Conflicts are never silently rebased.

Emoji and reaction authorship are server-visible interaction metadata, not E2E
content. Neither endpoint includes original message text or attachment data.
Access requires current room membership plus an envelope addressed to the reader's
device, or original authorship. Linking a device transfers legitimate original
history before that recipient device can read reactions. New members cannot read
or react to old messages without this access.

The client stores exact pending operations in private metadata before posting.
Network failures retry on reconnect, focus, or the 15-second fallback refresh.
Terminal 4xx responses discard the rejected operation. Sync pages fold by
message/author and revision, preserving null removals against older replays.
WebSocket broadcasts contain only a room invalidation hint. Full state is rebuilt
from the durable operation log after a restart; live caches fetch incremental
pages. An addressed-envelope audience version resets the cursor after linked-device
history transfer, so newly available old targets are synchronized too. Reactions do not change message previews or unread sequences.

## Interface

Replies form one flat thread under an original message. `threadRootId` is
authenticated inside encrypted content and checked against routing metadata.
Quoting a reply changes `replyTo`, while keeping the same root. Nested threads
and cross-thread quotes are rejected. Every reply retains its ordinary durable
room sequence; opening a thread does not create another conversation.

The original message opens above a scrollable discussion, with a separate
composer at the bottom. Desktop uses a side panel; phones use a full-screen
window. Reply counts and unread badges open the discussion. Composer drafts
remain separate in memory for the room and each thread. Viewing the main room
does not mark hidden thread replies read. Root authors and existing participants
receive thread notifications; manual follow and mute controls are not included.

Thread access and recipient selection require original-message access as well as
current membership. New members cannot receive old discussions solely because
they joined the room. Linked devices receive legitimate history before access.
WebSocket events carry only a room invalidation hint for thread replies. The
client synchronizes the complete addressed room envelope stream, including
hidden thread replies, before decrypting independent views. Its private durable
cursor does not advance past an addressed envelope that failed to decrypt.
History transfers reset synchronization using an audience version. Retries use
the saved ciphertext and original operation identity, including after device
membership changes.

The dedicated discussion and composer follow the familiar patterns described in
[Slack's thread guidance](https://slack.com/intl/en-gb/help/articles/115000769927-Use-threads-to-organise-discussions-)
and [Teams' channel reply guidance](https://support.microsoft.com/en-gb/teams/teams-channels/send-or-reply-to-a-channel-message-in-microsoft-teams).

Swipe right at least 60 points to reply. A short horizontal gesture animates back
without sending anything; vertical scrolling remains owned by the message list.
Hold a message or use its actions button to open a scrollable full-message window.
The composer shows a cancelable reply strip. Reaction chips show counts and mark
your selection. Tap to toggle, or hold a chip to open the participant list. The
picker provides quick reactions, searchable named emoji, and a People tab.

The new tables are included in the regenerated initial schema snapshot. Rebuild
only this checkout's local development database; no incremental migration is
provided.
