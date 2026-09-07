from __future__ import annotations

import asyncio
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest


def test_cancel_kills_running_subprocess_and_frees_worker(tmp_path: Path) -> None:
    from app.core.processing_control import run_process
    from app.tasks.runner import LocalTaskRunner

    marker = tmp_path / "started"
    finished = tmp_path / "finished"

    class Pipeline:
        def process(self, job_id):
            run_process(
                [sys.executable, "-c",
                 "import pathlib, sys, time; pathlib.Path(sys.argv[1]).touch(); "
                 "time.sleep(10); pathlib.Path(sys.argv[2]).touch()",
                 str(marker), str(finished)],
                timeout=15, check=True, capture_output=True, text=True,
            )

    async def scenario():
        runner = LocalTaskRunner(Pipeline(), shutdown_timeout_seconds=0.1)
        await runner.start()
        await runner.enqueue("one")
        deadline = time.monotonic() + 3
        while not marker.exists():
            assert time.monotonic() < deadline
            await asyncio.sleep(0.02)
        assert await runner.cancel("one")
        await asyncio.wait_for(runner.queue.join(), timeout=2)
        assert not finished.exists()
        assert runner.snapshot()["active_jobs"] == []
        await runner.stop()

    asyncio.run(scenario())


def test_stop_is_bounded_even_when_native_processing_does_not_cooperate() -> None:
    from app.tasks.runner import LocalTaskRunner, QueueCapacityError

    started = threading.Event()
    release = threading.Event()

    class Pipeline:
        def process(self, job_id):
            started.set()
            release.wait(5)

    async def scenario():
        runner = LocalTaskRunner(Pipeline(), shutdown_timeout_seconds=0.05)
        await runner.start()
        await runner.enqueue("active")
        while not started.is_set():
            await asyncio.sleep(0.01)
        await runner.enqueue("pending")
        before = time.monotonic()
        try:
            await asyncio.wait_for(runner.stop(), timeout=2)
            assert time.monotonic() - before < 1.5
            with pytest.raises(QueueCapacityError):
                await runner.enqueue("after-stop")
        finally:
            release.set()

    asyncio.run(scenario())


def test_process_timeout_reaps_child_and_preserves_diagnostics() -> None:
    from app.core.processing_control import run_process

    with pytest.raises(subprocess.TimeoutExpired) as error:
        run_process(
            [sys.executable, "-u", "-c", "import time; print('started'); time.sleep(10)"],
            timeout=0.2, check=True, capture_output=True, text=True,
        )
    assert "started" in str(error.value.output)


def test_cancellation_during_mms_slot_wait_does_not_start_a_process(tmp_path):
    from app.alignment.mms import SubprocessMMSRuntime
    from app.core.processing_control import ProcessingInterrupted, processing_context

    limiter = threading.BoundedSemaphore(1)
    limiter.acquire()
    event = threading.Event()

    def unexpected_runner(*args, **kwargs):
        pytest.fail("Canceled alignment started a subprocess")

    runtime = SubprocessMMSRuntime(limiter=limiter, runner=unexpected_runner)
    with pytest.raises(ProcessingInterrupted):
        with processing_context(event):
            event.set()
            runtime.align(tmp_path / "audio.wav", ["ki"], 1, line_token_counts=[1])
    assert not list(tmp_path.glob(".mms-*"))
    limiter.release()
