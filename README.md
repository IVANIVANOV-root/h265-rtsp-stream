# CCTV Monitor — H.265 RTSP Camera Wall

**English** | [Русский](#русский)

---

A self-hosted, browser-based RTSP camera mosaic with H.265 (HEVC) support, real-time WebSocket streaming, PWA installation, and a dark tactical UI. No plugins, no Flash, no re-encoding.

## Features

- **H.265 / H.264 passthrough** — ffmpeg copies the video stream without re-encoding → minimal CPU usage
- **Low latency** — MPEG-TS over WebSocket, ~1–3 s end-to-end delay
- **Camera groups** — organize cameras into named groups stored in SQLite
- **Drag & drop** — reorder cameras within a group (admin only)
- **Full-screen mode** — double-tap or click the ⛶ button; pinch-to-zoom and pan on touch, mouse wheel + drag on desktop
- **Audio** — optional audio stream in full-screen mode (🔇 / 🔊 toggle)
- **Multi-user auth** — roles: `admin`, `viewer`; bcrypt-hashed passwords
- **Admin panel** — add / edit / delete cameras and groups via UI, no config files needed
- **PWA** — installable on Android and iOS; works offline (UI shell cached by Service Worker)
- **Update banner** — notifies users when a new version is deployed
- **Docker deploy** — single command install

## Quick Install (one command)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/IVANIVANOV-root/h265-rtsp-stream/main/install.sh)
```

The script will:
- clone the repository
- generate a random `SESSION_SECRET` and save it to `.env`
- build and start the Docker container

App will be available at `http://<your-server-ip>:3010`

Default credentials: **admin / admin** — **change immediately** after first login.

## Manual Start

```bash
git clone https://github.com/IVANIVANOV-root/h265-rtsp-stream.git
cd h265-rtsp-stream
cp .env.example .env          # edit SESSION_SECRET
docker compose up -d --build  # http://localhost:3010
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SESSION_SECRET` | auto-generated | **Required in production.** Signs session cookies. If not set, all users are logged out on every container restart. Generate with: `openssl rand -hex 32` |
| `NODE_ENV` | — | Optional. The app auto-detects HTTPS via proxy headers — no need to set this manually |
| `PORT` | `3000` | Internal HTTP port (Docker maps it to 3010) |
| `DATA_DIR` | `./data` | Directory for the SQLite database |

## Security

### What is SESSION_SECRET?

When a user logs in, the server creates a signed session cookie. `SESSION_SECRET` is the key used to sign it. Anyone who knows this secret can forge valid session cookies — keep it private and random.

- **If not set:** a new random secret is generated on each startup → all active sessions are invalidated on every container restart (users must log in again). This is **not a security vulnerability** — it's just inconvenient. If you are the only user and restarts are rare, you can leave it unset.
- **Recommended:** generate once with `openssl rand -hex 32`, save to `.env`, never change it unless you want to force all users to re-login

### Built-in protections

| Protection | Details |
|---|---|
| **Login rate limiting** | 10 attempts per 15 min per IP; returns `429 Too Many Requests` |
| **bcrypt passwords** | All passwords hashed with bcrypt (cost 10) |
| **Security headers** | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| **No X-Powered-By** | Express version not disclosed |
| **httpOnly cookies** | Session cookie not accessible from JavaScript |
| **sameSite: strict** | CSRF protection for same-origin requests |
| **secure cookie** | Auto-detected: sent over HTTPS only when request comes through an HTTPS proxy |
| **Role-based API** | `viewer` role does not receive camera URLs or credentials |

### Recommended production setup

1. Put the app behind a reverse proxy (nginx, Caddy, NPM) with **HTTPS**
2. Set `SESSION_SECRET` in `.env` to a long random string
3. Change the default `admin / admin` password immediately
4. Create viewer-only accounts for users who only need to watch

### Docker Compose with environment

```yaml
services:
  camera:
    build: .
    ports:
      - "3010:3000"
    volumes:
      - camera_data:/app/data
    environment:
      - SESSION_SECRET=replace_with_output_of_openssl_rand_hex_32
    restart: unless-stopped

volumes:
  camera_data:
```

## Adding Cameras

1. Log in as `admin`
2. Click **+** in the header
3. Enter: name, RTSP URL, optional login/password, group
4. Save — stream starts immediately

Supported sources: Hikvision, Dahua, Reolink, and any H.265 / H.264 RTSP camera.

## Full-Screen Controls

| Action | Touch | Mouse |
|---|---|---|
| Open / close | Double-tap tile | Double-click tile |
| Zoom in / out | Pinch | Scroll wheel |
| Pan | Drag (when zoomed) | Drag with left button |
| Reset zoom | Double-tap | Double-click |
| Audio toggle | 🔇/🔊 button | 🔇/🔊 button |

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, better-sqlite3, ws |
| Streaming | ffmpeg → MPEG-TS → WebSocket |
| Player | mpegts.js 1.7.3 |
| Auth | express-session, bcryptjs |
| Storage | SQLite (better-sqlite3) |
| Frontend | Vanilla JS, Sortable.js 1.15.2 |
| Deploy | Docker, Docker Compose |

## License

MIT

---

## Русский

Самохостируемая веб-мозаика IP-камер с поддержкой H.265 (HEVC), стримингом через WebSocket, установкой как PWA и тёмным тактическим интерфейсом. Без плагинов, без Flash, без перекодирования.

## Возможности

- **H.265 / H.264 без перекодирования** — ffmpeg копирует поток как есть → минимальная нагрузка на CPU
- **Малая задержка** — MPEG-TS через WebSocket, ~1–3 с
- **Группы камер** — организация по группам, хранение в SQLite
- **Drag & drop** — изменение порядка камер внутри группы (только admin)
- **Полный экран** — двойной тап или кнопка ⛶; pinch-to-zoom и пан на сенсорных экранах, колёсико + перетаскивание на компьютере
- **Звук** — аудиопоток в режиме полного экрана (кнопка 🔇 / 🔊)
- **Мультипользовательская авторизация** — роли `admin` и `viewer`, пароли в bcrypt
- **Панель администратора** — добавление, редактирование и удаление камер и групп через интерфейс
- **PWA** — устанавливается на Android и iOS как приложение; кэш через Service Worker
- **Баннер обновления** — уведомляет пользователей о новой версии при деплое

## Быстрая установка (одна команда)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/IVANIVANOV-root/h265-rtsp-stream/main/install.sh)
```

Скрипт автоматически:
- клонирует репозиторий
- генерирует случайный `SESSION_SECRET` и сохраняет в `.env`
- собирает и запускает Docker-контейнер

Приложение будет доступно по адресу `http://<IP-сервера>:3010`

Логин по умолчанию: **admin / admin** — **сменить сразу** после первого входа.

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `SESSION_SECRET` | авто | **Обязательно для продакшна.** Подписывает куки сессий. Без него все пользователи выходят при каждом перезапуске контейнера. Генерировать: `openssl rand -hex 32` |
| `NODE_ENV` | — | Необязательно. Приложение автоматически определяет HTTPS через заголовки прокси |
| `PORT` | `3000` | Внутренний порт (Docker пробрасывает его на 3010) |
| `DATA_DIR` | `./data` | Директория для базы данных SQLite |

## Безопасность

### Что такое SESSION_SECRET?

При входе сервер создаёт подписанную куку сессии. `SESSION_SECRET` — это ключ подписи. Если не задать, при каждом перезапуске контейнера генерируется новый ключ и все пользователи автоматически выходят из системы.

**Без SESSION_SECRET** — не критично и не опасно. При каждом перезапуске контейнера генерируется новый ключ, и все авторизованные пользователи автоматически выходят из системы. Если вы единственный пользователь и перезапуски редкие — можно не задавать. Если камеры смотрят несколько человек — лучше задать, чтобы не выбрасывало при обновлениях.

Генерировать один раз: `openssl rand -hex 32`, сохранить в `.env`, не менять без нужды.

### Встроенная защита

| Защита | Детали |
|---|---|
| **Rate limiting на вход** | 10 попыток за 15 мин с одного IP, затем `429` |
| **bcrypt пароли** | Все пароли хэшируются bcrypt (стоимость 10) |
| **Security headers** | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| **Скрыт X-Powered-By** | Версия Express не раскрывается |
| **httpOnly cookie** | Кука сессии недоступна из JavaScript |
| **sameSite: strict** | Защита от CSRF |
| **secure cookie** | Только по HTTPS при `NODE_ENV=production` |
| **Разделение по ролям** | Роль `viewer` не получает URL и логины камер |

### Рекомендуемая конфигурация для продакшна

1. Разместить за reverse proxy (nginx, Caddy, NPM) с **HTTPS**
2. Задать `SESSION_SECRET` в `.env` — длинная случайная строка
3. Установить `NODE_ENV=production`
4. Сразу сменить пароль `admin / admin`
5. Создать viewer-аккаунты для пользователей, которым нужен только просмотр

## Добавление камер

1. Войти как `admin`
2. Нажать **+** в шапке
3. Ввести: название, RTSP URL, логин/пароль камеры (если нужно), группу
4. Сохранить — поток запускается сразу

Поддерживаются: Hikvision, Dahua, Reolink и любые H.265 / H.264 RTSP камеры.

## Управление в полном экране

| Действие | Сенсорный | Мышь |
|---|---|---|
| Открыть / закрыть | Двойной тап | Двойной клик |
| Зум | Pinch (щипок) | Колёсико мыши |
| Перемещение | Тащить (при зуме) | Тащить левой кнопкой |
| Сброс зума | Двойной тап | Двойной клик |
| Звук | Кнопка 🔇/🔊 | Кнопка 🔇/🔊 |

## Лицензия

MIT
