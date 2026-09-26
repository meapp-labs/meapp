import { expect, test } from 'bun:test'

import { getGroupCandidates } from './groupCandidates'

test('offers friends and existing chat participants once, excluding the current user', () => {
  expect(
    getGroupCandidates(
      ['emil7'],
      [
        { participants: ['emil', 'emil2'] },
        { participants: ['emil', 'emil3'] },
        { participants: ['emil', 'emil7'] },
      ],
      'emil',
    ),
  ).toEqual([
    { username: 'emil7', isFriend: true },
    { username: 'emil2', isFriend: false },
    { username: 'emil3', isFriend: false },
  ])
})
