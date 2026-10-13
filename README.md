# BluePy

**BluePy** ist eine Lern-IDE für Python im Informatikunterricht: Klassendiagramm, Objektleiste, interaktive Methodenaufrufe, Code Pad, Inspektoren, Debugger und Unit-Test-Aufnahme – lokal installierbar auf Windows, macOS und Linux. Lizenz: GPL-3.0. Website: https://bluepy.heidkamp.dev (Landing Page in `site/`).

- [docs/01-bluej-funktionsanalyse.md](docs/01-bluej-funktionsanalyse.md) – Funktionsanalyse des didaktischen Vorbilds und Übertragung auf Python (internes Arbeitsdokument)
- [docs/02-adr-stack-und-architektur.md](docs/02-adr-stack-und-architektur.md) – Stack, Architektur, Meilensteine
- [docs/03-rpc-protokoll.md](docs/03-rpc-protokoll.md) – Protokoll zwischen IDE und Python-Backend
- [docs/04-aufgaben-hub.md](docs/04-aufgaben-hub.md) – Aufgaben verteilen und einsammeln ohne Git und Logins (BluePy-Hub, M5)

## Stand: Version 1.0

**Enthalten:** alles unten plus **Pyright-Vervollständigung** (Completion mit Docstrings, Hover, Typfehler als Unterstreichung – läuft als Kindprozess in Electrons Node, braucht kein Python-Paket), **sechs Beispielprojekte** auf dem Welcome-Screen (`examples/index.json`: Python-Grundlagen mit Übungsaufgaben, Bank, Tierpark, Quest-Spiel, Datenstrukturen, Geheimschrift – alle mit Unit-Tests), Rückmeldung an SuS (*Aufgaben ▸ Rückmeldung abrufen…*), *Aufgabe aktualisieren* (nur von SuS unveränderte Dateien werden ersetzt), **Tests über alle Abgaben** im Korrekturmodus (jede Abgabe in einem eigenen Python-Prozess mit den Testdateien der Lehrkraft, Ergebnistabelle, CSV).

**M1 + M2-Kern – benutzbar.** Projekt anlegen/öffnen (Welcome-Screen, zuletzt geöffnet, Beispielprojekt „bank“), Dateien im Editor mit Tabs, Speichern und Syntaxprüfung beim Tippen, **Compile** (Syntaxprüfung + Laden ins Backend), **Klassendiagramm** aus statischer Analyse mit Vererbung, Assoziationen (Multiplizitäten, Komposition/Aggregation) und Uses-Pfeilen, Klassen verschiebbar (Layout in `package.bluepy`), **Objektleiste**: Rechtsklick auf Klasse → `new …`, Rechtsklick auf Objekt → Methoden (auch geerbte), Ergebnisdialog, **Inspektor** (verschachtelt, „Auf die Objektleiste“), Record method calls im Terminal, Modul ausführen. Zwei Fenster: der **Editor ist das Hauptfenster**, das **Klassendiagramm** mit Objektleiste hat ein eigenes (Menü *Fenster*, ⌘⇧D). Code Pad und Terminal (inkl. `input()` und Halt) wie in M0.

**M3 – Debugger.** Breakpoints per Klick in die Editor-Gutter, Debugger-Fenster (⌘⇧B) mit Aufrufsequenz, Klassen-/Instanz-/lokalen Variablen (Doppelklick inspiziert), Halt / Step / Step Into / Step Out / Continue / Terminate. Das Fenster öffnet sich automatisch beim Anhalten; die aktuelle Zeile ist im Editor gelb markiert. Solange das Debugger-Fenster offen ist, pausiert *Halt* das laufende Programm statt es abzubrechen.

Kleinigkeiten: Rückgabewerte interaktiver Aufrufe erscheinen zusätzlich im Terminal („→ 60 (int)“); Dateiliste, Code Pad, Terminal und Objektleiste lassen sich über ▾ zu einem Streifen einklappen (Zustand wird pro Fenster gemerkt). **Scope-Highlighting**: jeder Block ist ein Kasten hinter dem Text – Klasse grün, Funktion/Methode gelb, Schleife blau, Verzweigung/try/with lila –, der Rumpf heller abgesetzt, verschachtelte Kästen rechts eingerückt (`editor/scopeHighlight.ts`, Farben als `--scope-*` in `styles.css`).

