"""Command line: `python -m bluepy_hub serve` and the admin commands.

    python -m bluepy_hub serve --data ./data --site ../site --port 8080
    python -m bluepy_hub teacher add "Holger Heidkamp"     → prints the teacher key (once!)
    python -m bluepy_hub teacher list
    python -m bluepy_hub teacher remove 3
    python -m bluepy_hub stats
"""
from __future__ import annotations

import argparse
import os
import sys

from . import __version__
from .server import Hub
from .store import Store


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="bluepy_hub", description="BluePy-Hub – Aufgaben verteilen und einsammeln")
    parser.add_argument("--data", default=os.environ.get("HUB_DATA", "./data"), help="Datenverzeichnis (SQLite + Pakete)")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="HTTP-Server starten")
    serve.add_argument("--host", default=os.environ.get("HUB_HOST", "0.0.0.0"))
    serve.add_argument("--port", type=int, default=int(os.environ.get("HUB_PORT", "8080")))
    serve.add_argument("--site", default=os.environ.get("HUB_SITE"), help="Ordner mit der Landing Page (optional)")

    teacher = sub.add_parser("teacher", help="Lehrkräfte verwalten")
    teacher_sub = teacher.add_subparsers(dest="teacher_command", required=True)
    add = teacher_sub.add_parser("add")
    add.add_argument("name")
    teacher_sub.add_parser("list")
    remove = teacher_sub.add_parser("remove")
    remove.add_argument("id", type=int)

    sub.add_parser("stats", help="Zähler anzeigen")
    sub.add_parser("version")

    args = parser.parse_args(argv)
    if args.command == "version":
        print(__version__)
        return 0
    if args.command == "serve":
        hub = Hub(args.data, args.site)
        server = hub.serve(args.host, args.port)
        print(f"BluePy-Hub {__version__} auf http://{args.host}:{args.port}  (Daten: {os.path.abspath(args.data)})", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            hub.store.close()
        return 0

    store = Store(args.data)
    try:
        if args.command == "stats":
            for key, value in store.stats().items():
                print(f"{key:12} {value}")
        elif args.teacher_command == "add":
            teacher_id, key = store.add_teacher(args.name)
            print(f"Lehrkraft #{teacher_id} angelegt: {args.name}")
            print("Lehrer-Schlüssel (nur jetzt sichtbar, in BluePy unter Einstellungen ▸ Aufgaben-Hub eintragen):")
            print(key)
        elif args.teacher_command == "list":
            for t in store.list_teachers():
                print(f"#{t['id']:<4} {t['name']}  (seit {t['created']})")
        elif args.teacher_command == "remove":
            print("entfernt" if store.remove_teacher(args.id) else "nicht gefunden", file=sys.stderr)
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
