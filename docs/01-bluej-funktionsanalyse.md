# BlueJ – vollständige Funktionsanalyse als Vorlage für BluePy

Stand: BlueJ 6.0.1 (September 2026). Quellen: bluej.org (About, Tutorial 4.0, Unit-Testing-Tutorial, Git-Tutorial, Extensions-Seite, Versionshistorie 1.1.6 – 6.0.1) und die englische UI-Label-Datei aus dem BlueJ-Quellcode (`bluej/lib/english/labels`, GitHub k-pet-group/BlueJ-Greenfoot).

Ziel des Dokuments: Jede Funktion, die BlueJ hat, benennen – und pro Bereich festhalten, wie sie sich auf Python übertragen lässt und wo eine Grundsatzentscheidung nötig ist. Die Entscheidungen stehen in [ADR 002](02-adr-stack-und-architektur.md).

---

## 0. Was BlueJ ausmacht (Designprinzipien)

1. **Das Projekt ist ein Klassendiagramm.** Hauptfenster = UML-ähnliche Darstellung aller Klassen, nicht ein Dateibaum.
2. **Objekte sind sichtbar und anfassbar.** Objekte werden interaktiv erzeugt, liegen auf der *Objektleiste* (Object Bench), ihre Methoden werden per Rechtsklick aufgerufen – ganz ohne `main`.
3. **Edit → Compile → Run** ist ein expliziter, sichtbarer Zyklus (nicht kompilierte Klassen sind schraffiert).
4. **Bewusst kleine Oberfläche**: keine Perspektiven, keine Konfigurationshölle; genau ein Fenster pro Projekt plus Editor-, Terminal-, Debugger-Fenster.
5. **Zwei-Prozess-Architektur**: Die IDE läuft in einer JVM, der Nutzercode in einer zweiten („Debug VM"), angebunden über JDI/JDWP. Deshalb kann die IDE Nutzercode anhalten, inspizieren, neu starten („Reset Java Virtual Machine"), ohne selbst abzustürzen.
6. Didaktische „Erfindungen", die BlueJ für sich beansprucht: **Object Bench**, **Code Pad**, **Scope Highlighting** (farbig hinterlegte Blöcke).

---

## 1. Projekt & Hauptfenster

**Projektmodell**
- Projekt = Verzeichnis mit `package.bluej` (Layout, Metadaten); Unterverzeichnisse = Pakete (eigene `package.bluej`).
- `README.TXT` = Projektnotizen, als Notiz-Icon im Diagramm, Doppelklick öffnet Editor.
- Eine Klasse pro `.java`-Datei; Textdateien (`.txt`, `.css`) im Projekt werden als externe Dateien angezeigt und im BlueJ-Editor geöffnet.
- `bluej.properties`/`bluej.defs` für Nutzer- und Systemkonfiguration; `+libs`-Ordner im Projekt für projektspezifische Bibliotheken.
- Doppelklick auf `package.bluej` im Dateisystem startet BlueJ mit dem Projekt.

