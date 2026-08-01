#!/bin/bash
# Redeploy influ-app-backend to the VPS (Docker + Apache reverse proxy).
#
# Deploy model mirrors the frontend: the VPS holds a git clone of this repo.
# Each deploy pulls the latest main, builds the Docker image ON the server, and
# (re)starts the container. The container is published to 127.0.0.1 only; Apache
# (api.inflique.com) is the public door.
#
# IMPORTANT: this script does NOT run database migrations. Migrations are applied
# separately and individually via migrate.sh, so a routine deploy can never
# silently change the shared Supabase schema.
#
# Push your changes to origin/main first, then run this script.
set -euo pipefail

VPS=root@80.241.213.128
REMOTE_DIR=/opt/influ-app-backend
REPO=https://github.com/k1mmza/influ-app-backend.git   # public repo — no auth needed
HOST_PORT=3201            # published to 127.0.0.1 only (3200 is the frontend)
NET=influ-net             # private docker network shared by backend + redis

echo "==> Ensure private network + Redis (idempotent; Redis has NO host port)"
ssh "$VPS" "docker network inspect $NET >/dev/null 2>&1 || docker network create $NET"
ssh "$VPS" "docker inspect influ-redis >/dev/null 2>&1 || \
  docker run -d --name influ-redis --network $NET --restart unless-stopped \
    redis:7.2 redis-server --maxmemory-policy noeviction"

echo "==> Pulling latest main on the VPS"
# init-in-place (not git clone) so a pre-existing, untracked .env in $REMOTE_DIR
# is left untouched. `git clone` refuses a non-empty dir; `reset --hard` only
# touches tracked files, so the hand-placed .env survives every deploy.
ssh "$VPS" "if [ -d $REMOTE_DIR/.git ]; then \
    cd $REMOTE_DIR && git fetch origin && git reset --hard origin/main; \
  else \
    mkdir -p $REMOTE_DIR && cd $REMOTE_DIR && git init -q && \
    (git remote add origin $REPO 2>/dev/null || git remote set-url origin $REPO) && \
    git fetch --depth 1 origin main && git reset --hard origin/main; \
  fi"

echo "==> Building image on the VPS"
ssh "$VPS" "cd $REMOTE_DIR && docker build -t influ-app-backend ."

echo "==> Restarting container  [migrations NOT run here — see migrate.sh]"
ssh "$VPS" "docker stop influ-app-backend 2>/dev/null || true; docker rm influ-app-backend 2>/dev/null || true"
ssh "$VPS" "docker run -d --name influ-app-backend --network $NET \
    --env-file $REMOTE_DIR/.env \
    -p 127.0.0.1:$HOST_PORT:3001 --restart unless-stopped influ-app-backend"

echo "==> Readiness check (internal) — GET /health verifies DB + Redis"
# Probe the readiness endpoint, not GET / (liveness). --fail makes curl exit
# non-zero on a 503, so `set -e` aborts the deploy if the container came up but
# its gating dependencies (DB/Redis) are unreachable. Storage is reported in the
# body (storage: up|down) but does not gate — a 200 with storage:down is healthy.
# Retry a few times to absorb container warm-up.
ssh "$VPS" "for i in 1 2 3 4 5; do \
    if curl -fsS http://127.0.0.1:$HOST_PORT/health; then echo; exit 0; fi; \
    echo \"  readiness not ready yet (attempt \$i), retrying...\"; sleep 3; \
  done; \
  echo 'ERROR: /health did not return 200 (DB or Redis unreachable) — see: docker logs influ-app-backend'; \
  exit 1"
echo "==> Done. Public URL (after Apache + cert): https://api.inflique.com"
