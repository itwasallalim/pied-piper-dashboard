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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

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

  if (req.method === 'GET' && (url.pathname === '/api/data' || url.pathname === '/api/agents')) {
    const data = buildFullData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
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
