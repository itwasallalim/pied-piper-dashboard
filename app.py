#!/usr/bin/env python3
"""Pied Piper AI Agent Team Dashboard — Backend"""

import json
import glob
import os
import secrets
import functools
from datetime import datetime, timezone
from flask import Flask, jsonify, render_template, request, redirect, url_for, session, abort, send_from_directory
from werkzeug.utils import secure_filename

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
    total_cost = sum(max((m["usage"].get("cost") or {}).get("total", 0) or 0, 0) for m in assistant_msgs)

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

    # Calculate active hours from timestamps (time between first and last msg per session-hour)
    active_hours = len(time_series)  # each bucket is ~1 hour of activity

    # Estimate human-equivalent hours saved:
    # Average human writes ~40 words/min = ~53 tokens/min = ~3200 tokens/hour
    # Agent output tokens represent work a human would have to do
    human_equiv_hours = round(total_output / 3200, 1) if total_output else 0

    # Calculate first active timestamp
    first_active = min(timestamps) if timestamps else None

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
        "firstActive": first_active,
        "activeHours": active_hours,
        "humanEquivHours": human_equiv_hours,
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

@app.route('/api/data')
@login_required
def api_data():
    agents = [build_agent_stats(name) for name in AGENT_NAMES]
    team = {
        "totalCost": round(sum(a["totalCost"] for a in agents), 6),
        "totalTokens": sum(a["totalTokens"] for a in agents),
        "totalMessages": sum(a["totalMessages"] for a in agents),
        "assistantMessages": sum(a["assistantMessages"] for a in agents),
        "totalActiveHours": sum(a["activeHours"] for a in agents),
        "totalHumanEquivHours": round(sum(a["humanEquivHours"] for a in agents), 1),
    }
    return jsonify({"agents": agents, "team": team})


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
        "totalActiveHours": sum(a["activeHours"] for a in agents),
        "totalHumanEquivHours": round(sum(a["humanEquivHours"] for a in agents), 1),
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
            for k in ("title", "description", "assignee", "status", "goalId"):
                if k in body:
                    t[k] = body[k]
            _save_sprints(tasks)
            return jsonify(t)
    abort(404)


@app.route("/api/sprints/<int:task_id>/comments", methods=["GET"])
@login_required
def api_sprints_get_comments(task_id):
    tasks = _load_sprints()
    for t in tasks:
        if t["id"] == task_id:
            return jsonify({"comments": t.get("comments", [])})
    abort(404)


