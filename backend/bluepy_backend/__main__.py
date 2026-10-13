"""Entry point: `python -m bluepy_backend --connect host:port --token T [--cwd DIR]`."""

from __future__ import annotations

import argparse
import os
import socket
import sys

MINIMUM = (3, 11)


def _parse_endpoint(value: str) -> tuple[str, int]:
    host, sep, port = value.rpartition(":")
    if not sep or not port.isdigit():
        raise argparse.ArgumentTypeError("expected host:port")
    return host or "127.0.0.1", int(port)


def main(argv: list[str] | None = None) -> int:
    if sys.version_info[:2] < MINIMUM:
        print(
            f"BluePy benoetigt Python {MINIMUM[0]}.{MINIMUM[1]} oder neuer, "
            f"gefunden wurde {sys.version.split()[0]} ({sys.executable}).",
            file=sys.stderr,
        )
        return 3

    parser = argparse.ArgumentParser(prog="bluepy_backend")
    parser.add_argument("--connect", required=True, type=_parse_endpoint, help="host:port of the IDE")
    parser.add_argument("--token", required=True, help="session token echoed in the hello message")
    parser.add_argument("--cwd", default=None, help="project directory (becomes cwd and sys.path[0])")
    args = parser.parse_args(argv)

    if args.cwd:
        os.chdir(args.cwd)
        sys.path.insert(0, args.cwd)

    host, port = args.connect
    try:
        sock = socket.create_connection((host, port), timeout=10)
    except OSError as exc:
        print(f"BluePy backend: cannot connect to {host}:{port}: {exc}", file=sys.stderr)
        return 2
    sock.settimeout(None)
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError:
        pass

    from .rpc import Connection
    from .session import Session

    session = Session(Connection(sock), args.token, args.cwd)
    return session.run()


if __name__ == "__main__":
    sys.exit(main())
