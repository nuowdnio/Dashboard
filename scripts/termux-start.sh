#!/data/data/com.termux/files/usr/bin/bash
# Startet den Dashboard-Server im Hintergrund (falls er nicht schon läuft).
# --open: öffnet danach das Dashboard im Browser bzw. in der installierten App.
set -u

APP="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
URL="http://localhost:$PORT"
mkdir -p "$APP/data"

running() { curl -s -o /dev/null --max-time 2 "$URL/manifest.webmanifest"; }

# Verhindert, dass Android den Server im Hintergrund schlafen legt.
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

if running; then
  echo "Dashboard läuft bereits: $URL"
else
  cd "$APP"
  # Log klein halten: bei über 1 MB neu beginnen
  if [ -f data/server.log ] && [ "$(wc -c < data/server.log)" -gt 1048576 ]; then
    mv data/server.log data/server.log.old
  fi
  nohup node server.js >> data/server.log 2>&1 &
  echo $! > data/server.pid
  for _ in $(seq 1 30); do
    running && break
    sleep 0.5
  done
  if running; then
    echo "Dashboard gestartet: $URL"
  else
    echo "Start fehlgeschlagen. Details: $APP/data/server.log" >&2
    tail -n 20 data/server.log >&2 || true
    exit 1
  fi
fi

if [ "${1:-}" = "--open" ] && command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "$URL"
fi
