# Mein Dashboard

Persönliches Dashboard mit allen wichtigen Infos auf einen Blick:

- **📅 Anstehende Termine**: aus Samsung Kalender bzw. Google, Outlook oder iCloud über iCal-Link oder `.ics`-Datei
- **✅ Aufgaben**: mit Fälligkeitsdatum, Priorität und Hinweis auf Überfälliges
- **🚗 Auto-Status**: Kilometerstand, Tank/Akku, Reichweite, HU/TÜV, Inspektion, Reifenwechsel, Verriegelung, Standort
- **Übersichtsleiste** mit Terminen heute, offenen bzw. überfälligen Aufgaben und Auto-Hinweisen

Die Oberfläche ist auf Deutsch, passt sich an Handy und Tablet an und folgt dem hellen oder dunklen Modus des Geräts.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm start
```

Danach im Browser **http://localhost:3000** öffnen.

| Variable              | Standard        | Bedeutung                                                                 |
| --------------------- | --------------- | ------------------------------------------------------------------------- |
| `PORT`                | `3000`          | Port des Servers                                                          |
| `HOST`                | `127.0.0.1`     | `0.0.0.0` setzen, um das Dashboard im Heimnetz (z. B. auf dem Tablet) zu öffnen |
| `DASHBOARD_PASSWORD`  | –               | Wenn gesetzt, fragt der Browser beim Öffnen nach dem Passwort (Benutzername ist egal) |
| `DATA_DIR`            | `./data`        | Speicherort der Daten (`db.json` und hochgeladene Kalender)                |
| `TZ`                  | `Europe/Berlin` | Zeitzone für Termine                                                      |

Beispiel für den Zugriff im Heimnetz:

```bash
HOST=0.0.0.0 DASHBOARD_PASSWORD=geheim npm start
```

Alle Daten liegen lokal in `data/`. Der Ordner ist absichtlich von Git ausgeschlossen, weil er private Kalender-Links enthält.

## Samsung Kalender verbinden

Samsung bietet für den Kalender **keine öffentliche Schnittstelle** an. Samsung Kalender zeigt aber die Kalender der Konten an, die auf dem Handy eingerichtet sind, meistens ein Google-Konto. Über dieses Konto bekommt das Dashboard die Termine:

1. **Prüfen, wo die Termine liegen**
   Samsung Kalender → ☰ Menü → *Kalender verwalten*. Dort steht bei jedem Kalender das Konto, z. B. „Google“ oder „Mein Handy“/„Samsung-Konto“.

2. **Termine liegen im Google-Konto** (der Normalfall, aktualisiert sich automatisch)
   Am PC [calendar.google.com](https://calendar.google.com) öffnen → ⚙ *Einstellungen* → links den Kalender wählen → *Kalender integrieren* → **„Privatadresse im iCal-Format“** kopieren. Im Dashboard unter *Kalender verwalten* → *iCal-Link hinzufügen* einfügen.

3. **Termine liegen nur auf dem Handy oder im Samsung-Konto**
   - Empfohlen: In Samsung Kalender die Termine in das Google-Konto verschieben und dann wie in Schritt 2 vorgehen.
   - Alternativ: Die Termine als `.ics` exportieren, z. B. mit einer Export-App, und im Dashboard hochladen. So eine Datei aktualisiert sich aber nicht von selbst.

4. **Outlook / iCloud** funktionieren genauso über deren Link zum Veröffentlichen oder Freigeben (ICS).

Es lassen sich mehrere Kalender mit unterschiedlichen Farben hinzufügen. iCal-Links werden alle 5 Minuten neu abgerufen; mit ⟳ lädt das Dashboard sofort neu. Wiederkehrende Termine, Ausnahmen, verschobene Einzeltermine und die Zeitumstellung werden berücksichtigt.

## Aufbau

```
server.js          Express-Server und REST-API
lib/store.js       Speicherung in data/db.json
lib/calendar.js    iCal abrufen/parsen, Wiederholungen auflösen
public/            Oberfläche (HTML/CSS/JS, kein Build-Schritt)
```

### API

| Methode | Pfad                     | Zweck                                      |
| ------- | ------------------------ | ------------------------------------------ |
| GET     | `/api/state`             | Auto, Aufgaben, Kalenderliste              |
| PUT     | `/api/car`               | Auto-Status speichern                      |
| POST    | `/api/tasks`             | Aufgabe anlegen                            |
| PATCH   | `/api/tasks/:id`         | Aufgabe ändern (z. B. `{ "done": true }`)  |
| DELETE  | `/api/tasks/:id`         | Aufgabe löschen                            |
| POST    | `/api/calendars`         | Kalender hinzufügen (`url` oder `ics`)     |
| PATCH   | `/api/calendars/:id`     | Name/Farbe/aktiv ändern                    |
| DELETE  | `/api/calendars/:id`     | Kalender entfernen                         |
| GET     | `/api/events?days=14`    | Termine der nächsten n Tage                |

## Nächste Schritte

- **Auto automatisch anbinden**: Je nach Hersteller (z. B. VW/Skoda/Audi, BMW, Mercedes, Tesla) gibt es inoffizielle Schnittstellen oder Smart-Home-Integrationen, über die Kilometerstand, Tank/Akku, Standort und Verriegelung automatisch kommen. Der Auto-Status ist schon dafür vorbereitet (`source`).
- Weitere Kacheln, z. B. Wetter, Müllabfuhr, Paketverfolgung oder Finanzen.
