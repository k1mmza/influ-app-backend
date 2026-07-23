#!/bin/bash
# Apply pending Prisma migrations to the shared Supabase database.
#
# This is DELIBERATELY separate from deploy.sh: a routine deploy must never
# migrate silently. Run this only when you intend to apply migrations, and
# approve each run explicitly at the prompt below.
#
# Runs inside a one-off container built from the deployed image (so the Prisma
# CLI + generated client are present) and uses DIRECT_URL (non-pooled) for DDL,
# exactly as Prisma expects. Requires deploy.sh to have built the image first.
set -euo pipefail

VPS=root@80.241.213.128
REMOTE_DIR=/opt/influ-app-backend
NET=influ-net

echo "==> Migration status BEFORE applying"
ssh "$VPS" "docker run --rm --network $NET --env-file $REMOTE_DIR/.env \
    influ-app-backend npx prisma migrate status" || true

echo
echo "!! This applies pending migrations to the SHARED Supabase DB (affects"
echo "!! Render too, since the database is shared). This is not reversible here."
read -rp "Type MIGRATE to apply, anything else to abort: " ok
[ "$ok" = "MIGRATE" ] || { echo "Aborted — no migrations applied."; exit 1; }

echo "==> Applying migrations"
ssh "$VPS" "docker run --rm --network $NET --env-file $REMOTE_DIR/.env \
    influ-app-backend npx prisma migrate deploy"

echo "==> Done."
