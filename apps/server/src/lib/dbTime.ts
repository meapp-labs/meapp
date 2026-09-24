/**
 * Drizzle's SQLite `timestamp` mode uses epoch seconds. Some older raw SQL
 * inserts wrote epoch milliseconds, so both representations exist in the DB.
 * Drizzle has already converted selected values to Date; raw SQL returns a
 * number. Normalize either representation without rewriting existing rows.
 */
export const chatTimestampIso = (value: Date | number): string => {
  const stored = value instanceof Date ? value.getTime() / 1000 : value
  const milliseconds = stored >= 100_000_000_000 ? stored : stored * 1000
  return new Date(milliseconds).toISOString()
}
