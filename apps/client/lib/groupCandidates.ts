import type { Conversation } from '@meapp/shared'

export type GroupCandidate = { username: string; isFriend: boolean }

export function getGroupCandidates(
  friends: string[],
  conversations: Pick<Conversation, 'participants'>[],
  currentUsername: string,
): GroupCandidate[] {
  const byUsername = new Map<string, GroupCandidate>()
  for (const username of friends) {
    if (username && username !== currentUsername) {
      byUsername.set(username, { username, isFriend: true })
    }
  }
  for (const conversation of conversations) {
    for (const username of conversation.participants) {
      if (username && username !== currentUsername && !byUsername.has(username)) {
        byUsername.set(username, { username, isFriend: false })
      }
    }
  }
  return [...byUsername.values()].sort(
    (a, b) => Number(b.isFriend) - Number(a.isFriend) || a.username.localeCompare(b.username),
  )
}
