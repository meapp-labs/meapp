import type { Database } from 'bun:sqlite'

export function roomRepository(sqlite: Database) {
  return {
    findDm(firstId: string, secondId: string) {
      return sqlite
        .query(`SELECT r.id,r.name,r.created_at AS createdAt FROM rooms r
        JOIN room_members rm ON rm.room_id=r.id WHERE r.type='dm' AND rm.user_id IN (?,?)
        GROUP BY r.id HAVING COUNT(DISTINCT rm.user_id)=2 AND COUNT(*)=2
        AND (SELECT COUNT(*) FROM room_members all_members WHERE all_members.room_id=r.id)=2
        LIMIT 1`)
        .get(firstId, secondId) as { id: string; name: string; createdAt: number } | null
    },
    areFriends(firstId: string, secondId: string): boolean {
      return Boolean(
        sqlite
          .query('SELECT 1 FROM contacts WHERE user_id=? AND contact_user_id=?')
          .get(firstId, secondId),
      )
    },
    insertRoom(
      id: string,
      name: string,
      type: 'dm' | 'group',
      creatorId: string,
      createdAt: number,
    ) {
      sqlite
        .query('INSERT INTO rooms (id,name,type,created_by,created_at) VALUES (?,?,?,?,?)')
        .run(id, name, type, creatorId, createdAt)
    },
    insertMember(roomId: string, userId: string, role: 'admin' | 'member', joinedAt: number) {
      sqlite
        .query('INSERT INTO room_members (room_id,user_id,role,joined_at) VALUES (?,?,?,?)')
        .run(roomId, userId, role, joinedAt)
    },
  }
}
