from __future__ import annotations

import argparse
import hashlib
import json
import math
from dataclasses import replace
from collections import defaultdict
from pathlib import Path
from typing import Any

from app.alignment.benchmark import (
    BenchmarkCaseResult,
    BenchmarkDataError,
    compare_timelines,
    summarize_cases,
)
from app.alignment.review import lyric_timeline_from_dict


def _load_timeline(path: Path):
    content = path.read_bytes()
    return lyric_timeline_from_dict(json.loads(content)), hashlib.sha256(content).hexdigest()


def build_report(manifest_path: Path) -> dict[str, Any]:
    base_dir = manifest_path.resolve().parent
    content = manifest_path.read_bytes()
    manifest = json.loads(content)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("cases"), list) or not manifest["cases"]:
        raise BenchmarkDataError("Manifest must contain a non-empty cases list")
    names: set[str] = set()
    engine_names: set[str] = set()
    for case in manifest["cases"]:
        if not isinstance(case, dict) or not isinstance(case.get("name"), str) or not case["name"].strip():
            raise BenchmarkDataError("Every case must have a name")
        if case["name"] in names:
            raise BenchmarkDataError("Case names must be unique")
        names.add(case["name"])
        if not isinstance(case.get("reference"), str) or not isinstance(case.get("engines"), dict):
            raise BenchmarkDataError("Every case requires a reference and engines")
        engine_names.update(case["engines"])
    declared_engines = manifest.get("engines", sorted(engine_names))
    if not isinstance(declared_engines, list) or not declared_engines or any(
        not isinstance(engine, str) or not engine.strip() for engine in declared_engines
    ):
        raise BenchmarkDataError("Manifest must name at least one engine")
    engine_names.update(declared_engines)
    by_engine: dict[str, list[BenchmarkCaseResult]] = defaultdict(list)

    for case in manifest.get("cases", []):
        name = str(case["name"])
        try:
            reference, reference_hash = _load_timeline(base_dir / case["reference"])
        except Exception as exc:
            for engine_name in sorted(engine_names):
                by_engine[engine_name].append(
                    BenchmarkCaseResult(
                        name=name,
                        error=f"reference:{type(exc).__name__}",
                    )
                )
            continue

        for engine_name in sorted(engine_names):
            result = BenchmarkCaseResult(name=name, reference_sha256=reference_hash)
            try:
                engine_result = case["engines"].get(engine_name)
                if not isinstance(engine_result, dict):
                    raise BenchmarkDataError("Missing engine result")
                result = replace(result,
                    elapsed_seconds=_optional_float(engine_result.get("elapsed_seconds")),
                    peak_rss_mb=_optional_float(engine_result.get("peak_rss_mb")),
                )
                if engine_result.get("error"):
                    raise BenchmarkDataError(str(engine_result["error"]))
                candidate, candidate_hash = _load_timeline(base_dir / engine_result["timeline"])
                result = replace(result, actual_engine=candidate.alignment_engine,
                                 candidate_sha256=candidate_hash)
                if engine_name in {"whisper_mora", "fa_kara_mms"} and candidate.alignment_engine != engine_name:
                    raise BenchmarkDataError("Candidate used a different alignment engine (fallback)")
                metrics = compare_timelines(reference, candidate)
                result = replace(
                    result,
                    mora_count=metrics.mora_count,
                    mean_absolute_error_ms=(
                        metrics.mean_absolute_error_ms
                    ),
                    median_absolute_error_ms=(
                        metrics.median_absolute_error_ms
                    ),
                    max_absolute_error_ms=metrics.max_absolute_error_ms,
                    p95_absolute_error_ms=metrics.p95_absolute_error_ms,
                )
            except Exception as exc:
                result = replace(result, error=f"{type(exc).__name__}:{exc}")
            by_engine[str(engine_name)].append(result)

    report = {
        "manifest": str(manifest_path.resolve()),
        "manifest_sha256": hashlib.sha256(content).hexdigest(),
        "aggregation": "equal_weight_per_song; median and p95 summaries are means of case statistics",
        "engines": {
            engine: {
                "summary": summarize_cases(results),
                "cases": [result.to_dict() for result in results],
            }
            for engine, results in sorted(by_engine.items())
        },
    }
    report["quality_gate"] = evaluate_quality_gate(report, manifest.get("limits", {}))
    return report


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    number = float(value)
    if isinstance(value, bool) or not math.isfinite(number) or number < 0:
        raise BenchmarkDataError("Resource measurements must be finite and non-negative")
    return number


def evaluate_quality_gate(report: dict, limits: dict) -> dict:
    fields = {
        "max_failure_rate": "failure_rate",
        "max_mean_absolute_error_ms": "mean_absolute_error_ms",
        "max_mean_case_p95_absolute_error_ms": "mean_case_p95_absolute_error_ms",
        "max_mean_elapsed_seconds": "mean_elapsed_seconds",
        "max_peak_rss_mb": "peak_rss_mb",
    }
    if not isinstance(limits, dict) or set(limits) - fields.keys():
        raise BenchmarkDataError("Unknown quality limit")
    resolved = {"max_failure_rate": 0.0, **limits}
    for name, value in resolved.items():
        if _optional_float(value) is None or (name == "max_failure_rate" and float(value) > 1):
            raise BenchmarkDataError("Invalid quality limit")
    violations = []
    for engine, results in report["engines"].items():
        for name, limit in resolved.items():
            actual = results["summary"][fields[name]]
            measurement = {"max_mean_elapsed_seconds": "elapsed_seconds", "max_peak_rss_mb": "peak_rss_mb"}.get(name)
            missing = measurement and any(case[measurement] is None for case in results["cases"])
            if actual is None or missing or actual > float(limit):
                violations.append({"engine": engine, "limit": name, "expected_max": float(limit),
                                   "actual": actual, "missing_measurement": bool(missing)})
    return {"passed": not violations, "limits": resolved, "violations": violations}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Compare alignment timelines against fixed references."
    )
    parser.add_argument("manifest")
    parser.add_argument("--output", required=True)
    parser.add_argument("--strict", action="store_true", help="Exit with status 1 when the quality gate fails")
    args = parser.parse_args(argv)

    try:
        report = build_report(Path(args.manifest))
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            report,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    if args.strict and not report["quality_gate"]["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
