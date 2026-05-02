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

# Load host secrets for validation and for any tools that read the shell env.
# Compose also auto-loads $APP_DIR/.env for variable substitution.
set -a
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi
set +a

if [ -z "${MUSIC_HOST_DIR:-}" ]; then
  echo "Missing MUSIC_HOST_DIR (path to your audio library on the Docker host)." >&2
  echo "Set it in $APP_DIR/.env or export before deploy. GitLab: DEPLOY_WRITE_ENV_FROM_CI=1 and CI variable MUSIC_HOST_DIR." >&2
  exit 1
fi

docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true
