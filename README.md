# Mein Dashboard

Persönliches Dashboard mit allen wichtigen Infos auf einen Blick:

- **🌤 Wetter**: aktuell, die nächsten 12 Stunden, 6-Tage-Vorschau und Regenhinweis („Regen ab ca. 17 Uhr, Schirm mitnehmen“)
- **📅 Anstehende Termine**: aus Samsung Kalender bzw. Google, Outlook oder iCloud über iCal-Link oder `.ics`-Datei
- **✅ Aufgaben**: direkt aus **Todoist** (abhaken und neu anlegen inklusive) oder lokal im Dashboard
- **📦 Pakete**: erscheinen **nur, wenn ein Paket erwartet wird**, und verschwinden nach der Zustellung wieder
- **🚗 Auto-Status**: Kilometerstand, Tank, Reichweite, HU/TÜV, Inspektion (Datum oder km), Reifenwechsel, Notizen
- **Übersichtsleiste** mit Wetter, Terminen heute, fälligen Aufgaben, Paketen und Auto-Hinweisen

Die Oberfläche ist auf Deutsch, passt sich an Handy und Tablet an und folgt dem hellen oder dunklen Modus des Geräts.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm start
```

Danach im Browser **http://localhost:3000** öffnen. Wetter-Ort, Todoist und DHL richtest du über **⚙ Einstellungen** ein.

| Variable             | Standard        | Bedeutung                                                                          |
| -------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `PORT`               | `3000`          | Port des Servers                                                                   |
| `HOST`               | `127.0.0.1`     | `0.0.0.0` setzen, um das Dashboard im Heimnetz (z. B. auf dem Tablet) zu öffnen    |
| `DASHBOARD_PASSWORD` | –               | Wenn gesetzt, fragt der Browser beim Öffnen nach dem Passwort (Benutzername egal)  |
| `TODOIST_TOKEN`      | –               | Todoist-API-Token (alternativ in den Einstellungen eintragen)                      |
| `DHL_API_KEY`        | –               | DHL-API-Schlüssel für automatischen Paketstatus (optional)                         |
| `DATA_DIR`           | `./data`        | Speicherort der Daten (`db.json` und hochgeladene Kalender)                         |
| `TZ`                 | `Europe/Berlin` | Zeitzone für Termine und Wetter                                                    |

Beispiel für den Zugriff im Heimnetz:

```bash
HOST=0.0.0.0 DASHBOARD_PASSWORD=geheim npm start
```

Alle Daten liegen lokal in `data/`. Der Ordner ist absichtlich von Git ausgeschlossen, weil er private Kalender-Links und Zugangsdaten enthält. Die Datei ist nur für den eigenen Benutzer lesbar. Tokens und Kalender-Links werden nie an den Browser zurückgegeben.

## Wetter

Die Daten kommen von [Open-Meteo](https://open-meteo.com), kostenlos und ohne Anmeldung. In den Einstellungen den Ort suchen oder „📍 Aktuellen Standort verwenden“ wählen. Der Standort funktioniert nur über `localhost` oder `https`.

## Todoist

1. In Todoist: **Einstellungen → Integrationen → Entwickler** → API-Token kopieren.
2. Im Dashboard: **⚙ → Todoist** → Token einfügen → Speichern. Der Token wird dabei direkt geprüft.

Danach zeigt die Aufgaben-Kachel deine Todoist-Aufgaben:

- Standardmäßig **überfällige und die der nächsten 7 Tage** (Filter `overdue | 7 days`). Der Filter ist in den Einstellungen änderbar, z. B. `today | overdue` oder `#Privat & 14 days`. Dabei die englische Filter-Schreibweise verwenden.
- **Abhaken** erledigt die Aufgabe in Todoist; wiederkehrende Aufgaben springen wie gewohnt auf den nächsten Termin.
- **Neue Aufgaben** gehen direkt nach Todoist, mit Todoists Schnelleingabe: `Reifen wechseln morgen p1 #Auto`.
- Ein Klick auf den Titel öffnet die Aufgabe in Todoist.

Ohne Todoist werden Aufgaben lokal im Dashboard gespeichert.

## Pakete

Die Paket-Kachel ist normalerweise **unsichtbar**. Erwartest du ein Paket, legst du es über 📦 in der Kopfzeile an: Bezeichnung, Sendungsnummer (optional), erwarteter Tag. Danach:

