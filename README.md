# Mein Dashboard

Persönliches Dashboard mit allen wichtigen Infos auf einen Blick:

- **🌤 Wetter** für Wiesbaden (änderbar): aktuell, die nächsten 12 Stunden, 6-Tage-Vorschau und Regenhinweis („Regen ab ca. 17 Uhr, Schirm mitnehmen“)
- **💶 Auto-Kosten**: Tanken und alle anderen Ausgaben eintragen, mit Monatsdiagramm, Kosten nach Art, Verbrauch, Kosten pro km, Spritpreis und CSV-Export
- **✉️ Offene Mails** aus dem GMX-Postfach: ungelesene und markierte Mails, direkt als gelesen oder erledigt markierbar
- **✅ Aufgaben**: direkt aus **Todoist** (abhaken und neu anlegen inklusive) oder lokal im Dashboard
- **📦 Pakete**: erscheinen **nur, wenn ein Paket erwartet wird**. Sie werden automatisch aus Versandmails erkannt und verschwinden nach der Zustellung wieder
- **🚗 Auto-Status**: Kilometerstand, Tank, HU/TÜV, Inspektion (Datum oder km), Reifenwechsel, Notizen
- **Übersichtsleiste** mit Wetter, Mails, fälligen Aufgaben, Paketen, Auto-Hinweisen und Autokosten des Monats

Die Oberfläche ist auf Deutsch und folgt dem hellen oder dunklen Modus des Geräts. Auf dem Handy gibt es eine Tab-Leiste (Heute, Mails, Aufgaben, Auto), und das Dashboard lässt sich als App auf dem Startbildschirm installieren.

## Auf dem Handy nutzen (kostenlos)

Das Dashboard läuft direkt auf deinem Android-Handy, mit der kostenlosen App **Termux**. Es braucht keinen Server, kein Abo und kein Konto bei einem Hoster. Deine Zugangsdaten (GMX, Todoist) bleiben auf dem Handy. Es funktioniert überall, nicht nur im WLAN.

**Einmalig einrichten (ca. 10 Minuten):**

