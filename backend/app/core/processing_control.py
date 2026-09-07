from __future__ import annotations

import asyncio
import contextvars
import subprocess
import threading
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator


class ProcessingInterrupted(BaseException):
    """Control flow that must not trigger error recovery or model fallback."""


_interrupt: contextvars.ContextVar[threading.Event | None] = contextvars.ContextVar(
    "processing_interrupt", default=None,
)


@contextmanager
def processing_context(event: threading.Event) -> Iterator[None]:
    token = _interrupt.set(event)
    try:
        check_interrupted()
        yield
    finally:
        _interrupt.reset(token)


def check_interrupted() -> None:
    event = _interrupt.get()
    if event is not None and event.is_set():
        raise ProcessingInterrupted()


async def run_in_daemon_thread(function: Callable[..., Any], *args: Any) -> Any:
    # Native inference cannot be forcibly stopped in a Python thread. A daemon
    # keeps interpreter shutdown bounded; checkpoints prevent later state writes.
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    context = contextvars.copy_context()

    def complete(result: Any, error: BaseException | None) -> None:
        if not future.done():
            if error is not None:
                future.set_exception(error)
            else:
                future.set_result(result)

    def run() -> None:
        result, error = None, None
        try:
            result = context.run(function, *args)
        except BaseException as exc:
            error = exc
        try:
            loop.call_soon_threadsafe(complete, result, error)
        except RuntimeError:
            pass  # The service event loop has already closed.

    threading.Thread(target=run, daemon=True, name="nicokara-pipeline").start()
    return await future


def run_process(command, *, timeout: float, check=True, capture_output=True,
                text=True, **kwargs) -> subprocess.CompletedProcess:
    check_interrupted()
    if _interrupt.get() is None:
        return subprocess.run(command, timeout=timeout, check=check,
                              capture_output=capture_output, text=text, **kwargs)
    if capture_output:
        kwargs.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    started = time.monotonic()
    with subprocess.Popen(command, text=text, **kwargs) as process:
        try:
            while True:
                check_interrupted()
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(command, timeout)
                try:
                    stdout, stderr = process.communicate(timeout=min(0.1, remaining))
                    break
                except subprocess.TimeoutExpired:
                    continue
        except BaseException as exc:
            process.kill()
            stdout, stderr = process.communicate()
            if isinstance(exc, subprocess.TimeoutExpired):
                exc.output, exc.stderr = stdout, stderr
            raise
        check_interrupted()
        result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        if check:
            result.check_returncode()
        return result
