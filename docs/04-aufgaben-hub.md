# BluePy-Hub – Aufgaben verteilen und einsammeln ohne Git und ohne Logins

Stand: 13.10.2026, beschlossen (Hub-Ansatz, Hetzner-Server der Lehrkraft, Klassenliste mit persönlichen Codes). Umsetzung **M5 / Version 1.0**: vollständig (Server, Paketformat, Holen/Abgeben/Aktualisieren, Rückmeldung, Klassen, Veröffentlichen, Einsammeln, Korrekturmodus mit Tests über alle Abgaben).

## Ziel

Eine Lehrkraft verteilt ein BluePy-Projekt als Aufgabe, Schülerinnen und Schüler (SuS) holen es mit einem Code, bearbeiten es in BluePy und geben es mit einem Klick ab. Die Lehrkraft holt alle Abgaben auf einmal und korrigiert sie direkt in BluePy. Niemand meldet sich irgendwo an; es gibt keine Mail, kein Git, keine Accounts. Funktioniert auf Schulrechnern und zu Hause.

## Rollen und Geheimnisse

| Wer | Hat | Bekommt es wie |
|---|---|---|
| Lehrkraft | **Lehrer-Schlüssel** (lang, zufällig) + Hub-URL | einmal in BluePy *Einstellungen ▸ Aufgaben-Hub* eingetragen; vom Hub-Admin erzeugt (`hub-admin teacher add "Heidkamp"`) |
| SuS | **Aufgabencode** (pro Aufgabe, z. B. `KONTO-7H3K`) | von der Lehrkraft (Tafel, IServ) |
| SuS | **persönlicher Code** (6 Zeichen, pro Klasse einmalig, z. B. `M4K2PX`) | einmal von der Lehrkraft (Zettel/IServ), BluePy merkt ihn sich auf dem Gerät |

Der Aufgabencode öffnet die Aufgabe; der persönliche Code ordnet die Abgabe zu. Abgeben „im Namen eines anderen" braucht dessen Code – eine Hürde, kein Schutz, und das ist in Ordnung. Zusätzlich speichert der Hub pro Abgabe eine anonyme Geräte-Kennung (Hash); gibt ein Gerät unter mehreren Codes ab, zeigt die Übersicht das an.

Mehrere Lehrkräfte können denselben Hub nutzen: jede hat einen eigenen Schlüssel, Aufgabencodes sind hubweit eindeutig, Klassenlisten gehören zur Lehrkraft.

## Ablauf

### Lehrkraft: Klassenliste anlegen (einmal pro Klasse)

*Aufgaben ▸ Klassen verwalten…*: Name der Klasse, Namen der SuS (einfügen aus Zwischenablage, eine Zeile pro Person). Der Hub erzeugt die persönlichen Codes; BluePy zeigt eine druckbare Liste / kopierbaren Text „Name – Code". Namen bleiben beim Hub nur in dieser Liste (keine weiteren Personendaten).

### Lehrkraft: Aufgabe veröffentlichen

*Aufgaben ▸ Neue Aufgabe für SuS…* aus dem aktuell geöffneten Projekt:

- **Titel**, **Beschreibung** (Markdown; wird als `AUFGABE.md` ins Projekt gelegt und bei den SuS als eigener, einklappbarer Bereich im Editor-Fenster angezeigt)
- **Abgabe ab / bis** (Datum + Uhrzeit; Vorschlag: jetzt / in 7 Tagen)
- **Aufgabencode** (Vorschlag vom Hub aus dem Titel, änderbar)
- **Klasse(n)** aus der Klassenliste
- optional: Dateien ausschließen (z. B. Musterlösung), Unit-Tests mitgeben (Standard: ja)

BluePy packt das Projekt als `.bluepy`-Paket (ZIP mit `package.bluepy`, allen `.py`, `AUFGABE.md`, `aufgabe.json`) und lädt es mit dem Lehrer-Schlüssel hoch. Die Aufgabe ist sofort holbar; abgeben geht nur im Zeitfenster (Serverzeit).

### SuS: Aufgabe holen, bearbeiten, abgeben

