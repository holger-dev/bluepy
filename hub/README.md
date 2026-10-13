# BluePy-Hub

Der Abgabe-Server für BluePy: Lehrkräfte veröffentlichen Aufgaben, Schüler:innen holen sie per Code und geben per Klick ab, Lehrkräfte sammeln alles mit einem Klick ein. Keine Accounts, keine Logins. Konzept: [docs/04-aufgaben-hub.md](../docs/04-aufgaben-hub.md).

Reine Python-Standardbibliothek (3.11+), SQLite und Dateien unter `data/`, ein Docker-Container, HTTPS durch Caddy.

## In 10 Minuten auf einem Hetzner-Server

1. **Server**: Hetzner Cloud → CX22 (oder kleiner), Ubuntu 24.04. Domain anlegen, z. B. `bluepy.deine-schule.de`, A-Record auf die Server-IP.
2. **Docker installieren** (als root):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Repo holen und konfigurieren**:
   ```bash
   git clone https://github.com/holger-dev/bluepy.git /opt/bluepy
   cd /opt/bluepy/hub
   cp .env.example .env && nano .env        # HUB_DOMAIN=bluepy.deine-schule.de
   ```
4. **Starten** (baut das Image, Caddy holt das Zertifikat automatisch):
   ```bash
   docker compose up -d --build
   docker compose logs -f hub               # „BluePy-Hub 0.1.0 auf http://0.0.0.0:8080“
   ```
5. **Lehrkraft anlegen** – der Schlüssel wird nur einmal angezeigt:
   ```bash
   docker compose run --rm hub teacher add "Holger Heidkamp"
   ```
   Den Schlüssel in BluePy unter *Einstellungen ▸ Aufgaben-Hub* eintragen (Hub-URL: `https://bluepy.deine-schule.de`).

Fertig. `https://bluepy.deine-schule.de/` zeigt die Landing Page aus `site/` (als Volume eingebunden: nach Änderungen reicht `git pull`, Browser-Cache 5 Minuten), `/api/health` den Status.

### Betrieb

| Was | Befehl |
|---|---|
| Lehrkräfte auflisten / entfernen | `docker compose run --rm hub teacher list` / `… teacher remove <id>` |
| Zähler | `docker compose run --rm hub stats` |
| Update | `cd /opt/bluepy && git pull && cd hub && docker compose up -d --build` |
| Backup | `data/` sichern (SQLite + Pakete), z. B. nächtlich per `tar czf` auf den Hetzner Storage Box |
| Logs | `docker compose logs -f` |

Firewall: nur 22, 80 und 443 offen lassen (Hetzner Cloud Firewall oder `ufw`).

Rechte: Der Container startet als root, setzt `data/` auf den Nutzer `hub` (uid 1000) und läuft dann unprivilegiert weiter (`entrypoint.py`) – deshalb immer `docker compose run --rm hub …` für Admin-Befehle, nicht `exec`.

## Ohne Docker

```bash
cd hub
python3 -m bluepy_hub --data ./data serve --port 8080 --site ../site
python3 -m bluepy_hub --data ./data teacher add "Name"
```

Davor einen Reverse Proxy mit HTTPS (Caddy, nginx) – der Hub spricht nur HTTP.

## API

JSON über HTTP; Pakete (`.bluepy` = ZIP) sind base64-codiert im JSON-Body (max. 20 MB). Lehrkraft-Endpunkte brauchen `Authorization: Bearer <Lehrer-Schlüssel>`.

| Methode | Pfad | Wer | Zweck |
|---|---|---|---|
| `GET` | `/api/health` | alle | Status, Serverzeit |
| `GET` | `/api/me` | Lehrkraft | Name, Anzahl Klassen/Aufgaben |
| `GET` / `POST` | `/api/classes` | Lehrkraft | Klassen mit persönlichen Codes; anlegen `{name, students:[…]}` |
| `POST` | `/api/classes/{id}/students` | Lehrkraft | Namen nachtragen `{students:[…]}` |
| `DELETE` | `/api/classes/{id}` | Lehrkraft | Klasse löschen (inkl. Abgaben) |
| `GET` / `POST` | `/api/tasks` | Lehrkraft | Aufgaben; anlegen `{title, description, code?, submitFrom?, submitUntil?, classes:[ids], tests?, package}` |
| `PUT` / `DELETE` | `/api/tasks/{code}` | Lehrkraft | Metadaten/Paket aktualisieren (Version +1) / löschen |
| `GET` | `/api/tasks/{code}/submissions` | Lehrkraft | Übersicht pro SuS (Zeitstempel, zu spät, gleiches Gerät, Rückmeldung) |
| `GET` | `/api/tasks/{code}/submissions/{personal}` | Lehrkraft | letzte Abgabe als Paket |
| `POST` | `/api/tasks/{code}/feedback/{personal}` | Lehrkraft | `{notes, points}` |
| `GET` | `/api/tasks/{code}` | SuS | Aufgabe mit Paket (`/info` ohne Paket) |
| `POST` | `/api/tasks/{code}/submissions` | SuS | `{personal, package, device?, allowLate?}` – nur im Zeitfenster |
| `GET` | `/api/tasks/{code}/feedback?personal=…` | SuS | Rückmeldung |

Fehler kommen als `{error, reason}`; `reason` ∈ `unknown-task`, `unknown-student`, `window-before`, `window-after`, `rate-limit`, `no-key`, `bad-key`, `no-submission`, `no-feedback`. Nach 30 falschen Codes in 10 Minuten blockt der Hub die IP vorübergehend (429).

Tests: `python3 -m unittest discover -s tests -t .` (startet einen echten Server auf einem freien Port).
