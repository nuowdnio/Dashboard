# Mein Dashboard

Persönliches Dashboard als Web-App, gemacht fürs Handy: einfach den Link öffnen und als App auf den Startbildschirm legen. Kein Server, keine Installation, keine Kosten.

- **📰 Morgenbriefing**: die Top-Meldungen aus deinem [Morgenbriefing](https://nuowdnio.github.io/morgenbriefing/) mit Kurzfassung, Börsenlage (DAX) und einem Link zum ganzen Briefing
- **🌤 Wetter** für Wiesbaden (änderbar): aktuell, die nächsten 12 Stunden, 6 Tage und ein Regenhinweis
- **❄️ Frost und Glätte**: ein Hinweis wie „Frost bis −3° gegen 6 Uhr: Scheibe freikratzen, 5 Minuten früher los“
- **⚠ Unwetterwarnungen** des Deutschen Wetterdienstes für deinen Ort. Sie erscheinen nur, wenn eine Warnung besteht.
- **⛽ Spritpreise**: die günstigsten geöffneten Tankstellen in der Nähe (E10, E5 oder Diesel), im Vergleich zu deinem letzten Tankpreis
- **💶 Auto-Kosten**: Tanken und alle anderen Ausgaben eintragen. Dazu gibt es ein Monatsdiagramm, den **Verbrauch über die Zeit**, die Kosten nach Art, die Kosten pro km und einen CSV-Export.
- **🛢 Ölwechsel**: Fortschritt bis zum nächsten Ölwechsel (nach km und Zeit), mit Warnung, wenn er fällig wird
- **✅ Aufgaben**: direkt aus **Todoist** (inklusive Abhaken und neu Anlegen) oder lokal im Dashboard
- **🗒 Notizen**: kurze Notizen, die du anheften, bearbeiten und kopieren kannst
- **🚗 Auto-Status**: Kilometerstand, HU/TÜV, Inspektion, Ölwechsel und Reifenwechsel, mit Warnungen vor fälligen Terminen
- Auf dem Handy: **Tab-Leiste** (Heute, To-dos, Auto), Eingaben als Bottom-Sheet. Als App installierbar und auch **ohne Internet** nutzbar.

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
4. Für Spritpreise: auf **onboarding.tankerkoenig.de** kostenlos einen API-Schlüssel anfordern (Name und E-Mail). Dann **⚙ → Spritpreise** → Schlüssel einfügen und Sorte wählen.

Morgenbriefing, Wetter, Frost und Unwetterwarnungen funktionieren ohne Einrichtung.

## Wo liegen meine Daten?

**Nur auf deinem Gerät**, im Speicher des Browsers. Die Webseite selbst enthält keine persönlichen Daten. Nichts davon geht an GitHub oder an einen Server. Das Dashboard holt sich nur Daten ab:

- Wetter von [Open-Meteo](https://open-meteo.com)
- Unwetterwarnungen des DWD über [Bright Sky](https://brightsky.dev)
- Spritpreise von [Tankerkönig](https://creativecommons.tankerkoenig.de) (Daten der MTS-K, CC BY 4.0)
- Todoist direkt von Todoist
- das Briefing von deiner Briefing-Seite

Daraus folgt:

- **Sicherung:** ⚙ → *Daten sichern* → „Sicherung herunterladen“ speichert eine Datei mit allen Einträgen. Mach das ab und zu, z. B. zum Monatsende. Löschst du die Browserdaten von Chrome, sind die Einträge sonst weg. Todoist-Token und Tankerkönig-Schlüssel werden absichtlich nicht mitgesichert.
- **Gerät wechseln:** Auf dem neuen Gerät „Sicherung laden“ wählen und die Datei auswählen.
- Handy und PC haben jeweils **eigene Daten**. Sie gleichen sich nicht automatisch ab.

## Auto-Kosten

Mit **⛽ Tanken** bzw. **+ Ausgabe** trägst du Kosten ein: Tanken, Inspektion, Reparatur, Reifen, Versicherung, Kfz-Steuer, HU/TÜV, Parken/Maut, Pflege und Sonstiges. Beim Tanken gibst du Betrag, Liter und Kilometerstand an, den Literpreis rechnet das Dashboard aus.

- **Kosten pro km:** alle Kosten geteilt durch die gefahrenen km. Dafür braucht es Einträge mit Kilometerstand.
- **Ø Verbrauch** in l/100 km nach der Volltank-Methode. Dafür sind mindestens zwei Volltankungen mit Kilometerstand nötig. Teilbetankungen dazwischen werden mitgezählt.
- **Verbrauch über Zeit:** ein Punkt je Volltankung, mit Linie für den Durchschnitt. Tippen oder Zeigen auf einen Punkt zeigt Datum, Verbrauch, km und Liter.
- Der Kilometerstand eines Eintrags wird automatisch in den Auto-Status übernommen.
- **Ölwechsel:** Unter *Mein Auto → Bearbeiten* trägst du den letzten Ölwechsel ein (km und Datum) und das Intervall (Standard: 15.000 km oder 12 Monate, je nachdem, was zuerst kommt). Trägst du später eine Ausgabe der Art „Ölwechsel“ mit Kilometerstand ein, beginnt der Zähler automatisch neu.
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