**Menü Project**: New Project…, Open Project…, Open Recent, Open Non-BlueJ… (beliebiges Quellverzeichnis als Projekt öffnen), Open ZIP/JAR…, Close, Save, Save As…, Import… (Quellen in bestehendes Projekt importieren, Dialog „Package Line Mismatches"), Create Jar File…, Page Setup…, Print… (Klassendiagramm drucken), Quit.

**Menü Edit**: New Class…, New Package…, New CSS/Text File…, Add Class from File…, Delete, New Uses Arrow…, New Inheritance Arrow…, Delete Arrow….

**Menü Tools**: Compile, Compile Selected, Rebuild Package, Use Library Class…, Project Documentation, Testing ▸ (Run Tests, End Recording, Cancel Recording), Team ▸ (siehe 11), Preferences….

**Menü View**: Show Uses, Show Inheritance, Show Debugger, Show Terminal, Show Code Pad, Show Test Results, Show Team and Test Controls.

**Menü Help**: About BlueJ, Installed Extensions, Check Version…, Copyright, BlueJ Web Site, Online Documentation, Interactive Tutorial (seit 4.1.2, geführtes Tutorial in der IDE), Java Class Libraries, JavaFX GUI Libraries.

**Toolbar (links)**: New Class…, Uses-Pfeil, Inheritance-Pfeil, Compile, Run Tests (wenn Testing aktiv), Status/Update (wenn Teamwork aktiv), Re-run (seit 5.5: letzten Konstruktor/statische Methode/JavaFX-App mit gleichen Parametern erneut ausführen, kompiliert vorher), Aufnahme-Indikator für Test-Recording (End/Cancel).

**Statuszeile** unten mit Meldungen („Compiling…", „Class compiled – no syntax errors", Testergebnis) und **Ausführungsanzeige** (rote Streifen, solange die Debug-VM arbeitet); Klick darauf = **Reset Java Virtual Machine** (bestätigungspflichtig; leert Objektleiste und Inspektoren).

**Sonstiges**: Zuletzt geöffnete Projekte werden beim Start wieder geöffnet (abschaltbar), mehrere Projekte gleichzeitig in getrennten Fenstern, „File changed on disk"-Erkennung.

---

## 2. Klassendiagramm

- Klassen-Icons mit Name, Farbe nach Typ und Stereotyp-Markern: `<<abstract>>`, `<<interface>>`, `<<enum>>`, `<<record>>`, `<<unit test>>`, JavaFX-App, Paket-Icon, Notiz-Icon (README).
- Nicht kompilierte oder fehlerhafte Klassen: grau/schraffiert.
- **Uses-Pfeile** (gestrichelt) werden automatisch aus dem Quelltext abgeleitet; **Inheritance-Pfeile** (durchgezogen, hohler Kopf) für extends/implements, auch zwischen Interfaces; sealed-Klassen korrekt.
- Pfeile per Toolbar interaktiv ziehen → erzeugt `extends`/`implements` bzw. Import im Quelltext; Pfeil-Rechtsklick → löschen (entfernt die Beziehung aus dem Code).
- Pfeilrouting vermeidet Kreuzungen; Layout wird in `package.bluej` gespeichert und ist Git-versionierbar („Commit diagram layout").
- Klassen verschieben, Größe ändern, Mehrfachauswahl (Shift/Rubberband), Tastaturnavigation, Tippen eines Klassennamens fokussiert die Klasse.
- Doppelklick = Editor öffnen; Pakete per Doppelklick betreten (Navigation im selben Fenster).
- Klassen-Kontextmenü (kompilierte Klasse): alle Konstruktoren `new X(…)`, alle statischen Methoden (inkl. `main`), ggf. „more methods"-Untermenü; dann Open Editor, Compile, Inspect (Klassen-Inspektor für statische Felder), Delete, Duplicate…, Convert to Java / Convert to Stride, Create Test Class, Run JavaFX Application.
- Paket-Kontextmenü: Open, Delete. Externe Datei: Open (außerhalb BlueJ), Delete file.
- **New Class-Dialog**: Name, Sprache (Java/Stride), Typ (Class, Abstract Class, Interface, Enum, Record, Unit Test, JavaFX Application, früher Applet/MIDlet), seit 5.5 Dropdown Template/Minimal (leere Klasse).
- Klassen-Templates sind Textdateien (`lib/<sprache>/templates/newclass/*.tmpl`), anpassbar.

---

## 3. Objektleiste & interaktive Ausführung

**Create Object-Dialog** (aus Klassenmenü): zeigt Konstruktor-Signatur und Javadoc-Kommentar, Feld für Instanznamen (vorbelegt, z. B. `person1`), ein Eingabefeld je Parameter (Name + Typ sichtbar), Typparameter bei Generics, Array-Literale wie `{"a","b"}` erlaubt. Objekte auf der Leiste können per Klick als Parameter eingesetzt werden. Abstrakte Klassen/Interfaces lassen sich nicht instanziieren.

**Objektleiste** (Object Bench, unten im Hauptfenster): rote Kästen `name : Klasse`, horizontal scrollbar, Mehrfachauswahl, Tastaturnavigation, Drag & Drop in Parameterfelder und Code Pad. Wird geleert bei Neukompilierung der zugehörigen Klasse und bei VM-Reset.

**Objekt-Kontextmenü**: alle öffentlichen Methoden, gruppiert nach „inherited from <Oberklasse>" / „redefined in", (No accessible methods), „more methods"-Untermenü bei vielen Methoden; dann **Inspect**, **Remove** (in den Labels auch *Serialize*).

**Method Call-Dialog**: Signatur + Javadoc, Parameterfelder, Objektleisten-Objekte per Klick einsetzbar, Enter = OK.

**Method Result**: Rückgabewert in einem Ergebnis-Inspektor (mit Inspect/Get); bei `void` nichts; Exceptions landen mit anklickbarem Stacktrace im Terminal und als Statusmeldung. Während einer Test-Aufnahme bietet der Ergebnis-Dialog Assertions an (siehe 10).

**Use Library Class…** (Tools): voll qualifizierter Klassenname eingeben → Liste der Konstruktoren/statischen Methoden → Objekt aus Bibliotheksklasse auf die Leiste.

**Get**: aus Inspektoren oder Code-Pad-Ergebnissen Objekte auf die Leiste holen; bei `get` auch package-private Member.

---

## 4. Inspektoren

- **Object Inspector**: Felder mit Typ und Wert, Referenzfelder weiter inspizierbar (Inspect) oder auf die Leiste holen (Get), „Show static fields", Arrays (auch mehrdimensional) als Listen, String-Inspektion mit Inhaltsfeld und „Copy to clipboard" (5.5), Fenster verschiebbar, mehrere gleichzeitig offen, aktualisieren sich nach Code-Pad-Anweisungen.
- **Class Inspector** (statische Felder), **Enum Inspector**, **Interface Inspector**, **Method Result**.
- Aus dem Debugger: Doppelklick auf Referenz → Inspektor.

---

## 5. Code Pad

- Ein-/ausblendbar (View ▸ Show Code Pad), rechts unten im Hauptfenster, eigene Schriftgröße.
- Ausdrücke eingeben → Ergebnis mit Typ (`42 (int)`); Anweisungen (z. B. `System.out.println(…)`) ohne Ergebnisanzeige.
- Mehrzeilige Eingaben mit Shift-Enter; lokale Variablen bleiben zwischen Eingaben erhalten; Objekte der Leiste sind als Namen verfügbar.
- Ergebnisobjekte per Klick auf das Objekt-Symbol auf die Leiste ziehen (Name vergeben) oder inspizieren.
- Historie mit Pfeiltasten; Kontextmenü: Select all history, Add to object bench, Inspect, Clear history.
- Fehlermeldungen des Compilers inline; Generics werden unterstützt.

---

## 6. Editor (Java-Editor, seit 5.0 neu geschrieben)

**Fenster/Tabs**: eigenes Fenster pro Projekt mit Tabs pro Klasse (verschiebbar), Toolbar (Compile, Undo, Cut, Copy, Paste, Close, Page Setup), Umschalter **Source Code / Documentation** (gerenderte Javadoc der Klasse).

**Darstellung**: Syntax-Highlighting, **Scope Highlighting** (verschachtelte Blöcke farbig hinterlegt, Stärke einstellbar, abschaltbar), Zeilennummern (Standard an), Klammer-Matching, „Stand-out"-Kommentare (`/*#`), Schriftgröße per Tastenkürzel/Strg-Scroll/Pinch, Schriftart (Source Code Pro), Cursor-Zeilen-Highlight.

**Bearbeiten**: Undo/Redo, Cut/Copy/Paste, Indent more/less, **Auto-layout** (Neu-Einrücken), Comment/Uncomment, **Insert method**, **Add method comment** (Javadoc-Skelett), Auto-Indent, automatisches schließendes `}` (konfigurierbar), Wortselektion, Kontextmenü, „Screenshot line(s)" (Bild der Zeilen in die Zwischenablage).

**Suchen**: Find-Leiste (Find, Replace, Next, Prev, Match Case, Whole word, Richtung, Wrap around), Replace Once/All, Go to line….

**Code-Intelligenz**: Code Completion (Strg-Leertaste, auch lokale Variablen, Parameter, Pattern-Variablen, `System.in/out/err`), **Quick Fixes** (z. B. fehlenden Import ergänzen, auch bei lokalisierten Compilermeldungen), Mittelklick/Kontextmenü auf Klassennamen → Definition bzw. Doku, automatische Fehlerprüfung beim Tippen mit roter Unterstreichung + Meldung beim Hover + Markierung in der Seitenleiste, mehrere Fehler gleichzeitig, Liste der Fehler im Accessibility-Modus.

**Debug im Editor**: Breakpoints per Klick in die Gutter (Stop-Schild), Set/Clear Breakpoint, aktuelle Zeile beim Stepping hervorgehoben, Breakpoints überleben Neukompilierung.

**Optionen**: Key Bindings… (alle Tastenkürzel anzeigen/ändern), Preferences…, Increase/Decrease/Reset Font Size.

**Drucken**: Print Source Code mit Optionen Zeilennummern, Scope Highlighting, Schriftgröße; Einstellungen bleiben erhalten.

**Sonstiges**: „File changed on disk"-Dialog, Nicht-ASCII-Eingabe (CJK), Performance bis > 5000 Zeilen, Textdateien im selben Editor.

---

## 7. Kompilieren & Fehler

- Compile (einzelne Klasse im Editor, markierte Klassen, ganzes Paket, Rebuild Package). Speichert automatisch vor dem Kompilieren.
- Fehler: rote Unterstreichung, Markierung in der Gutter, Meldung im Editor/Statuszeile, erneutes Compile springt zum nächsten Fehler; Compiler-Warnungen optional.
- Nach erfolgreichem Compile: Klasse wird in der Debug-VM neu geladen, Objekte dieser Klasse verschwinden von der Leiste.
- Fehlende oder veraltete `.class`-Dateien werden erkannt.

---

## 8. Terminal

- Eigenes Fenster für `System.out`/`System.err`/`System.in` (Eingabe direkt im Terminal), stderr in eigenem, bei Bedarf eingeblendetem Bereich, der je Methodenaufruf geleert wird.
- Stacktraces farbig und **anklickbar** (springt zur Zeile im Editor).
- **Abschnittsgrenzen je Methodenaufruf** mit Tooltip, welcher Aufruf die Ausgabe erzeugt hat (5.3).
- **Record method calls**: jede interaktive Aktion (Objekt erzeugen, Methode aufrufen) wird als Java-Quelltext ins Terminal geschrieben – zeigt Lernenden, welchen Code die Klicks entsprechen.
- Optionen: Clear screen at method call, Record method calls, Unlimited buffering, Always on top; Aktionen: Clear, Copy, Paste, Save to file…, Print, Close; Form-Feed leert das Terminal; Encoding einstellbar; Schriftgröße synchron mit Editor.

---

## 9. Debugger

- Fenster mit Threads-Liste (Hide system threads), **Call Sequence** (Aufrufstapel, Frames anklickbar), **Static variables**, **Instance variables**, **Local variables** (dreigeteilt), Objekte per Doppelklick inspizierbar.
- Buttons: **Halt** (laufende Ausführung, z. B. Endlosschleife, anhalten), **Step**, **Step Into**, **Continue**, **Terminate**.
- Öffnet sich automatisch beim Erreichen eines Breakpoints oder bei Halt; aktuelle Zeile im Editor markiert; Stepping erkennt Methodenende; Breakpoints im Debug-VM-Thread der interaktiven Aufrufe.
- Zusätzlich: Reset Java Virtual Machine (Prozess der Debug-VM neu starten); `System.exit` startet die VM automatisch neu.

---

## 10. Unit-Tests (JUnit 5, JUnit 4 weiter unterstützt)

- Aktivierung: Preferences ▸ „Show unit testing tools" → Toolbar-Buttons Run Tests + Aufnahme-Indikator, View ▸ Show Test Results, Klassenmenü ▸ **Create Test Class** (Name `XTest`, Icon `<<unit test>>`, an Referenzklasse angeheftet) oder New Class ▸ Unit Test (freistehend).
- Testklassen-Menü: **Test All**, jede Testmethode einzeln, **Create Test Method…** (startet Aufnahme), **Object Bench to Test Fixture**, **Test Fixture to Object Bench**.
- **Test-Aufnahme**: alle Interaktionen (Objekte erzeugen, Methoden aufrufen) werden als Testmethoden-Code aufgezeichnet; bei Rückgabewerten bietet der Ergebnisdialog ein Assertion-Panel (equals, same, null, not null, assertTrue/False, Toleranz bei double …); End = speichern, Cancel = verwerfen; Testklasse wird anschließend automatisch kompiliert.
- **Fixtures**: Objektleiste → `setUp()`; Fixture wird vor jedem Test wiederhergestellt; Fixture zurück auf die Leiste zum Erweitern.
- **Run Tests** (alle Tests im Paket) / Test All (eine Klasse) / einzelne Methode.
- **Test Results-Fenster**: Liste mit grünem Haken / grauem Kreuz (Failure) / rotem Kreuz (Error), Zähler Tests/Errors/Failures/Total Time, grüner/roter Balken, Detailbereich mit gefiltertem Stacktrace, „Show Source" springt zur Zeile. Einzelner bestandener Test → nur Statusmeldung.
- Testklassen sind normale Klassen und per Hand editierbar; Test-first-Workflow mit Stubs möglich.

---

## 11. Teamwork (Git; Subversion bis 4.x, CVS bis 3.x)

- Aktivierung: Preferences ▸ „Show teamwork controls" → Toolbar Status/Update, Tools ▸ Team.
- Menü Team: **Share this project…**, **Checkout Project…**, **Commit/Push…**, **Update…**, **Status**, **Project History**, **Teamwork Settings…**.
- **Team Settings-Dialog**: Name, E-Mail, Server-Typ, User, Password/Access token (Speichern auf diesem Rechner), Server, Repository Path, Protocol, Repository URI, Branch/Default branch, **Check connection**.
- **Commit-Dialog**: Liste modified/new/deleted, Commit comment, „Commit diagram layout"; Commit offline, danach **Push**-Dialog.
- **Update-Dialog**: betroffene Dateien, „Update diagram layout"; **Conflicts found**-Dialog mit „Show conflicts".
- **Status-Dialog**: File name, Revision, Local status (New, Modified, Deleted, Needs pull, Needs update), Remote status, Refresh.
- **Project History**: Commit-Nachrichten, geänderte Dateien, Autor; Filter Show file / Show user.
- Versioniert werden Quellen, README, Unterpakete, Diagramm-Layout; Status-Markierungen an den Klassen-Icons.
- Technik: jGit mit SSH-Unterstützung, Access-Token für GitHub/GitLab.

---

## 12. Dokumentation

- Editor-Umschalter Documentation: gerenderte Javadoc der Klasse.
- Tools ▸ **Project Documentation**: Javadoc für das ganze Projekt generieren und im Browser öffnen (auch im Klassendiagramm per „documentation view").
- Create Object-/Method Call-Dialoge zeigen die Javadoc-Kommentare der jeweiligen Methode.
- Help ▸ Java Class Libraries / JavaFX GUI Libraries (URL konfigurierbar, offline möglich).
- Add method comment (Javadoc-Skelett einfügen).

---

## 13. Eigenständige Anwendung

- Project ▸ **Create Jar File…**: Main-Klasse wählen, optional Quellen einschließen, „Include user libraries" (Bibliotheken werden neben das Jar gelegt), Ergebnis läuft mit `java -jar` bzw. Doppelklick.

---

## 14. Bibliotheken

- Preferences ▸ Libraries: Jar/Zip hinzufügen/löschen mit Status (Loaded/Error/Not loaded) und Pfad; außerdem `lib/userlib` (systemweit) und `+libs` (projektweit).
- Tools ▸ Use Library Class… (siehe 3), Open ZIP/JAR… (Jar als Projekt/Bibliothek öffnen).
- VM-Argumente (`bluej.vm.args`), Javadoc-Pfad, alternative JDK-Pfade konfigurierbar.

---

## 15. Preferences (Tabs)

- **Editor**: Font size, Scope Highlighting (Stärke), Syntax highlighting, Auto-indent, closing bracket automatisch, Zeilennummern, Dateiänderungen auf Platte prüfen, Klammer-Matching, Key Bindings, unterstützte Dateiendungen, Reset to default.
- **Miscellaneous**: JDK documentation URL, Show unit testing tools, Show teamwork controls, Use optimization, Compiler-Warnungen (unsafe collections), „Run user code on thread" (JavaFX/Swing/Default), Research participation (Blackbox, Experiment-/Teilnehmer-ID).
- **Interface**: Sprache (viele Übersetzungen, Standard = Systemsprache), Accessibility Mode, Show Terminal execution scopes, Re-open last projects at startup, General.
- **Libraries**: siehe 14.
- **Extensions**: installierte Extensions mit Scope (System/User/Project), Version, Ort.
- Mac: Cmd-, öffnet Preferences; Preferences im App-Menü.

---

## 16. Extensions & Submitter

- **Extension-API** (Java-Jar in `lib/extensions2`, `~/.bluej/extensions2` oder `<Projekt>/extensions2`): Menüeinträge in Tools/Klassen-/Objektmenü hinzufügen, Events (Compile, Invocation, Package open/close, Class events, Dependency events), Zugriff auf Projekt/Paket/Klasse/Objekt/Editor, eigene Preference-Panels, Zeichnen des Paketgraphen anpassen. Help ▸ Installed Extensions.
- **Submitter** (mitgeliefert): Projekt per HTTP(S)/E-Mail/Dateikopie an einen Server abgeben; Konfiguration über `submission.defs`-Dateien (Schemes, Dateiauswahl, Datumsformat).
- Bekannte Drittanbieter-Extensions: Main Program Runner (Run main direkt), Class Card, PMD, Checkstyle, SonarLint, GetterSetter, UML Extension, SceneBuilder, About… open project.

---

## 17. Weitere Funktionen

- **Stride**: rahmenbasierter Editor (frame-based editing), Projekte rein Java, rein Stride oder gemischt; Konvertierung in beide Richtungen; eigene Drucker-/Bearbeitungslogik. (Riesiges Teilsystem.)
- **Kotlin** (6.0): Editieren und Ausführen von Kotlin-Klassen im selben Projekt.
- **Lokalisierung**: Interface-Sprache in Preferences, viele Sprachen (u. a. Deutsch, Chinesisch), lokalisierte Klassen-Templates.
- **Accessibility**: Screenreader-Unterstützung, Accessibility-Modus mit Fehlerliste, Tastaturbedienung überall.
- **Interactive Tutorial** (Help) mit Beispielprojekt.
- **Check Version / Latest News**, anonyme Nutzungsstatistik (abschaltbar), **Blackbox**-Forschungsdatensammlung (Opt-in beim ersten Start).
- **Raspberry Pi**: ARM64-Build, GPIO-Tutorials, früher eigener Konfigurations-Tab.
- **Plattform/Installer**: Windows MSI (mit JDK), Standalone-ZIP (USB-Stick), macOS DMG (Intel + Apple Silicon), Debian/Ubuntu .deb, generisches Jar; 64-bit; HiDPI; Datei-Assoziation.
- **Drucken** von Diagramm und Quelltext (Seitenlayout, Skalierung).
- **Lizenz**: GPL 2 mit Classpath Exception; Quellcode auf GitHub.

---

## 18. Übersetzung nach Python – Bereich für Bereich

| BlueJ (Java) | BluePy (Python) | Entscheidung |
|---|---|---|
| Projekt = Ordner mit `package.bluej` | Ordner mit `package.bluepy` (JSON: Layout, Einstellungen); Unterordner mit `__init__.py` = Pakete | beschlossen |
| 1 Klasse pro `.java` | Konvention 1 Klasse pro `.py` über „New Class"; Dateien mit mehreren Klassen → ein Icon je Klasse (gleiche Datei); Dateien ohne Klasse → **Modul-Icon** mit Funktionen (verhalten sich wie statische Methoden) | beschlossen |
| Compile (javac) | „Compile" bleibt als Schritt: Syntaxprüfung (`ast`/`compile()`), statische Prüfung (Pyright), dann **(Neu-)Laden des Moduls im Nutzerprozess**; schraffierte Icons bis dahin | beschlossen |
| `<<abstract>>` / `<<interface>>` / `<<enum>>` / `<<record>>` | `abc.ABC` + `@abstractmethod` / `typing.Protocol` / `enum.Enum` / `@dataclass` – per AST erkannt | beschlossen |
| Uses-/Inheritance-Pfeile aus Quelltext | Inheritance aus `class A(B)`, Uses aus Imports und Namensreferenzen, **zusätzlich Assoziation/Aggregation/Komposition mit Multiplizitäten** aus Attributzuweisungen und Type Hints | beschlossen (mehr als BlueJ) |
| Konstruktor-/Methoden-Signaturen mit Typen | `inspect.signature` + Type Hints (falls vorhanden, sonst „any"); Parameter sind beliebige Python-Ausdrücke, Objekte der Leiste per Klick | beschlossen |
| Public/Private | Konvention: `_name` ausgeblendet (Option „private Methoden zeigen"), Dunder-Methoden standardmäßig ausgeblendet | Option |
| Statische Methoden / `main` | `@staticmethod`/`@classmethod` + Modulfunktionen; `if __name__ == "__main__":` → „Run module" | beschlossen |
| Object Inspector (Felder) | `vars()`/`__slots__`/Properties (Option); Listen/Dicts/Tuples/Sets wie Arrays; String mit Inhaltsfeld | beschlossen |
| Class Inspector (static) | Klassenattribute | beschlossen |
| Code Pad | REPL im Nutzerprozess: Eingabe als `eval` (Ausdruck) oder `exec` (Anweisung) im Namespace, Leisten-Objekte als Namen, Ergebnis mit `type()`; Historie, Add to bench, Inspect | beschlossen |
| Terminal (System.out/err/in) | stdout/stderr/stdin des Nutzerprozesses umgeleitet; Tracebacks anklickbar; Abschnitte je Aufruf; Record method calls erzeugt Python-Code (`person1 = Person("Anna")`) | beschlossen |
| Debugger (JDI) | eigener Tracer im Nutzerprozess (`sys.settrace`/`threading.settrace`, später `sys.monitoring`); Halt = asynchrone Exception im Hauptthread; Terminate/Reset = Prozess neu starten | beschlossen |
| JUnit | `unittest` (Stdlib): Aufnahme erzeugt `self.assertEqual(...)`, Fixture → `setUp`, Ergebnisfenster aus `TestResult`; pytest später optional | beschlossen |
| Javadoc / Project Documentation | Docstrings: Doku-Ansicht im Editor, Dialoge zeigen Docstrings, Projekt-Doku via `pydoc` (HTML) | beschlossen |
| Create Jar | „Create App": `zipapp` (.pyz, Stdlib) + optional PyInstaller | beschlossen |
| Libraries (Jar) | Projekt-venv + pip; Preferences ▸ Libraries = Paketliste; Use Library Class = `modul.Klasse` | v2 |
| Git (jGit) | isomorphic-git (HTTPS + Token, kein SSH); identische Dialoge | beschlossen |
| Extensions (Java-Jar) | Python-Plugins (Entry Points), gleiche Hook-Punkte | später |
| Submitter | identisch (HTTP/Mail/Kopie) | später |
| Scope Highlighting (Klammern) | nach **Einrückung** – passt zu Python besonders gut | beschlossen |
| Code Completion / Quick Fixes | Pyright (LSP) | beschlossen |
| Stride | **außer Scope** (Kent-Team hat dafür „Strype") | beschlossen |
| Kotlin | entfällt | – |
| Bundled JDK | **kein** gebündelter Interpreter; Python ≥ 3.11 vorausgesetzt, integrierter Check | beschlossen |

Verwandte Projekte zum Abgucken: **Thonny** (Python/Tk, Backend-Prozess + eigener Tracer, Object Inspector), **Strype** (Kent, rahmenbasiertes Python), **Mu** (Python/Qt, Einsteiger-Editor), BlueJ-Quellcode selbst (Dialog-Flüsse, Test-Recording, Terminal-Verhalten).
