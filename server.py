#!/usr/bin/env python3
# Pied Piper Dashboard - Production Ready

import os
import json
from flask import Flask, render_template, jsonify, request, send_file, redirect, url_for, session, abort
from werkzeug.security import check_password_hash, generate_password_hash

from app import app, build_agent_stats, AGENT_NAMES  # Import from app.py

# Adjust paths for production
@app.route('/api/data')
@login_required
def api_data():
    agents = [build_agent_stats(name) for name in AGENT_NAMES]
    team = {
        "totalCost": round(sum(a.get("totalCost", 0) for a in agents), 6),
        "totalTokens": sum(a.get("totalTokens", 0) for a in agents),
        "totalMessages": sum(a.get("totalMessages", 0) for a in agents),
        "assistantMessages": sum(a.get("assistantMessages", 0) for a in agents),
    }
    return jsonify({"agents": agents, "team": team})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5123))
    app.run(host='0.0.0.0', port=port, debug=False)