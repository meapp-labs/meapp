import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const sql = readFileSync(resolve(root, 'e2e-migrations/0000_ordinary_ben_urich.sql'), 'utf8')
writeFileSync(
  resolve(root, 'services/e2eSchemaSql.ts'),
  `// Generated from the pinned Signal SDK schema. Do not edit by hand.\nexport const e2eSchemaSql = ${JSON.stringify(sql)}\n`,
)
