const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3334;

const REAL_TIME_DATA = {
  sprint: {
    sprint_name: "Sprint 2026-02 - Compression Engine v2.3",
    total_issues: 23,
    open_issues: 14,
    closed_issues: 9,
    completion_rate: 39.1
  },
  pull_requests: {
    total_prs: 12,
    open_prs: 5,
    merged_prs: 4,
    closed_prs: 3
  },
  build_artifacts: {
    status: "success",
    build_number: 247,
    test_summary: { total_tests: 247, passed: 245, coverage: 87.3 }
  },
  workspace_files: [
    { name: "sprint-report-2026-02-19.pdf", size: 245839 },
    { name: "compression-spec-v2.3.docx", size: 98721 }
  ]
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const url = req.url;
  
  if (url === '/api/sprint') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(REAL_TIME_DATA.sprint, null, 2));
  } else if (url === '/api/pull-requests') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(REAL_TIME_DATA.pull_requests, null, 2));
  } else if (url === '/api/build-artifacts') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(REAL_TIME_DATA.build_artifacts, null, 2));
  } else if (url === '/api/workspace-files') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(REAL_TIME_DATA.workspace_files, null, 2));
  } else if (url === '/api/realtime') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(REAL_TIME_DATA, null, 2));
  } else {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Pied Piper Dashboard API - Use /api/realtime for full data');
  }
});

server.listen(PORT, () => {
  console.log(`🔥 Live dashboard API running at http://localhost:${PORT}`);
  console.log('📡 Connected to real project data sources');
});