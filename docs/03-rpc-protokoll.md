# RPC-Protokoll Electron ↔ Backend

Version: **0.1** (M0)

## Transport

- Electron (Main-Prozess) öffnet einen TCP-Server auf `127.0.0.1`, Port 0 (zufällig).
- Das Backend wird gestartet mit
  `python -B -X utf8 -u <resources>/backend/launcher.py --connect 127.0.0.1:<port> --token <token> --cwd <projekt>`
  und verbindet sich.
- Framing: **newline-delimited JSON**, eine Nachricht pro Zeile, UTF-8.
- Nachrichten folgen **JSON-RPC 2.0**: `{"jsonrpc":"2.0","id":1,"method":"…","params":{…}}`,
  Antworten `{"jsonrpc":"2.0","id":1,"result":{…}}` oder `{"jsonrpc":"2.0","id":1,"error":{"code":…,"message":"…","data":…}}`,
  Notifications ohne `id`.
- Die erste Nachricht des Backends ist die Notification `hello` mit dem Token. Stimmt es nicht, beendet Electron den Prozess.

## Threading-Modell im Backend

- **Hauptthread** = Ausführer für Nutzercode (Job-Schleife). Nötig für `turtle`/`tkinter` auf macOS.
- **Reader-Thread** liest den Socket. „Sofort"-Methoden (`ping`, `env.info`, `halt`, `stdin.provide`, `shutdown`) werden direkt dort beantwortet, alle anderen in die Job-Warteschlange des Hauptthreads gelegt.
- Jeder Job bekommt eine **Invocation-ID** (= JSON-RPC-`id`). Ausgaben, die währenddessen entstehen, tragen diese ID (→ Abschnitte im Terminal).

## Methoden (M0)

| Methode | Richtung | Params | Result |
|---|---|---|---|
| `hello` (Notification) | Backend → Electron | `{token, pid, python: {version, executable, implementation, platform}}` | – |
| `ping` | Electron → Backend | `{}` | `{"pong": true}` |
| `env.info` | Electron → Backend | `{}` | `{version, versionInfo:[maj,min,patch], executable, implementation, platform, prefix, isVenv, hasTkinter, cwd, sysPath:[…]}` |
| `codepad.eval` | Electron → Backend (Hauptthread) | `{code, id?}` | `{kind:"expression"\|"statement", value?: {repr, type, isNone}, error?, inspectable?, bench}` – `inspectable` = das Ergebnis ist ein Objekt, das später über den Namen `$<id>` inspiziert / auf die Leiste gelegt werden kann; **Zuweisungen an Objekte** (`k = Konto(p, 5)`) legen `k` automatisch auf die Objektleiste, `k = 5` / `del k` nehmen es wieder herunter (`bench` = Leiste danach) |
| `halt` | Electron → Backend (sofort) | `{}` | `{halted: bool}` – löst `HaltRequested` im Hauptthread aus, falls gerade eine Invocation läuft |
| `stdin.provide` (Notification) | Electron → Backend (sofort) | `{text}` | – |
| `shutdown` | Electron → Backend (sofort) | `{}` | `{ok: true}`; Prozess beendet sich |

## Notifications Backend → Electron (M0)

| Methode | Params |
|---|---|
| `output` | `{stream:"stdout"\|"stderr", text, invocation: number\|null}` |
| `stdin.request` | `{invocation}` – Backend wartet auf `stdin.provide` |
| `invocation.started` | `{invocation, method}` |
| `invocation.finished` | `{invocation, method, ok}` |

## Fehlercodes

- `-32700` Parse error, `-32600` Invalid request, `-32601` Method not found, `-32602` Invalid params, `-32603` Internal error
- `1000` HaltRequested (Invocation abgebrochen durch Halt)

## Methoden (M1/M2)

| Methode | Thread | Params | Result |
|---|---|---|---|
| `project.open` | Haupt | `{dir}` | `{ok, cwd}` – setzt cwd und `sys.path[0]`, leert die Objektleiste |
| `module.load` | Haupt | `{files:[rel]}` | `{results:[{file, module, ok, stage: syntax\|read\|import\|loaded, error}], removedObjects, bench}` – „Compile": Syntaxprüfung, dann frischer Import; Klassen und Module landen im Code-Pad-Namespace; Objekte neu geladener Module fliegen von der Leiste |
| `module.run` | Haupt | `{file}` | `{ok, exitCode?, error?}` – führt die Datei als `__main__` aus (`runpy`) |
| `class.describe` | Haupt | `{module, name}` | Konstruktor-Parameter, Methoden (mit `definedIn`, `inherited`, `kind`, `visibility`), Klassenattribute, `isAbstract` |
| `object.create` | Haupt | `{module, name, benchName?, args:[expr]}` | `{ok, object, record, bench}` bzw. `{ok:false, error}` – Argumente sind Python-Ausdrücke im Namespace (Leisten-Objekte per Name) |
| `object.call` | Haupt | `{target}` oder `{module,name}`, `method`, `args` | `{ok, value, inspectable, record, bench}` – Exceptions landen zusätzlich als Traceback im Terminal |
| `object.inspect` | Haupt | `{name, path?}` | `{value, className, mro, fields:[{name, kind, value, inspectable}], classAttributes}` – `name` darf `_` (letztes Ergebnis) oder `$<id>` (Code-Pad-Ergebnis) sein, `path` navigiert Attribute/Indizes |
| `object.get` | Haupt | `{name, path?, newName?}` | legt den Wert unter `newName` auf die Leiste; `record` = `newName = <Ausdruck>` |
| `object.remove` | Haupt | `{name}` | `{ok, bench}` |
| `bench.list` / `bench.suggestName` | sofort | – / `{className}` | `{bench}` / `{name}` – jedes Leisten-Objekt trägt `code`: den Python-Ausdruck, der es erzeugt hat (für Objektleiste → Fixture), oder `null` |
| `bench.clear` | sofort | – | `{ok, bench: []}` |

