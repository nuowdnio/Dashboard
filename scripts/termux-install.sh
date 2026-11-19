#!/data/data/com.termux/files/usr/bin/bash
# Richtet das Dashboard auf einem Android-Handy in Termux ein (kostenlos, läuft direkt auf dem Handy).
# Aufruf aus dem entpackten Ordner:  bash scripts/termux-install.sh
# Erneut ausführen = Update. Deine Daten (data/) bleiben dabei erhalten.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP="${DASHBOARD_HOME:-$HOME/dashboard}"

echo "==> Dashboard wird eingerichtet in: $APP"

# 1. Node.js und curl installieren
if ! command -v node >/dev/null 2>&1; then
  echo "==> Installiere Node.js (einmalig, dauert ein paar Minuten) …"
  pkg update -y
  pkg install -y nodejs-lts curl
elif ! command -v curl >/dev/null 2>&1; then
  pkg install -y curl
fi

# 2. Programmdateien kopieren (data/ mit deinen Einträgen bleibt unangetastet)
mkdir -p "$APP"
if [ "$SRC" != "$APP" ]; then
  for item in server.js package.json package-lock.json lib public scripts README.md; do
    [ -e "$SRC/$item" ] && cp -R "$SRC/$item" "$APP/"
  done
fi
mkdir -p "$APP/data"

# 3. Abhängigkeiten installieren
echo "==> Installiere Abhängigkeiten …"
cd "$APP"
npm install --omit=dev --no-audit --no-fund

# 4. Verknüpfungen: Widget auf dem Startbildschirm (App "Termux:Widget") und Autostart (App "Termux:Boot")
mkdir -p "$HOME/.shortcuts" "$HOME/.termux/boot"
cat > "$HOME/.shortcuts/Dashboard starten" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
bash "$APP/scripts/termux-start.sh" --open
EOF
cat > "$HOME/.shortcuts/Dashboard stoppen" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
bash "$APP/scripts/termux-stop.sh"
EOF
cat > "$HOME/.termux/boot/dashboard" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
bash "$APP/scripts/termux-start.sh"
EOF
chmod +x "$HOME/.shortcuts/Dashboard starten" "$HOME/.shortcuts/Dashboard stoppen" "$HOME/.termux/boot/dashboard"

# 5. Kurzbefehle für die Kommandozeile
BASHRC="$HOME/.bashrc"
touch "$BASHRC"
if ! grep -q "# dashboard-aliases" "$BASHRC"; then
  cat >> "$BASHRC" <<EOF
# dashboard-aliases
alias dashboard-start='bash "$APP/scripts/termux-start.sh" --open'
alias dashboard-stop='bash "$APP/scripts/termux-stop.sh"'
EOF
fi

# 6. Starten (ein laufender Server wird neu gestartet, damit ein Update sofort greift)
bash "$APP/scripts/termux-stop.sh" >/dev/null 2>&1 || true
bash "$APP/scripts/termux-start.sh" --open

cat <<EOF

✅ Fertig! Das Dashboard läuft unter http://localhost:3000

So geht es weiter:
  • In Chrome: Menü ⋮ → "App installieren" bzw. "Zum Startbildschirm hinzufügen".
  • Später starten: im Termux-Widget "Dashboard starten" antippen
    oder in Termux "dashboard-start" eingeben.
  • Mit der App "Termux:Boot" startet es automatisch nach jedem Neustart des Handys.
EOF
