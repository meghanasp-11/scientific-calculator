const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);
const DATA_DIR = path.join(ROOT, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]', 'utf8');

function readHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.slice(0, 60) : [];
  } catch {
    return [];
  }
}

function writeHistory(history) {
  const safe = Array.isArray(history) ? history.slice(0, 60) : [];
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const absolute = path.resolve(ROOT, relative);
  if (!absolute.startsWith(ROOT + path.sep)) return null;
  return absolute;
}

function serveFile(req, res) {
  const absolute = safePath(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  if (!absolute) return sendJson(res, 403, { error: 'Forbidden' });
  fs.stat(absolute, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { error: 'Not found' });
    const ext = path.extname(absolute).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(absolute).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/history' && req.method === 'GET') {
    return sendJson(res, 200, { history: readHistory() });
  }

  if (url.pathname === '/api/history' && req.method === 'DELETE') {
    writeHistory([]);
    return sendJson(res, 200, { history: [] });
  }

  if (url.pathname === '/api/history' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const history = writeHistory(parsed.history);
        sendJson(res, 200, { history });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON payload' });
      }
    });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveFile(req, res);
  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Calcula running at http://localhost:${PORT}`);
  console.log('History API: GET/POST/DELETE /api/history');
});
