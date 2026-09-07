from __future__ import annotations

import asyncio
import logging
import time
import threading
from collections import defaultdict, deque
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any, Callable
from uuid import uuid4

from app.core.event_logging import event_context, exception_details
from app.core.processing_control import (
    ProcessingInterrupted, processing_context, run_in_daemon_thread,
)


logger = logging.getLogger(__name__)


async def dispatch_pending_jobs(database: Any, runner: "LocalTaskRunner") -> None:
    while True:
        try:
            for job_id in database.list_job_ids(status="UPLOADED"):
                if not runner.can_accept:
                    break
                if runner.is_scheduled(job_id):
                    continue
                # An earlier enqueue may have yielded to a cancellation request.
                job = database.get_job(job_id)
                if job is not None and job["status"] == "UPLOADED":
                    await runner.enqueue(job_id)
        except Exception as exc:
            safe_error = exception_details(exc, include_traceback=False)
            logger.error("Persistent queue dispatch failed (%s: %s); retrying",
                         safe_error["exception_type"], safe_error["error_summary"])
            await asyncio.sleep(0.5)
        await asyncio.sleep(0.1)


class QueueCapacityError(RuntimeError):
    """Raised when all waiting slots are reserved or the runner is stopping."""


class QueueReservation:
    def __init__(self, runner: "LocalTaskRunner") -> None:
        self._runner = runner
        self._active = True

    async def enqueue(self, job_id: str) -> None:
        if not self._active:
            raise RuntimeError("Queue reservation is no longer active")
        self._active = False
        self._runner._enqueue_reserved(job_id)

    def release(self) -> None:
        if self._active:
            self._active = False
            self._runner._release_reservation()


