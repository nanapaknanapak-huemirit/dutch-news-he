#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_DIR="$REPO_DIR/site"
PAGES_URL="${PAGES_URL:-https://nanapaknanapak-huemirit.github.io/dutch-news-he/}"
PAGES_KEY="${PAGES_KEY:-$HOME/.ssh/dutch-news-he-pages}"
PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"

case "$PAGES_URL" in
  */) ;;
  *) PAGES_URL="$PAGES_URL/" ;;
esac

if [ ! -f "$PAGES_KEY" ]; then
  echo "Pages deploy key not found at $PAGES_KEY; skipping deploy." >&2
  exit 0
fi

if [ ! -f "$SITE_DIR/index.html" ]; then
  echo "Missing $SITE_DIR/index.html; run the build first." >&2
  exit 1
fi

if ! grep -qF "$PAGES_URL" "$SITE_DIR/index.html"; then
  echo "Refusing to deploy: $PAGES_URL is not present in site/index.html." >&2
  echo "Check SITE_URL in ~/.config/dutch-news-he/notify.env and rebuild." >&2
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  (cd "$REPO_DIR" && node scripts/check.mjs)
fi

ORIGIN="$(git -C "$REPO_DIR" remote get-url origin)"
case "$ORIGIN" in
  https://github.com/*) REMOTE="git@github.com:${ORIGIN#https://github.com/}" ;;
  http://github.com/*) REMOTE="git@github.com:${ORIGIN#http://github.com/}" ;;
  *) REMOTE="$ORIGIN" ;;
esac
if [ -n "${PAGES_REPO:-}" ]; then
  REMOTE="$PAGES_REPO"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dutch-news-pages.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

git -C "$TMP_DIR" init -q
git -C "$TMP_DIR" remote add origin "$REMOTE"
git -C "$TMP_DIR" checkout -q --orphan "$PAGES_BRANCH"

cp -a "$SITE_DIR"/. "$TMP_DIR"/
touch "$TMP_DIR/.nojekyll"

git -C "$TMP_DIR" add -A
git -C "$TMP_DIR" \
  -c user.name="nanapaknanapak-huemirit" \
  -c user.email="231016085+nanapaknanapak-huemirit@users.noreply.github.com" \
  commit -q -m "deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

GIT_SSH_COMMAND="ssh -i '$PAGES_KEY' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
  git -C "$TMP_DIR" push --force origin "$PAGES_BRANCH"

echo "Deployed $PAGES_URL to $PAGES_BRANCH"
