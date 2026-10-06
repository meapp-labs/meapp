# Group management

Rooms have a persistent `dm` or `group` type. A group remains a group when its
membership shrinks to two or one. Direct-message membership and names cannot be
changed through group APIs.

Admins can rename a group, add/remove members, promote admins, and issue or revoke
expiring invite tokens. Members can view members and leave. A sole admin leaving a
nonempty group must transfer the role to a current member. Membership changes and
their audit messages commit in the same message-sequence transaction. Permissions,
block checks, and capacity are rechecked inside that transaction. Group capacity
is 100 members.

Invites store only a SHA-256 token hash. Expiration and usage caps are checked
atomically when joining; retries by a current member do not consume another use.
An inviter must still be an admin. Leaving/removing an inviter revokes their tokens.
Blocked users cannot be directly added by, or accept invites from, the blocked
account. This applies to the acting admin/inviter, rather than every group member.

The conversation list offers create and join buttons. Group settings offer rename,
member management, token creation, and active-token revocation. Select a group
header or its menu to open settings. Leaving clears the selected conversation.

Room names, membership, roles, invite metadata, and membership audit text are
server-readable metadata. User message content continues through the existing
end-to-end encryption path. A removed member loses API access and live room socket
subscriptions; cached history and copies already received cannot be revoked.

Membership revocation is mirrored through Redis pub/sub with local eviction when
Redis is unavailable. Authentication and subscriptions recheck current membership
after awaiting subscription limits, preventing removal during a pending handshake
from granting stale access.
