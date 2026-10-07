/**
 * Shared Lua scripts for Redis-backed rate limiting.
 * Single source of truth so the HTTP (plugins/rateLimit.ts) and WebSocket
 * (ws/connectionManager.ts) limiters cannot drift apart.
 */

/**
 * Atomic fixed-window counter: INCR + EXPIRE in one roundtrip.
 * KEYS[1] = counter key, ARGV[1] = window seconds.
 * Returns the incremented count.
 */
export const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
`
