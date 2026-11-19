#!/data/data/com.termux/files/usr/bin/bash
# Stoppt den Dashboard-Server.
APP="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$APP/data/server.pid"

if [ -f "$PID_FILE" ] && kill "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Dashboard gestoppt."
else
  echo "Dashboard lief nicht."
fi
rm -f "$PID_FILE"
command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
exit 0
