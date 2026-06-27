#!/usr/bin/env bash
# Launch RESONANCE locally. Open the printed URL in your browser. Headphones on 🎧
cd "$(dirname "$0")"
PORT="${1:-8000}"
echo "RESONANCE running at  http://localhost:${PORT}"
echo "(Ctrl+C to stop)"
exec python3 -m http.server "$PORT"
