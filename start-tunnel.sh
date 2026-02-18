#!/bin/bash
# Start the Pied Piper dashboard + Cloudflare quick tunnel
# Posts the new URL to Slack via OpenClaw

DASH_DIR="$HOME/.openclaw/workspace-piedpiper/dashboard"
LOG="/tmp/cloudflared.log"

# Kill any existing instances
pkill -f "python3 serve.py" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

# Start dashboard server
cd "$DASH_DIR"
DASH_USER=admin DASH_PASS=PiedPiper2026! nohup python3 serve.py > /tmp/piedpiper-dash.log 2>&1 &
sleep 2

# Start tunnel
rm -f "$LOG"
nohup cloudflared tunnel --url http://localhost:8787 > "$LOG" 2>&1 &
sleep 10

# Extract URL
URL=$(grep -o 'https://[a-z0-9\-]*\.trycloudflare\.com' "$LOG" | head -1)

if [ -n "$URL" ]; then
    echo "Dashboard live at: $URL"
    echo "$URL" > "$DASH_DIR/.tunnel-url"
else
    echo "Failed to get tunnel URL"
    exit 1
fi
