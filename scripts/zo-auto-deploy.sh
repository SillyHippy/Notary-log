#!/usr/bin/env bash
# Pull latest Notary-log from GitHub, rebuild, and restart the Zo HTTP service.
# Run manually after a push, or schedule on Zo Computer (cron) for automatic deploys.
#
# Example cron (every 30 minutes — adjust as needed):
#   */30 * * * * /home/workspace/Projects/Notary-log/scripts/zo-auto-deploy.sh >> /tmp/notary-log-deploy.log 2>&1
#
# Requires: git repo at REPO_DIR, supervisor program "notary-log" (or set SERVICE_NAME).

set -euo pipefail

REPO_DIR="${NOTARY_LOG_REPO:-/home/workspace/Projects/Notary-log}"
BRANCH="${NOTARY_LOG_BRANCH:-main}"
SERVICE_NAME="${NOTARY_LOG_SERVICE:-notary-log}"
BUILD_MODE="${NOTARY_LOG_BUILD:-build}"

cd "$REPO_DIR"

BEFORE="$(git rev-parse HEAD)"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "$(date -Iseconds) No changes on $BRANCH — skip rebuild"
  exit 0
fi

echo "$(date -Iseconds) Deploying $AFTER on $BRANCH"

if command -v bun >/dev/null 2>&1; then
  bun install
  bun run "$BUILD_MODE"
else
  pnpm install
  pnpm --filter @workspace/notary-journal... run "$BUILD_MODE"
fi

if command -v supervisorctl >/dev/null 2>&1; then
  supervisorctl restart "$SERVICE_NAME"
  echo "$(date -Iseconds) Restarted $SERVICE_NAME"
else
  echo "$(date -Iseconds) supervisorctl not found — rebuild only, restart service manually"
fi

echo "$(date -Iseconds) Deploy complete"
