'use strict';

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// ─── Security headers ─────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ─── Login rate limiter ───────────────────────────────────────────────────────
const loginAttempts = new Map(); // ip -> { count, resetAt }
function loginRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const WINDOW = 15 * 60 * 1000; // 15 min
  const MAX = 10;
  let entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + WINDOW };
  entry.count++;
  loginAttempts.set(ip, entry);
  if (entry.count > MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  next();
}

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'camera.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Database ────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role     TEXT NOT NULL DEFAULT 'viewer',
    prefs    TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS cameras (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,
    cam_user   TEXT,
    cam_pass   TEXT,
    enabled    INTEGER DEFAULT 1,
    sort_pos   INTEGER DEFAULT 0,
    group_name TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS groups (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT UNIQUE NOT NULL,
    sort_pos INTEGER DEFAULT 0
  );
`);

try { db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN prefs TEXT DEFAULT '{}'`); } catch {}
try { db.exec(`ALTER TABLE cameras ADD COLUMN group_name TEXT DEFAULT ''`); } catch {}

// Seed groups from existing camera group_names if groups table is empty
{
  const existingCamGroups = db.prepare(
    "SELECT DISTINCT group_name FROM cameras WHERE group_name != '' ORDER BY group_name"
  ).all();
  if (existingCamGroups.length > 0 && db.prepare('SELECT COUNT(*) as c FROM groups').get().c === 0) {
    const insertGroup = db.prepare('INSERT OR IGNORE INTO groups (name, sort_pos) VALUES (?, ?)');
    existingCamGroups.forEach((row, i) => insertGroup.run(row.group_name, i));
  }
}

if (!db.prepare('SELECT id FROM users WHERE username = ?').get('admin')) {
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')")
    .run('admin', bcrypt.hashSync('admin', 10));
  console.log('Default admin created: admin / admin');
} else {
  db.prepare("UPDATE users SET role='admin' WHERE username='admin' AND role='viewer'").run();
}

// ─── Session ─────────────────────────────────────────────────────────────────

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'strict',
    secure: 'auto',
  },
});

const wsTokens = new Map();

function applySession(req) {
  return new Promise((resolve) => {
    const fakeRes = { getHeader: () => {}, setHeader: () => {}, end: () => {} };
    sessionMiddleware(req, fakeRes, resolve);
  });
}

app.use(sessionMiddleware);
app.use(express.json());
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth middleware ──────────────────────────────────────────────────────────

const requireAuth = (req, res, next) => {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

const requireAdmin = (req, res, next) => {
  if (req.session?.role === 'admin') return next();
  res.status(403).json({ error: 'Forbidden' });
};

// ─── Auth routes ─────────────────────────────────────────────────────────────

app.post('/api/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;

  const token = crypto.randomBytes(20).toString('hex');
  wsTokens.set(token, user.id);
  req.session.wsToken = token;

  let prefs = {};
  try { prefs = JSON.parse(user.prefs || '{}'); } catch {}

  res.json({ ok: true, username: user.username, role: user.role, wsToken: token, prefs });
});

app.post('/api/logout', (req, res) => {
  if (req.session?.wsToken) wsTokens.delete(req.session.wsToken);
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (req.session?.userId) {
    const user = db.prepare('SELECT prefs FROM users WHERE id = ?').get(req.session.userId);
    let prefs = {};
    try { prefs = JSON.parse(user?.prefs || '{}'); } catch {}
    res.json({
      authenticated: true,
      username: req.session.username,
      role: req.session.role,
      wsToken: req.session.wsToken,
      prefs
    });
  } else {
    res.json({ authenticated: false });
  }
});

// ─── User preferences ────────────────────────────────────────────────────────

app.put('/api/prefs', requireAuth, (req, res) => {
  const prefs = req.body || {};
  db.prepare('UPDATE users SET prefs = ? WHERE id = ?')
    .run(JSON.stringify(prefs), req.session.userId);
  res.json({ ok: true });
});

// ─── Camera routes ────────────────────────────────────────────────────────────

const selectCamera = db.prepare(
  'SELECT id, name, url, cam_user, enabled, sort_pos, group_name FROM cameras WHERE id = ?'
);

app.get('/api/cameras', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'admin';
  const cols = isAdmin
    ? 'id, name, url, cam_user, enabled, sort_pos, group_name'
    : 'id, name, enabled, sort_pos, group_name';
  res.json(db.prepare(`SELECT ${cols} FROM cameras ORDER BY sort_pos, id`).all());
});

app.put('/api/cameras/reorder', requireAuth, requireAdmin, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const update = db.prepare('UPDATE cameras SET sort_pos=? WHERE id=?');
  db.transaction(ids => ids.forEach((id, i) => update.run(i, id)))(order);
  res.json({ ok: true });
});

