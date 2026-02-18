# 🔥 Pied Piper Agent Dashboard

Real-time monitoring dashboard for the Pied Piper AI agent team.

## Quick Start

```bash
cd dashboard
pip install -r requirements.txt
python app.py
```

Open **http://localhost:5123** in your browser.

## Features

- **Team totals** — combined cost, tokens, messages
- **Per-agent cards** — individual stats with model info and last active time
- **Cost breakdown chart** — bar chart of spending per agent
- **Token usage over time** — line chart of token consumption
- **Activity timeline** — last 20 messages across all agents
- **Auto-refresh** every 30 seconds

## Configuration

Set `AGENTS_DIR` environment variable to override the default agents directory:

```bash
AGENTS_DIR=/path/to/agents python app.py
```