Notification `record {code, invocation}`: der Python-Code der interaktiven Aktion („Record method calls").

Notification `result {repr, type, invocation}`: Rückgabewert eines interaktiven `object.call`, falls nicht `None` – Electron schreibt ihn als eigene Zeile („→ 60 (int)") ins Terminal, zusätzlich zum Ergebnisdialog.

Die **statische Analyse** (Klassendiagramm) läuft nicht über den Socket, sondern als eigener Prozess: `python -B -X utf8 backend/analyze.py <projekt>` schreibt das Modell (Module, Klassen, Methoden, Attribute, Kanten) als JSON auf stdout. Siehe `bluepy_backend/analyzer.py`.

## Unit-Tests (M4)

| Methode | Thread | Params | Result |
|---|---|---|---|
| `tests.describe` | sofort (nur `ast`) | `{file, className}` | `{className, line, tests:[{name, line}], hasFixture, fixtureNames, fixtureCode}` – Testmethoden und die in `setUp` angelegten `self.`-Attribute |
| `tests.run` | Haupt | `{files, className?, method?}` | lädt die Testmodule frisch, baut die Suite (`unittest.TestLoader`) und streamt pro Test `test.started {id, file, className, method}` und `test.finished {id, file, className, method, status: passed\|failed\|error\|skipped, message, traceback, line, durationMs}`; Result `{total, passed, failed, errors, skipped, durationMs, results, bench}`. Nicht ladbare Testdateien erscheinen als `error` mit `method = Stage`. Halt bricht den Lauf ab (Fehler 1000). Der Traceback ist der von `unittest` gefilterte; `line` ist die innerste Zeile in der Testdatei |
| `tests.fixtureToBench` | Haupt | `{file, className}` | lädt die Datei frisch, leert die Leiste, instanziiert die Klasse, ruft `setUp()` und legt die dort angelegten `self.`-Attribute auf die Leiste (`code` aus dem `setUp`-Quelltext) → `{ok, bench, names}` bzw. `{ok:false, error}` |

Aufnahme von Testmethoden, Assertions und das Schreiben in die Testklasse passieren im Main-Prozess (`apps/desktop/src/main/tests/`): die `record`-Notifications sind die Aufnahme; Fixture-Objekte werden per Tokenizer zu `self.<name>` umgeschrieben.

## Debugger (M3)

Alle `debug.*`-Methoden werden **sofort** auf dem Reader-Thread beantwortet – auch während der Hauptthread in einer Pause steht.

| Methode | Params | Result |
|---|---|---|
| `debug.setBreakpoints` | `{file, lines:[int]}` (leere Liste löscht) | `{ok}` |
| `debug.clearBreakpoints` | – | `{ok}` |
| `debug.arm` | `{enabled}` – Debugger-Fenster offen ⇒ Nutzercode wird getract, damit *Halt* pausiert statt abbricht | `{ok, armed}` |
| `debug.pause` | – | `{ok}` – `false`, wenn gerade nicht getract wird (dann macht die IDE den harten `halt`) |
| `debug.continue` / `debug.step` / `debug.stepInto` / `debug.stepOut` / `debug.terminate` | – | `{ok}` – `false`, wenn nicht pausiert |
| `debug.frames` | – | `{paused, frames:[{index, file, line, function, className}]}` (innerster Frame zuerst, nur Projektdateien) |
| `debug.variables` | `{frame}` | `{frame, locals, instance, static}` – je `[{name, value, inspectable}]` |
| `debug.inspect` | `{frame, scope: locals\|instance\|static, name, path}` | `{value, className, fields}` |
| `debug.state` | – | `{paused, armed, active}` |

Notifications: `debug.paused {reason: breakpoint\|step\|pause, frames, invocation}`, `debug.resumed {command}`.

Technik: `sys.settrace` nur auf dem Hauptthread und nur rund um Nutzercode-Aufrufe, solange Breakpoints existieren oder der Debugger scharf ist; nur Frames aus Projektdateien bekommen eine Zeilen-Trace-Funktion. Während einer Pause blockiert der Hauptthread in einer Warteschleife; `terminate` und *Halt* lösen `HaltRequested` aus.

**CPython-3.11-Falle:** `PyThreadState_SetAsyncExc(tid, NULL)` (Abbrechen einer asynchronen Exception) lässt unter 3.11 den nächsten Funktionsaufruf mit aktivem `sys.settrace` hängen. Das Backend ruft diese Variante deshalb nie auf; eine gesetzte, aber nicht zugestellte Halt-Exception wird nach der Invocation kurz abgewartet und abgefangen (`Session._absorb_async_exception`). Die Backend-Tests laufen lokal gegen 3.11, 3.12 und 3.13 (`pnpm test:backend`).

## Geplant (M4, Namen reserviert)

`tests.run`, `tests.list`, `docs.generate`, `app.build`; Notifications `test.result`, `exception`.