- *Aufgaben ▸ Aufgabe holen…* → Aufgabencode → Projekt liegt unter `Dokumente/BluePy/Aufgaben/<Code> <Titel>/` und ist geöffnet; Beschreibung und Zeitfenster sind sichtbar (Bereich *Aufgabe* im Editor-Fenster, Status „Abgabe bis Fr 17:00").
- *Aufgaben ▸ Abgeben* (auch Toolbar-Button, nur in Aufgabenprojekten): beim ersten Mal den persönlichen Code eingeben (wird gespeichert), danach ein Klick. BluePy packt das Projekt, lädt es hoch, zeigt „Abgabe angenommen – 14:32 Uhr". Mehrfach abgeben ist erlaubt, es zählt die letzte Abgabe. Außerhalb des Zeitfensters: klare Meldung, keine Annahme.
- *Aufgaben ▸ Aufgabe aktualisieren*: holt eine nachgebesserte Aufgabenversion; nur Dateien, die SuS nicht geändert haben, werden ersetzt.

### Lehrkraft: Abgaben einsammeln und korrigieren

*Aufgaben ▸ Abgaben einsammeln…* → Aufgabe wählen → BluePy lädt **alle** Abgaben (beim nächsten Mal nur neue/geänderte) nach `Dokumente/BluePy/Abgaben/<Code>/<Name>/` und öffnet den **Korrekturmodus**:

- links die Klassenliste mit Status je SuS: *abgegeben* (Zeitstempel), *zu spät* (falls Nachfrist erlaubt), *fehlt*, Hinweis bei doppelter Geräte-Kennung
- Klick auf einen Namen → die Abgabe ist als Projekt geöffnet: Editor, Klassendiagramm, Objekte erzeugen, Debugger, **Tests ausführen** – alles wie gewohnt
- rechts **Notizen + Punkte** zur Abgabe (lokal in `korrektur.json` im Abgabenordner), Pfeile vor/zurück, Fortschritt „12 von 27 gesehen"
- *Tests über alle Abgaben ausführen* → Tabelle (SuS × Testmethoden, bestanden/fehlgeschlagen/Fehler), als CSV exportierbar
- später: *Rückmeldung an den Hub* (Notizen + Punkte, optional) – SuS holen sie mit *Aufgaben ▸ Rückmeldung abrufen*

### Fallback ohne Hub

*Projekt ▸ Als Paket exportieren…* / *Paket importieren…* (`.bluepy`, dieselbe ZIP-Struktur) für USB-Stick, IServ-Dateiablage oder Mail. Dasselbe Paketformat wie der Hub, also kein Sonderweg.

## Der Hub

Ein kleiner Python-Dienst (Stdlib + `fastapi`/`uvicorn`, eine Datei-Ablage, SQLite für Metadaten), als **ein Docker-Container** mit Caddy davor (automatisches HTTPS). Läuft auf einem Hetzner CX22 (~4 €/Monat) oder jedem anderen Linux-Server mit Docker. Setup: `docker compose up -d`, Domain auf den Server zeigen lassen, `hub-admin teacher add` – zehn Minuten.

### Endpunkte

| Methode | Pfad | Wer | Zweck |
|---|---|---|---|
| `POST` | `/api/classes` | Lehrkraft | Klassenliste anlegen → persönliche Codes |
| `GET` | `/api/classes` | Lehrkraft | Klassen und Codes |
| `POST` | `/api/tasks` | Lehrkraft | Aufgabe veröffentlichen (Multipart: `aufgabe.json` + Paket) → Aufgabencode |
| `GET` | `/api/tasks` | Lehrkraft | eigene Aufgaben mit Abgabezählern |
| `GET` | `/api/tasks/{code}` | SuS | Aufgabe holen (Metadaten + Paket); Code ist das Geheimnis |
| `POST` | `/api/tasks/{code}/submissions` | SuS | Abgabe (persönlicher Code + Paket + Geräte-Kennung); Server prüft Zeitfenster und Klasse |
| `GET` | `/api/tasks/{code}/submissions` | Lehrkraft | alle Abgaben (Liste + Download, `If-Modified-Since` für „nur Neues") |
| `GET` | `/api/tasks/{code}/feedback/{personal}` | SuS | Rückmeldung (später) |

Authentifizierung: Lehrer-Schlüssel als `Authorization: Bearer …`; SuS-Anfragen tragen nur Aufgabencode (Pfad) und persönlichen Code (Body). Rate-Limit auf das Raten von Codes (Aufgabencodes: 2 Wörter + 4 Zeichen ≈ 2^30; persönliche Codes nur in Verbindung mit einem Aufgabencode gültig). Pakete max. 20 MB. Keine Personendaten außer den Namen in der Klassenliste; Löschen einer Klasse/Aufgabe löscht alles dazu.

### Ablage auf dem Server

```
data/
  hub.sqlite                 Lehrkräfte, Klassen, Codes, Aufgaben, Abgaben (Metadaten)
  tasks/<code>/aufgabe.bluepy
  submissions/<code>/<personal>/<timestamp>.bluepy   (letzte zählt, ältere bleiben für Nachfragen)
```

### Paketformat `.bluepy`

ZIP mit `package.bluepy` (wie im Projekt), allen Projektdateien außer `__pycache__`/versteckten Ordnern, `AUFGABE.md` und `aufgabe.json`:

```json
{
  "format": 1,
  "code": "KONTO-7H3K",
  "title": "Konto und Sparkonto",
  "teacher": "Heidkamp",
  "classes": ["8c"],
  "submitFrom": "2026-10-14T08:00:00+02:00",
  "submitUntil": "2026-10-21T17:00:00+02:00",
  "version": 2,
  "tests": true
}
```

## In BluePy

- Menü **Aufgaben** (neu): Aufgabe holen…, Abgeben, Aufgabe aktualisieren, — Neue Aufgabe für SuS…, Abgaben einsammeln…, Klassen verwalten…, — Paket exportieren…, Paket importieren…. Lehrer-Einträge erscheinen nur, wenn ein Lehrer-Schlüssel eingetragen ist.
- Einstellungen: Hub-URL, Lehrer-Schlüssel (im OS-Schlüsselbund via `safeStorage`), persönlicher Code (ebenfalls geschützt gespeichert).
- Main-Prozess: `hub/client.ts` (HTTPS, Pakete packen/entpacken mit `node:zlib`/`yauzl`-frei über eigene ZIP-Implementierung oder `adm-zip`), Korrekturmodus als Zustand im `AppState` (`review: { code, submissions, index, notes }`).
- Editor-Fenster: Bereich *Aufgabe* (Markdown-Ansicht der `AUFGABE.md`, Zeitfenster, Abgabe-Button); Korrekturleiste im Korrekturmodus.

## Umsetzung (M5)

| Teil | Stand | Wo |
|---|---|---|
| Paketformat `.bluepy`, Export/Import | fertig | `apps/desktop/src/main/hub/package.ts`, `zip.ts` (ZIP ohne Fremdbibliothek) |
| Hub-Server, Docker, Caddy, `hub-admin` | fertig, 6 API-Tests | `hub/` (`python -m bluepy_hub`), `hub/README.md` |
| SuS: Aufgabe holen, Aufgabenbereich, Abgeben, persönlicher Code | fertig | `main/hub/manager.ts`, `renderer/components/HubDialogs.tsx`, `AssignmentPane.tsx` |
| Lehrkraft: Klassen, Veröffentlichen, Einsammeln, Korrekturmodus | fertig | `HubDialogs.tsx`, `ReviewBar.tsx` |
| Rückmeldung an SuS | fertig (`/feedback`; *Aufgaben ▸ Rückmeldung abrufen…*) | `HubDialogs.tsx` (FeedbackDialog) |
| Tests über alle Abgaben als Tabelle | fertig – jede Abgabe in eigenem Prozess, Testdateien der Lehrkraft aus `_aufgabe/` gewinnen, Watchdog 60 s, CSV | `backend/run_tests.py`, `manager.reviewRunTests`, ReviewTestsDialog |
| Aufgabe aktualisieren (SuS) | fertig – `originalHashes` in `aufgabe.json`, nur unveränderte Dateien werden ersetzt | `manager.updateTask` |

Abweichungen vom Entwurf: Pakete gehen als base64 im JSON-Body statt Multipart (Server bleibt Stdlib-only); Abgaben außerhalb des Zeitfensters werden abgelehnt, eine Nachfrist gibt es noch nicht (`allowLate` ist im Protokoll vorgesehen).
