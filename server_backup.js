const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3333;
const AGENTS_DIR = '/Users/anton/.openclaw/agents';
const AGENT_NAMES = ['richard', 'dinesh', 'gilfoyle', 'erlich', 'jiangyang'];

const AGENT_DISPLAY = {
  richard: 'Richard Hendricks',
  dinesh: 'Dinesh Chugtai',
  gilfoyle: 'Bertram Gilfoyle',
  erlich: 'Erlich Bachman',
  jiangyang: 'Jian-Yang'
};

// Auth config
const AUTH_USER = 'piedpiper';
const AUTH_PASS = 'middleout2026';
const SESSION_SECRET = '89c06c5b345b6a73b9ddc82c9f97a2d7ee977ae0128c80570d67255a04823472';
const activeSessions = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function checkAuth(req, res) {
  const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    if (k) acc[k] = v;
    return acc;
  }, {});
  if (cookies.session && activeSessions.has(cookies.session)) return true;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');
  if (token && activeSessions.has(token)) return true;
  return false;
}

function serveLogin(res, error) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pied Piper Dashboard — Login</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0d1117; color:#c9d1d9; font-family:-apple-system,BlinkMacSystemFont,sans-serif;
    display:flex; justify-content:center; align-items:center; min-height:100vh; }
  .login { background:#161b22; border:1px solid #30363d; border-radius:12px; padding:40px; width:360px; }
  .login h1 { color:#4CAF50; font-size:24px; margin-bottom:8px; text-align:center; }
  .login p { color:#8b949e; font-size:14px; margin-bottom:24px; text-align:center; }
  .login label { display:block; font-size:13px; color:#8b949e; margin-bottom:4px; }
  .login input { width:100%; padding:10px 12px; background:#0d1117; border:1px solid #30363d;
    border-radius:6px; color:#c9d1d9; font-size:14px; margin-bottom:16px; }
  .login input:focus { outline:none; border-color:#4CAF50; }
  .login button { width:100%; padding:10px; background:#4CAF50; color:#fff; border:none;
    border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; }
  .login button:hover { background:#45a049; }
  .error { color:#f85149; font-size:13px; text-align:center; margin-bottom:12px; }
</style></head><body>
<div class="login">
  <h1>🔐 Pied Piper</h1>
  <p>Team Dashboard</p>
  ${error ? '<div class="error">Invalid credentials</div>' : ''}
  <form method="POST" action="/login">
    <label>Username</label><input name="username" autofocus>
    <label>Password</label><input name="password" type="password">
    <button type="submit">Sign In</button>
  </form>
</div></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function getSessionType(key) {
  if (key.includes(':subagent:')) return 'subagent';
  if (key.includes(':thread:')) return 'thread';
  if (key.includes(':cron:')) return 'cron';
  if (key.includes(':slack:')) return 'slack';
  return 'main';
}

function getChannelFromKey(key) {
  if (key.includes(':slack:')) return 'slack';
  if (key.includes(':discord:')) return 'discord';
  if (key.includes(':telegram:')) return 'telegram';
  if (key.includes(':cron:')) return 'cron';
  if (key.includes(':subagent:')) return 'subagent';
  return 'unknown';
}

function readJsonlMessages(filePath, agentName) {
  const messages = [];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    for (const line of lines) {
      try {
        const o = JSON.parse(line);
        if (o.type === 'user' || o.type === 'assistant') {
          let preview = '';
          if (typeof o.content === 'string') preview = o.content.slice(0, 200);
          else if (Array.isArray(o.content)) {
            const textPart = o.content.find(p => p.type === 'text');
            if (textPart) preview = (textPart.text || '').slice(0, 200);
          }
          messages.push({
            agent_id: agentName,
            agent: AGENT_DISPLAY[agentName] || agentName,
            direction: o.type === 'user' ? 'in' : 'out',
            preview,
            timestamp: o.timestamp || o.ts || Date.now()
          });
        }
      } catch {}
    }
  } catch {}
  return messages;
}

function countJsonlMessages(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim().split('\n').filter(l => {
      try { const o = JSON.parse(l); return o.type === 'user' || o.type === 'assistant'; } catch { return false; }
    }).length;
  } catch { return 0; }
}

function readAgentData(agentName) {
  const sessionsFile = path.join(AGENTS_DIR, agentName, 'sessions', 'sessions.json');
  let sessions = {};
  try { sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8')); } catch { return null; }

  const sessionsDir = path.join(AGENTS_DIR, agentName, 'sessions');
  let totalTokens = 0, inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, sessionCount = 0;
  let latestUpdate = 0;
  const sessionTypes = {};
  const sessionList = [];
  const channels = new Set();
  let allMessages = [];
  let msgIn = 0, msgOut = 0;

  for (const [key, s] of Object.entries(sessions)) {
    sessionCount++;
    totalTokens += s.totalTokens || 0;
    inputTokens += s.inputTokens || 0;
    outputTokens += s.outputTokens || 0;
    cacheReadTokens += s.cacheReadTokens || 0;
    if (s.updatedAt > latestUpdate) latestUpdate = s.updatedAt;

    const sType = getSessionType(key);
    sessionTypes[sType] = (sessionTypes[sType] || 0) + 1;
    const channel = getChannelFromKey(key);
    channels.add(channel);

    let messageCount = 0;
    if (s.sessionId) {
      const jsonlPath = path.join(sessionsDir, s.sessionId + '.jsonl');
      messageCount = countJsonlMessages(jsonlPath);
      const msgs = readJsonlMessages(jsonlPath, agentName);
      msgs.forEach(m => {
        if (m.direction === 'in') msgIn++;
        else msgOut++;
      });
      allMessages = allMessages.concat(msgs);
    }

    sessionList.push({
      sessionKey: key,
      sessionId: s.sessionId,
      totalTokens: s.totalTokens || 0,
      inputTokens: s.inputTokens || 0,
      outputTokens: s.outputTokens || 0,
      updatedAt: s.updatedAt,
      model: s.model || 'unknown',
      contextTokens: s.contextTokens || 0,
      type: sType,
      messageCount,
      channel
    });
  }

  const inputCost = (inputTokens / 1e6) * 15;
  const outputCost = (outputTokens / 1e6) * 75;
  const cacheCost = (cacheReadTokens / 1e6) * 1.5;

  return {
    id: agentName,
    name: AGENT_DISPLAY[agentName] || agentName,
    total_input: inputTokens,
    total_output: outputTokens,
    total_cache_read: cacheReadTokens,
    total_cost: inputCost + outputCost + cacheCost,
    session_count: sessionCount,
    status: (Date.now() - latestUpdate) < 300000 ? 'active' : (Date.now() - latestUpdate) < 3600000 ? 'idle' : 'inactive',
    msg_in: msgIn,
    msg_out: msgOut,
    context_used: sessionList[0]?.contextTokens || 0,
    context_max: 200000,
    model: sessionList[0]?.model || 'unknown',
    channels: [...channels],
    last_active: latestUpdate,
    sessions: sessionList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    messages: allMessages
  };
}

function buildFullData() {
  const agentsData = AGENT_NAMES.map(readAgentData).filter(Boolean);

  // Build flat sessions list for the session table
  const sessions = [];
  agentsData.forEach(a => {
    a.sessions.forEach(s => {
      sessions.push({
        agent_id: a.id,
        agent: a.name,
        key: s.sessionKey,
        channel: s.channel,
        updated_at: s.updatedAt,
        tokens: s.totalTokens,
        type: s.type
      });
    });
  });
  sessions.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));

  // Collect all messages
  let allMessages = [];
  agentsData.forEach(a => {
    allMessages = allMessages.concat(a.messages || []);
  });
  allMessages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // Timeline = recent messages
  const timeline = allMessages.slice(0, 50);

  // Cron runs
  const cronRuns = [];
  agentsData.forEach(a => {
    a.sessions.filter(s => s.type === 'cron').forEach(s => {
      cronRuns.push({
        agent_id: a.id,
        agent: a.name,
        status: 'success',
        summary: `Cron session for ${a.name}`,
        ts: s.updatedAt,
        durationMs: null
      });
    });
  });
  cronRuns.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // Strip messages from agent objects to avoid duplication
  const agents = agentsData.map(a => {
    const { messages, sessions, ...rest } = a;
    return rest;
  });

  return {
    agents,
    sessions: sessions.slice(0, 100),
    messages: allMessages.slice(0, 100),
    timeline: timeline.slice(0, 50),
    cron_runs: cronRuns.slice(0, 20),
    generated_at: new Date().toISOString()
  };
}

// ─── Shared Drive (uploads) ───
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Auto-upload directory for team work
const WORKSPACE_DIR = path.join(__dirname, 'shared-workspace');
if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

const MIME_TYPES = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.csv': 'text/csv', '.md': 'text/markdown',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.zip': 'application/zip', '.json': 'application/json',
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript'
};

function getFileIcon(ext) {
  if (['.pdf'].includes(ext)) return '📕';
  if (['.doc','.docx'].includes(ext)) return '📄';
  if (['.xls','.xlsx','.csv'].includes(ext)) return '📊';
  if (['.ppt','.pptx'].includes(ext)) return '📽️';
  if (['.png','.jpg','.jpeg','.gif','.svg','.webp'].includes(ext)) return '🖼️';
  if (['.zip'].includes(ext)) return '📦';
  if (['.md','.txt'].includes(ext)) return '📝';
  if (['.json','.js','.html','.css'].includes(ext)) return '💻';
  return '📎';
}

function listFiles() {
  const allFiles = [];
  const dirs = [UPLOADS_DIR, WORKSPACE_DIR];
  
  dirs.forEach(dir => {
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
        files.forEach(f => {
          const stat = fs.statSync(path.join(dir, f));
          if (stat.isFile()) {
            const ext = path.extname(f).toLowerCase();
            allFiles.push({
              name: f,
              size: stat.size,
              modified: stat.mtimeMs,
              ext,
              icon: getFileIcon(ext),
              mime: MIME_TYPES[ext] || 'application/octet-stream',
              source: dir === UPLOADS_DIR ? 'manual' : 'auto'
            });
          }
        });
      }
    } catch (err) { console.error(`Error reading ${dir}:`, err); }
  });
  
  return allFiles.sort((a, b) => b.modified - a.modified);
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const boundary = req.headers['content-type']?.match(/boundary=(.+)/)?.[1];
    if (!boundary) return reject(new Error('No boundary'));
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const boundaryBuf = Buffer.from('--' + boundary);
      const parts = [];
      let start = 0;
      while (true) {
        const idx = buf.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        if (start > 0) {
          const partBuf = buf.slice(start, idx);
          const headerEnd = partBuf.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            const headers = partBuf.slice(0, headerEnd).toString();
            const body = partBuf.slice(headerEnd + 4, partBuf.length - 2); // trim trailing \r\n
            const nameMatch = headers.match(/name="([^"]+)"/);
            const fileMatch = headers.match(/filename="([^"]+)"/);
            if (nameMatch) {
              parts.push({
                name: nameMatch[1],
                filename: fileMatch ? fileMatch[1] : null,
                data: body
              });
            }
          }
        }
        start = idx + boundaryBuf.length + 2; // skip \r\n
      }
      resolve(parts);
    });
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Login endpoint
  if (req.method === 'POST' && url.pathname === '/login') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const user = params.get('username');
      const pass = params.get('password');
      if (user === AUTH_USER && pass === AUTH_PASS) {
        const token = generateToken();
        activeSessions.add(token);
        res.writeHead(302, {
          'Set-Cookie': `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
          'Location': '/'
        });
        res.end();
      } else {
        serveLogin(res, true);
      }
    });
    return;
  }

  // Logout
  if (req.method === 'GET' && url.pathname === '/logout') {
    const cookies = (req.headers.cookie || '').split(';').reduce((acc, c) => {
      const [k, v] = c.trim().split('=');
      if (k) acc[k] = v;
      return acc;
    }, {});
    if (cookies.session) activeSessions.delete(cookies.session);
    res.writeHead(302, {
      'Set-Cookie': 'session=; Path=/; Max-Age=0',
      'Location': '/login'
    });
    res.end();
    return;
  }

  // Login page
  if (req.method === 'GET' && url.pathname === '/login') {
    serveLogin(res, false);
    return;
  }

  // Everything else requires auth
  if (!checkAuth(req, res)) {
    res.writeHead(302, { 'Location': '/login' });
    res.end();
    return;
  }

  // ─── Shared Drive API ───
  if (req.method === 'GET' && url.pathname === '/api/files') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ files: listFiles() }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/files/upload') {
    parseMultipart(req).then(parts => {
      const uploaded = [];
      for (const part of parts) {
        if (part.filename && part.data.length > 0) {
          // Sanitize filename
          const safeName = part.filename.replace(/[^a-zA-Z0-9._\-() ]/g, '_').slice(0, 200);
          
          // Categorize files
          const ext = path.extname(safeName).toLowerCase();
          const categoryDir = path.join(UPLOADS_DIR, getFileCategory(ext));
          if (!fs.existsSync(categoryDir)) fs.mkdirSync(categoryDir, { recursive: true });
          
          // Save to appropriate category
          const dest = path.join(categoryDir, safeName);
          fs.writeFileSync(dest, part.data);
          
          // Also save to shared workspace for team access
          const sharedDest = path.join(WORKSPACE_DIR, safeName);
          fs.writeFileSync(sharedDest, part.data);
          
          uploaded.push({ name: safeName, category: getFileCategory(ext) });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, uploaded }));
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/files/download/')) {
    const filename = decodeURIComponent(url.pathname.replace('/api/files/download/', ''));
    const safeName = path.basename(filename);
    const filePath = path.join(UPLOADS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(safeName).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length': stat.size
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/files/')) {
    const filename = decodeURIComponent(url.pathname.replace('/api/files/', ''));
    const safeName = path.basename(filename);
    const filePath = path.join(UPLOADS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    fs.unlinkSync(filePath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/api/data' || url.pathname === '/api/agents')) {
    const data = buildFullData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    // File management endpoints
  } else if (req.method === 'GET' && url.pathname === '/api/files') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listFiles()));
  } else if (req.method === 'POST' && url.pathname.startsWith('/api/upload')) {
    parseMultipart(req).then(parts => {
      const filePart = parts.find(p => p.name === 'file');
      if (!filePart || !filePart.filename) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'No file uploaded' }));
        return;
      }
      
      const filename = filePart.filename;
      const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const uniqueName = `${Date.now()}-${safeName}`;
      const filepath = path.join(UPLOADS_DIR, uniqueName);
      
      fs.writeFileSync(filepath, filePart.data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, filename: uniqueName }));
    }).catch(err => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    });
  } else if (req.method === 'GET' && url.pathname === '/api/download') {
    const filename = url.searchParams.get('file');
    if (!filename) {
      res.writeHead(400);
      res.end('Missing filename');
      return;
    }
    
    // Check both directories
    const possiblePaths = [
      path.join(UPLOADS_DIR, filename),
      path.join(WORKSPACE_DIR, filename)
    ];
    
    const filepath = possiblePaths.find(p => fs.existsSync(p));
    if (!filepath) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    fs.createReadStream(filepath).pipe(res);
  } else if (req.method === 'DELETE' && url.pathname.startsWith('/api/delete')) {
    const filename = url.searchParams.get('file');
    if (!filename) {
      res.writeHead(400);
      res.end('Missing filename');
      return;
    }
    
    const possiblePaths = [
      path.join(UPLOADS_DIR, filename),
      path.join(WORKSPACE_DIR, filename)
    ];
    
    const filepath = possiblePaths.find(p => fs.existsSync(p));
    if (!filepath) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    fs.unlinkSync(filepath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));  
  } else if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const htmlPath = path.join(__dirname, 'index.html');
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => console.log(`Dashboard running at http://localhost:${PORT}`));
