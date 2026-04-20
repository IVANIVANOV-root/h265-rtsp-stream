#!/bin/bash
# ============================================================
#  h265-rtsp-stream — автоматическая установка
#  Источник: https://github.com/IVANIVANOV-root/h265-rtsp-stream
# ============================================================
set -e

REPO_URL="https://github.com/IVANIVANOV-root/h265-rtsp-stream.git"
INSTALL_DIR="${1:-camera-mosaic}"
PORT="${2:-3010}"

echo ""
echo "================================================="
echo "  h265-rtsp-stream installer"
echo "================================================="
echo "  Директория: $INSTALL_DIR"
echo "  Порт:       $PORT"
echo ""

# --- Зависимости ---
if ! command -v docker &>/dev/null; then
  echo "[ERROR] Docker не установлен. Установите Docker и повторите."
  exit 1
fi
if ! docker compose version &>/dev/null 2>&1 && ! docker-compose version &>/dev/null 2>&1; then
  echo "[ERROR] Docker Compose не найден."
  exit 1
fi
if ! command -v git &>/dev/null; then
  echo "[ERROR] git не установлен."
  exit 1
fi

# --- Клонирование ---
if [ -d "$INSTALL_DIR" ]; then
  echo "[INFO] Директория $INSTALL_DIR уже существует, обновляем..."
  cd "$INSTALL_DIR"
  git pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# --- SESSION_SECRET ---
ENV_FILE=".env"
if [ -f "$ENV_FILE" ] && grep -q "SESSION_SECRET=" "$ENV_FILE"; then
  echo "[INFO] SESSION_SECRET уже задан в .env, пропускаем."
else
  # Генерация: openssl → /dev/urandom → python fallback
  if command -v openssl &>/dev/null; then
    SECRET=$(openssl rand -hex 32)
  elif [ -r /dev/urandom ]; then
    SECRET=$(cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
  elif command -v python3 &>/dev/null; then
    SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  else
    echo "[ERROR] Не удалось сгенерировать SESSION_SECRET. Установите openssl или python3."
    exit 1
  fi
  echo "SESSION_SECRET=$SECRET" >> "$ENV_FILE"
  echo "[OK] SESSION_SECRET сгенерирован и сохранён в .env"
fi

# --- Порт ---
if grep -q "HOST_PORT=" "$ENV_FILE" 2>/dev/null; then
  echo "[INFO] PORT уже задан в .env"
else
  echo "HOST_PORT=$PORT" >> "$ENV_FILE"
fi

# --- Обновляем docker-compose.yml под переменные из .env ---
# (docker compose автоматически подхватывает .env в той же директории)

# --- Определение HTTP/HTTPS ---
echo ""
echo "Как будет доступно приложение?"
echo "  1) HTTPS через обратный прокси (nginx, NPM, Caddy) — рекомендуется"
echo "  2) HTTP напрямую (локальная сеть, тест)"
read -p "Выбор [1/2, по умолчанию 1]: " PROTO_CHOICE
PROTO_CHOICE="${PROTO_CHOICE:-1}"

if [ "$PROTO_CHOICE" = "2" ]; then
  echo "COOKIE_SECURE=false" >> "$ENV_FILE"
  echo "[INFO] Режим HTTP: cookie.secure=false"
else
  echo "COOKIE_SECURE=auto" >> "$ENV_FILE"
  echo "[INFO] Режим HTTPS/auto: cookie.secure определяется по X-Forwarded-Proto"
fi

# --- Сборка и запуск ---
echo ""
echo "[BUILD] Сборка Docker-образа..."
if docker compose version &>/dev/null 2>&1; then
  docker compose up -d --build
else
  docker-compose up -d --build
fi

echo ""
echo "================================================="
echo "  Установка завершена!"
echo "================================================="
echo ""
echo "  Приложение запущено на порту $PORT"
echo "  Откройте: http://$(hostname -I | awk '{print $1}'):$PORT"
echo ""
echo "  Данные для входа по умолчанию:"
echo "    Логин:  admin"
echo "    Пароль: admin"
echo ""
echo "  ВАЖНО: смените пароль admin при первом входе!"
echo ""
echo "  SESSION_SECRET хранится в: $INSTALL_DIR/.env"
echo "  База данных (volume): camera_data"
echo ""
