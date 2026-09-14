# MeApp Operations Runbook (V8 Final)

## Backup & Restore (Fix #8 - No torn reads in WAL mode)

- **Continuous Replication**: Litestream replicates WAL to S3 every 1s (`sync-interval 1s`).
- **Target RPO**: ≤60s, **Target RTO**: ≤5min (measured via chaos testing: 2s RPO under active write load).
- **Pre-Migration Snapshot**:
  Never use a plain `cp` command while the server is writing, as this can cause torn reads in SQLite WAL mode.
  Use atomic `VACUUM INTO` or `sqlite3 .backup`:
  ```bash
  podman exec meapp-server sqlite3 /app/data/data.db "VACUUM INTO '/app/data/backup-pre-${SHA}.db'"
  podman exec meapp-server sqlite3 /app/data/backup-pre-${SHA}.db "PRAGMA integrity_check;"
  ```
- **Restore Procedure**: `./scripts/test-restore.sh`
- **Backup Verification**: Weekly CI restore test.

## Database Migrations & Volume Locking (Fix #7)

- **SQLite Locking Across Containers**:
  SQLite file locking (via `fcntl`) functions across Podman volume bind mounts on host filesystems (ext4/xfs).
  However, migrations should **never** run concurrently with write traffic:
  - **Option A (Safest)**: Stop the server container, run the migration container, then start the server container.
  - **Option B**: Run migrations via `podman exec meapp-server bun run src/migrate.ts` inside the running server container to ensure locking is handled within the same process environment.
- **Concurrency Lock**:
  CI migrations run within the `meapp-migration-prod` concurrency group with `cancel-in-progress: false` to guarantee that only one migration runs at any given time.

## Deployment & Rollback Invariant (Fix #1, Fix #9)

- **Application Image Rollback**: Safe at any time (`systemctl --user restart meapp:prev-sha`).
- **Database Rollback**: NEVER automated.
  - Schema evolution follows the **Expand / Contract** pattern across releases:
    - **Release N (expand)**: Add new columns/tables as nullable or with defaults. Old and new code both function seamlessly.
    - **Release N+1 (migrate)**: Switch application code to the new schema and backfill historical data.
    - **Release N+2 (contract)**: Drop old unused columns/tables only after N+1 has been stable in production for 1 week.
  - Destructive schema changes (`DROP COLUMN`, `DROP TABLE`) are blocked in CI by `scripts/check-destructive-migration.sh` unless explicitly labeled with `allow-destructive-migration`.
