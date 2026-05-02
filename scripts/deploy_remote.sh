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

if [ -z "${JWT_SECRET:-}" ] || [ -z "${MUSIC_HOST_DIR:-}" ]; then
  echo "Missing JWT_SECRET or MUSIC_HOST_DIR." >&2
  echo "On the deploy host, create $APP_DIR/.env (copy from .env.example) with at least those two." >&2
  echo "Or from GitLab: set CI/CD variables JWT_SECRET and MUSIC_HOST_DIR, and variable DEPLOY_WRITE_ENV_FROM_CI=1 to write .env each deploy." >&2
  exit 1
fi

docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true
