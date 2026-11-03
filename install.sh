#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

mkdir -p data/editions cache/subtitles cache/audio logs site

npm install --no-audit --no-fund
node scripts/build.mjs

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
cp systemd/dutch-news-he.service systemd/dutch-news-he.timer systemd/dutch-news-he-serve.service "$UNIT_DIR/"

systemctl --user daemon-reload
systemctl --user enable --now dutch-news-he.timer
systemctl --user enable --now dutch-news-he-serve.service

echo
echo "Site: $PROJECT_DIR/site/index.html"
echo "Updates: $PROJECT_DIR/site/updates.html"
echo "Podcast: $PROJECT_DIR/site/podcast.xml"
echo "Local server: http://localhost:8787/"
echo "Update now: systemctl --user start dutch-news-he.service"
echo "Logs: journalctl --user -u dutch-news-he"
echo "Telegram setup: node scripts/setup-telegram.mjs"
systemctl --user list-timers --no-pager | grep dutch-news || true
