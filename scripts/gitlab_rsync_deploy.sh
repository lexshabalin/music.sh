#!/usr/bin/env bash
# Called from GitLab CI after exporting GITLAB_CI_* variables from DEV_* or DEMO_*.
set -euo pipefail

if [ -z "${GITLAB_CI_DEPLOY_HOST:-}" ] || [ -z "${GITLAB_CI_DEPLOY_USER:-}" ] || [ -z "${GITLAB_CI_DEPLOY_DIR:-}" ]; then
  echo "Missing GITLAB_CI_DEPLOY_HOST / GITLAB_CI_DEPLOY_USER / GITLAB_CI_DEPLOY_DIR" >&2
  exit 1
fi

key_src=""
if [ -n "${GITLAB_CI_SSH_KEY_B64:-}" ]; then
  key_src="$GITLAB_CI_SSH_KEY_B64"
else
  key_src="${GITLAB_CI_SSH_KEY:-}"
fi

if [ -z "$key_src" ]; then
  echo "Missing GITLAB_CI_SSH_KEY_B64 or GITLAB_CI_SSH_KEY" >&2
  exit 1
fi

mkdir -p ~/.ssh
chmod 700 ~/.ssh
eval "$(ssh-agent -s)"
# If value is base64, decode; otherwise treat as raw private key.
if echo "$key_src" | base64 -d >/tmp/deploy_key 2>/dev/null; then
  tr -d '\r' </tmp/deploy_key | ssh-add -
else
  echo "$key_src" | tr -d '\r' | ssh-add -
fi
ssh-keyscan -H "$GITLAB_CI_DEPLOY_HOST" >> ~/.ssh/known_hosts

rsync -az --delete \
  --exclude '.git' \
  --exclude '.gitlab-ci.yml' \
  --exclude '.env' \
  --exclude 'pgdata/' \
  --exclude 'appdata/' \
  --exclude 'music/' \
  ./ "$GITLAB_CI_DEPLOY_USER@$GITLAB_CI_DEPLOY_HOST:$GITLAB_CI_DEPLOY_DIR/"

if [ -n "${GITLAB_CI_WRITE_ENV_FROM_CI:-}" ]; then
  : "${GITLAB_CI_MUSIC_HOST_DIR:?Set GITLAB_CI_MUSIC_HOST_DIR when GITLAB_CI_WRITE_ENV_FROM_CI is set}"
  printf '%s\n' "MUSIC_HOST_DIR=$GITLAB_CI_MUSIC_HOST_DIR" > .env.musicsh.ci
  rsync -az .env.musicsh.ci "$GITLAB_CI_DEPLOY_USER@$GITLAB_CI_DEPLOY_HOST:$GITLAB_CI_DEPLOY_DIR/.env"
  rm -f .env.musicsh.ci
fi

ssh "$GITLAB_CI_DEPLOY_USER@$GITLAB_CI_DEPLOY_HOST" "bash '$GITLAB_CI_DEPLOY_DIR/scripts/deploy_remote.sh'"
