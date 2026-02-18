#!/usr/bin/env python3
"""Pied Piper AI Agent Team Dashboard — Backend"""

import json
import glob
import os
import secrets
import functools
from datetime import datetime, timezone
from flask import Flask, jsonify, render_template, request, redirect, url_for, session, abort

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", secrets.token_hex(32))

AGENTS_DIR = os.environ.get("AGENTS_DIR", "/Users/anton/.openclaw/agents")
AGENT_NAMES = ["richard", "erlich", "dinesh", "gilfoyle", "jiangyang"]

# Auth credentials — change these or set via environment variables
DASHBOARD_USER = os.environ.get("DASHBOARD_USER", "piedpiper")
DASHBOARD_PASS = os.environ.get("DASHBOARD_PASS", "middleout2026")


def login_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("authenticated"):
            if request.path.startswith("/api/"):
                abort(401)
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


def parse_sessions(agent_name):
    """Parse all JSONL session files for an agent."""
    sessions_dir = os.path.join(AGENTS_DIR, agent_name, "sessions")
    messages = []
    if not os.path.isdir(sessions_dir):
        return messages
    for fp in glob.glob(os.path.join(sessions_dir, "*.jsonl")):
        with open(fp, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("type") == "message":
                    msg = rec.get("message", {})
                    messages.append({
                        "id": rec.get("id"),
                        "timestamp": rec.get("timestamp"),
                        "role": msg.get("role"),
                        "model": msg.get("model"),
                        "provider": msg.get("provider"),
                        "usage": msg.get("usage"),
                        "stopReason": msg.get("stopReason"),
                        "content_preview": _content_preview(msg.get("content")),
                    })
    return messages


def _content_preview(content):
    """Extract a short text preview from message content."""
    if isinstance(content, str):
        return content[:120]
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text", "").strip():
                text = block["text"].strip()
                if text:
                    return text[:120]
            if isinstance(block, dict) and block.get("type") == "toolCall":
                return f"🔧 {block.get('name', 'tool')}(…)"
    return ""


def build_agent_stats(agent_name):
    messages = parse_sessions(agent_name)
    assistant_msgs = [m for m in messages if m["role"] == "assistant" and m.get("usage")]
    total_input = sum(m["usage"].get("input", 0) or 0 for m in assistant_msgs)
    total_output = sum(m["usage"].get("output", 0) or 0 for m in assistant_msgs)
    total_cache_read = sum(m["usage"].get("cacheRead", 0) or 0 for m in assistant_msgs)
    total_cache_write = sum(m["usage"].get("cacheWrite", 0) or 0 for m in assistant_msgs)
    total_tokens = sum(m["usage"].get("totalTokens", 0) or 0 for m in assistant_msgs)
    total_cost = sum((m["usage"].get("cost") or {}).get("total", 0) or 0 for m in assistant_msgs)

    models = set(m.get("model") for m in assistant_msgs if m.get("model"))
    timestamps = [m["timestamp"] for m in messages if m.get("timestamp")]
    last_active = max(timestamps) if timestamps else None

    # Time series: bucket by hour
    time_series = {}
    for m in assistant_msgs:
        ts = m.get("timestamp", "")[:13]  # "2026-02-18T13"
        if ts:
            bucket = time_series.setdefault(ts, {"tokens": 0, "cost": 0, "messages": 0})
            bucket["tokens"] += m["usage"].get("totalTokens", 0) or 0
            bucket["cost"] += (m["usage"].get("cost") or {}).get("total", 0) or 0
            bucket["messages"] += 1

    return {
        "agent": agent_name,
        "totalMessages": len(messages),
        "assistantMessages": len(assistant_msgs),
        "tokensInput": total_input,
        "tokensOutput": total_output,
        "tokensCacheRead": total_cache_read,
        "tokensCacheWrite": total_cache_write,
        "totalTokens": total_tokens,
        "totalCost": round(total_cost, 6),
        "models": sorted(models),
        "lastActive": last_active,
        "timeSeries": time_series,
    }


def build_recent_activity(limit=20):
    all_msgs = []
    for agent in AGENT_NAMES:
        for m in parse_sessions(agent):
            if m.get("content_preview"):
                all_msgs.append({**m, "agent": agent})
    all_msgs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return all_msgs[:limit]


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        if (request.form.get("username") == DASHBOARD_USER and
                request.form.get("password") == DASHBOARD_PASS):
            session["authenticated"] = True
            return redirect(url_for("index"))
        error = "Invalid credentials"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


SPRINT_FILE = os.path.join(os.path.dirname(__file__), "sprint_data.json")


def load_sprint():
    if os.path.exists(SPRINT_FILE):
        with open(SPRINT_FILE, "r") as f:
            return json.load(f)
    return {"backlog": [], "inprogress": [], "done": []}


def save_sprint(data):
    with open(SPRINT_FILE, "w") as f:
        json.dump(data, f, indent=2)


@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/team")
@login_required
def team():
    return render_template("team.html")


@app.route("/sprint")
@login_required
def sprint():
    return render_template("sprint.html")


@app.route("/api/sprint", methods=["GET"])
@login_required
def api_sprint_get():
    return jsonify(load_sprint())


@app.route("/api/sprint", methods=["POST"])
@login_required
def api_sprint_post():
    data = request.get_json(force=True)
    save_sprint(data)
    return jsonify({"ok": True})


@app.route("/api/stats")
@login_required
def api_stats():
    agents = [build_agent_stats(name) for name in AGENT_NAMES]
    team = {
        "totalCost": round(sum(a["totalCost"] for a in agents), 6),
        "totalTokens": sum(a["totalTokens"] for a in agents),
        "totalMessages": sum(a["totalMessages"] for a in agents),
        "assistantMessages": sum(a["assistantMessages"] for a in agents),
    }
    return jsonify({"agents": agents, "team": team})


@app.route("/api/activity")
@login_required
def api_activity():
    return jsonify({"activity": build_recent_activity(20)})


# --- Sprint Board API ---
SPRINTS_FILE = os.path.join(os.path.dirname(__file__), "sprints.json")


def _load_sprints():
    if not os.path.exists(SPRINTS_FILE):
        return []
    with open(SPRINTS_FILE, "r") as f:
        return json.load(f)


def _save_sprints(data):
    with open(SPRINTS_FILE, "w") as f:
        json.dump(data, f, indent=2)


@app.route("/api/sprints", methods=["GET"])
@login_required
def api_sprints_get():
    return jsonify({"tasks": _load_sprints()})


@app.route("/api/sprints", methods=["POST"])
@login_required
def api_sprints_create():
    body = request.get_json(force=True)
    tasks = _load_sprints()
    new_id = max((t["id"] for t in tasks), default=0) + 1
    task = {
        "id": new_id,
        "title": body.get("title", "Untitled"),
        "description": body.get("description", ""),
        "assignee": body.get("assignee", "richard"),
        "status": body.get("status", "backlog"),
        "created": datetime.now(timezone.utc).isoformat(),
    }
    tasks.append(task)
    _save_sprints(tasks)
    return jsonify(task), 201


@app.route("/api/sprints/<int:task_id>", methods=["PUT"])
@login_required
def api_sprints_update(task_id):
    body = request.get_json(force=True)
    tasks = _load_sprints()
    for t in tasks:
        if t["id"] == task_id:
            for k in ("title", "description", "assignee", "status"):
                if k in body:
                    t[k] = body[k]
            _save_sprints(tasks)
            return jsonify(t)
    abort(404)


@app.route("/api/sprints/<int:task_id>", methods=["DELETE"])
@login_required
def api_sprints_delete(task_id):
    tasks = _load_sprints()
    tasks = [t for t in tasks if t["id"] != task_id]
    _save_sprints(tasks)
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5123, debug=True)
