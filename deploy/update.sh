#!/usr/bin/env bash
# Pull the latest GitHub main and rebuild. Database volume is kept.
#   bash deploy/update.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .git ]]; then
  echo "This folder is not a git checkout. Clone the repo first." >&2
  exit 1
fi

git fetch origin
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
echo "Update finished. Data volume pvc_arvand_data was not removed."