app.post('/api/cameras', requireAuth, requireAdmin, (req, res) => {
  const { name, url, cam_user, cam_pass, group_name } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });

  const r = db.prepare(
    'INSERT INTO cameras (name, url, cam_user, cam_pass, group_name) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), url.trim(), cam_user || null, cam_pass || null, group_name || '');

  res.json(selectCamera.get(r.lastInsertRowid));
});

app.put('/api/cameras/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { name, url, cam_user, cam_pass, enabled, group_name } = req.body || {};

  if (streamManager.isActive(id)) streamManager.stopStream(id);
  if (audioStreamManager.isActive(id)) audioStreamManager.stopStream(id);

  db.prepare(`
    UPDATE cameras SET name=?, url=?, cam_user=?, cam_pass=?, enabled=?, group_name=?
    WHERE id=?
  `).run(name, url, cam_user || null, cam_pass || null, enabled ? 1 : 0, group_name || '', id);

  res.json(selectCamera.get(id));
});

app.delete('/api/cameras/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  streamManager.stopStream(id);
  audioStreamManager.stopStream(id);
  db.prepare('DELETE FROM cameras WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/cameras/:id/status', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  res.json({ active: streamManager.isActive(id), clients: streamManager.clientCount(id) });
});

// ─── User management routes ───────────────────────────────────────────────────

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, username, role FROM users ORDER BY id').all());
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'role must be admin or viewer' });
  try {
    const r = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)")
      .run(username.trim(), bcrypt.hashSync(password, 10), role);
    res.json({ id: r.lastInsertRowid, username: username.trim(), role });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Пользователь уже существует' });
    throw e;
  }
});

app.put('/api/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { role } = req.body || {};
  if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  if (id === req.session.userId) return res.status(400).json({ error: 'Нельзя изменить свою роль' });
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: 'Нельзя удалить себя' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Required' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'Пароль слишком короткий' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.password))
    return res.status(401).json({ error: 'Неверный текущий пароль' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.session.userId);
  res.json({ ok: true });
});

// ─── Group routes ────────────────────────────────────────────────────────────

app.get('/api/groups', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, name, sort_pos FROM groups ORDER BY sort_pos, id').all());
});

app.post('/api/groups', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const maxPos = db.prepare('SELECT COALESCE(MAX(sort_pos),0)+1 AS p FROM groups').get().p;
    const r = db.prepare('INSERT INTO groups (name, sort_pos) VALUES (?, ?)').run(name.trim(), maxPos);
    res.json({ id: r.lastInsertRowid, name: name.trim(), sort_pos: maxPos });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Группа уже существует' });
    throw e;
  }
});

app.put('/api/groups/reorder', requireAuth, requireAdmin, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const update = db.prepare('UPDATE groups SET sort_pos=? WHERE id=?');
  db.transaction(ids => ids.forEach((id, i) => update.run(i, id)))(order);
  res.json({ ok: true });
});

app.put('/api/groups/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const existing = db.prepare('SELECT * FROM groups WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  try {
    db.prepare('UPDATE groups SET name=? WHERE id=?').run(name.trim(), id);
    // Also rename all cameras in this group
    db.prepare("UPDATE cameras SET group_name=? WHERE group_name=?").run(name.trim(), existing.name);
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Группа уже существует' });
    throw e;
  }
});

app.delete('/api/groups/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT * FROM groups WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  // Ungroup cameras from this group
  db.prepare("UPDATE cameras SET group_name='' WHERE group_name=?").run(existing.name);
  db.prepare('DELETE FROM groups WHERE id=?').run(id);
  res.json({ ok: true });
});

// ─── System metrics endpoint ─────────────────────────────────────────────────

app.get('/api/metrics', requireAuth, (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpuUsage = os.loadavg();
  const uptime = os.uptime();

  // Get stream stats
  const streamStats = [];
  for (const [camId, entry] of streamManager.active) {
    streamStats.push({
      cameraId: camId,
      clients: entry.clients.size,
      restarts: entry.restarts,
      pid: entry.proc?.pid || null
    });
  }

  res.json({
    cpu: {
      load1: cpuUsage[0],
      load5: cpuUsage[1],
      load15: cpuUsage[2],
      cores: os.cpus().length
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: ((usedMem / totalMem) * 100).toFixed(1)
    },
    uptime,
    streams: streamStats,
    timestamp: Date.now()
  });
});

// ─── Stream Manager ───────────────────────────────────────────────────────────

class StreamManager {
  constructor(options) {
    this.withAudio = (options && options.withAudio) || false;
    /** @type {Map<number, { proc: ChildProcess, clients: Set<WebSocket>, stopTimer: any, restarts: number, startTime: number }>} */
    this.active = new Map();
  }

  buildUrl(camera) {
    const url = camera.url.trim();
    if (!camera.cam_user) return url;
    try {
      const u = new URL(url);
      u.username = camera.cam_user;
      if (camera.cam_pass) u.password = camera.cam_pass;
      return u.toString();
    } catch {
      return url;
    }
  }

