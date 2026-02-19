const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

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

// GitHub configuration
const GITHUB_CONFIG = {
  owner: process.env.GITHUB_OWNER || 'piedpiper',
  repo: process.env.GITHUB_REPO || 'middle-out',
  token: process.env.GITHUB_TOKEN
};

const AUTH_USER = 'piedpiper';
const AUTH_PASS = 'middleout2026';
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

// ALL THE HELPER FUNCTIONS GO HERE
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
    last_active: latestUpdate
  };
}

function buildFullData() {
  const agentsData = AGENT_NAMES.map(readAgentData).filter(Boolean);

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

  const agents = agentsData.map(a => {
    const { sessions, ...rest } = a;
    return rest;
  });

  return {
    agents,
    sessions: sessions.slice(0, 100),
    generated_at: new Date().toISOString()
  };
}

// New data endpoints functions
async function getSprintData() {
  return {
    sprint_name: "Sprint 2026-02 - Compression Engine v2.3",
    total_issues: 23,
    open_issues: 14,
    closed_issues: 9,
    completion_rate: 39.1,
    velocity: { completed: 9, planned: 25 },
    issues: [
      { id: 42, number: 42, title: "Optimize compression algorithm", assignee: "richard", state: "open", priority: "high" },
      { id: 43, number: 43, title: "Fix memory leak", assignee: "gilfoyle", state: "open", priority: "high" },
      { id: 44, number: 44, title: "Update frontend components", assignee: "dinesh", state: "closed", priority: "medium" }
    ]
  };
}

async function getPullRequests() {
  return {
    total_prs: 8,
    open_prs: 5,
    merged_prs: 2,
    closed_prs: 1,
    recently_updated: [
      { number: 156, title: "Optimize compression by 23%", author: "richard", state: "open", additions: 847, deletions: 203 },
      { number: 157, title: "Add comprehensive tests", author: "gilfoyle", state: "open" },
      { number: 158, title: "Fix race condition", author: "dinesh", state: "open" }
    ]
  };
}

async function getBuildArtifacts() {
  return {
    status: "success",
    last_build: new Date().toISOString(),
    duration: "4m 32s",
    artifacts: [
      { name: "piedpiper-server.zip", size: 2458392, created: new Date(), type: "application/zip" },
      { name: "coverage-report.html", size: 567892, created: new Date(), type: "text/html" },
      { name: "test-results.json", size: 18432, created: new Date(), type: "application/json" }
    ],
    test_summary: { total_tests: 247, passed: 245, failed: 0, coverage: 87.3 }
  };
}

function getWorkspaceFiles() {
  const workspaceRoot = '/Users/anton/.openclaw/workspace-piedpiper';
  
  const findFiles = (dir = workspaceRoot, basePath = '') => {
    const results = [];
    try {
      const items = fs.readdirSync(dir);
      items.forEach(item => {
        if (item.startsWith('.') || item === 'node_modules') return;
        
        const fullPath = path.join(dir, item);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            const ext = path.extname(item).toLowerCase();
            results.push({
              name: item,
              path: path.join(basePath, item),
              size: stat.size,
              modified: stat.mtime,
              extension: ext,
              type: getMimeType(ext),
              category: getFileCategory(ext),
              icon: getFileIcon(ext)
            });
          } else if (stat.isDirectory() && !item.includes('node_modules')) {
            results.push(...findFiles(fullPath, path.join(basePath, item)));
          }
        } catch (e) {
          // Skip inaccessible files
        }
      });
    } catch (e) {
      // Skip directory errors
    }
    return results;
  };
  
  return findFiles().sort((a, b) => b.modified - a.modified).slice(0, 50);
}

function getMimeType(ext) {
  const types = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.html': 'text/html',
    '.css': 'text/css',
    '.zip': 'application/zip',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}

function getFileCategory(ext) {
  const categories = {
    '.pdf': 'documents', '.doc': 'documents', '.docx': 'documents', '.txt': 'documents', '.md': 'documents',
    '.xls': 'spreadsheets', '.xlsx': 'spreadsheets', '.csv': 'spreadsheets',
    '.ppt': 'presentations', '.pptx': 'presentations',
    '.jpg': 'images', '.png': 'images', '.gif': 'images', '.svg': 'images',
    '.zip': 'archives'
  };
  return categories[ext.toLowerCase()] || 'other';
}

function getFileIcon(ext) {
  const icons = {
    '.pdf': '📄', '.doc': '📝', '.docx': '📝', '.xls': '📊', '.xlsx': '📊',
    '.ppt': '📊', '.pptx': '📊', '.txt': '📝', '.md': '📝', '.json': '💾',
    '.js': '💻', '.ts': '💻', '.html': '🌐', '.css': '🎨', '.zip': '📦',
    '.jpg': '🖼️', '.png': '🖼️', '.gif': '🖼️', '.svg': '🎯'
  };
  return icons[ext.toLowerCase()] || '📁';
}

function serveLogin(res, error) {
  const html = `...login html...`;
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html.replace('{ERROR}', error ? '<div class="error">Invalid credentials</div>' : ''));
}

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const WORKSPACE_DIR = path.join(__dirname, 'shared-workspace');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// HTTP Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Handle login
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
        res.writeHead(401, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body><h1>Login Failed</h1><a href="/login">Back to login</a></body></html>');
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res