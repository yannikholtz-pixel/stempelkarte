# Nails by Julss – Digitale Stempelkarte

Digitale Treuekarte als PWA: Kundinnen sammeln Stempel per QR-Code, Julia vergibt sie per Handy-Scanner. Beim 5. Besuch gibt es 5 € Rabatt, beim 10. Besuch 50 % auf eine Behandlung — danach beginnt die Karte von vorn.

## So funktioniert's im Alltag

1. **Neue Kundin:** Julia zeigt im Studio-Bereich (Tab „Neue Kundin") einen QR-Code. Die Kundin scannt ihn mit der Handykamera, gibt ihren Namen ein und hat ihre Karte.
2. **Stempeln:** Beim Besuch zeigt die Kundin ihre Karte (QR-Code), Julia scannt sie unter `/julia` → „Stempel geben". Doppel-Stempel innerhalb von 4 Stunden werden abgefragt.
3. **Rabatt:** Bei 5 bzw. 10 Stempeln erscheint automatisch ein Rabatt auf der Karte der Kundin. Julia löst ihn im Studio-Bereich per Knopfdruck ein.
4. **Aufs Handy:** Android → Button „Zu Google Wallet hinzufügen" (wenn eingerichtet, s. u.) oder „App installieren". iPhone → Teilen → „Zum Home-Bildschirm".

## Statistik und Steuer

Im Studio-Bereich gibt es den Tab **„Zahlen"**:

- Beim Stempeln kann Julia optional **Behandlung + Preis** eintragen — daraus entstehen die Auswertungen. Umsätze ohne Stempelkarte (Laufkundschaft) lassen sich manuell nachtragen.
- Auswertung nach Zeitraum (heute/Woche/Monat/Jahr/gesamt): Umsatz, Besuche, Ø pro Besuch, Stempel, eingelöste Rabatte, neue Kundinnen, Umsatzverlauf, Top-Behandlungen und Top-Kundinnen.
- **Excel-Export:** „Alle Einzelumsätze" (Datum, Kundin, Behandlung, Betrag) und „Monatsübersicht" als CSV mit UTF-8-BOM, Semikolon und Dezimalkomma — öffnet sich in deutschem Excel direkt korrekt. Der Jahres-Export der Einzelumsätze taugt als Einnahmen-Grundlage für die Steuererklärung (ersetzt natürlich keine Steuerberatung).

## Lokal starten

```
npm install
node server.js        # oder: Stempelkarte.bat doppelklicken
```

- Kundinnen-Seite: http://localhost:3535
- Julia-Bereich: http://localhost:3535/julia (Passwort lokal: `julia`)
- Daten liegen lokal in `data/stempelkarte.db` (SQLite, wird automatisch angelegt).

## Deployment auf Render (kostenlos)

Der Free-Tier von Render hat **keine dauerhafte Festplatte** — ohne externe Datenbank wären alle Stempel nach jedem Deploy weg. Darum braucht es eine kostenlose Postgres-Datenbank bei [Neon](https://neon.tech):

1. Auf neon.tech mit GitHub anmelden → neues Projekt → **Connection String** kopieren (beginnt mit `postgresql://`).
2. Auf render.com → New → Blueprint → dieses Repo wählen (`render.yaml` wird erkannt).
3. Umgebungsvariablen setzen:
   - `ADMIN_PASSWORD` – Julias Passwort für den Studio-Bereich (**unbedingt setzen!**)
   - `DATABASE_URL` – der Neon-Connection-String
   - `BASE_URL` – die Render-URL, z. B. `https://nails-stempelkarte.onrender.com`
4. Deploy. Fertig — die URL kann Julia an ihre Kundinnen geben.

Hinweis Free-Tier: Der Service schläft nach 15 Minuten Inaktivität ein; der erste Aufruf danach dauert ~30–60 Sekunden.

## Google Wallet einrichten (optional, kostenlos)

Damit Android-Kundinnen die Karte in die echte Google Wallet laden können:

1. [Google Pay & Wallet Console](https://pay.google.com/business/console) → mit Google-Konto anmelden → **Google Wallet API** → als Issuer registrieren (kostenlos). Die **Issuer ID** notieren.
2. In der [Google Cloud Console](https://console.cloud.google.com) ein Projekt anlegen → „Google Wallet API" aktivieren → **Service Account** erstellen → JSON-Schlüssel herunterladen.
3. In der Wallet Console unter „Nutzer" die E-Mail des Service Accounts als Entwickler hinzufügen.
4. Auf Render zwei Umgebungsvariablen setzen:
   - `GOOGLE_WALLET_ISSUER_ID` – die Issuer ID (Zahl)
   - `GOOGLE_SERVICE_ACCOUNT_JSON` – der komplette Inhalt der JSON-Datei
5. Neu deployen. Der Button „Zu Google Wallet hinzufügen" erscheint automatisch auf jeder Karte (außer auf iPhones). Stempelstände werden bei jedem Stempel in die Wallet synchronisiert.

Solange der Issuer-Account im Demo-Modus ist, zeigen die Pässe „[TEST ONLY]" — in der Console kann man **Publishing Access** beantragen, um das zu entfernen.

**Apple Wallet** ist bewusst nicht dabei: Dafür verlangt Apple einen Developer-Account (99 €/Jahr). iPhone-Nutzerinnen nehmen stattdessen „Zum Home-Bildschirm" — gleicher Komfort, keine Kosten.

## Technik

- Node.js (>= 22.5) + Express, keine nativen Abhängigkeiten (kein C++-Compiler nötig)
- Datenbank: `node:sqlite` lokal, Postgres via `DATABASE_URL` in Produktion (`db.js` abstrahiert beides)
- Google Wallet: JWT-Signierung mit `node:crypto`, keine Google-SDKs (`wallet.js`)
- Frontend: Vanilla JS PWA, QR-Erzeugung (`qrcodejs`) und -Scan (`jsQR`) lokal gebundelt in `public/vendor/`
- Icons neu erzeugen: Logo als `assets/logo-roh.png` ablegen → `npm run icons`
