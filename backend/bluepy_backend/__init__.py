"""BluePy backend – runs inside the learner's Python interpreter.

The backend is the Python counterpart of BlueJ's "debug VM": it loads the
project's modules, keeps the objects of the object bench alive, executes
interactive calls, evaluates Code Pad input, traces for the debugger and runs
unit tests.  It talks JSON-RPC 2.0 over a localhost socket with the Electron
main process (see docs/03-rpc-protokoll.md).

Hard rule: standard library only.  This package must run on any CPython >= 3.11
without pip-installed dependencies.
"""

__version__ = "0.1.0"
PROTOCOL_VERSION = "0.1"
