#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found on server. Install Docker Engine first." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose not found on server. Install docker-compose-plugin." >&2
  exit 1
fi

echo "Deploying in: $APP_DIR"

# Optional: if you keep production env overrides on the server, place them in:
#   $APP_DIR/.env
# Compose will auto-load it.

docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true
