# Mein Dashboard

Persönliches Dashboard als Web-App, gemacht fürs Handy: einfach den Link öffnen und als App auf den Startbildschirm legen. Kein Server, keine Installation, keine Kosten.

- **🌤 Wetter** für Wiesbaden (änderbar): aktuell, die nächsten 12 Stunden, 6 Tage und ein Regenhinweis („Regen ab ca. 17 Uhr, Schirm mitnehmen“)
- **💶 Auto-Kosten**: Tanken und alle anderen Ausgaben eintragen. Dazu gibt es ein Monatsdiagramm, die Kosten nach Art, den Verbrauch, die Kosten pro km, den Spritpreis und einen CSV-Export.
- **✅ Aufgaben**: direkt aus **Todoist** (inklusive Abhaken und neu Anlegen) oder lokal im Dashboard
- **🚗 Auto-Status**: Kilometerstand, Tank, HU/TÜV, Inspektion (nach Datum oder km), Reifenwechsel, Notizen, mit Warnungen vor fälligen Terminen
- **Übersicht** mit Wetter, fälligen Aufgaben, Auto-Hinweisen und Autokosten des Monats
- Auf dem Handy: **Tab-Leiste** (Heute, Aufgaben, Auto), Eingaben als Bottom-Sheet. Als App installierbar und auch **ohne Internet** nutzbar.

## Online stellen (einmalig, kostenlos über GitHub Pages)

1. Auf GitHub das Repository öffnen → **Settings** → **Pages**.
2. Unter *Build and deployment*: **Source: Deploy from a branch**.
3. **Branch:** `ccr-da9c4d43-8x19ts`, **Ordner:** `/docs` → **Save**.
4. Nach ein bis zwei Minuten ist das Dashboard erreichbar unter
   **https://nuowdnio.github.io/Dashboard/**

## Auf dem Handy einrichten

1. Den Link in **Chrome** öffnen.
2. **Menü ⋮ → „App installieren“** bzw. „Zum Startbildschirm hinzufügen“. Jetzt hast du ein Dashboard-Symbol wie bei jeder App. Lange auf das Symbol drücken zeigt Abkürzungen wie „Tanken“ und „Neue Aufgabe“.
3. Für Todoist: **⚙ → Todoist** → API-Token einfügen. Den Token findest du in Todoist unter *Einstellungen → Integrationen → Entwickler*.

## Wo liegen meine Daten?

**Nur auf deinem Gerät**, im Speicher des Browsers. Die Webseite selbst enthält keine persönlichen Daten. Nichts davon geht an GitHub oder an einen Server. Wetter kommt direkt von [Open-Meteo](https://open-meteo.com), Todoist direkt von Todoist.

Daraus folgt:

- **Sicherung:** ⚙ → *Daten sichern* → „Sicherung herunterladen“ speichert eine Datei mit allen Einträgen. Mach das ab und zu, z. B. zum Monatsende. Löschst du die Browserdaten von Chrome, sind die Einträge sonst weg. Der Todoist-Token wird absichtlich nicht mitgesichert.
- **Gerät wechseln:** Auf dem neuen Gerät „Sicherung laden“ wählen und die Datei auswählen.
- Handy und PC haben jeweils **eigene Daten**. Sie gleichen sich nicht automatisch ab.

## Auto-Kosten

Mit **⛽ Tanken** bzw. **+ Ausgabe** trägst du Kosten ein: Tanken, Inspektion, Reparatur, Reifen, Versicherung, Kfz-Steuer, HU/TÜV, Parken/Maut, Pflege und Sonstiges. Beim Tanken gibst du Betrag, Liter und Kilometerstand an, den Literpreis rechnet das Dashboard aus.

- **Kosten pro km:** alle Kosten geteilt durch die gefahrenen km. Dafür braucht es Einträge mit Kilometerstand.
- **Ø Verbrauch** in l/100 km nach der Volltank-Methode. Dafür sind mindestens zwei Volltankungen mit Kilometerstand nötig. Teilbetankungen dazwischen werden mitgezählt.
- Der Kilometerstand eines Eintrags wird automatisch in den Auto-Status übernommen.
- **CSV-Export** für Excel (Semikolon, Dezimalkomma)

## Aufbau

```
docs/index.html            Oberfläche
docs/app.js                Logik der Oberfläche
docs/local-api.js          Datenschicht im Browser (Speicher, Wetter, Todoist, Sicherung)
docs/styles.css            Gestaltung (hell/dunkel, Handy-Ansicht)
docs/sw.js                 Offline-Fähigkeit
docs/manifest.webmanifest  App-Installation
```

Lokal ausprobieren: im Ordner `docs` z. B. `python3 -m http.server 8080` starten und http://localhost:8080 öffnen.

Die frühere Version mit eigenem Server (GMX-Mails, automatische Paketerkennung, Termux) steht in der Git-Historie bis Commit `71c0026`.
