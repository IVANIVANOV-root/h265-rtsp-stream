# h265-rtsp-stream

**Веб-мозаика IP-камер** — самостоятельно развёртываемый просмотрщик RTSP-потоков в браузере без плагинов.  
**Self-hosted RTSP camera wall** — watch H.265/H.264 IP cameras in any browser, no plugins required.

---

## 📋 Содержание / Table of Contents

- [Русский](#русский)
- [English](#english)

---

# Русский

## Возможности

| Функция | Описание |
|---|---|
| **H.265 / H.264** | Passthrough без перекодирования, минимальная задержка |
| **WebSocket стриминг** | ffmpeg → MPEG-TS → WebSocket → mpegts.js в браузере |
| **PWA** | Устанавливается на телефон/планшет, работает офлайн (app shell) |
| **Тёмная и светлая тема** | Переключатель ☀/☾, запоминается в браузере |
| **Мультиязычность** | RU / EN / KZ / BY — язык задаётся администратором каждому пользователю |
| **Группы камер** | Создание, переименование, сортировка drag-and-drop |
| **Ограничение доступа** | Администратор выбирает, какие камеры видит каждый пользователь |
| **Fullscreen + zoom** | Двойной тап/клик — полный экран; pinch-to-zoom × 8, пан |
| **Звук** | Включается в полноэкранном режиме (отдельный AAC-поток) |
| **Смена паролей** | Администратор сбрасывает пароль любому пользователю |
| **Стойкие сессии** | Сессия переживает перезапуск сервера (30 дней, rolling) |
| **Rate limiting** | 10 попыток входа / 15 минут с IP |

## Требования

- Docker + Docker Compose
- git
- Открытый порт (по умолчанию `3010`)
- RTSP-камеры в локальной сети (или любой RTSP-источник)

## Быстрая установка

```bash
curl -fsSL https://raw.githubusercontent.com/IVANIVANOV-root/h265-rtsp-stream/main/install.sh | bash
```

Или с указанием директории и порта:

```bash
curl -fsSL https://raw.githubusercontent.com/IVANIVANOV-root/h265-rtsp-stream/main/install.sh | bash -s -- camera-mosaic 3010
```

Скрипт выполнит:
1. Клонирование репозитория
2. Генерацию `SESSION_SECRET` (через `openssl rand -hex 32`)
3. Уточнение режима доступа — HTTP или HTTPS
4. Сборку Docker-образа и запуск контейнера

После установки откройте `http://<IP>:3010`, войдите как `admin / admin` и **сразу смените пароль**.

## Ручная установка

```bash
git clone https://github.com/IVANIVANOV-root/h265-rtsp-stream.git camera-mosaic
cd camera-mosaic

# Создайте .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
echo "HOST_PORT=3010" >> .env

# Для HTTP-доступа без прокси:
echo "COOKIE_SECURE=false" >> .env
# Для HTTPS через обратный прокси (nginx, NPM, Caddy):
echo "COOKIE_SECURE=auto" >> .env

docker compose up -d --build
```

## SESSION_SECRET — как это работает

`SESSION_SECRET` подписывает сессионные cookie. Если он изменится — все активные сессии станут недействительными (пользователи выйдут).

**Порядок приоритетов:**

1. Переменная окружения `SESSION_SECRET` (из `.env` или `docker-compose.yml`)
2. Файл `data/session.secret` внутри Docker volume (создаётся автоматически при первом запуске)
3. Если ни то, ни другое не найдено — генерируется случайное значение **при каждом запуске** ⚠️

> ⚠️ Без явно заданного `SESSION_SECRET` и без volume сессии будут сбрасываться при каждом перезапуске контейнера.

**Рекомендуется:** задать `SESSION_SECRET` в `.env` один раз при установке (скрипт делает это автоматически) и не менять.

## HTTP vs HTTPS

| Сценарий | `COOKIE_SECURE` | Поведение |
|---|---|---|
| Локальная сеть, HTTP напрямую | `false` | Cookie без флага Secure, работает |
| За обратным прокси (nginx/NPM/Caddy) + HTTPS | `auto` | Express читает `X-Forwarded-Proto`, ставит Secure автоматически |
| HTTPS напрямую (Node.js с сертификатом) | `true` | Cookie только по HTTPS |

Установочный скрипт спрашивает об этом интерактивно. При ручной установке добавьте нужную строку в `.env`.

## Обновление

```bash
cd camera-mosaic
git pull
docker compose up -d --build
```

База данных и `SESSION_SECRET` хранятся в Docker volume — обновление их не затрагивает.

## Структура файлов

```
camera-mosaic/
├── server.js          # Бэкенд: Express + WebSocket + ffmpeg
├── public/
│   ├── index.html     # SPA: весь UI
│   ├── sw.js          # Service Worker (PWA)
│   └── manifest.json  # PWA-манифест
├── Dockerfile
├── docker-compose.yml
├── install.sh         # Скрипт автоматической установки
└── .env               # Ваши секреты (не в git)
```

---

# English

## Features

| Feature | Description |
|---|---|
| **H.265 / H.264** | Passthrough, no re-encoding, minimal latency |
| **WebSocket streaming** | ffmpeg → MPEG-TS → WebSocket → mpegts.js in browser |
| **PWA** | Installable on phone/tablet, offline app shell |
| **Dark & light theme** | ☀/☾ toggle, remembered per browser |
| **Multi-language** | RU / EN / KZ / BY — admin assigns language per user |
| **Camera groups** | Create, rename, drag-and-drop reorder |
| **Per-user camera access** | Admin selects which cameras each viewer can see |
| **Fullscreen + zoom** | Double-tap/click for fullscreen; pinch-to-zoom ×8, pan |
| **Audio** | Enabled in fullscreen mode (separate AAC stream) |
| **Password management** | Admin resets any user's password |
| **Persistent sessions** | Sessions survive server restarts (30 days, rolling) |
| **Rate limiting** | 10 login attempts / 15 min per IP |

## Requirements

- Docker + Docker Compose
- git
- Open port (default `3010`)
- RTSP cameras on local network (or any RTSP source)

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/IVANIVANOV-root/h265-rtsp-stream/main/install.sh | bash
```

Or with custom directory and port:

```bash
curl -fsSL https://raw.githubusercontent.com/IVANIVANOV-root/h265-rtsp-stream/main/install.sh | bash -s -- camera-mosaic 3010
```

The script will:
1. Clone the repository
2. Generate `SESSION_SECRET` (via `openssl rand -hex 32`)
3. Ask whether you're using HTTP or HTTPS
4. Build the Docker image and start the container

After install, open `http://<IP>:3010`, log in as `admin / admin` and **change the password immediately**.

## Manual Install

```bash
git clone https://github.com/IVANIVANOV-root/h265-rtsp-stream.git camera-mosaic
cd camera-mosaic

# Create .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
echo "HOST_PORT=3010" >> .env

# For direct HTTP access (no proxy):
echo "COOKIE_SECURE=false" >> .env
# For HTTPS via reverse proxy (nginx, NPM, Caddy):
echo "COOKIE_SECURE=auto" >> .env

docker compose up -d --build
```

## SESSION_SECRET — how it works

`SESSION_SECRET` signs session cookies. If it changes, all active sessions are invalidated (users get logged out).

**Priority order:**

1. `SESSION_SECRET` environment variable (from `.env` or `docker-compose.yml`)
2. File `data/session.secret` inside the Docker volume (auto-created on first run)
3. If neither found — a random value is generated **on every startup** ⚠️

> ⚠️ Without an explicit `SESSION_SECRET` and without a persistent volume, sessions will reset on every container restart.

**Recommended:** set `SESSION_SECRET` in `.env` once during install (the script does this automatically) and never change it.

## HTTP vs HTTPS

| Scenario | `COOKIE_SECURE` | Behaviour |
|---|---|---|
| Local network, direct HTTP | `false` | Cookie without Secure flag, works fine |
| Behind reverse proxy (nginx/NPM/Caddy) + HTTPS | `auto` | Express reads `X-Forwarded-Proto`, sets Secure automatically |
| Direct HTTPS (Node.js with certificate) | `true` | Cookie only over HTTPS |

The install script asks interactively. For manual install, add the appropriate line to `.env`.

## Updating

```bash
cd camera-mosaic
git pull
docker compose up -d --build
```

Database and `SESSION_SECRET` are stored in a Docker volume — updates do not affect them.

---

## Stack

`Node.js 20` · `Express` · `WebSocket (ws)` · `ffmpeg` · `mpegts.js` · `better-sqlite3` · `bcryptjs` · `express-session` · `Sortable.js` · `Docker`

## License

MIT