1. **F-Droid** von [f-droid.org](https://f-droid.org) installieren und darüber **Termux**, **Termux:Widget** und **Termux:Boot** installieren. Die Termux-Version im Play Store ist veraltet, deshalb alle drei aus F-Droid.
2. In Chrome auf dem Handy die ZIP-Datei des Dashboards herunterladen (bei GitHub angemeldet):
   `https://github.com/nuowdnio/Dashboard/archive/refs/heads/ccr-da9c4d43-8x19ts.zip`
3. **Termux** öffnen und diese Zeilen eingeben, jede mit Enter. Bei der ersten Zeile den Speicherzugriff erlauben.
   ```
   termux-setup-storage
   pkg install -y unzip
   cd ~ && unzip -o "$(ls -t ~/storage/downloads/Dashboard-*.zip | head -1)" && bash Dashboard-*/scripts/termux-install.sh
   ```
   Das dauert beim ersten Mal ein paar Minuten. Danach öffnet sich das Dashboard im Browser.
4. In Chrome: **Menü ⋮ → „App installieren“** (bzw. „Zum Startbildschirm hinzufügen“). Jetzt hast du ein Dashboard-Symbol wie bei jeder App. Lange auf das Symbol drücken zeigt Abkürzungen wie „Tanken“ und „Neue Aufgabe“.
5. **Samsung-Akku-Einstellungen**, damit Android Termux nicht schlafen legt: *Einstellungen → Akku → Hintergrundnutzungsgrenzen → Nie in Standby versetzte Apps → Termux und Termux:Boot hinzufügen*.
6. **Termux:Boot** einmal öffnen. Ab dann startet das Dashboard nach jedem Neustart des Handys von selbst.
7. Optional: auf dem Startbildschirm lange drücken → *Widgets* → **Termux:Widget** → „Dashboard starten“. Ein Tipp darauf startet den Server und öffnet das Dashboard.

**Gut zu wissen:**

- Der Server braucht im Ruhezustand kaum Akku; Mails und Pakete werden nur geprüft, wenn du das Dashboard öffnest.
- Läuft der Server einmal nicht, zeigt die App den letzten Stand mit einem Hinweis an. Dann im Widget „Dashboard starten“ antippen oder in Termux `dashboard-start` eingeben.
- **Update:** neue ZIP-Datei herunterladen und Schritt 3 (nur die letzte Zeile) wiederholen. Deine Daten bleiben erhalten.
- **Sicherung:** Deine Daten liegen in Termux unter `~/dashboard/data/db.json`. Die Autokosten kannst du jederzeit als CSV exportieren.

## Auf dem Computer starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm start
```

Danach im Browser **http://localhost:3000** öffnen. GMX, Todoist und optional DHL richtest du über **⚙ Einstellungen** ein.

| Variable             | Standard        | Bedeutung                                                                          |
| -------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `PORT`               | `3000`          | Port des Servers                                                                   |
| `HOST`               | `127.0.0.1`     | `0.0.0.0` setzen, um das Dashboard im Heimnetz (z. B. auf dem Tablet) zu öffnen    |
| `DASHBOARD_PASSWORD` | –               | Wenn gesetzt, fragt der Browser beim Öffnen nach dem Passwort (Benutzername egal)  |
| `TODOIST_TOKEN`      | –               | Todoist-API-Token (alternativ in den Einstellungen eintragen)                      |
| `DHL_API_KEY`        | –               | DHL-API-Schlüssel für automatischen Paketstatus (optional)                         |
| `MAIL_USER`, `MAIL_PASSWORD` | –       | GMX-Zugang (alternativ in den Einstellungen eintragen)                             |
| `MAIL_IMAP_HOST`     | automatisch     | Anderer IMAP-Server (Standard für GMX: `imap.gmx.net`)                             |
| `DATA_DIR`           | `./data`        | Speicherort der Daten (`db.json`)                                                  |
| `TZ`                 | `Europe/Berlin` | Zeitzone für Termine und Wetter                                                    |

Beispiel für den Zugriff im Heimnetz:

```bash
HOST=0.0.0.0 DASHBOARD_PASSWORD=geheim npm start
```

Alle Daten liegen lokal in `data/`. Der Ordner ist absichtlich von Git ausgeschlossen, weil er Zugangsdaten enthält. Die Datei ist nur für den eigenen Benutzer lesbar. Passwörter und Tokens werden nie an den Browser zurückgegeben.

## Wetter

Die Daten kommen von [Open-Meteo](https://open-meteo.com), kostenlos und ohne Anmeldung. Voreingestellt ist **Wiesbaden**. In den Einstellungen kannst du einen anderen Ort suchen oder „📍 Aktuellen Standort verwenden“ wählen. Der Standort funktioniert nur über `localhost` oder `https`.

## Auto-Kosten

Mit **⛽ Tanken** bzw. **+ Ausgabe** trägst du Kosten ein: Tanken, Inspektion, Reparatur, Reifen, Versicherung, Kfz-Steuer, HU/TÜV, Parken/Maut, Pflege und Sonstiges. Beim Tanken gibst du Betrag, Liter und Kilometerstand an, der Literpreis wird mitgerechnet.

Die Kachel zeigt für die letzten 12 Monate, das laufende Jahr oder gesamt:

- Kosten diesen Monat und im Zeitraum
- **Kosten pro km**: alle Kosten geteilt durch die gefahrenen km. Dafür braucht es Einträge mit Kilometerstand.
- **Ø Verbrauch** in l/100 km nach der Volltank-Methode. Dafür sind mindestens zwei Volltankungen mit Kilometerstand nötig; Teilbetankungen dazwischen werden mitgezählt.
- Letzter und durchschnittlicher **Spritpreis**
- **Monatsdiagramm** (Tanken und sonstige Kosten), Aufteilung nach Art und die letzten Einträge zum Bearbeiten
- **CSV-Export** für Excel

Ein eingetragener Kilometerstand wird automatisch in den Auto-Status übernommen.

## E-Mail (GMX)

1. In GMX einmalig den Zugriff erlauben: **E-Mail → Einstellungen → POP3/IMAP Abruf → „E-Mails über externe Programme senden und empfangen“** aktivieren.
2. Im Dashboard: **⚙ → E-Mail (GMX)** → Adresse und Passwort eingeben → Verbinden. Die Anmeldung wird dabei direkt geprüft. Bei Zwei-Faktor-Anmeldung ein App-Passwort von GMX verwenden.

Danach zeigt die Mail-Kachel alle **ungelesenen** und **markierten (⭐)** Mails im Posteingang. Mit „✓ Gelesen“ bzw. „Erledigt“ änderst du das direkt im Postfach; die Mail verschwindet dann aus der Liste. Das Dashboard liest nur und markiert, es löscht und verschickt nichts.

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

Die Paket-Kachel ist normalerweise **unsichtbar**.

**Automatisch aus Versandmails:** Ist GMX verbunden, prüft das Dashboard alle 10 Minuten die Mails der letzten 14 Tage auf Versandbestätigungen von DHL, Hermes, DPD, GLS, UPS und Amazon. Daraus übernimmt es Sendungsnummer, Paketdienst und erwarteten Liefertag und legt das Paket an. Eine spätere „Zugestellt“-Mail schließt es ab. Newsletter werden ignoriert. Jede Mail wird nur einmal ausgewertet, ein gelöschtes Paket kommt also nicht wieder.

**Von Hand:** Über 📦 in der Kopfzeile: Bezeichnung, Sendungsnummer (optional), erwarteter Tag.

Sobald ein Paket unterwegs ist:

- erscheint die Kachel mit Status, erwartetem Tag und einem Link zur Sendungsverfolgung (DHL, Hermes, DPD, GLS, UPS, Amazon). Der Paketdienst wird anhand der Nummer vorgeschlagen.
- erscheint in der Übersichtsleiste ein Hinweis, z. B. „1 kommt heute“.
- verschwindet die Kachel nach „✓ Erhalten“ am nächsten Tag wieder.

**Automatischer DHL-Status (optional):** Mit einem kostenlosen Schlüssel von [developer.dhl.com](https://developer.dhl.com) (Konto anlegen → App erstellen → API „Shipment Tracking – Unified“) holt das Dashboard den Status von DHL-Paketen selbst ab, z. B. „In Zustellung“ oder „Zugestellt“. Zugestellte Pakete werden dann automatisch ausgeblendet.

## Auto

Ältere Modelle wie der Ford Focus haben kein Online-Modem und damit keine Schnittstelle (FordPass Connect gibt es erst bei neueren Modellen). Die Werte trägst du über **Bearbeiten** ein; der Kilometerstand kommt automatisch aus den Tankeinträgen. Das Dashboard warnt 30 Tage vor HU/TÜV, Inspektion und Reifenwechsel, 1.000 km vor dem Inspektions-Kilometerstand und bei einem Tank unter 20 %.

## Aufbau

```
server.js          Express-Server und REST-API
lib/store.js       Speicherung in data/db.json
lib/weather.js     Open-Meteo (Vorhersage, Ortssuche)
lib/todoist.js     Todoist API v1
lib/packages.js    Paketdienste, Tracking-Links, DHL-Status
lib/mail.js        IMAP (GMX): offene Mails, Versandmails erkennen
public/            Oberfläche (HTML/CSS/JS, kein Build-Schritt), App-Manifest, Service Worker
scripts/           Einrichten/Starten/Stoppen auf dem Handy (Termux)
```

### API

| Methode            | Pfad                                         | Zweck                                         |
| ------------------ | -------------------------------------------- | --------------------------------------------- |
| GET                | `/api/state`                                 | Auto, Einstellungen (ohne Geheimnisse)        |
| PUT                | `/api/car`                                   | Auto-Status speichern                         |
| GET/POST           | `/api/tasks`                                 | Aufgaben (Todoist oder lokal) lesen/anlegen   |
| PATCH/DELETE       | `/api/tasks/:id`                             | Abhaken (`{ "done": true }`) / löschen (lokal) |
| GET/POST           | `/api/expenses`                              | Auto-Ausgaben lesen / eintragen               |
| PATCH/DELETE       | `/api/expenses/:id`                          | Ausgabe ändern / löschen                      |
| GET                | `/api/expenses.csv`                          | CSV-Export                                    |
| GET                | `/api/mail`                                  | Ungelesene und markierte Mails                |
| PATCH              | `/api/mail/:uid`                             | `{ "seen": true }` / `{ "flagged": false }`   |
| GET                | `/api/weather`, `/api/weather/search?q=`     | Vorhersage, Ortssuche                         |
| GET/POST           | `/api/packages`                              | Sichtbare Pakete lesen / Paket anlegen        |
| PATCH/DELETE       | `/api/packages/:id`                          | Paket ändern / entfernen                      |
| PUT                | `/api/settings/weather`, `…/todoist`, `…/dhl`, `…/mail` | Einstellungen speichern (`DELETE …/todoist` bzw. `…/mail` trennt) |