@app.route("/api/sprints/<int:task_id>/comments", methods=["POST"])
@login_required
def api_sprints_add_comment(task_id):
    body = request.get_json(force=True)
    text = body.get("text", "").strip()
    author = body.get("author", "You").strip()
    if not text:
        abort(400)
    tasks = _load_sprints()
    for t in tasks:
        if t["id"] == task_id:
            if "comments" not in t:
                t["comments"] = []
            t["comments"].append({
                "author": author,
                "text": text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            _save_sprints(tasks)
            return jsonify({"ok": True, "comments": t["comments"]})
    abort(404)


@app.route("/api/sprints/<int:task_id>/log", methods=["POST"])
@login_required
def api_sprints_add_log(task_id):
    body = request.get_json(force=True)
    entry = body.get("entry", "").strip()
    if not entry:
        abort(400)
    tasks = _load_sprints()
    for t in tasks:
        if t["id"] == task_id:
            if "log" not in t:
                t["log"] = []
            t["log"].append(entry)
            _save_sprints(tasks)
            return jsonify({"ok": True, "log": t["log"]})
    abort(404)


@app.route("/api/sprints/<int:task_id>", methods=["DELETE"])
@login_required
def api_sprints_delete(task_id):
    tasks = _load_sprints()
    tasks = [t for t in tasks if t["id"] != task_id]
    _save_sprints(tasks)
    return jsonify({"ok": True})


@app.route("/api/messages")
@login_required
def api_messages():
    agent_filter = request.args.get("agent", "")
    role_filter = request.args.get("role", "")
    limit = int(request.args.get("limit", 100))
    all_msgs = []
    agents = [agent_filter] if agent_filter and agent_filter in AGENT_NAMES else AGENT_NAMES
    for agent_name in agents:
        for m in parse_sessions(agent_name):
            if m.get("content_preview") and m.get("role") in ("user", "assistant"):
                if role_filter and m["role"] != role_filter:
                    continue
                all_msgs.append({**m, "agent": agent_name})
    all_msgs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return jsonify({"messages": all_msgs[:limit]})


GOALS_FILE = os.path.join(os.path.dirname(__file__), "goals.json")


def _load_goals():
    if not os.path.exists(GOALS_FILE):
        return []
    with open(GOALS_FILE, "r") as f:
        return json.load(f)


def _save_goals(data):
    with open(GOALS_FILE, "w") as f:
        json.dump(data, f, indent=2)


@app.route("/api/goals", methods=["GET"])
@login_required
def api_goals_get():
    goals = _load_goals()
    tasks = _load_sprints()
    # Enrich goals with progress from linked tasks
    for g in goals:
        linked = [t for t in tasks if t.get("goalId") == g["id"]]
        total = len(linked)
        done = len([t for t in linked if t.get("status") == "done"])
        g["linkedTasks"] = total
        g["completedTasks"] = done
        g["progress"] = round((done / total * 100) if total > 0 else 0)
    return jsonify({"goals": goals})


@app.route("/api/goals", methods=["POST"])
@login_required
def api_goals_create():
    body = request.get_json(force=True)
    goals = _load_goals()
    new_id = max((g["id"] for g in goals), default=0) + 1
    goal = {
        "id": new_id,
        "title": body.get("title", "Untitled"),
        "description": body.get("description", ""),
        "owner": body.get("owner", "richard"),
        "deadline": body.get("deadline", ""),
        "status": body.get("status", "active"),
        "created": datetime.now(timezone.utc).isoformat(),
    }
    goals.append(goal)
    _save_goals(goals)
    return jsonify(goal), 201


@app.route("/api/goals/<int:goal_id>", methods=["PUT"])
@login_required
def api_goals_update(goal_id):
    body = request.get_json(force=True)
    goals = _load_goals()
    for g in goals:
        if g["id"] == goal_id:
            for k in ("title", "description", "owner", "deadline", "status"):
                if k in body:
                    g[k] = body[k]
            _save_goals(goals)
            return jsonify(g)
    abort(404)


@app.route("/api/goals/<int:goal_id>", methods=["DELETE"])
@login_required
def api_goals_delete(goal_id):
    goals = _load_goals()
    goals = [g for g in goals if g["id"] != goal_id]
    _save_goals(goals)
    return jsonify({"ok": True})


@app.route("/api/leaderboard", methods=["GET"])
@login_required
def api_leaderboard():
    tasks = _load_sprints()
    agents_data = {}
    for name in AGENT_NAMES:
        agent_tasks = [t for t in tasks if t.get("assignee") == name]
        done = [t for t in agent_tasks if t.get("status") == "done"]
        in_prog = [t for t in agent_tasks if t.get("status") == "in-progress"]
        blocked = [t for t in agent_tasks if t.get("status") == "blocked"]
        backlog = [t for t in agent_tasks if t.get("status") == "backlog"]
        total_logs = sum(len(t.get("log", [])) for t in agent_tasks)
        total_comments = sum(len(t.get("comments", [])) for t in agent_tasks)
        # Score: done*10 + in_progress*3 + logs*2 + comments*1 - blocked*5
        score = len(done) * 10 + len(in_prog) * 3 + total_logs * 2 + total_comments - len(blocked) * 5
        stats = build_agent_stats(name)
        agents_data[name] = {
            "agent": name,
            "done": len(done),
            "inProgress": len(in_prog),
            "blocked": len(blocked),
            "backlog": len(backlog),
            "totalTasks": len(agent_tasks),
            "logEntries": total_logs,
            "comments": total_comments,
            "score": max(score, 0),
            "humanEquivHours": stats.get("humanEquivHours", 0),
            "activeHours": stats.get("activeHours", 0),
            "totalCost": stats.get("totalCost", 0),
            "status": "shipping" if len(done) > len(in_prog) else ("grinding" if len(in_prog) > 0 else ("blocked" if len(blocked) > 0 else "idle")),
        }
    ranked = sorted(agents_data.values(), key=lambda x: x["score"], reverse=True)
    for i, r in enumerate(ranked):
        r["rank"] = i + 1
        if i == 0:
            r["badge"] = "👑"
        elif i == 1:
            r["badge"] = "🥈"
        elif i == 2:
            r["badge"] = "🥉"
        else:
            r["badge"] = ""
    return jsonify({"leaderboard": ranked})


DOCS_DIR = os.path.join(os.path.dirname(__file__), "docs")
DOCS_FILE = os.path.join(os.path.dirname(__file__), "docs_meta.json")
os.makedirs(DOCS_DIR, exist_ok=True)


def _load_docs():
    if not os.path.exists(DOCS_FILE):
        return []
    with open(DOCS_FILE, "r") as f:
        return json.load(f)


def _save_docs(data):
    with open(DOCS_FILE, "w") as f:
        json.dump(data, f, indent=2)


@app.route("/api/docs", methods=["GET"])
@login_required
def api_docs_list():
    docs = _load_docs()
    return jsonify({"docs": docs})


@app.route("/api/docs", methods=["POST"])
@login_required
def api_docs_create():
    body = request.get_json(force=True)
    docs = _load_docs()
    new_id = max((d["id"] for d in docs), default=0) + 1
    doc = {
        "id": new_id,
        "title": body.get("title", "Untitled"),
        "category": body.get("category", "general"),
        "content": body.get("content", ""),
        "author": body.get("author", "richard"),
        "tags": body.get("tags", []),
        "audience": body.get("audience", "all"),  # human, ai, all
        "created": datetime.now(timezone.utc).isoformat(),
        "updated": datetime.now(timezone.utc).isoformat(),
    }
    docs.append(doc)
    _save_docs(docs)
    return jsonify(doc), 201


@app.route("/api/docs/<int:doc_id>", methods=["GET"])
@login_required
def api_docs_get(doc_id):
    docs = _load_docs()
    for d in docs:
        if d["id"] == doc_id:
            return jsonify(d)
    abort(404)


@app.route("/api/docs/<int:doc_id>", methods=["PUT"])
@login_required
def api_docs_update(doc_id):
    body = request.get_json(force=True)
    docs = _load_docs()
    for d in docs:
        if d["id"] == doc_id:
            for k in ("title", "category", "content", "author", "tags", "audience"):
                if k in body:
                    d[k] = body[k]
            d["updated"] = datetime.now(timezone.utc).isoformat()
            _save_docs(docs)
            return jsonify(d)
    abort(404)


@app.route("/api/docs/<int:doc_id>", methods=["DELETE"])
@login_required
def api_docs_delete(doc_id):
    docs = _load_docs()
    docs = [d for d in docs if d["id"] != doc_id]
    _save_docs(docs)
    return jsonify({"ok": True})


import subprocess

@app.route("/api/repos", methods=["GET"])
@login_required
def api_repos():
    """Fetch GitHub repos for the org via gh CLI."""
    try:
        result = subprocess.run(
            ["gh", "repo", "list", "itwasallalim", "--public", "--json",
             "name,description,url,updatedAt,primaryLanguage,isPrivate,stargazerCount,forkCount",
             "--limit", "50"],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            repos = json.loads(result.stdout)
            return jsonify({"repos": repos})
    except Exception as e:
        return jsonify({"repos": [], "error": str(e)})
    return jsonify({"repos": []})


@app.route("/api/repos/<name>/commits", methods=["GET"])
@login_required
def api_repo_commits(name):
    """Fetch recent commits for a repo."""
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/itwasallalim/{name}/commits",
             "--jq", ".[0:10] | .[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}"],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            commits = []
            for line in result.stdout.strip().split("\n"):
                if line.strip():
                    try:
                        commits.append(json.loads(line))
                    except:
                        pass
            return jsonify({"commits": commits})
    except Exception as e:
        return jsonify({"commits": [], "error": str(e)})
    return jsonify({"commits": []})


UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.route("/api/files", methods=["GET"])
@login_required
def api_files_list():
    files = []
    for fname in os.listdir(UPLOAD_DIR):
        fpath = os.path.join(UPLOAD_DIR, fname)
        if os.path.isfile(fpath):
            stat = os.stat(fpath)
            files.append({
                "name": fname,
                "size": stat.st_size,
                "uploaded": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    files.sort(key=lambda f: f["uploaded"], reverse=True)
    return jsonify({"files": files})


@app.route("/api/files/upload", methods=["POST"])
@login_required
def api_files_upload():
    uploaded = []
    for f in request.files.getlist("file"):
        if f.filename:
            fname = secure_filename(f.filename)
            f.save(os.path.join(UPLOAD_DIR, fname))
            uploaded.append(fname)
    return jsonify({"uploaded": uploaded}), 201


@app.route("/api/files/<path:filename>", methods=["GET"])
@login_required
def api_files_download(filename):
    if request.args.get("preview") == "1":
        return send_from_directory(UPLOAD_DIR, filename, as_attachment=False)
    return send_from_directory(UPLOAD_DIR, filename, as_attachment=True)


@app.route("/api/files/<path:filename>", methods=["DELETE"])
@login_required
def api_files_delete(filename):
    fpath = os.path.join(UPLOAD_DIR, secure_filename(filename))
    if os.path.exists(fpath):
        os.remove(fpath)
        return jsonify({"ok": True})
    abort(404)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5123, debug=True)
