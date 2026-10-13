# ADR 002 – Stack und Architektur von BluePy

Status: **beschlossen** (13.10.2026)
Vorgänger: [01 – BlueJ-Funktionsanalyse](01-bluej-funktionsanalyse.md)

## Kontext

BluePy soll exakt die Funktionen von BlueJ bieten, aber für Python, lokal installierbar auf Windows, macOS und Linux. BlueJ selbst wird **nicht** geforkt. Die Entscheidungen unten wurden in der Stack-Diskussion getroffen.

## Entscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| 1 | **Electron + TypeScript (strict)** als IDE-Shell | Plattformübergreifend, größtes Ökosystem für Editor- und Diagramm-Komponenten. |
| 2 | **Kein gebündelter Interpreter.** Python ≥ 3.11 wird vorausgesetzt; BluePy hat eine integrierte Erkennung mit Status-Chip und OS-spezifischer Installationsanleitung. | Schülerinnen und Schüler installieren Python selbst; BluePy muss das zuverlässig erkennen und erklären. 3.10 ist seit Oktober 2026 EOL. |
| 3 | **CodeMirror 6** als Editor (nicht Monaco) | Scope-Highlighting nach Einrückung, eigene Gutter, Inline-Widgets sind in CM6 gewöhnliche Extensions; Lezer-Python-Parser liefert sofort einen Syntaxbaum im Renderer. |
| 4 | **Pyright** als Language Server (Completion, Fehler beim Tippen, Definition, Hover) | In TypeScript geschrieben, läuft im Node von Electron (`ELECTRON_RUN_AS_NODE`), funktioniert auch ohne installiertes Python. |
| 5 | **Eigener Tracer** im Backend (`sys.settrace`/`threading.settrace`, später `sys.monitoring` ab 3.12) | Volle Kontrolle über Halt/Step; Tracer nur aktiv, wenn Breakpoints existieren oder gesteppt wird. |
| 6 | **Klassendiagramm mit echten UML-Beziehungen**: Vererbung, Uses, Assoziation/Aggregation/Komposition mit Multiplizitäten (1:1, 1:n, 0..1) | Geht über BlueJ hinaus; Ableitung per statischer Analyse (tree-sitter-python), Type Hints machen es exakt. |
| 7 | Statische Projektanalyse mit **Pythons `ast`** als eigener, zustandsloser Prozess (`backend/analyze.py`); Diagramm als **eigenes SVG** (Drag, Kontextmenü), Layout in `package.bluepy`. *Revidiert am 13.10.2026* – ursprünglich tree-sitter im Main-Prozess + React Flow/elkjs. | `ast` ist exakt, hat keine Abhängigkeit und ist vollständig testbar; der Analyse-Prozess läuft parallel zum Backend, also auch während Nutzercode läuft. Preis: ohne installiertes Python gibt es kein Diagramm (nur die Dateiliste). React Flow/elkjs bleiben Optionen, falls das SVG an Grenzen stößt. |
| 8 | **Backend in Python, nur Stdlib, null pip-Abhängigkeiten** | Muss auf jedem Schüler-Python ≥ 3.11 laufen. |
| 9 | **JSON-RPC 2.0 über localhost-Socket** (Electron ist Server, Backend verbindet sich mit Token); stdout/stderr/stdin des Nutzercodes werden im Backend umgeleitet und als Events geschickt | Steuerkanal und Programmausgabe getrennt; Abschnitte je Aufruf, stderr getrennt, `input()` als Terminal-Anfrage. |
| 10 | **Nutzercode läuft im Hauptthread des Backends**, RPC-I/O im Nebenthread | `turtle`/`tkinter` brauchen auf macOS den Main-Thread. |
| 11 | **`unittest`** als Testframework; Aufnahme erzeugt `self.assert…`-Code, Fixture → `setUp()` | Stdlib; pytest später optional als Runner. |
| 12 | ~~isomorphic-git~~ → **kein Git in BluePy** (beschlossen 13.10.2026, Abend). Aufgaben und Abgaben laufen über den **BluePy-Hub** (eigener kleiner Abgabe-Server, docs/04), Export/Import als `.bluepy`-Paket als Fallback. | Git braucht Logins/Tokens auf Schülerrechnern und erklärt sich SuS nicht von selbst; der Hub kommt ohne Anmeldung aus (Aufgabencode + persönlicher Code). |
| 13 | Doku: Docstrings im Editor, Projekt-Doku via **`pydoc`**; „Create App" via **`zipapp`** (.pyz), PyInstaller später optional | Stdlib. |
| 14 | Bibliotheken: Projekt-venv + pip (v2), im Projektmodell von Anfang an vorgesehen | |
| 15 | **i18next**, Deutsch + Englisch ab Tag 1 | |
| 16 | **electron-builder**: Windows NSIS (per-User) + MSI + portable, macOS DMG (universal), Linux deb + AppImage; Updates via electron-updater (GitHub Releases) | Entspricht BlueJs Installer-Matrix. |
| 17 | Signing: Apple Developer ID vorhanden (Notarisierung einplanen); Windows-Zertifikat **später** | |
| 18 | **Lizenz GPL-3.0** | |
| 19 | Qualität: Vitest (TS), `unittest` (Backend), Playwright (E2E gegen Electron). **Keine CI auf Push** (beschlossen 13.10.2026); GitHub Actions nur als **Release-Workflow** (`release.yml`: Build + Signierung/Notarisierung + Installer ans Release) | Pushen soll einfach pushen; Qualität wird lokal geprüft (`pnpm typecheck`, `pnpm test`, `pnpm test:backend`). |