class LocalTaskRunner:
    def __init__(
        self,
        pipeline: Any | None = None,
        *,
        pipeline_factory: Callable[[], Any] | None = None,
        max_pending_jobs: int = 4,
        worker_count: int = 1,
        heartbeat_interval_seconds: float = 5,
        shutdown_timeout_seconds: float = 30,
        event_logger: Any | None = None,
    ) -> None:
        if pipeline is None and pipeline_factory is None:
            raise ValueError("pipeline or pipeline_factory is required")
        if worker_count <= 0:
            raise ValueError("worker_count must be greater than zero")
        if max_pending_jobs <= 0 or shutdown_timeout_seconds <= 0:
            raise ValueError("queue capacity and shutdown timeout must be positive")
        if heartbeat_interval_seconds <= 0:
            raise ValueError("heartbeat_interval_seconds must be greater than zero")
        if worker_count > 1 and pipeline_factory is None:
            logger.warning(
                "Multiple workers are sharing one pipeline instance; "
                "prefer pipeline_factory for thread safety."
            )
        self.pipeline = pipeline
        self.pipeline_factory = pipeline_factory
        self.max_pending_jobs = max_pending_jobs
        self.worker_count = worker_count
        self.heartbeat_interval_seconds = heartbeat_interval_seconds
        self.event_logger = event_logger
        self.shutdown_timeout_seconds = shutdown_timeout_seconds
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=max_pending_jobs)
        self._scheduled_jobs: set[str] = set()
        self._interrupts: dict[str, threading.Event] = {}
        self._stopping = False
        self._queued_at: dict[str, deque[float]] = defaultdict(deque)
        self._reserved_slots = 0
        self._capacity_available = asyncio.Event()
        self._capacity_available.set()
        self._worker_tasks: dict[int, asyncio.Task[None]] = {}
        self._started = False
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._last_heartbeat_at: datetime | None = None
        self._active_jobs: dict[int, tuple[str, datetime]] = {}

    @property
    def can_accept(self) -> bool:
        return not self._stopping and (
            self.queue.qsize() + self._reserved_slots < self.max_pending_jobs
        )

    def _update_capacity_event(self) -> None:
        if self.can_accept or self._stopping:
            self._capacity_available.set()
        else:
            self._capacity_available.clear()

    def reserve(self) -> QueueReservation:
        if not self.can_accept:
            raise QueueCapacityError("Processing queue is full or stopping")
        self._reserved_slots += 1
        self._update_capacity_event()
        return QueueReservation(self)

    def _release_reservation(self) -> None:
        if self._reserved_slots <= 0:
            raise RuntimeError("Queue reservation accounting is invalid")
        self._reserved_slots -= 1
        self._update_capacity_event()

    def _enqueue_reserved(self, job_id: str) -> None:
        self._release_reservation()
        if self._stopping:
            raise QueueCapacityError("Processing queue is stopping")
        if job_id in self._scheduled_jobs:
            return
        self._scheduled_jobs.add(job_id)
        self._queued_at[job_id].append(time.perf_counter())
        self.queue.put_nowait(job_id)
        self._record_queued(job_id)
        self._update_capacity_event()

    async def start(self) -> None:
        if self._stopping:
            raise RuntimeError("A stopped task runner cannot be restarted")
        if self._started:
            return
        self._started = True
        self._last_heartbeat_at = datetime.now(UTC)
        self._ensure_workers()
        self._heartbeat_task = asyncio.create_task(self._heartbeat())

    async def resize_workers(self, worker_count: int) -> None:
        if worker_count <= 0:
            raise ValueError("worker_count must be greater than zero")
        previous_count = self.worker_count
        if worker_count == previous_count:
            return
        if worker_count > 1 and self.pipeline_factory is None:
            logger.warning(
                "Multiple workers are sharing one pipeline instance; "
                "prefer pipeline_factory for thread safety."
            )
        self.worker_count = worker_count
        if self._started:
            self._ensure_workers()
        logger.info(
            "Background worker count changed from %s to %s",
            previous_count,
            worker_count,
        )

    @property
    def active_worker_count(self) -> int:
        return sum(
            not task.done() for task in self._worker_tasks.values()
        )

    def _ensure_workers(self) -> None:
        for worker_index in range(self.worker_count):
            task = self._worker_tasks.get(worker_index)
            if task is None or task.done():
                self._worker_tasks[worker_index] = asyncio.create_task(
                    self._worker(worker_index)
                )

    def snapshot(self) -> dict[str, Any]:
        now = datetime.now(UTC)
        alive_workers = self.active_worker_count
        heartbeat_age = (
            (now - self._last_heartbeat_at).total_seconds()
            if self._last_heartbeat_at is not None
            else None
        )
        healthy = (
            alive_workers == self.worker_count
            and self.worker_count > 0
            and heartbeat_age is not None
            and heartbeat_age <= max(5, self.heartbeat_interval_seconds * 3)
        )
        return {
            "healthy": healthy,
            "worker_count": self.worker_count,
            "alive_workers": alive_workers,
            "queued_in_memory": self.queue.qsize(),
            "queue_capacity": self.max_pending_jobs,
            "reserved_slots": self._reserved_slots,
            "accepting_jobs": self.can_accept,
            "last_heartbeat_at": (
                self._last_heartbeat_at.isoformat()
                if self._last_heartbeat_at is not None
                else None
            ),
            "active_jobs": [
                {
                    "worker_index": worker_index,
                    "job_id": job_id,
                    "started_at": started_at.isoformat(),
                }
                for worker_index, (job_id, started_at) in sorted(
                    self._active_jobs.items()
                )
            ],
        }

    async def enqueue(self, job_id: str) -> None:
        if job_id in self._scheduled_jobs and not self._stopping:
            return
        await self.reserve().enqueue(job_id)

    def is_scheduled(self, job_id: str) -> bool:
        return job_id in self._scheduled_jobs

    def _record_queued(self, job_id: str) -> None:
        if self.event_logger is None:
            return
        self.event_logger.emit(
            event="job.queued",
            level="INFO",
            category="queue",
            message="任务已进入处理队列",
            job_id=job_id,
            component="task_runner",
            details={"queue_length": self.queue.qsize()},
        )

    async def enqueue_wait(self, job_id: str) -> None:
        while True:
            try:
                reservation = self.reserve()
            except QueueCapacityError:
                if self._stopping:
                    raise
                await self._capacity_available.wait()
                continue
            await reservation.enqueue(job_id)
            return

    async def cancel(self, job_id: str) -> bool:
        interrupt = self._interrupts.get(job_id)
        if interrupt is not None:
            interrupt.set()
        retained_job_ids: list[str] = []
        removed = False
        while True:
            try:
                queued_job_id = self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            self.queue.task_done()
            if queued_job_id == job_id and not removed:
                removed = True
                timestamps = self._queued_at.get(queued_job_id)
                if timestamps:
                    timestamps.popleft()
                self._queued_at.pop(queued_job_id, None)
                self._scheduled_jobs.discard(queued_job_id)
            else:
                retained_job_ids.append(queued_job_id)

        for queued_job_id in retained_job_ids:
            self.queue.put_nowait(queued_job_id)
        self._update_capacity_event()
        return removed or interrupt is not None

    async def stop(self) -> None:
        self._stopping = True
        self._started = False
        self._update_capacity_event()
        while not self.queue.empty():
            job_id = self.queue.get_nowait()
            self.queue.task_done()
            self._scheduled_jobs.discard(job_id)
        pending = set()
        if self._worker_tasks:
            _, pending = await asyncio.wait(
                self._worker_tasks.values(), timeout=self.shutdown_timeout_seconds,
            )
        if pending:
            for interrupt in self._interrupts.values():
                interrupt.set()
            # Give external processes time to be killed and reaped.
            await asyncio.wait(pending, timeout=0.5)
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._heartbeat_task
            self._heartbeat_task = None
        if self._worker_tasks:
            worker_tasks = list(self._worker_tasks.values())
            for worker_task in worker_tasks:
                worker_task.cancel()
            with suppress(asyncio.CancelledError):
                await asyncio.gather(*worker_tasks)
            self._worker_tasks = {}
        while not self.queue.empty():
            job_id = self.queue.get_nowait()
            self.queue.task_done()
            self._scheduled_jobs.discard(job_id)
        self._queued_at.clear()

    async def _heartbeat(self) -> None:
        while True:
            self._last_heartbeat_at = datetime.now(UTC)
            await asyncio.sleep(self.heartbeat_interval_seconds)

    async def _worker(self, worker_index: int) -> None:
        if worker_index == 0 and self.pipeline is not None:
            pipeline = self.pipeline
        elif self.pipeline_factory is not None:
            pipeline = self.pipeline_factory()
        else:
            pipeline = self.pipeline
        while self._started and worker_index < self.worker_count:
            try:
                job_id = await asyncio.wait_for(
                    self.queue.get(),
                    timeout=0.5,
                )
            except TimeoutError:
                continue
            if self._stopping:
                self.queue.task_done()
                self._scheduled_jobs.discard(job_id)
                return
            self._update_capacity_event()
            self._active_jobs[worker_index] = (job_id, datetime.now(UTC))
            interrupt = threading.Event()
            self._interrupts[job_id] = interrupt
            timestamps = self._queued_at.get(job_id)
            queued_at = timestamps.popleft() if timestamps else time.perf_counter()
            if timestamps is not None and not timestamps:
                self._queued_at.pop(job_id, None)
            run_id = str(uuid4())
            queue_wait_ms = max((time.perf_counter() - queued_at) * 1000, 0)
            with event_context(
                job_id=job_id,
                run_id=run_id,
                component="task_runner",
            ):
                if self.event_logger is not None:
                    self.event_logger.emit(
                        event="worker.assigned",
                        level="INFO",
                        category="queue",
                        message="worker 已领取任务",
                        details={
                            "worker_index": worker_index,
                            "queue_wait_ms": round(queue_wait_ms, 3),
                            "queue_length": self.queue.qsize(),
                        },
                    )
                started = time.perf_counter()
                try:
                    with processing_context(interrupt):
                        await run_in_daemon_thread(pipeline.process, job_id)
                except ProcessingInterrupted:
                    logger.info("Processing interrupted for job %s", job_id)
                except Exception as exc:
                    safe_error = exception_details(exc, include_traceback=False)
                    logger.error(
                        "Background worker %s failed for job %s (%s: %s)",
                        worker_index,
                        job_id,
                        safe_error["exception_type"],
                        safe_error["error_summary"],
                    )
                    if self.event_logger is not None:
                        self.event_logger.emit(
                            event="worker.failed",
                            level="ERROR",
                            category="queue",
                            message="worker 执行任务失败",
                            duration_ms=(time.perf_counter() - started) * 1000,
                            details={
                                "worker_index": worker_index,
                                **exception_details(exc),
                            },
                        )
                else:
                    if self.event_logger is not None:
                        self.event_logger.emit(
                            event="worker.released",
                            level="INFO",
                            category="queue",
                            message="worker 已完成本次任务运行",
                            duration_ms=(time.perf_counter() - started) * 1000,
                            details={"worker_index": worker_index},
                        )
                finally:
                    self._active_jobs.pop(worker_index, None)
                    self._interrupts.pop(job_id, None)
                    self._scheduled_jobs.discard(job_id)
                    self.queue.task_done()
                if self._stopping:
                    return
