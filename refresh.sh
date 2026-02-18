#!/bin/bash
# Pied Piper Dashboard — Data Pipeline
# Generates data.json from JSONL transcripts (for static fallback)
# For live data, use: python3 serve.py

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "🔮 Pied Piper Dashboard — Data Pipeline"
echo "   Aggregating JSONL transcripts..."

python3 -c "
import sys, json
sys.path.insert(0, '$DIR')
from serve import aggregate
data = aggregate()
with open('$DIR/data.json', 'w') as f:
    json.dump(data, f, indent=2)
agents = data['agents']
total_cost = sum(a['total_cost'] for a in agents)
total_msgs = sum(a.get('msg_in',0) + a.get('msg_out',0) for a in agents)
print(f'   ✅ {len(agents)} agents, {len(data[\"sessions\"])} sessions, {total_msgs} messages')
print(f'   💰 Total cost: \${total_cost:.4f}')
print(f'   📝 Wrote data.json')
"

echo ""
echo "To run the live dashboard:"
echo "  python3 serve.py"
echo "  → http://localhost:8787"