## Architektur

```
┌──────────────────────── Electron ────────────────────────┐
│  Renderer (React + CodeMirror 6)   ←typed IPC→   Main    │
│  Diagramm · Objektleiste · Editor ·              Prozess │
│  Code Pad · Terminal · Debugger ·                 │      │
│  Inspektoren · Dialoge                            │      │
└───────────────────────────────────────────────────┼──────┘
                          ┌────────────────────────┼─────────────┐
                          │ JSON-RPC (localhost)   │ LSP (stdio)  │
                 ┌────────▼─────────┐     ┌────────▼───────────┐
                 │ bluepy-backend   │     │ Pyright            │
                 │ Python der SuS   │     │ (im Node von       │
                 │ nur Stdlib       │     │  Electron)         │
                 │ = „Debug-VM"     │     └────────────────────┘
                 └──────────────────┘
```

- **Main-Prozess** besitzt Dateisystem, Projektmodell, Backend-Prozess, Pyright, Test-Aufnahme/-Läufe, Hub-Client. Renderer ist reine UI (`contextIsolation: true`, `nodeIntegration: false`, typed IPC über `contextBridge`).
- **Backend** ist das Gegenstück zur BlueJ-Debug-VM: lädt Module, hält die Objektleiste, führt Aufrufe aus, tract, testet. „Reset Python" = Prozess beenden und neu starten.
- Ohne installiertes Python funktionieren: Projekt öffnen, Diagramm, Editor, Completion, Aufgabe holen/abgeben. Erst „Compile"/Objekt erzeugen scheitert – mit erklärendem Dialog.

## Fenstermodell (beschlossen 13.10.2026)

Anders als BlueJ ist **der Editor das Hauptfenster**; das Klassendiagramm bekommt ein eigenes Fenster.

| Fenster | Inhalt | Verhalten |
|---|---|---|
| **Editor** (Hauptfenster) | Editor-Tabs, Code Pad, Terminal, Statuszeile | Öffnet sich mit dem Projekt; Schließen beendet BluePy (bzw. schließt das Projekt, sobald es einen Projekt-Chooser gibt) |
| **Klassendiagramm** | Klassendiagramm + Objektleiste, Toolbar (Neue Klasse, Pfeile, Compile) | Menü *Fenster ▸ Klassendiagramm*, Toolbar-Button, ⌘⇧D / Ctrl+Shift+D; beliebig schließ- und wieder öffnenbar; merkt sich Position und Größe |
| **Debugger** (M3), **Testergebnisse** (M4, ⌘⇧T) | wie in BlueJ eigene Fenster; das Testergebnis-Fenster öffnet sich bei Fehlschlägen oder mehreren Tests von selbst | |
| Objektleiste | im Diagrammfenster unter dem Diagramm **und** im Editor-Fenster unter dem Code Pad (gleiche Leiste, beide einklappbar) | Objekte, die im Code Pad per Zuweisung entstehen (`k = Konto(p, 5)`), landen automatisch auf der Leiste (BlueJ zeigt dafür Objekt-Icons zum Ziehen) |

Technik: Ein Renderer-Bundle, die Fensterrolle kommt per URL (`?window=main|diagram`). **Geteilter Zustand liegt im Main-Prozess** (`main/state.ts`: Backend-Status, Terminal-Verlauf, stdin-Zustand, später Objektleiste und Projektmodell); jedes Fenster lädt beim Start einen Snapshot und bekommt danach Events. Fensterverwaltung in `main/windows.ts`, Anwendungsmenü in `main/menu.ts` (Edit-Rollen sind nötig, damit ⌘C/⌘V auf macOS funktionieren).

## Aufgaben-Workflow: BluePy-Hub statt Git (beschlossen 13.10.2026)

Der zunächst geplante Git-Workflow (öffentliches Aufgaben-Repo, Push ins eigene Repo, OAuth Device Flow) ist **verworfen**: er braucht Anmeldungen und Tokens auf jedem Schülerrechner. Stattdessen ein eigener, winziger Abgabe-Server (**BluePy-Hub**) auf dem Hetzner-Server der Lehrkraft, ohne Logins: Lehrkraft veröffentlicht ein Projekt als Aufgabe (Beschreibung, Zeitfenster, Aufgabencode, Klasse), SuS holen sie per Code, geben per persönlichem Code ab, Lehrkraft sammelt alle Abgaben mit einem Klick ein und korrigiert direkt in BluePy. Details, Protokoll und Server-Setup: **docs/04-aufgaben-hub.md**. Fallback ohne Netz: Projekt als `.bluepy`-Paket exportieren/importieren.

