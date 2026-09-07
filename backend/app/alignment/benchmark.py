from __future__ import annotations

from dataclasses import asdict, dataclass
from math import ceil
from statistics import mean, median
from typing import Any

from app.alignment.models import LyricTimeline


class BenchmarkDataError(ValueError):
    """Raised when reference and candidate timelines cannot be compared."""


@dataclass(frozen=True)
class TimelineErrorMetrics:
    mora_count: int
    mean_absolute_error_ms: float
    median_absolute_error_ms: float
    max_absolute_error_ms: int
    p95_absolute_error_ms: int


@dataclass(frozen=True)
class BenchmarkCaseResult:
    name: str
    mora_count: int = 0
    mean_absolute_error_ms: float | None = None
    median_absolute_error_ms: float | None = None
    max_absolute_error_ms: int | None = None
    p95_absolute_error_ms: int | None = None
    elapsed_seconds: float | None = None
    peak_rss_mb: float | None = None
    error: str | None = None
    actual_engine: str | None = None
    reference_sha256: str | None = None
    candidate_sha256: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _flatten(timeline: LyricTimeline) -> list[tuple[str, int, int]]:
    return [
        (mora.reading, mora.start_ms, mora.end_ms)
        for line in timeline.lines
        for token in line.tokens
        for mora in token.moras
    ]


def compare_timelines(
    reference: LyricTimeline,
    candidate: LyricTimeline,
) -> TimelineErrorMetrics:
    expected = _flatten(reference)
    actual = _flatten(candidate)
    if any(start < 0 or end <= start for _, start, end in expected + actual):
        raise BenchmarkDataError("Timeline contains invalid mora timing")
    if not expected or [item[0] for item in expected] != [
        item[0] for item in actual
    ]:
        raise BenchmarkDataError("Timeline mora sequence does not match reference")

    errors = [
        error
        for (_, expected_start, expected_end), (
            _,
            actual_start,
            actual_end,
        ) in zip(expected, actual, strict=True)
        for error in (
            abs(actual_start - expected_start),
            abs(actual_end - expected_end),
        )
    ]
    return TimelineErrorMetrics(
        mora_count=len(expected),
        mean_absolute_error_ms=mean(errors),
        median_absolute_error_ms=median(errors),
        max_absolute_error_ms=max(errors),
        p95_absolute_error_ms=sorted(errors)[ceil(len(errors) * 0.95) - 1],
    )


def summarize_cases(cases: list[BenchmarkCaseResult]) -> dict[str, Any]:
    successful = [case for case in cases if case.error is None]
    return {
        "case_count": len(cases),
        "success_count": len(successful),
        "failure_rate": (
            (len(cases) - len(successful)) / len(cases) if cases else 0.0
        ),
        "mean_absolute_error_ms": _mean_value(
            successful,
            "mean_absolute_error_ms",
        ),
        "median_absolute_error_ms": _mean_value(
            successful,
            "median_absolute_error_ms",
        ),
        "mean_elapsed_seconds": _mean_value(
            cases,
            "elapsed_seconds",
        ),
        "peak_rss_mb": max(
            (
                case.peak_rss_mb
                for case in cases
                if case.peak_rss_mb is not None
            ),
            default=None,
        ),
        "max_absolute_error_ms": max(
            (case.max_absolute_error_ms for case in successful
             if case.max_absolute_error_ms is not None), default=None,
        ),
        "mean_case_p95_absolute_error_ms": _mean_value(successful, "p95_absolute_error_ms"),
    }


def _mean_value(
    cases: list[BenchmarkCaseResult],
    field: str,
) -> float | None:
    values = [
        value
        for case in cases
        if (value := getattr(case, field)) is not None
    ]
    return mean(values) if values else None
