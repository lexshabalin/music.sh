#!/usr/bin/env bash
# Push a semver tag to GitHub and create a release when one is missing.
# ponytail: tag-only push of one repo. Upgrade path is a GitLab push mirror plus a GitHub Action.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-lexshabalin/music.sh}"

tag_ok() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

release_body() {
  printf '{"tag_name":"%s","name":"%s","generate_release_notes":true}' "$1" "$1"
}

if [[ "${1:-}" == "--check" ]]; then
  tag_ok v1.2.3
  ! tag_ok 1.2.3
  ! tag_ok v1.2
  ! tag_ok v1.2.3-rc1
  body="$(release_body v1.2.3)"
  [[ "$body" == '{"tag_name":"v1.2.3","name":"v1.2.3","generate_release_notes":true}' ]]
  echo "ok"
  exit 0
fi

: "${GITHUB_TOKEN:?Set CI/CD variable GITHUB_TOKEN}"
: "${CI_COMMIT_TAG:?CI_COMMIT_TAG is empty}"
tag_ok "$CI_COMMIT_TAG" || {
  echo "tag must match vMAJOR.MINOR.PATCH" >&2
  exit 1
}
git rev-parse --verify "refs/tags/${CI_COMMIT_TAG}^{commit}" >/dev/null

git push "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" "refs/tags/${CI_COMMIT_TAG}"

code="$(curl -sS -o /tmp/gh-release.json -w "%{http_code}" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/releases/tags/${CI_COMMIT_TAG}")"

if [[ "$code" == "200" ]]; then
  echo "release ${CI_COMMIT_TAG} already exists"
  exit 0
fi
if [[ "$code" != "404" ]]; then
  echo "github release lookup failed: HTTP ${code}" >&2
  cat /tmp/gh-release.json >&2
  exit 1
fi

curl -fsS -X POST \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/${REPO}/releases" \
  --data "$(release_body "$CI_COMMIT_TAG")"
echo
echo "created release ${CI_COMMIT_TAG}"
