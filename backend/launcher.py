# BluePy backend launcher.
#
# Started by the Electron main process as
#   python -B -X utf8 -u launcher.py --connect 127.0.0.1:<port> --token <token> [--cwd <project>]
#
# This file must stay syntax-compatible with very old Pythons so that the
# version guard below can print a readable message instead of a SyntaxError.
import os
import sys

MINIMUM = (3, 11)

if sys.version_info[:2] < MINIMUM:
    sys.stderr.write(
        "BluePy benoetigt Python %d.%d oder neuer, gefunden wurde %s (%s).\n"
        % (MINIMUM[0], MINIMUM[1], sys.version.split()[0], sys.executable)
    )
    sys.stderr.flush()
    sys.exit(3)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bluepy_backend.__main__ import main  # noqa: E402

sys.exit(main())