**M4 – Unit-Tests** (auf `unittest`): Rechtsklick auf eine Klasse → *Testklasse anlegen* (`test_konto.py` mit `KontoTest`), Rechtsklick auf die Testklasse → *Alle Tests*, einzelne Testmethoden, *Testmethode aufnehmen…* (alle Objekt-Interaktionen werden zur Testmethode, der Ergebnisdialog bietet Assertions an, Fixture-Objekte werden `self.…`), *Objektleiste → Fixture (setUp)* und zurück. *Tests ausführen* (⌘⇧R) läuft über alle Testklassen; das **Testergebnis-Fenster** (⌘⇧T) zeigt Live-Ergebnisse mit Balken, Zählern, Meldung und gefiltertem Traceback, Doppelklick springt zur Zeile.

Außerdem: Objekte, die im Code Pad per Zuweisung entstehen (`k = Konto(p, 5)`), liegen automatisch auf der Objektleiste, die jetzt auch im Editor-Fenster unter dem Code Pad steht (Rechtsklick → Methoden, Inspizieren); Objekt-Ergebnisse ohne Zuweisung haben einen Chip „Inspizieren / Auf die Objektleiste". **Dark Mode**: Menü *Ansicht ▸ Farbschema* oder der ◐/☀/☾-Button in jeder Toolbar (System/Hell/Dunkel), Editor inklusive Syntaxfarben.

**M5 – Aufgaben ohne Git und ohne Logins** (`docs/04-aufgaben-hub.md`, Server in `hub/`): Menü **Aufgaben**. SuS: *Aufgabe holen…* (Code eingeben → Projekt liegt in `Dokumente/BluePy/Aufgaben` und ist offen, Beschreibung + Frist im Bereich *Aufgabe*), *Abgeben* (persönlicher Code einmalig, danach ein Klick). Lehrkraft (sobald ein Lehrer-Schlüssel eingetragen ist): *Klassen verwalten…* (Namen einfügen → persönliche Codes), *Neue Aufgabe für SuS…* (Titel, Markdown-Beschreibung, Zeitfenster, Code, Klassen, Dateien ausschließen), *Abgaben einsammeln…* (alle Abgaben nach `Dokumente/BluePy/Abgaben`, **Korrekturmodus** mit Abgaben-Auswahl, ◀ ▶, Punkte + Notizen in `korrektur.json`, Tests ausführen). Dazu *Projekt als Paket exportieren…* / *Paket importieren…* (`.bluepy`). Der Hub ist reine Python-Stdlib + SQLite in einem Docker-Container, Anleitung in `hub/README.md`.

Nicht in 1.0: Windows-Signatur (Zertifikat), Interactive Tutorial, Accessibility-Feinschliff.

Schnellstart: `pnpm dev` → „Beispiel „bank“ öffnen“ → **Compile** (⌘K) → Fenster *Klassendiagramm* (⌘⇧D) → Rechtsklick auf `Person` → `new Person("Anna")` → Rechtsklick auf `Konto` → `new Konto(person1, 100)` → Rechtsklick auf `konto1` → `einzahlen(50)` → `kontostand()`. Debugger: in `konto.py` links neben `self.stand += betrag` klicken (Breakpoint) → `konto1.einzahlen(5)` → Debugger-Fenster → Step.

## Voraussetzungen (Entwicklung)

- Node.js ≥ 22 und pnpm (über Corepack: `corepack enable`)
- Python ≥ 3.11 (wird zur Laufzeit erkannt, nicht gebündelt)

## Entwickeln

```bash
pnpm install          # einmalig; lädt auch das Electron-Binary (Build-Skripte für electron/esbuild sind in pnpm-workspace.yaml freigegeben)
pnpm dev              # startet Electron mit Hot Reload (BLUEPY_DEVTOOLS=1 pnpm dev öffnet die DevTools mit)
pnpm typecheck        # TypeScript (main, preload, renderer, protocol)
pnpm test             # Vitest (Discovery-Parsing, Protokoll-Schemas, Scope-Highlighting)
pnpm test:backend     # Python-Backend (unittest, startet echte Backend-Prozesse)
```

