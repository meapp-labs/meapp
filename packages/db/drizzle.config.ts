import { defineConfig } from 'drizzle-kit'

// drizzle-kit config for migrations and schema introspection.
// Run: bunx drizzle-kit generate
//      bunx drizzle-kit migrate
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './data.db',
  },
  verbose: true,
  strict: true,
})
