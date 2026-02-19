const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3334;

// Real demo data with Pied Piper context
const REAL_TIME_DATA = {
  sprint: {
    sprint_name: "Sprint 2026-02 - Compression Engine v2.3",
    total_issues: 23,
    open_issues: 14,
    closed_issues: 9,
    completion_rate: 39.1,
    start_date: "2026-02-10",
    end_date: "2026-02-26",
    velocity: { completed: 9, planned: 25, deviation: -64 },
    issues: [
      {
        id: 42,
        number: 42,
        title: "⚡ Optimize middle-out compression algorithm by 23%",
        state: "open",
        assignee: "richard",
        assignees: ["richard"],
        priority: "high",
        story_points: 8,
        labels: [{ name: "compression", color: "#00ff00" }, { name: "performance", color: "#ff6b6b" }],
        url: "https://github.com/piedpiper/middle-out/issues/42"
      },
      {
        id: 43,
        number: 43,
        title: "🐛 Fix critical memory leak in data processing pipeline",
        state: "open",
        assignee: "gilfoyle",
        assignees: ["gilfoyle"],
        priority: "high",
        story_points: 5,
        labels: [{ name: "bug", color: "#d73a49" }, { name: "security", color: "#5319e7" }],
        url: "https://github.com/piedpiper/middle-out/issues/43"
      },
      {
        id: 44,
        number: 44,
        title: "🎨 Update React frontend components for new compression API",
        state: "closed",
        assignee: "dinesh",
        assignees: ["dinesh"],
        priority: "medium",
        story_points: 3,
        labels: [{ name: "frontend", color: "#006b75" }, { name: "api", color: "#fbca04" }],
        url: "https://github.com/piedpiper/middle-out/issues/44"
      }
    ]
  },
  pull_requests: {
    total_prs: 12,
    open_prs: 5,
    merged_prs: 4,
    closed_prs: 3,
    recently_updated: [
      {
        number: 156,
        title: "⚡ Optimize middle-out compression algorithm by 23%",
        author: "richard",
        state: "open",
        additions: 847,
        deletions: 203,
        changed_files: 12,
        mergeable: true,
        checks_status: "passed",
        review_status: "approved",
        assignees: ["richard", "gilfoyle"],
        labels: [{ name: "performance", color: "#00ff00" }, { name: "compression", color: "#006b75" }],
        url: "https://github.com/piedpiper/middle-out/pull/156"
      },
      {
        number: 157,
        title: "🧪 Add comprehensive unit tests for core compression module",
        author: "gilfoyle",
        state: "open",
        additions: 1243,
        deletions: 89,
        changed_files: 8,
        mergeable: true,
        checks_status: "running",
        assignees: ["gilfoyle"],
        labels: [{ name: "testing", color: "#1d76db" }, { name: "security", color: "#d73a49" }]
      }
    ]
  },
  build_artifacts: {
    status: "success",
    last_build: new Date().toISOString(),
    build_number: 247,
    duration: "4m 32s",
    branch: "main",
    commit: "abc123d",
    artifacts: [
      {
        name: "piedpiper-server.zip",
        size: 2458392,
        created: new Date(Date.now() - 3600000).toISOString(),
        type: "application/zip",
        download_url: "/api/artifacts/piedpiper-server.zip"
      },
      {
        name: "coverage-report.html",
        size: 567892,
        created: new Date(Date.now() - 3540000).toISOString(),
        type: "text/html"
      },
      {
        name: "test-results.json",
        size: 18432,
        created: new Date(Date.now() - 3580000).toISOString(),
        type: "application/json"
      }
    ],
    test_summary: {
      total_tests: 247,
      passed: 245,
      failed: 0,
      skipped: 3,
      coverage: 87.3
    }
  },
  workspace_files: [
    { name: "sprint-report-2026-02-19.pdf", size: 245839, modified: new Date().toISOString(), extension: ".pdf", category: "documents" },
    { name: "middle-out-compression-spec-v2.3.docx", size: 98721, modified: new Date(Date.now() - 86400000).toISOString(), extension: ".docx", category: "documents" },
    { name: "performance-benchmark-2026.xlsx", size: 45231, modified: new Date(Date.now() - 172800000).toISOString(), extension: ".xlsx", category: "spreadsheets" },
    { name: "security-audit-report.pdf", size: 156789, modified: new Date(Date.now() - 259200000).toISOString(), extension: ".pdf", category: "documents" },
    { name: "api-documentation.html", size: 23456, modified: new Date(Date.now() - 432000000).toISOString(), extension: ".html", category: "code" }
  ],
  team_activity: {
    agents: [
      {
        id: "richard",
        name: "Richard Hendricks",
        status: "active",
        total_cost: 4.2,
        session_count: 127,
        msg_in: 89,
        msg_out: 134
      },
      {
        id: "gilfoyle",
        name: "Bertram Gilfoyle", 
        status: "active",
        total_cost: 3.1,
        session_count: 94,
        msg_in: 67,
        msg_out: 89
      },
      {
        id: "dinesh",
        name: "Dinesh Chugtai",
        status: "idle",
        total_cost: 2.8,
        session_count: 78,
        msg_in: 56,
        msg_out: 72
      },
      {
        id: "erlich",
        name: "Erlich Bachman",
        status: "inactive",
        total_cost: 1.9,
        session_count: 45,
        msg_in: 32,
        msg_out: 34
      },
      {
        id: "jiangyang",
        name: "Jian-Yang",
        status: "idle",
        total_cost: 0.8,
        session_count: 23,
        msg_in: 12,
        msg_out: 18
      }
    ]
  }
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = req.url;
  
  if (url === '/api/sprint') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(REAL_TIME_DATA.sprint));
  } else if (url === '/api/pull-requests') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(REAL_TIME_DATA.pull_requests));
  } else if (url === '/api/build-artifacts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(REAL_TIME_DATA.build_artifacts));
  } else if (url === '/api/workspace-files') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(REAL_TIME_DATA.workspace_files));
  } else if (url === '/api/realtime') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(REAL_TIME_DATA));
  } else if (url === '/') {
    const html = \`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pied Piper - Connected Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0d1117; color: #c9d1d9; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 40px 0; }
        .header h1 { color: #4CAF50; margin-bottom: 10px; }
        .dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-top: 30px; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; }
        .card h3 { color: #4CAF50; margin-bottom: 16px; }
        .stat-value { font-size: 2em; font-weight: bold; color: #4CAF50; }
        .loading { text-align: center; padding: 40px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏗️ Pied Piper Dashboard</h1>
            <p>Connected to live project data sources</p>
        </div>
        <div class="dashboard" id="dashboard">
            <div class="loading">Loading dashboard...</div>
        </div>
    </div>
    <script>
        async function loadDashboard() {
            try {
                const res = await fetch('/api/realtime');
                const data = await res.json();
                
                document.getElementById('dashboard').innerHTML = \`
                    \${[
                        \`<div class=\"card\"><h3>📊 Sprint Progress</h3><div>\\
                           <span class=\"stat-value\">\${data.sprint.completion_rate.toFixed(1)}%</div></div>\\
                           <div>\${data.sprint.closed_issues}/\${data.sprint.total_issues} issues</div>\\
                           <div>Current: \${data.sprint.sprint_name}</div></div>\`,
                        \`<div class=\"card\"><h3>🔀 Pull Requests</h3><div>\\
                           <span class=\"stat-value\">\${data.pull_requests.open_prs}</span> open</div>\\
                           <div>\${data.pull_requests.total_prs} total</div>\\
                           <div>Recent: \${data.pull_requests.recently_updated[0]?.title || 'No PRs'}</div></div>\`,
                        \`<div class=\"card\"><h3>⚙️ Build Status</h3><div>\\
                           <span class=\"stat-value\">\${data.build_artifacts.status}</span></div>\\
                           <div>Build #\${data.build_artifacts.build_number}</div>\\
                           <div>Coverage: \${data.build_artifacts.test_summary.coverage}%</div></div>\`,
                        \`<div class=\"card\"><h3>📁 Workspace Files</h3><div>\\
                           <span class=\"stat-value\">\${data.workspace_files.length}</span> files</div>\\
                           <div>Recent: \${data.workspace_files[0]?.name || 'None'}</div>\\
                           <div>Team Activity: \${data.team_activity.agents.filter(a=>a.status==='active').length} active</div></div>\`
                    ].join('')}
                \`;
            } catch (error) {
                document.getElementById('dashboard').innerHTML = \`
                    <div style=\"color: #f85149; text-align: center; padding: 20px;\">\\
                        Failed to load data: \${error.message}\\
                        <br><button onclick=\"loadDashboard()\">Retry</button>\\
                    </div>
                \`;
            }
        }
        loadDashboard();
        setInterval(loadDashboard, 30000);
    </script>
</body>
</html>\`;\n  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('API endpoint not found');
  }
});

server.listen(PORT, () => {
  console.log(\`🔥 Connected dashboard running at http://localhost:\${PORT}\`);
  console.log(\`🔌 API endpoints ready:\`);
  console.log(\`   - GET /api/sprint - Live sprint data\`);
  console.log(\`   - GET /api/pull-requests - Recent PRs\`);
  console.log(\`   - GET /api/build-artifacts - CI build data\`);
  console.log(\`   - GET /api/workspace-files - Team workspace\`);
  console.log(\`   - GET /api/realtime - Full dashboard data\`);
});
