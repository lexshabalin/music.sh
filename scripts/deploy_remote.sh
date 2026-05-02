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

export DOCKER_BUILDKIT=1

# `docker compose up --build` pins CPU/RAM on the *host* (build ignores container cpus/mem_limit). Split build + up
# and run the build at low IO/CPU priority so the hypervisor stays responsive (see Dockerfile GOMAXPROCS / npm jobs).
run_compose_build() {
  if command -v nice >/dev/null 2>&1; then
    if command -v ionice >/dev/null 2>&1 && ionice -c2 -n7 true 2>/dev/null; then
      ionice -c2 -n7 nice -n 15 docker compose build
    else
      nice -n 15 docker compose build
    fi
  elif command -v ionice >/dev/null 2>&1 && ionice -c2 -n7 true 2>/dev/null; then
    ionice -c2 -n7 docker compose build
  else
    docker compose build
  fi
}
run_compose_build
docker compose up -d --no-build
docker image prune -f >/dev/null 2>&1 || true
