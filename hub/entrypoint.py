"""Container entry point: make /data writable for the `hub` user, then drop
privileges and run `python -m bluepy_hub <args>` (default: serve).

Bind mounts are created by Docker as root on the host, so the first start
would otherwise fail with PermissionError.  Running as root only for the
chown keeps the server itself unprivileged.  `docker compose run --rm hub
teacher add "Name"` goes through here too, so admin commands never leave
root-owned files behind.
"""
from __future__ import annotations

import os
import pwd
import sys


def main() -> None:
    args = sys.argv[1:] or ["serve"]
    data = os.environ.get("HUB_DATA", "/data")
    try:
        user = pwd.getpwnam("hub")
    except KeyError:
        user = None
    if user is not None and os.geteuid() == 0:
        os.makedirs(data, exist_ok=True)
        for root, dirs, files in os.walk(data):
            for name in [*dirs, *files]:
                path = os.path.join(root, name)
                try:
                    st = os.lstat(path)
                    if st.st_uid != user.pw_uid or st.st_gid != user.pw_gid:
                        os.lchown(path, user.pw_uid, user.pw_gid)
                except OSError:
                    pass
        os.chown(data, user.pw_uid, user.pw_gid)
        os.setgroups([])
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)
        os.environ["HOME"] = user.pw_dir
    os.execvp(sys.executable, [sys.executable, "-m", "bluepy_hub", "--data", data, *args])


if __name__ == "__main__":
    main()
