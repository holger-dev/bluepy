"""Exceptions shared across the backend."""


class HaltRequested(BaseException):
    """Raised (asynchronously) in the main thread when the IDE presses Halt.

    Derives from BaseException so that user code catching `Exception` cannot
    swallow it.
    """