  startStream(camera, existingClients) {
    if (!existingClients) existingClients = new Set();
    if (this.active.has(camera.id)) return this.active.get(camera.id);

    const rtspUrl = this.buildUrl(camera);
    const mode = this.withAudio ? 'audio+video' : 'video-only';
    console.log('[Cam ' + camera.id + '] Starting (' + mode + '): "' + camera.name + '"');

    const args = [
      '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c:v', 'copy',
    ];

    if (this.withAudio) {
      args.push('-c:a', 'aac', '-ar', '44100', '-b:a', '64k');
    } else {
      args.push('-an');
    }

    args.push('-f', 'mpegts', 'pipe:1');

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { proc, clients: existingClients, stopTimer: null, restarts: 0, startTime: Date.now() };
    this.active.set(camera.id, entry);

    proc.stdout.on('data', (chunk) => {
      for (const ws of entry.clients) {
        if (ws.readyState === 1) {
          ws.send(chunk, { binary: true }, (err) => {
            if (err) entry.clients.delete(ws);
          });
        } else {
          entry.clients.delete(ws);
        }
      }
    });

    proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.error('[Cam ' + camera.id + '] ffmpeg: ' + msg);
    });

    proc.on('close', (code) => {
      console.log('[Cam ' + camera.id + '] ffmpeg exited (code ' + code + ')');
      this.active.delete(camera.id);

      if (entry.clients.size === 0) return;

      const cam = db.prepare('SELECT * FROM cameras WHERE id = ? AND enabled = 1').get(camera.id);
      if (!cam) { entry.clients.forEach(ws => ws.close()); return; }

      const restarts = entry.restarts;
      if (restarts >= 10) { entry.clients.forEach(ws => ws.close()); return; }

      const delay = Math.min(1000 * (restarts + 1), 15000);
      console.log('[Cam ' + camera.id + '] Restart in ' + delay + 'ms (attempt ' + (restarts + 1) + ')');
      setTimeout(() => {
        if (entry.clients.size > 0) {
          const newEntry = this.startStream(cam, entry.clients);
          if (newEntry) newEntry.restarts = restarts + 1;
        }
      }, delay);
    });

    proc.on('error', (err) => {
      console.error('[Cam ' + camera.id + '] spawn error: ' + err.message);
    });

    return entry;
  }

  addClient(cameraId, ws) {
    const camera = db.prepare('SELECT * FROM cameras WHERE id = ? AND enabled = 1').get(cameraId);
    if (!camera) { ws.close(4404, 'Not found'); return; }

    let entry = this.active.get(cameraId);
    if (!entry) entry = this.startStream(camera);

    if (entry.stopTimer) {
      clearTimeout(entry.stopTimer);
      entry.stopTimer = null;
    }

    entry.clients.add(ws);

    ws.on('close', () => {
      const currentEntry = this.active.get(cameraId);
      if (!currentEntry) return;
      currentEntry.clients.delete(ws);
      if (currentEntry.clients.size === 0) {
        currentEntry.stopTimer = setTimeout(() => {
          if (this.active.get(cameraId)?.clients.size === 0) {
            this.stopStream(cameraId);
          }
        }, 30000);
      }
    });
  }

  stopStream(id) {
    const entry = this.active.get(id);
    if (!entry) return;
    if (entry.stopTimer) clearTimeout(entry.stopTimer);
    try { entry.proc.kill('SIGTERM'); } catch {}
    entry.clients.forEach(ws => { try { ws.close(); } catch {} });
    this.active.delete(id);
    console.log('[Cam ' + id + '] Stopped');
  }

  isActive(id) { return this.active.has(id); }
  clientCount(id) { return this.active.get(id)?.clients.size || 0; }
  stopAll() { [...this.active.keys()].forEach(id => this.stopStream(id)); }
}

const streamManager = new StreamManager();
const audioStreamManager = new StreamManager({ withAudio: true });

// ─── WebSocket upgrade handler ────────────────────────────────────────────────

server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    const videoMatch = url.pathname.match(/^\/ws\/stream\/(\d+)$/);
    const audioMatch = url.pathname.match(/^\/ws\/audio\/(\d+)$/);
    const match = videoMatch || audioMatch;

    if (!match) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    let userId = wsTokens.get(token);
    if (!userId) {
      await applySession(req);
      userId = req.session?.userId;
    }

    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const cameraId = parseInt(match[1]);
      if (audioMatch) {
        audioStreamManager.addClient(cameraId, ws);
      } else {
        streamManager.addClient(cameraId, ws);
      }
    });
  } catch (err) {
    console.error('WS upgrade error:', err.message);
    socket.destroy();
  }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
  console.log('Shutting down...');
  streamManager.stopAll();
  audioStreamManager.stopAll();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
} catch {
  console.error('ERROR: ffmpeg not found in PATH. Please install ffmpeg.');
  process.exit(1);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Camera service: http://0.0.0.0:' + PORT);
});
