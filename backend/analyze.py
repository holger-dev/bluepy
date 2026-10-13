# Stateless project analysis CLI used by the IDE:
#   python -B -X utf8 analyze.py <project-dir>   ->  JSON model on stdout
import os
import sys

if sys.version_info[:2] < (3, 11):
    sys.stderr.write("BluePy benoetigt Python 3.11 oder neuer.\n")
    sys.exit(3)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bluepy_backend.analyzer import main  # noqa: E402

sys.exit(main())
