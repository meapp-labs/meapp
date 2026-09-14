# MeApp Operations Runbook

## Backup & Restore

- Litestream replicates WAL to S3 every 1s (config: sync-interval 1s)
- Target RPO: ≤60s, Target RTO: ≤5min
- Measured RPO (last chaos test 2026-09-10): 2s (3 messages lost in 1000 writes during kill -9)
- Restore procedure: `./scripts/test-restore.sh`
- Backup verification: Weekly CI job

## Deployment & Rollback Invariant

- Application image rollback is safe: `systemctl --user restart meapp:prev-sha`
- Database rollback is NEVER automatic:
  - Database schema changes follow the Expand/Contract pattern across releases:
    - **Release N (expand)**: Add new columns/tables as nullable or with defaults. Old and new code both function.
    - **Release N+1 (migrate)**: Switch application code to new schema and backfill data.
    - **Release N+2 (contract)**: Drop old unused columns/tables after N+1 has been stable for 1 week.
  - Pre-migration backup is created automatically in CI before every migration:
    `cp ~/meapp-data/data.db ~/meapp-data/data.db.pre-${SHA}`
  - If a migration fails, restore from the pre-migration backup and Litestream S3 snapshot. Never perform automatic downgrade migrations.
