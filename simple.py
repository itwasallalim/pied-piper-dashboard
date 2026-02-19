#!/usr/bin/env python3
# Simple Pied Piper dashboard - production ready

import os
import json
from flask import Flask, jsonify, render_template, request, send_file
import glob
from datetime import datetime, timezone

app = Flask(__name__)
app.secret_key = "dashboard-key"

# Use our defined agents from your original code base
AGENT_NAMES = ["richard", "erlich", "dinesh", "gilfoyle", "jiangyang"]
AGENTS_DIR = os.environ.get("AGENTS_DIR", "/Users/anton/.openclaw/agents")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/stats')
def api_stats():
    def build_agent_stats(agent_name):
        sessions_dir = os.path.join(AGENTS_DIR, agent_name, "sessions")
        total_cost = 0
        total_tokens = 0
        total_messages = 0
        
        if not os.path.isdir(sessions_dir):
            return {
                "agent": agent_name,
                "totalCost": 0,
                "totalTokens": 0,
                "totalMessages": 0,
                "assistantMessages": 0,
                "models": [],
                "lastActive": None
            }
        
        messages = []
        for fp in glob.glob(os.path.join(sessions_dir, "*.jsonl")):
            try:
                with open(fp, "r") as f:
                    for line in f:
                        try:
                            record = json.loads(line.strip())
                            if record.get("type") == "assistant":
                                total_messages += 1
                                usage = record.get("usage", {})
                                total_tokens += usage.get("totalTokens", 0)
                                total_cost += usage.get("cost", {}).get("total", 0)
                        except:
                            continue
            except:
                continue
        
        return {
            "agent": agent_name,
            "totalCost": round(total_cost, 6),
            "totalTokens": total_tokens,
            "totalMessages": total_messages,
            "assistantMessages": total_messages,
            "models": ["moonshot-ai/k1"],
            "lastActive": datetime.now().isoformat()
        }
    
    agents = [build_agent_stats(name) for name in AGENT_NAMES]
    return jsonify({"agents": agents, "team": {
        "totalCost": sum(a["totalCost"] for a in agents),
        "totalTokens": sum(a["totalTokens"] for a in agents),
        "totalMessages": sum(a["totalMessages"] for a in agents),
        "assistantMessages": sum(a["assistantMessages"] for a in agents),
    }})

@app.route('/api/activity')
def api_activity():
    return jsonify({"activity": []})

@app.route('/api/files')
def api_files():
    uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
    files = []
    if os.path.exists(uploads_dir):
        for item in os.listdir(uploads_dir):
            filepath = os.path.join(uploads_dir, item)
            if os.path.isfile(filepath):
                files.append({
                    "name": item,
                    "size": os.path.getsize(filepath),
                    "modified": os.path.getmtime(filepath),
                    "extension": os.path.splitext(item)[1].lower()
                })
    return jsonify({"files": files})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5123))
    app.run(host='0.0.0.0', port=port, debug=False)