Nach dem ersten `pnpm install` bitte `pnpm-lock.yaml` mit einchecken (die Release-Action nutzt `--frozen-lockfile`).

## Release und Signierung

**Was du einmalig brauchst**

macOS (Developer ID hast du):
1. Xcode ▸ Settings ▸ Accounts ▸ *Manage Certificates…* ▸ ＋ ▸ **Developer ID Application** (falls noch nicht vorhanden).
2. Schlüsselbundverwaltung ▸ Zertifikat „Developer ID Application: … (TEAMID)“ **mit privatem Schlüssel** auswählen ▸ Exportieren als `.p12` mit Passwort.
3. `base64 -i zertifikat.p12 | pbcopy` → Secret `CSC_LINK`; das Passwort → `CSC_KEY_PASSWORD`.
4. Notarisierung: `APPLE_ID` (deine Apple-ID), `APPLE_APP_SPECIFIC_PASSWORD` (appleid.apple.com ▸ Anmeldung und Sicherheit ▸ App-spezifische Passwörter), `APPLE_TEAM_ID` (developer.apple.com ▸ Membership).

Windows (Zertifikat fehlt noch) – zwei brauchbare Wege, beide ohne Hardware-Token:
- **SignPath Foundation** (kostenlos für Open-Source-Projekte, GPL ok): Antrag unter signpath.org/foundation, Signierung läuft über deren Dienst aus GitHub Actions. Dauert ein paar Wochen Prüfung, dann die sauberste Lösung.
- **Azure Trusted Signing** (~10 $/Monat, Identitätsprüfung als Einzelperson oder Organisation): sofort nutzbar, electron-builder unterstützt es direkt (`win.azureSignOptions`).
Klassische OV/EV-Zertifikate (Sectigo, DigiCert) brauchen seit 2023 einen Hardware-Token und passen nicht in eine GitHub-Action. Ohne Signatur startet der Installer trotzdem, Windows zeigt nur „Unbekannter Herausgeber“ (SmartScreen, *Trotzdem ausführen*).

Linux braucht keine Signatur.

## Release

Es gibt keine CI auf Push. Ein **GitHub-Release** (Tag beliebig, z. B. `v1.0.0`; die Dateinamen tragen die Version aus `apps/desktop/package.json`) startet `.github/workflows/release.yml`: baut auf macOS/Windows/Linux, signiert und notarisiert (macOS mit Developer ID, Windows sobald das Zertifikat als Secret hinterlegt ist) und hängt DMG, Setup-EXE/Portable, AppImage/DEB per `gh release upload` an genau dieses Release. Die nötigen Secrets stehen oben in der Workflow-Datei. Manuell: *Actions → Release → Run workflow* baut ohne Veröffentlichung (Installer als Artefakte). Wichtig: *Re-run jobs* baut immer den ursprünglichen Commit des Runs – nach einem Fix also ein neues Release anlegen oder *Run workflow* nutzen.

## Paketieren

```bash
pnpm dist             # electron-builder für das aktuelle OS → apps/desktop/release/
pnpm --filter @bluepy/desktop dist:mac    # DMG (universal); Notarisierung über APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
pnpm --filter @bluepy/desktop dist:win    # NSIS, MSI, portable
pnpm --filter @bluepy/desktop dist:linux  # deb, AppImage
```

## Struktur

```
apps/desktop/        Electron-App (src/main, src/preload, src/renderer)
packages/protocol/   RPC- und IPC-Verträge (TypeScript + zod)
backend/             Python-Backend (nur Stdlib) + Tests
docs/                Analyse, ADRs, Protokoll
```

## Architektur in einem Satz

Der Electron-Main-Prozess startet das Python der Lernenden mit `backend/launcher.py`, spricht mit ihm JSON-RPC über einen localhost-Socket und zeigt alles im Renderer (React) an – Nutzercode läuft nie im IDE-Prozess.
