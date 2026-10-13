# BluePy

**BluePy ist BlueJ für Python**: eine Lern-IDE mit Klassendiagramm, Objektleiste, interaktiven Methodenaufrufen, Code Pad, Inspektoren, Debugger und Unit-Test-Aufnahme – lokal installierbar auf Windows, macOS und Linux. Lizenz: GPL-3.0.

- [docs/01-bluej-funktionsanalyse.md](docs/01-bluej-funktionsanalyse.md) – was BlueJ kann und wie es auf Python übertragen wird
- [docs/02-adr-stack-und-architektur.md](docs/02-adr-stack-und-architektur.md) – Stack, Architektur, Meilensteine
- [docs/03-rpc-protokoll.md](docs/03-rpc-protokoll.md) – Protokoll zwischen IDE und Python-Backend

## Stand

**M1 + M2-Kern – benutzbar.** Projekt anlegen/öffnen (Welcome-Screen, zuletzt geöffnet, Beispielprojekt „bank“), Dateien im Editor mit Tabs, Speichern und Syntaxprüfung beim Tippen, **Compile** (Syntaxprüfung + Laden ins Backend), **Klassendiagramm** aus statischer Analyse mit Vererbung, Assoziationen (Multiplizitäten, Komposition/Aggregation) und Uses-Pfeilen, Klassen verschiebbar (Layout in `package.bluepy`), **Objektleiste**: Rechtsklick auf Klasse → `new …`, Rechtsklick auf Objekt → Methoden (auch geerbte), Ergebnisdialog, **Inspektor** (verschachtelt, „Auf die Objektleiste“), Record method calls im Terminal, Modul ausführen. Zwei Fenster: der **Editor ist das Hauptfenster**, das **Klassendiagramm** mit Objektleiste hat ein eigenes (Menü *Fenster*, ⌘⇧D). Code Pad und Terminal (inkl. `input()` und Halt) wie in M0.

**M3 – Debugger.** Breakpoints per Klick in die Editor-Gutter, Debugger-Fenster (⌘⇧B) mit Aufrufsequenz, Klassen-/Instanz-/lokalen Variablen (Doppelklick inspiziert), Halt / Step / Step Into / Step Out / Continue / Terminate. Das Fenster öffnet sich automatisch beim Anhalten; die aktuelle Zeile ist im Editor gelb markiert. Solange das Debugger-Fenster offen ist, pausiert *Halt* das laufende Programm statt es abzubrechen.

Noch offen: Pyright-Completion, Unit-Test-Aufnahme (M4), Git + Aufgaben-Workflow (M5).

Schnellstart: `pnpm dev` → „Beispiel „bank“ öffnen“ → **Compile** (⌘K) → Fenster *Klassendiagramm* (⌘⇧D) → Rechtsklick auf `Person` → `new Person("Anna")` → Rechtsklick auf `Konto` → `new Konto(person1, 100)` → Rechtsklick auf `konto1` → `einzahlen(50)` → `kontostand()`. Debugger: in `konto.py` links neben `self.stand += betrag` klicken (Breakpoint) → `konto1.einzahlen(5)` → Debugger-Fenster → Step.

## Voraussetzungen (Entwicklung)

- Node.js ≥ 22 und pnpm (über Corepack: `corepack enable`)
- Python ≥ 3.11 (wird zur Laufzeit erkannt, nicht gebündelt)

## Entwickeln

```bash
pnpm install          # einmalig; lädt auch das Electron-Binary (Build-Skripte für electron/esbuild sind in pnpm-workspace.yaml freigegeben)
pnpm dev              # startet Electron mit Hot Reload
pnpm typecheck        # TypeScript (main, preload, renderer, protocol)
pnpm test             # Vitest (Discovery-Parsing, Protokoll-Schemas, Scope-Highlighting)
pnpm test:backend     # Python-Backend (unittest, startet echte Backend-Prozesse)
```

Nach dem ersten `pnpm install` bitte `pnpm-lock.yaml` mit einchecken (CI nutzt `--frozen-lockfile`).

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
