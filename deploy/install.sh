#!/usr/bin/env bash
# First-time setup on Debian. Clone the repo, then run:
#   bash deploy/install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER" || true
  echo "Docker installed. If 'docker compose' says permission denied, log out and back in, then run this script again."
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is missing." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp deploy/env.example .env
  echo "Created .env from deploy/env.example. Edit the admin password before going live."
fi

docker compose up -d --build
set -a
# shellcheck disable=SC1091
source .env
set +a
echo
echo "PVC Arvand is running."
echo "Open http://$(hostname -I | awk '{print $1}'):${APP_PUBLISH_PORT:-8080}/"
echo "Default login is whatever you set in .env (admin / admin123 if unchanged)."
echo "Next updates: bash deploy/update.sh"