## Oberfläche: Hell/Dunkel

Farbschema `system | light | dark` in den Einstellungen (Menü *Ansicht ▸ Farbschema*, Umschalt-Button in jeder Toolbar). Der Main-Prozess setzt `nativeTheme.themeSource`; die Renderer lesen `prefers-color-scheme` und setzen `data-theme` auf `<html>` – alle Farben sind CSS-Variablen (`styles.css`), der Editor nutzt dieselben Variablen für sein Chrome und schaltet die Syntaxfarben per Compartment um (`defaultHighlightStyle` hell, `oneDarkHighlightStyle` dunkel).

## Repo-Struktur

```
bluepy/
  apps/desktop/        Electron-App: src/main, src/preload, src/renderer
  packages/protocol/   RPC- und IPC-Verträge (TS-Typen + zod) – eine Quelle der Wahrheit
  apps/desktop/src/shared/   reine Module für Main und Renderer (Python-Blockstruktur)
  backend/             bluepy_backend/ (Python, Stdlib) + tests/ (unittest)
  hub/                 (M5) BluePy-Hub: Abgabe-Server (Python, Docker) – siehe docs/04
  docs/                Funktionsanalyse, ADRs, Protokoll, Hub-Design
```

## Meilensteine

- **M0** Gerüst: Electron + CM6 + Backend-Handshake + Interpreter-Check + Code Pad/Terminal end-to-end, Fenstermodell (Editor-Hauptfenster + Diagrammfenster)
- **M1** *(fertig bis auf Pyright)* Projekt (`package.bluepy`, Neu/Öffnen/Zuletzt/Beispiel), Dateien im Editor mit Tabs und Speichern, Syntaxprüfung beim Tippen (Lezer), Compile (Syntax + Laden), Klassendiagramm mit Vererbung/Assoziation (Multiplizitäten, Komposition/Aggregation)/Uses, Live-Analyse beim Speichern
- **M2** *(Kern fertig)* Objektleiste, Create Object / Method Call / Method Result, Inspektor (verschachtelt, Get auf die Leiste), Record method calls im Terminal, Modul ausführen (`__main__`). Offen: Pyright-Completion, Inspektoren als eigene Fenster, Drag von Objekten in Parameterfelder
- **M3** *(fertig)* Debugger: Breakpoints in der Editor-Gutter, Halt (pausiert bei offenem Debugger-Fenster, bricht sonst ab), Step / Step Into / Step Out / Continue / Terminate, Aufrufsequenz, Klassen-/Instanz-/lokale Variablen mit Inspektor, eigenes Debugger-Fenster (⌘⇧B), aktuelle Zeile im Editor
- **M4** *(fertig)* Unit-Tests auf `unittest`: Testklasse anlegen, Test All / einzelne Tests, Testergebnis-Fenster mit Live-Ergebnissen, Zeile und gefiltertem Traceback, **Test-Aufnahme** (Interaktionen → Testmethode, Assertion-Panel im Ergebnisdialog, Fixture-Objekte als `self.`), Objektleiste ↔ Fixture (`setUp`) in beide Richtungen. Dazu: Code-Pad-Objekte auf der Leiste, Objektleiste im Editor-Fenster, Scope-Highlighting als Kästen, Dark Mode mit Umschalter, Release-Workflow statt CI
- **M5** *(fertig)* **BluePy-Hub** (docs/04): Server in `hub/` (Stdlib, SQLite, Docker + Caddy), Paketformat `.bluepy` mit eigenem ZIP-Code, Aufgabe holen / abgeben / aktualisieren (persönlicher Code), Rückmeldung abrufen, Klassen, Veröffentlichen, Einsammeln + Korrekturmodus mit Notizen/Punkten und Tests über alle Abgaben (eigener Prozess je Abgabe, `backend/run_tests.py`), Export/Import. Landing Page in `site/` (wird vom Hub ausgeliefert)
- **M6 = Version 1.0** *(fertig bis auf Signatur)* Pyright als LSP-Kindprozess (`main/lsp/pyright.ts`: Completion mit Resolve, Hover, Diagnostik nur bei sauberem Parse; Paket `pyright` per `asarUnpack`, läuft mit `ELECTRON_RUN_AS_NODE`), sechs Beispielprojekte (`examples/index.json`), Release-Workflow. Offen: Windows-Signatur, Interactive Tutorial, Accessibility

## Konsequenzen

- Das Backend muss auf Python 3.11 … 3.15 laufen und wird gegen mehrere Versionen getestet.
- Alle Python-Versions- und Umgebungsprobleme müssen in der UI erklärbar sein (Status-Chip, Dialog), nicht als Exception enden.
- Zwei Parser (Lezer im Editor, tree-sitter im Analysator) sind bewusst in Kauf genommen: der eine für sofortige Editor-Reaktion, der andere für ein vollständiges Projektmodell.
