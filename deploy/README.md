# Production deployment (rootless podman + systemd quadlets)

## Install (once)

```sh
cp deploy/meapp.network ~/.config/containers/systemd/
cp deploy/meapp-redis.container ~/.config/containers/systemd/
cp deploy/meapp.container ~/.config/containers/systemd/
mkdir -p ~/meapp
cat > ~/meapp/meapp.env <<'EOF'
JWT_SECRET=<openssl rand -hex 32>
WS_TICKET_SECRET=<openssl rand -hex 32>
DOMAIN=example.com,api.example.com
EOF
chmod 600 ~/meapp/meapp.env
systemctl --user daemon-reload
systemctl --user start meapp.service
```

CI rewrites only `~/.config/containers/systemd/meapp.container.d/tag.conf`
(the image tag drop-in); the unit files themselves stay in version control.

## Required GitHub secrets / variables

| Secret | Purpose |
| --- | --- |
| `SERVER_HOST` | Deploy target host |
| `SERVER_USER` | SSH user (rootless podman user) |
| `SSH_KEY` | Deploy key |
| `EXPO_TOKEN` | EAS Update |
| `WEB_DIST_PATH` (vars) | rsync destination for the web bundle |

## Backup & restore

CI takes a `VACUUM INTO` snapshot in the `migrate` job before every migration
(the image has no `sqlite3` binary; `bun -e "sqlite.exec(...)"` is used — same
technique as `scripts/chaos-test.sh`). Snapshots land in the `meapp-server-data`
volume as `/data/backup-pre-<tag>.db`.

Manual backup:

```sh
podman exec meapp-server bun -e \
  "import {sqlite} from './packages/db/src/client.ts'; sqlite.exec(\"VACUUM INTO '/data/backup-manual.db'\")"
```

Restore (stop server first — SQLite is single-writer):

```sh
systemctl --user stop meapp.service
podman run --rm -v meapp-server-data:/data:Z docker.io/library/alpine \
  sh -c "cp /data/backup-pre-<tag>.db /data/data.db && rm -f /data/data.db-wal /data/data.db-shm"
systemctl --user start meapp.service
```

The database is not migrated back automatically on rollback: migrations are
forwards-only. If a deploy introduces a destructive migration, restore the
`backup-pre-<tag>.db` snapshot taken before that migration ran.
