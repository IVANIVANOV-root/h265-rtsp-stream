#!/bin/bash
# CCTV Monitor — one-command installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/IVANIVANOV-root/h265-rtsp-stream/main/install.sh)

set -e

REPO="https://github.com/IVANIVANOV-root/h265-rtsp-stream.git"
DIR="cctv-monitor"
SECRET=$(openssl rand -hex 32 2>/dev/null || cat /proc/sys/kernel/random/uuid | tr -d '-')

echo ""
echo "╔══════════════════════════════════════╗"
echo "║        CCTV Monitor — Installer      ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Проверяем зависимости
for cmd in git docker; do
  if ! command -v $cmd &>/dev/null; then
    echo "ERROR: '$cmd' not found. Please install it first."
    exit 1
  fi
done

# Клонируем
if [ -d "$DIR" ]; then
  echo "Directory '$DIR' already exists — pulling latest changes..."
  git -C "$DIR" pull
else
  echo "Cloning repository..."
  git clone "$REPO" "$DIR"
fi

cd "$DIR"

# Создаём .env если его нет
if [ ! -f .env ]; then
  cat > .env <<EOF
SESSION_SECRET=$SECRET
NODE_ENV=production
PORT=3000
EOF
  echo "Generated .env with a random SESSION_SECRET"
else
  echo ".env already exists — skipping"
fi

# Создаём docker-compose.override.yml для подключения .env
if [ ! -f docker-compose.override.yml ]; then
  cat > docker-compose.override.yml <<EOF
services:
  camera:
    env_file: .env
EOF
fi

echo ""
echo "Starting containers..."
docker compose up -d --build

echo ""
echo "✓ Done! App is running at http://$(hostname -I | awk '{print $1}'):3010"
echo ""
echo "Default login: admin / admin"
echo "⚠  Change the password immediately after first login!"
echo ""
echo "SESSION_SECRET is saved in .env — do not lose this file."
