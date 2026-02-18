#!/usr/bin/env python3
"""Pied Piper Live Dashboard Server — serves HTML + /api/data from JSONL transcripts."""

import json, glob, os, time, datetime, html, base64, secrets, hashlib
from http.server import HTTPServer, SimpleHTTPRequestHandler
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs

AGENTS_DIR = os.path.expanduser("~/.openclaw/agents")
CRON_DIR = os.path.expanduser("~/.openclaw/cron/runs")
DASHBOARD_DIR = Path(__file__).parent
SPRINT_FILE = DASHBOARD_DIR / "sprint.json"
AGENT_IDS = ["richard", "erlich", "dinesh", "gilfoyle", "jiangyang"]
AGENT_NAMES = {
    "richard": "Richard Hendricks", "erlich": "Erlich Bachman",
    "dinesh": "Dinesh Chugtai", "gilfoyle": "Bertram Gilfoyle",
    "jiangyang": "Jian-Yang",
}

def parse_channel(key: str) -> str:
    parts = key.split(":")
    if "slack" in parts:
        idx = parts.index("slack")
        return "slack:" + ":".join(parts[idx+1:])
    for tag in ("main", "subagent", "cron"):
        if tag in parts:
            return tag
    return "unknown"

def aggregate():
    now_ms = int(time.time() * 1000)
    result = {"agents": [], "sessions": [], "timeline": [], "messages": [], "cron_runs": [], "generated_at": datetime.datetime.now().isoformat()}

    for agent_id in AGENT_IDS:
        agent_dir = os.path.join(AGENTS_DIR, agent_id, "sessions")
        sessions_file = os.path.join(agent_dir, "sessions.json")

        agent_data = {
            "id": agent_id, "name": AGENT_NAMES.get(agent_id, agent_id),
            "model": "unknown", "total_input": 0, "total_output": 0,
            "total_cache_read": 0, "total_cache_write": 0, "total_cost": 0.0,
            "session_count": 0, "last_active": 0, "context_used": 0,
            "context_max": 200000, "status": "inactive",
            "msg_in": 0, "msg_out": 0, "channels": set(),
        }

        session_keys = {}
        if os.path.exists(sessions_file):
            try:
                with open(sessions_file) as f:
                    session_keys = json.load(f)
            except Exception:
                pass

        agent_data["session_count"] = len(session_keys)

        for key, val in session_keys.items():
            updated = val.get("updatedAt", 0)
            if updated > agent_data["last_active"]:
                agent_data["last_active"] = updated
            channel = parse_channel(key)
            agent_data["channels"].add(channel.split(":")[0])
            result["sessions"].append({
                "agent": AGENT_NAMES.get(agent_id, agent_id), "agent_id": agent_id,
                "key": key, "channel": channel, "updated_at": updated,
                "session_id": val.get("sessionId", ""), "tokens": 0,
            })

        if agent_data["last_active"] > now_ms - 300_000:
            agent_data["status"] = "active"
        elif agent_data["last_active"] > now_ms - 3_600_000:
            agent_data["status"] = "idle"

        # Parse JSONL files
        jsonl_files = glob.glob(os.path.join(agent_dir, "*.jsonl"))
        for jf in jsonl_files:
            model = None
            try:
                with open(jf) as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = json.loads(line)
                        except Exception:
                            continue

                        etype = entry.get("type", "")

                        if etype == "model_change":
                            model = entry.get("modelId") or entry.get("data", {}).get("modelId")

                        if etype == "custom" and entry.get("customType") == "model-snapshot":
                            d = entry.get("data", {})
                            if d.get("modelId"):
                                model = d["modelId"]

                        if etype == "message":
                            msg = entry.get("message", {})
                            role = msg.get("role", "")
                            ts = entry.get("timestamp", "")
                            usage = msg.get("usage", {})

                            if usage:
                                agent_data["total_input"] += usage.get("input", 0)
                                agent_data["total_output"] += usage.get("output", 0)
                                agent_data["total_cache_read"] += usage.get("cacheRead", 0)
                                agent_data["total_cache_write"] += usage.get("cacheWrite", 0)
                                agent_data["total_cost"] += usage.get("cost", {}).get("total", 0)

                            if role == "user":
                                agent_data["msg_in"] += 1
                            elif role == "assistant":
                                agent_data["msg_out"] += 1

                            # Extract message content for recent messages
                            content_text = ""
                            content = msg.get("content", [])
                            if isinstance(content, list):
                                for c in content:
                                    if isinstance(c, dict) and c.get("type") == "text":
                                        content_text = c.get("text", "")[:300]
                                        break
                            elif isinstance(content, str):
                                content_text = content[:300]

                            if content_text.strip() and role in ("user", "assistant"):
                                # Strip system prefixes for cleaner display
                                preview = content_text.strip()
                                if preview.startswith("System:"):
                                    # Extract the actual message after metadata
                                    lines = preview.split("\n")
                                    for ln in lines:
                                        ln = ln.strip()
                                        if ln and not ln.startswith("System:") and not ln.startswith("Conversation info") and not ln.startswith("```") and not ln.startswith("Sender") and not ln.startswith("{") and not ln.startswith("Untrusted") and not ln.startswith("<<<"):
                                            preview = ln
                                            break

                                result["messages"].append({
                                    "agent": AGENT_NAMES.get(agent_id, agent_id),
                                    "agent_id": agent_id,
                                    "role": role,
                                    "direction": "in" if role == "user" else "out",
                                    "timestamp": ts,
                                    "preview": preview[:150],
                                    "model": msg.get("model", model or ""),
                                })

                            # Timeline for assistant messages
                            if role == "assistant" and content_text.strip():
                                result["timeline"].append({
                                    "agent": AGENT_NAMES.get(agent_id, agent_id),
                                    "agent_id": agent_id,
                                    "timestamp": ts,
                                    "preview": content_text.strip()[:120],
                                    "model": msg.get("model", model or "unknown"),
                                })
            except Exception:
                continue

            if model:
                agent_data["model"] = model

            # Update session token counts
            basename = os.path.basename(jf)
            sid = basename.replace(".jsonl", "").split("-topic-")[0]
            for s in result["sessions"]:
                if s["session_id"] == sid and s["agent_id"] == agent_id:
                    s["tokens"] += agent_data["total_input"] + agent_data["total_output"]

        agent_data["context_used"] = agent_data["total_input"] + agent_data["total_cache_read"]
        agent_data["channels"] = sorted(agent_data["channels"])
        result["agents"].append(agent_data)

    # Sort
    result["timeline"].sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    result["timeline"] = result["timeline"][:50]
    result["messages"].sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    result["messages"] = result["messages"][:100]
    result["sessions"].sort(key=lambda x: x.get("updated_at", 0), reverse=True)

    # Cron
    cron_files = glob.glob(os.path.join(CRON_DIR, "*.jsonl"))
    for cf in cron_files:
        try:
            with open(cf) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        result["cron_runs"].append(json.loads(line))
                    except Exception:
                        pass
        except Exception:
            pass
    result["cron_runs"].sort(key=lambda x: x.get("ts", 0), reverse=True)
    result["cron_runs"] = result["cron_runs"][:20]

    return result