- erscheint die Kachel mit Status, erwartetem Tag und einem Link zur Sendungsverfolgung (DHL, Hermes, DPD, GLS, UPS, Amazon). Der Paketdienst wird anhand der Nummer vorgeschlagen.
- erscheint in der Übersichtsleiste ein Hinweis, z. B. „1 kommt heute“.
- verschwindet die Kachel nach „✓ Erhalten“ am nächsten Tag wieder.

**Automatischer DHL-Status (optional):** Mit einem kostenlosen Schlüssel von [developer.dhl.com](https://developer.dhl.com) (Konto anlegen → App erstellen → API „Shipment Tracking – Unified“) holt das Dashboard den Status von DHL-Paketen selbst ab, z. B. „In Zustellung“ oder „Zugestellt“. Zugestellte Pakete werden dann automatisch ausgeblendet.

## Samsung Kalender verbinden

Samsung bietet für den Kalender **keine öffentliche Schnittstelle** an. Termine, die nur auf dem Handy liegen (Kalender „Mein Handy“ bzw. „Samsung-Konto“), kann das Dashboard nicht direkt lesen. So geht es:

1. **Termine ins Google-Konto legen** (empfohlen): In Samsung Kalender unter ⚙ Einstellungen den *Standardkalender* auf dein Google-Konto stellen. Dann landen neue Termine automatisch bei Google. Bestehende Termine überträgst du, indem du beim Bearbeiten als Kalender „Google“ wählst. Je nach Samsung-Version gibt es dafür unter *Kalender verwalten* auch eine Funktion zum Verschieben. Die Samsung-App nutzt du weiter wie gewohnt.
2. **Link holen:** Am PC [calendar.google.com](https://calendar.google.com) → ⚙ *Einstellungen* → links den Kalender wählen → *Kalender integrieren* → **„Privatadresse im iCal-Format“** kopieren. Im Dashboard unter *Kalender* → *iCal-Link hinzufügen* einfügen. Ab dann aktualisiert sich alles automatisch alle 5 Minuten.
3. **Ohne Google:** Termine als `.ics` exportieren, z. B. mit einer Export-App, und hochladen. Mit „Datei ersetzen“ spielst du später einen neuen Export ein.

Wiederkehrende Termine, Ausnahmen, verschobene Einzeltermine und die Zeitumstellung werden berücksichtigt.

## Auto

Ältere Modelle wie der Ford Focus haben kein Online-Modem und damit keine Schnittstelle (FordPass Connect gibt es erst bei neueren Modellen). Die Werte trägst du über **Bearbeiten** ein, z. B. nach dem Tanken oder der Werkstatt. Das Dashboard warnt 30 Tage vor HU/TÜV, Inspektion und Reifenwechsel, 1.000 km vor dem Inspektions-Kilometerstand und bei einem Tank unter 20 %.

## Aufbau

```
server.js          Express-Server und REST-API
lib/store.js       Speicherung in data/db.json
lib/calendar.js    iCal abrufen/parsen, Wiederholungen auflösen
lib/weather.js     Open-Meteo (Vorhersage, Ortssuche)
lib/todoist.js     Todoist API v1
lib/packages.js    Paketdienste, Tracking-Links, DHL-Status
public/            Oberfläche (HTML/CSS/JS, kein Build-Schritt)
```

### API

| Methode            | Pfad                                         | Zweck                                         |
| ------------------ | -------------------------------------------- | --------------------------------------------- |
| GET                | `/api/state`                                 | Auto, Kalenderliste, Einstellungen (ohne Geheimnisse) |
| PUT                | `/api/car`                                   | Auto-Status speichern                         |
| GET/POST           | `/api/tasks`                                 | Aufgaben (Todoist oder lokal) lesen/anlegen   |
| PATCH/DELETE       | `/api/tasks/:id`                             | Abhaken (`{ "done": true }`) / löschen (lokal) |
| POST               | `/api/calendars`                             | Kalender hinzufügen (`url` oder `ics`)        |
| PATCH/DELETE       | `/api/calendars/:id`                         | Name/Farbe/aktiv/Datei ändern, entfernen      |
| GET                | `/api/events?days=14`                        | Termine der nächsten n Tage                   |
| GET                | `/api/weather`, `/api/weather/search?q=`     | Vorhersage, Ortssuche                         |
| GET/POST           | `/api/packages`                              | Sichtbare Pakete lesen / Paket anlegen        |
| PATCH/DELETE       | `/api/packages/:id`                          | Paket ändern / entfernen                      |
| PUT                | `/api/settings/weather`, `…/todoist`, `…/dhl` | Einstellungen speichern (`DELETE …/todoist` trennt) |