# --- Auth ---
AUTH_USER = os.environ.get("DASH_USER", "piedpiper")
AUTH_PASS = os.environ.get("DASH_PASS", secrets.token_urlsafe(12))
SESSION_TOKENS = {}  # token -> expiry timestamp

LOGIN_HTML = """<!DOCTYPE html>
<html lang="en" class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pied Piper — Login</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{{background:#0f172a;font-family:system-ui}}</style></head>
<body class="flex items-center justify-center min-h-screen">
<div class="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-sm border border-slate-700">
<h1 class="text-2xl font-bold text-green-400 mb-1 text-center">🔒 Pied Piper</h1>
<p class="text-slate-400 text-sm mb-6 text-center">Dashboard Login</p>
{error}
<form method="POST" action="/login">
<input name="user" placeholder="Username" class="w-full mb-3 px-4 py-2 bg-slate-900 text-white rounded border border-slate-600 focus:border-green-400 outline-none" required>
<input name="pass" type="password" placeholder="Password" class="w-full mb-4 px-4 py-2 bg-slate-900 text-white rounded border border-slate-600 focus:border-green-400 outline-none" required>
<button type="submit" class="w-full py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded transition">Log In</button>
</form></div></body></html>"""

def check_auth(handler) -> bool:
    cookie_str = handler.headers.get("Cookie", "")
    cookie = SimpleCookie()
    cookie.load(cookie_str)
    token_morsel = cookie.get("pp_session")
    if token_morsel:
        token = token_morsel.value
        if token in SESSION_TOKENS and SESSION_TOKENS[token] > time.time():
            return True
    return False

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DASHBOARD_DIR), **kwargs)

    def do_PATCH(self):
        if self.path == "/api/sprint":
            if not check_auth(self):
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{"error":"unauthorized"}')
                return
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode())
            task_id = body.get("task_id")
            column = body.get("column")
            try:
                with open(SPRINT_FILE) as f:
                    sprint = json.load(f)
            except Exception:
                sprint = {"tasks": [], "next_id": 1}
            found = False
            for t in sprint["tasks"]:
                if t["id"] == task_id:
                    t["column"] = column
                    found = True
                    break
            if found:
                with open(SPRINT_FILE, "w") as f:
                    json.dump(sprint, f, indent=2)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True}).encode())
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":"task not found"}')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/sprint":
            if not check_auth(self):
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{"error":"unauthorized"}')
                return
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode())
            try:
                with open(SPRINT_FILE) as f:
                    sprint = json.load(f)
            except Exception:
                sprint = {"tasks": [], "next_id": 1}
            new_task = {
                "id": sprint.get("next_id", len(sprint["tasks"]) + 1),
                "title": body.get("title", "Untitled"),
                "assignee": body.get("assignee", "Unassigned"),
                "column": body.get("column", "backlog"),
            }
            sprint["tasks"].append(new_task)
            sprint["next_id"] = new_task["id"] + 1
            with open(SPRINT_FILE, "w") as f:
                json.dump(sprint, f, indent=2)
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(new_task).encode())
        elif self.path == "/login":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode()
            params = parse_qs(body)
            user = params.get("user", [""])[0]
            pw = params.get("pass", [""])[0]
            if user == AUTH_USER and pw == AUTH_PASS:
                token = secrets.token_urlsafe(32)
                SESSION_TOKENS[token] = time.time() + 86400  # 24h
                self.send_response(303)
                self.send_header("Set-Cookie", f"pp_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400")
                self.send_header("Location", "/")
                self.end_headers()
            else:
                page = LOGIN_HTML.format(error='<p class="text-red-400 text-sm mb-4 text-center">Invalid credentials</p>')
                self.send_response(401)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(page.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        # Login page is always accessible
        if self.path == "/login":
            page = LOGIN_HTML.format(error="")
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(page.encode())
            return

        # Everything else requires auth
        if not check_auth(self):
            self.send_response(303)
            self.send_header("Location", "/login")
            self.end_headers()
            return

        if self.path.startswith("/api/sprint"):
            try:
                with open(SPRINT_FILE) as f:
                    sprint = json.load(f)
            except Exception:
                sprint = {"tasks": [], "next_id": 1}
            payload = json.dumps(sprint).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(payload))
            self.end_headers()
            self.wfile.write(payload)
            return

        if self.path.startswith("/api/data"):
            data = aggregate()
            payload = json.dumps(data).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(payload))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload)
        else:
            super().do_GET()

    def log_message(self, fmt, *args):
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] {fmt % args}")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8787))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"🔮 Pied Piper Dashboard → http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()
