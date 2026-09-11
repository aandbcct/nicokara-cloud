"use client";

import {
  ChevronDown,
  GripVertical,
  Languages,
  RotateCcw,
  TimerReset,
  Undo2, Redo2, Repeat2, SkipBack, SkipForward, Minus, Plus,
} from "lucide-react";
import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  applyLineEdgeOffset,
  applyLineOffset,
  applyTimelineOffset,
  timelineDragOffsetMs,
  updateLineRange,
  updateMoraBoundary,
  updateOuterMoraEdge,
  updateUnitReading,
  updateUnitText,
} from "@/lib/kirakara-review";
import type {
  KirakaraLine,
  KirakaraTimeline,
} from "@/lib/kirakara-timeline";
import {
  DEFAULT_PLAYBACK_SHORTCUT_BINDINGS,
  formatPlaybackSeconds,
  playbackShortcut,
  PlaybackShortcut,
  previewSeekMs,
  type PlaybackRange,
  type PlaybackShortcutBindings,
} from "@/lib/timeline-editing";

type TimingDragTarget =
  | { kind: "line-edge"; edge: "start" | "end" }
  | { kind: "line-move" }
  | { kind: "mora-boundary"; boundaryIndex: number; baseTimeMs: number }
  | { kind: "mora-outer-edge"; edge: "start" | "end"; baseTimeMs: number };

type TimingBoundaryTarget =
  | { kind: "line-start" }
  | { kind: "mora"; boundaryIndex: number }
  | { kind: "mora-outer"; edge: "start" | "end" }
  | { kind: "line-end" };

type TimingDrag = {
  pointerId: number;
  lineIndex: number;
  target: TimingDragTarget;
  startClientX: number;
  trackWidth: number;
  lineDuration: number;
  baseTimeline: KirakaraTimeline;
  latestTimeline: KirakaraTimeline;
  moved: boolean;
};

type TimingSegmentBase = {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
};

type TimingSegment = TimingSegmentBase & (
  | { kind: "mora"; moraIndex: number; boundaryIndex: number | null }
  | { kind: "unit"; moraIndex: null; boundaryIndex: null }
);

type MoraBoundaryMarker = {
  boundaryIndex: number;
  leftPercent: number;
};

const MOUSE_BOUNDARY_GAP_PX = 20;
const TOUCH_BOUNDARY_GAP_PX = 32;
const MOUSE_BOUNDARY_HIT_WIDTH_PX = 12;
const TOUCH_BOUNDARY_HIT_WIDTH_PX = 24;
const MORA_SEGMENT_TOP_PX = 18;
const MORA_SEGMENT_HEIGHT_PX = 48;
const MORA_TRACK_HEIGHT_PX = 74;

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3);
}

function lineTimingSegments(line: KirakaraLine): TimingSegment[] {
  const moraCount = line.units.reduce(
    (count, unit) => count + unit.moras.length,
    0,
  );
  let moraPosition = 0;

  return line.units.flatMap((unit, unitIndex): TimingSegment[] => {
    if (unit.moras.length === 0) {
      if (unit.endMs <= unit.startMs) return [];
      return [{
        key: `unit-${unitIndex}`,
        kind: "unit",
        label: unit.reading || unit.text,
        startMs: unit.startMs,
        endMs: unit.endMs,
        moraIndex: null,
        boundaryIndex: null,
      }];
    }

    return unit.moras.map((mora, moraIndex) => {
      const segment: TimingSegment = {
        key: `mora-${unitIndex}-${moraIndex}`,
        kind: "mora",
        label: mora.reading,
        startMs: mora.startMs,
        endMs: mora.endMs,
        moraIndex: moraPosition,
        boundaryIndex: moraPosition < moraCount - 1 ? moraPosition : null,
      };
      moraPosition += 1;
      return segment;
    });
  });
}

export function timingDragPreviewMs(
  timeline: KirakaraTimeline,
  lineIndex: number,
  target:
    | { kind: "line-edge"; edge: "start" | "end" }
    | { kind: "line-move" }
    | { kind: "mora-boundary"; boundaryIndex: number }
    | { kind: "mora-outer-edge"; edge: "start" | "end" },
): number {
  const line = timeline.lines[lineIndex];
  if (!line) throw new RangeError("歌词行不存在");
  if (target.kind === "line-edge") {
    return target.edge === "start" ? line.startMs : line.endMs;
  }

  if (target.kind === "line-move") return line.startMs;
  if (target.kind === "mora-outer-edge") {
    const moras = line.units.flatMap((unit) => unit.moras);
    const mora = target.edge === "start" ? moras[0] : moras.at(-1);
    if (!mora) throw new RangeError("当前歌词行没有 Mora");
    return target.edge === "start" ? mora.startMs : mora.endMs;
  }

  const boundary = lineTimingSegments(line).find(
    (segment) => segment.kind === "mora"
      && segment.boundaryIndex === target.boundaryIndex,
  );
  if (!boundary) throw new RangeError("Mora 分界不存在");
  return boundary.endMs;
}

export function timingDragSeekMs(
  timeline: KirakaraTimeline,
  lineIndex: number,
  target:
    | { kind: "line-edge"; edge: "start" | "end" }
    | { kind: "line-move" }
    | { kind: "mora-boundary"; boundaryIndex: number }
    | { kind: "mora-outer-edge"; edge: "start" | "end" },
  previewLeadMs: number,
): number {
  return previewSeekMs(
    timingDragPreviewMs(timeline, lineIndex, target),
    previewLeadMs,
    timeline.durationMs,
  );
}

function moraBoundaryMarkers(
  segments: TimingSegment[],
  lineStartMs: number,
  lineDurationMs: number,
): MoraBoundaryMarker[] {
  return segments
    .filter(
      (segment) => segment.kind === "mora" && segment.boundaryIndex !== null,
    )
    .map((segment) => ({
      boundaryIndex: segment.boundaryIndex as number,
      leftPercent: (segment.endMs - lineStartMs) / lineDurationMs * 100,
    }));
}

export function directlyDraggableBoundaryIndexes(
  boundaryPositionsPx: number[],
  minimumGapPx: number,
): Set<number> {
  const direct = new Set<number>();
  for (let index = 1; index < boundaryPositionsPx.length - 1; index += 1) {
    const leftGap = boundaryPositionsPx[index] - boundaryPositionsPx[index - 1];
    const rightGap = boundaryPositionsPx[index + 1] - boundaryPositionsPx[index];
    if (leftGap >= minimumGapPx && rightGap >= minimumGapPx) direct.add(index - 1);
  }
  return direct;
}

function applyTimingDragTarget(
  timeline: KirakaraTimeline,
  lineIndex: number,
  target: TimingDragTarget,
  offsetMs: number,
): KirakaraTimeline {
  if (target.kind === "line-edge") {
    return applyLineEdgeOffset(timeline, lineIndex, target.edge, offsetMs);
  }
  if (target.kind === "line-move") {
    return applyLineOffset(timeline, lineIndex, offsetMs);
  }
  if (target.kind === "mora-outer-edge") {
    return updateOuterMoraEdge(
      timeline,
      lineIndex,
      target.edge,
      target.baseTimeMs + offsetMs,
    );
  }
  return updateMoraBoundary(
    timeline,
    lineIndex,
    target.boundaryIndex,
    target.baseTimeMs + offsetMs,
  );
}

export function KirakaraReviewEditor({
  timeline,
  editingLineIndex,
  previewLeadMs,
  shortcutBindings = DEFAULT_PLAYBACK_SHORTCUT_BINDINGS,
  onEditingLineChange,
  onChange,
  onSeek,
  canUndo = false, canRedo = false, onUndo, onRedo, looping = false, onLoopChange, onLoop,
}: {
  timeline: KirakaraTimeline;
  editingLineIndex: number | null;
  previewLeadMs: number;
  shortcutBindings?: PlaybackShortcutBindings;
  onEditingLineChange: (index: number) => void;
  onChange: (timeline: KirakaraTimeline, group?: string) => void;
  onSeek: (milliseconds: number) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  looping?: boolean;
  onLoopChange?: (looping: boolean) => void;
  onLoop?: (range: PlaybackRange | null) => void;
}) {
  const [offset, setOffset] = useState("0.00");
  const [error, setError] = useState<string | null>(null);
  const [stepMs, setStepMs] = useState(10);
  const [activeDrag, setActiveDrag] = useState<TimingDragTarget | null>(null);
  const [selectedBoundary, setSelectedBoundary] = useState<{
    lineIndex: number;
    target: TimingBoundaryTarget;
  } | null>(null);
  const [selectedMora, setSelectedMora] = useState<{
    lineIndex: number;
    moraIndex: number;
  } | null>(null);
  const [trackWidthPx, setTrackWidthPx] = useState(0);
  const [minimumBoundaryGapPx] = useState(() =>
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(pointer: coarse)").matches
      ? TOUCH_BOUNDARY_GAP_PX
      : MOUSE_BOUNDARY_GAP_PX,
  );
  const boundaryHitWidthPx = minimumBoundaryGapPx === TOUCH_BOUNDARY_GAP_PX
    ? TOUCH_BOUNDARY_HIT_WIDTH_PX
    : MOUSE_BOUNDARY_HIT_WIDTH_PX;
  const [rangeDraft, setRangeDraft] = useState<{
    lineIndex: number;
    sourceStartMs: number;
    sourceEndMs: number;
    start: string;
    end: string;
  } | null>(null);
  const timelineTrack = useRef<HTMLDivElement | null>(null);
  const timingDrag = useRef<TimingDrag | null>(null);
  const currentLineIndex = editingLineIndex ?? -1;
  const line = timeline.lines[currentLineIndex];
  const lineStartMs = line?.startMs;
  const lineEndMs = line?.endMs;

  useEffect(() => {
    onLoop?.(looping && lineStartMs !== undefined && lineEndMs !== undefined ? { startMs: lineStartMs, endMs: lineEndMs } : null);
  }, [looping, lineStartMs, lineEndMs, onLoop]);
  useEffect(() => () => onLoop?.(null), [onLoop]);
  useEffect(() => {
    const track = timelineTrack.current;
    if (!track) return;
    const updateTrackWidth = () => {
      if (timingDrag.current) return;
      setTrackWidthPx(Math.round(track.getBoundingClientRect().width));
    };
    updateTrackWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateTrackWidth);
    observer.observe(track);
    return () => observer.disconnect();
  }, [editingLineIndex]);
  const timingSegments = useMemo(
    () => line ? lineTimingSegments(line) : [],
    [line],
  );
  const boundaryMarkers = useMemo(
    () => line
      ? moraBoundaryMarkers(
          timingSegments,
          line.startMs,
          Math.max(1, line.endMs - line.startMs),
        )
      : [],
    [line, timingSegments],
  );
  const directBoundaryIndexes = useMemo(
    () => directlyDraggableBoundaryIndexes(
      [
        0,
        ...boundaryMarkers.map((marker) => marker.leftPercent / 100 * trackWidthPx),
        trackWidthPx,
      ],
      minimumBoundaryGapPx,
    ),
    [boundaryMarkers, minimumBoundaryGapPx, trackWidthPx],
  );
  const moraSegments = timingSegments.filter(
    (segment): segment is TimingSegment & { kind: "mora"; moraIndex: number } =>
      segment.kind === "mora" && segment.moraIndex !== null,
  );
  const selectedMoraSegment = selectedMora?.lineIndex === currentLineIndex
    ? moraSegments.find((segment) => segment.moraIndex === selectedMora.moraIndex) ?? null
    : null;

  useEffect(() => {
    function handleMoraShortcut(event: KeyboardEvent) {
      const shortcut = playbackShortcut(event, event.target, shortcutBindings);
      if (shortcut !== PlaybackShortcut.PreviousMora
        && shortcut !== PlaybackShortcut.NextMora) return;
      if (moraSegments.length === 0) return;
      event.preventDefault();
      const current = selectedMora?.lineIndex === currentLineIndex
        ? selectedMora.moraIndex
        : shortcut === PlaybackShortcut.NextMora ? -1 : moraSegments.length;
      const direction = shortcut === PlaybackShortcut.NextMora ? 1 : -1;
      const moraIndex = Math.min(
        moraSegments.length - 1,
        Math.max(0, current + direction),
      );
      setSelectedMora({ lineIndex: currentLineIndex, moraIndex });
    }
    window.addEventListener("keydown", handleMoraShortcut, true);
    return () => window.removeEventListener("keydown", handleMoraShortcut, true);
  }, [currentLineIndex, moraSegments, selectedMora, shortcutBindings]);
  const currentRangeDraft = rangeDraft?.lineIndex === currentLineIndex
    && rangeDraft.sourceStartMs === lineStartMs
    && rangeDraft.sourceEndMs === lineEndMs
    ? rangeDraft
    : {
        lineIndex: currentLineIndex,
        sourceStartMs: lineStartMs ?? 0,
        sourceEndMs: lineEndMs ?? 0,
        start: lineStartMs === undefined ? "" : seconds(lineStartMs),
        end: lineEndMs === undefined ? "" : seconds(lineEndMs),
      };

  function changeRange(startMs: number, endMs: number): KirakaraTimeline | null {
    try {
      const updated = updateLineRange(timeline, currentLineIndex, startMs, endMs);
      onChange(updated);
      setError(null);
      return updated;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "时间范围无效");
      return null;
    }
  }

  function commitRangeDraft() {
    const startMs = Number(currentRangeDraft.start) * 1000;
    const endMs = Number(currentRangeDraft.end) * 1000;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      setError("请输入完整、有效的时间点");
      return;
    }
    const previous = timeline.lines[currentLineIndex - 1];
    const next = timeline.lines[currentLineIndex + 1];
    const constrainedStart = Math.max(previous?.endMs ?? 0, Math.round(startMs));
    const constrainedEnd = Math.min(next?.startMs ?? Number.POSITIVE_INFINITY, Math.round(endMs));
    const updated = changeRange(constrainedStart, constrainedEnd);
    const updatedLine = updated?.lines[currentLineIndex];
    if (updatedLine) {
      setRangeDraft({
        ...currentRangeDraft,
        start: seconds(updatedLine.startMs),
        end: seconds(updatedLine.endMs),
      });
    } else {
      setRangeDraft(null);
    }
  }

  function applyOffset() {
    const offsetMs = Math.round(Number(offset) * 1000);
    if (!Number.isFinite(offsetMs)) {
      setError("请输入有效的偏移秒数");
      return;
    }
    onChange(applyTimelineOffset(timeline, offsetMs));
    setOffset("0.00");
    setError(null);
  }

  function changeUnitText(unitIndex: number, text: string) {
    onChange(updateUnitText(timeline, currentLineIndex, unitIndex, text));
    setError(null);
  }

  function changeUnitReading(unitIndex: number, reading: string) {
    onChange(updateUnitReading(timeline, currentLineIndex, unitIndex, reading));
    setError(null);
  }

  function startTimingDrag(
    event: ReactPointerEvent<HTMLElement>,
    target: TimingDragTarget,
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const trackWidth = timelineTrack.current?.getBoundingClientRect().width ?? 0;
    if (trackWidth <= 0 || !line) return;

    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setError(null);
    timingDrag.current = {
      pointerId: event.pointerId,
      lineIndex: currentLineIndex,
      target,
      startClientX: event.clientX,
      trackWidth,
      lineDuration: Math.max(1, line.endMs - line.startMs),
      baseTimeline: timeline,
      latestTimeline: timeline,
      moved: false,
    };
    setActiveDrag(target);
    const boundaryTarget = target.kind === "line-edge"
      ? { kind: target.edge === "start" ? "line-start" : "line-end" } as const
      : target.kind === "mora-boundary"
        ? { kind: "mora", boundaryIndex: target.boundaryIndex } as const
        : target.kind === "mora-outer-edge"
          ? { kind: "mora-outer", edge: target.edge } as const
          : null;
    setSelectedBoundary(boundaryTarget
      ? { lineIndex: currentLineIndex, target: boundaryTarget }
      : null);
  }

  function moveTimingDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = timingDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaPixels = event.clientX - drag.startClientX;
    if (!drag.moved && Math.abs(deltaPixels) < 3) return;

    event.preventDefault();
    drag.moved = true;
    const offsetMs = timelineDragOffsetMs(
      deltaPixels,
      drag.trackWidth,
      drag.lineDuration,
    );
    const updated = applyTimingDragTarget(
      drag.baseTimeline,
      drag.lineIndex,
      drag.target,
      offsetMs,
    );
    drag.latestTimeline = updated;
    onChange(updated, `drag-${drag.pointerId}`);
  }

  function finishTimingDrag(
    event: ReactPointerEvent<HTMLElement>,
    canceled = false,
  ) {
    const drag = timingDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    timingDrag.current = null;
    setActiveDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) {
      if (canceled) onChange(drag.baseTimeline, `drag-${drag.pointerId}`);
      onChange(canceled ? drag.baseTimeline : drag.latestTimeline);
    }
    if (drag.moved && !canceled) {
      onSeek(timingDragSeekMs(
        drag.latestTimeline,
        drag.lineIndex,
        drag.target,
        previewLeadMs,
      ));
    }
  }

  function adjustMoraBoundary(boundaryIndex: number, boundaryMs: number, direction: -1 | 1) {
    const updated = updateMoraBoundary(
      timeline,
      currentLineIndex,
      boundaryIndex,
      boundaryMs + direction * stepMs,
    );
    onChange(updated);
    onSeek(previewSeekMs(
      timingDragPreviewMs(updated, currentLineIndex, { kind: "mora-boundary", boundaryIndex }),
      previewLeadMs,
      timeline.durationMs,
    ));
  }

  function adjustLineEdge(edge: "start" | "end", direction: -1 | 1) {
    const updated = applyLineEdgeOffset(timeline, currentLineIndex, edge, direction * stepMs);
    onChange(updated);
    onSeek(previewSeekMs(
      timingDragPreviewMs(updated, currentLineIndex, { kind: "line-edge", edge }),
      previewLeadMs,
      timeline.durationMs,
    ));
  }

  function adjustLineMove(direction: -1 | 1) {
    const updated = applyLineOffset(timeline, currentLineIndex, direction * stepMs);
    onChange(updated);
    onSeek(previewSeekMs(
      timingDragPreviewMs(updated, currentLineIndex, { kind: "line-move" }),
      previewLeadMs,
      timeline.durationMs,
    ));
  }

  function moraEdgeTarget(
    segment: TimingSegment & { kind: "mora"; moraIndex: number },
    edge: "start" | "end",
  ): TimingDragTarget {
    if (edge === "start" && segment.moraIndex === 0) {
      return { kind: "mora-outer-edge", edge, baseTimeMs: segment.startMs };
    }
    if (edge === "end" && segment.moraIndex === moraSegments.length - 1) {
      return { kind: "mora-outer-edge", edge, baseTimeMs: segment.endMs };
    }
    return {
      kind: "mora-boundary",
      boundaryIndex: edge === "start" ? segment.moraIndex - 1 : segment.moraIndex,
      baseTimeMs: edge === "start" ? segment.startMs : segment.endMs,
    };
  }

  function changeMoraEdge(
    segment: TimingSegment & { kind: "mora"; moraIndex: number },
    edge: "start" | "end",
    timeMs: number,
  ) {
    const target = moraEdgeTarget(segment, edge);
    const currentTimeMs = edge === "start" ? segment.startMs : segment.endMs;
    const updated = applyTimingDragTarget(
      timeline,
      currentLineIndex,
      target,
      timeMs - currentTimeMs,
    );
    onChange(updated);
    onSeek(timingDragSeekMs(updated, currentLineIndex, target, previewLeadMs));
  }

  function selectTimingBoundary(target: TimingBoundaryTarget) {
    setSelectedBoundary({ lineIndex: currentLineIndex, target });
  }

  function boundaryTooltip(target: TimingBoundaryTarget, milliseconds: number) {
    const currentBoundary = selectedBoundary?.lineIndex === currentLineIndex
      ? selectedBoundary.target
      : null;
    const selected = currentBoundary?.kind === target.kind
      && (target.kind === "mora"
        ? currentBoundary.kind === "mora" && currentBoundary.boundaryIndex === target.boundaryIndex
        : target.kind === "mora-outer"
          ? currentBoundary.kind === "mora-outer" && currentBoundary.edge === target.edge
          : true);
    if (!selected) return null;
    return (
      <span
        data-time-boundary-tooltip="true"
        className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[11px] font-medium tabular-nums text-background shadow-sm"
      >
        {formatPlaybackSeconds(milliseconds)}
      </span>
    );
  }

  if (!line || editingLineIndex === null) {
    return (
      <section aria-labelledby="timeline-review-heading">
        <h3 id="timeline-review-heading" className="text-base font-bold">时间轴检查</h3>
        <p className="mt-4 text-sm text-muted-foreground">请从歌词列表选择一行，或使用“定位歌词”锁定当前播放行。</p>
      </section>
    );
  }
  const lineDuration = Math.max(1, line.endMs - line.startMs);

  return (
    <section aria-labelledby="timeline-review-heading">
      <h3 id="timeline-review-heading" className="sr-only">时间轴检查</h3>

      <div
        data-review-panels="true"
        className="space-y-5"
      >
        <section data-timing-panel="true" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-3">
              <h4 className="shrink-0 text-sm font-bold">设置时间轴</h4>
              <span className="truncate text-xs font-medium text-muted-foreground">{editingLineIndex + 1}. {line.text}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {seconds(line.startMs)} - {seconds(line.endMs)}
              </span>
            </div>
            <div data-timing-toolbar="true" className="flex items-center gap-1">
              <button type="button" title="撤销" aria-label="撤销" disabled={!canUndo || Boolean(activeDrag)} onClick={onUndo}
                className="focus-ring inline-flex size-9 items-center justify-center rounded-sm border hover:bg-muted disabled:opacity-40"><Undo2 className="size-4" /></button>
              <button type="button" title="重做" aria-label="重做" disabled={!canRedo || Boolean(activeDrag)} onClick={onRedo}
                className="focus-ring inline-flex size-9 items-center justify-center rounded-sm border hover:bg-muted disabled:opacity-40"><Redo2 className="size-4" /></button>
              <button type="button" title="上一句" aria-label="上一句" disabled={editingLineIndex === 0} onClick={() => onEditingLineChange(editingLineIndex - 1)}
                className="focus-ring inline-flex size-9 items-center justify-center rounded-sm border hover:bg-muted disabled:opacity-40"><SkipBack className="size-4" /></button>
              <button type="button" title="下一句" aria-label="下一句" disabled={editingLineIndex >= timeline.lines.length - 1} onClick={() => onEditingLineChange(editingLineIndex + 1)}
                className="focus-ring inline-flex size-9 items-center justify-center rounded-sm border hover:bg-muted disabled:opacity-40"><SkipForward className="size-4" /></button>
              {onLoop && <button type="button" title="单句循环试听" aria-label="单句循环试听" aria-pressed={looping} onClick={() => onLoopChange?.(!looping)}
                className={`focus-ring inline-flex size-9 items-center justify-center rounded-sm border ${looping ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}><Repeat2 className="size-4" /></button>}
            </div>
          </div>

          <div data-timeline-track-wrapper="true" className="mt-3 w-full">
            <div
              ref={timelineTrack}
              data-mora-timeline="true"
              data-boundary-gap-px={minimumBoundaryGapPx}
              className="relative rounded-sm border bg-muted/40"
              style={{ height: `${MORA_TRACK_HEIGHT_PX}px` }}
              aria-label={`当前歌词行时间轴：${line.text}`}
            >
              <button
                type="button"
                draggable={false}
                data-line-move="true"
                data-playback-shortcuts="true"
                title="整句平移"
                aria-label="整句平移"
                className="focus-ring absolute left-1/2 top-0 z-20 flex h-5 w-12 -translate-x-1/2 -translate-y-1/2 touch-none select-none cursor-grab items-center justify-center text-primary active:cursor-grabbing"
                onPointerDown={(event) => startTimingDrag(event, { kind: "line-move" })}
                onPointerMove={moveTimingDrag}
                onPointerUp={finishTimingDrag}
                onPointerCancel={(event) => finishTimingDrag(event, true)}
                onLostPointerCapture={(event) => finishTimingDrag(event, true)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  adjustLineMove(event.key === "ArrowLeft" ? -1 : 1);
                }}
              >
                <GripVertical data-line-control-dot="move" className="size-4 rotate-90" />
              </button>

              {(["start", "end"] as const).map((edge) => (
                <button
                  key={edge}
                  type="button"
                  draggable={false}
                  data-line-edge={edge}
                  data-time-boundary-kind={edge === "start" ? "line-start" : "line-end"}
                  data-playback-shortcuts="true"
                  aria-label={`调整当前歌词行的${edge === "start" ? "开始" : "结束"}时间`}
                  title={edge === "start" ? "整句开始（按比例拉伸）" : "整句结束（按比例拉伸）"}
                  className={`focus-ring absolute top-0 z-30 flex h-6 w-4 -translate-y-1/2 touch-none select-none cursor-ew-resize items-center justify-center text-primary ${
                    edge === "start"
                      ? "left-0 -translate-x-1/2"
                      : "right-0 translate-x-1/2"
                  }`}
                  onPointerDown={(event) => startTimingDrag(event, { kind: "line-edge", edge })}
                  onFocus={() => selectTimingBoundary({ kind: edge === "start" ? "line-start" : "line-end" })}
                  onBlur={() => setSelectedBoundary(null)}
                  onPointerMove={moveTimingDrag}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    adjustLineEdge(edge, event.key === "ArrowLeft" ? -1 : 1);
                  }}
                  onPointerUp={finishTimingDrag}
                  onPointerCancel={(event) => finishTimingDrag(event, true)}
                  onLostPointerCapture={(event) => finishTimingDrag(event, true)}
                >
                  {boundaryTooltip(
                    { kind: edge === "start" ? "line-start" : "line-end" },
                    edge === "start" ? line.startMs : line.endMs,
                  )}
                  <GripVertical data-line-control-dot={edge} className="size-4" />
                </button>
              ))}

              {timingSegments.map((segment, index) => {
                const start = Math.max(line.startMs, Math.min(line.endMs, segment.startMs));
                const end = Math.max(start, Math.min(line.endMs, segment.endMs));
                const left = (start - line.startMs) / lineDuration * 100;
                const width = (end - start) / lineDuration * 100;
                const selected = segment.moraIndex !== null
                  && selectedMora?.lineIndex === currentLineIndex
                  && selectedMora.moraIndex === segment.moraIndex;
                const affected = segment.moraIndex !== null && (
                  activeDrag?.kind === "mora-boundary"
                    ? segment.moraIndex === activeDrag.boundaryIndex || segment.moraIndex === activeDrag.boundaryIndex + 1
                    : activeDrag?.kind === "mora-outer-edge"
                      ? activeDrag.edge === "start"
                        ? segment.moraIndex === 0
                        : segment.moraIndex === moraSegments.length - 1
                      : false
                );
                return (
                  <button
                    key={segment.key}
                    type="button"
                    data-mora-segment={segment.kind === "mora" ? segment.key : undefined}
                    data-unit-segment={segment.kind === "unit" ? segment.key : undefined}
                    data-playback-shortcuts={segment.kind === "mora" ? "true" : undefined}
                    aria-pressed={segment.kind === "mora" ? selected : undefined}
                    className={`focus-ring absolute flex min-w-px items-center overflow-hidden border text-xs font-semibold ${
                      segment.kind === "unit"
                        ? "border-border bg-background text-muted-foreground"
                        : selected || affected
                          ? "z-10 border-primary bg-primary/25 text-primary"
                          : index % 2 === 0
                            ? "border-primary/45 bg-primary/20 text-foreground hover:bg-primary/25"
                            : "border-border bg-card text-foreground hover:bg-muted"
                    }`}
                    style={{
                      left: `${left}%`,
                      top: `${MORA_SEGMENT_TOP_PX}px`,
                      height: `${MORA_SEGMENT_HEIGHT_PX}px`,
                      width: `${width}%`,
                    }}
                    title={segment.kind === "mora"
                      ? `选择 Mora：${segment.label}（${seconds(start)} - ${seconds(end)}）`
                      : `${segment.label} ${seconds(start)} - ${seconds(end)}`}
                    onClick={() => {
                      if (segment.moraIndex !== null) {
                        setSelectedMora({ lineIndex: currentLineIndex, moraIndex: segment.moraIndex });
                      }
                    }}
                    onFocus={() => {
                      if (segment.moraIndex !== null) {
                        setSelectedMora({ lineIndex: currentLineIndex, moraIndex: segment.moraIndex });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (segment.kind !== "mora" || segment.moraIndex === null) return;
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      changeMoraEdge(
                        segment,
                        "start",
                        segment.startMs + (event.key === "ArrowLeft" ? -stepMs : stepMs),
                      );
                    }}
                  >
                    <span className="block w-full truncate px-1.5 text-center">
                      {segment.label}
                    </span>
                  </button>
                );
              })}

              {boundaryMarkers.map(({ boundaryIndex, leftPercent }) => {
                  const selectedMoraIndex = selectedMora?.lineIndex === currentLineIndex
                    ? selectedMora.moraIndex
                    : null;
                  const selectedByMora = selectedMoraIndex === boundaryIndex
                    || selectedMoraIndex === boundaryIndex + 1;
                  const dragging = activeDrag?.kind === "mora-boundary"
                    && activeDrag.boundaryIndex === boundaryIndex;
                  if (!directBoundaryIndexes.has(boundaryIndex) && !selectedByMora && !dragging) return null;
                  const marker = moraSegments[boundaryIndex];
                  const selected = selectedBoundary?.lineIndex === currentLineIndex
                    && selectedBoundary.target.kind === "mora"
                    && selectedBoundary.target.boundaryIndex === boundaryIndex;
                  const title = selectedMoraIndex === boundaryIndex + 1
                    ? "当前 Mora 开始"
                    : selectedMoraIndex === boundaryIndex
                      ? "当前 Mora 结束"
                      : `${marker?.label ?? "Mora"} 后的分界`;
                  return (
                    <button
                      key={`boundary-${boundaryIndex}`}
                      type="button"
                      draggable={false}
                      data-mora-boundary={boundaryIndex}
                      data-time-boundary-kind="mora"
                      data-playback-shortcuts="true"
                      data-density-mode={directBoundaryIndexes.has(boundaryIndex) ? "direct" : "selected"}
                      aria-label={`调整第 ${boundaryIndex + 1} 个 Mora 分界`}
                      title={title}
                      className={`focus-ring group absolute z-20 flex -translate-x-1/2 touch-none select-none cursor-ew-resize items-center justify-center ${
                        selected || dragging ? "text-primary" : "text-muted-foreground"
                      }`}
                      style={{
                        left: `${leftPercent}%`,
                        top: `${MORA_SEGMENT_TOP_PX}px`,
                        width: `${boundaryHitWidthPx}px`,
                        height: `${MORA_SEGMENT_HEIGHT_PX}px`,
                      }}
                      onPointerDown={(event) => startTimingDrag(event, {
                        kind: "mora-boundary",
                        boundaryIndex,
                        baseTimeMs: marker?.endMs ?? line.startMs,
                      })}
                      onFocus={() => selectTimingBoundary({ kind: "mora", boundaryIndex })}
                      onBlur={() => setSelectedBoundary(null)}
                      onPointerMove={moveTimingDrag}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                        event.preventDefault();
                        adjustMoraBoundary(boundaryIndex, marker?.endMs ?? line.startMs, event.key === "ArrowLeft" ? -1 : 1);
                      }}
                      onPointerUp={finishTimingDrag}
                      onPointerCancel={(event) => finishTimingDrag(event, true)}
                      onLostPointerCapture={(event) => finishTimingDrag(event, true)}
                    >
                      {boundaryTooltip({ kind: "mora", boundaryIndex }, marker?.endMs ?? line.startMs)}
                      <span className={`pointer-events-none h-full bg-current transition-[width] ${selected || dragging ? "w-0.5" : "w-px group-hover:w-0.5"}`} />
                    </button>
                  );
                })}

              {selectedMoraSegment && (["start", "end"] as const).map((edge) => {
                const isOuter = edge === "start"
                  ? selectedMoraSegment.moraIndex === 0
                  : selectedMoraSegment.moraIndex === moraSegments.length - 1;
                if (!isOuter) return null;
                const timeMs = edge === "start" ? selectedMoraSegment.startMs : selectedMoraSegment.endMs;
                const leftPercent = (timeMs - line.startMs) / lineDuration * 100;
                return (
                  <button
                    key={`outer-mora-${edge}`}
                    type="button"
                    data-mora-outer-edge={edge}
                    data-time-boundary-kind={`mora-${edge}`}
                    data-playback-shortcuts="true"
                    aria-label={`调整当前 Mora 的${edge === "start" ? "开始" : "结束"}时间`}
                    title={`当前 Mora ${edge === "start" ? "开始" : "结束"}`}
                    className="focus-ring absolute z-30 flex -translate-x-1/2 touch-none cursor-ew-resize items-center justify-center text-primary"
                    style={{
                      left: `${leftPercent}%`,
                      top: `${MORA_SEGMENT_TOP_PX}px`,
                      width: `${boundaryHitWidthPx}px`,
                      height: `${MORA_SEGMENT_HEIGHT_PX}px`,
                    }}
                    onPointerDown={(event) => {
                      // eslint-disable-next-line react-hooks/refs -- 仅在指针事件触发后读取时间轴元素尺寸。
                      startTimingDrag(event, { kind: "mora-outer-edge", edge, baseTimeMs: timeMs });
                    }}
                    onFocus={() => selectTimingBoundary({ kind: "mora-outer", edge })}
                    onBlur={() => setSelectedBoundary(null)}
                    onPointerMove={moveTimingDrag}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      changeMoraEdge(selectedMoraSegment, edge, timeMs + (event.key === "ArrowLeft" ? -stepMs : stepMs));
                    }}
                    onPointerUp={finishTimingDrag}
                    onPointerCancel={(event) => finishTimingDrag(event, true)}
                    onLostPointerCapture={(event) => finishTimingDrag(event, true)}
                  >
                    {boundaryTooltip({ kind: "mora-outer", edge }, timeMs)}
                    <span className="pointer-events-none h-full w-0.5 bg-current" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">
              开始时间（秒）
              <input
                type="number"
                data-playback-shortcuts="true"
                min={timeline.lines[currentLineIndex - 1]
                  ? seconds(timeline.lines[currentLineIndex - 1].endMs)
                  : "0"}
                step="0.001"
                value={currentRangeDraft.start}
                onChange={(event) => setRangeDraft({ ...currentRangeDraft, start: event.target.value })}
                onBlur={commitRangeDraft}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="focus-ring mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              结束时间（秒）
              <input
                type="number"
                data-playback-shortcuts="true"
                min="0"
                max={timeline.lines[currentLineIndex + 1]
                  ? seconds(timeline.lines[currentLineIndex + 1].startMs)
                  : undefined}
                step="0.001"
                value={currentRangeDraft.end}
                onChange={(event) => setRangeDraft({ ...currentRangeDraft, end: event.target.value })}
                onBlur={commitRangeDraft}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="focus-ring mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <button
              type="button"
              className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold hover:bg-muted sm:col-span-2"
              onClick={() => onSeek(previewSeekMs(line.startMs, previewLeadMs, timeline.durationMs))}
            >
              <RotateCcw className="size-4" />
              定位预览
            </button>
          </div>

          {selectedMoraSegment && (
            <div data-selected-mora-editor="true" className="mt-3 rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold">当前 Mora：{selectedMoraSegment.label}</p>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {seconds(selectedMoraSegment.startMs)} - {seconds(selectedMoraSegment.endMs)}
                </span>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {(["start", "end"] as const).map((edge) => {
                  const timeMs = edge === "start" ? selectedMoraSegment.startMs : selectedMoraSegment.endMs;
                  return (
                    <label key={`${selectedMoraSegment.moraIndex}-${edge}-${timeMs}`} className="text-xs font-medium text-muted-foreground">
                      Mora {edge === "start" ? "开始" : "结束"}（秒）
                      <input
                        type="number"
                        data-mora-time-input={edge}
                        data-playback-shortcuts="true"
                        min="0"
                        step="0.001"
                        defaultValue={seconds(timeMs)}
                        onBlur={(event) => {
                          const nextTimeMs = Number(event.currentTarget.value) * 1000;
                          if (!Number.isFinite(nextTimeMs)) {
                            setError("请输入完整、有效的 Mora 时间点");
                            return;
                          }
                          changeMoraEdge(selectedMoraSegment, edge, nextTimeMs);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        className="focus-ring mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div data-timing-adjustment-row="true" className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-muted-foreground">微调步长
              <select aria-label="微调步长" value={stepMs} onChange={event => setStepMs(Number(event.target.value))}
                className="focus-ring mt-1 block h-9 rounded-md border bg-background px-2 text-sm text-foreground">
                {[1, 10, 25, 50, 100].map(value => <option key={value} value={value}>{value} ms</option>)}
              </select>
            </label>
            {(["line"] as const).map(target => <div key={target} className="text-xs text-muted-foreground">
              整句
              <div className="mt-1 flex gap-1">
                {([-1, 1] as const).map(direction => {
                  const label = `整句${direction < 0 ? "提前" : "延后"}`;
                  return <button key={direction} type="button" title={label} aria-label={label}
                    className="focus-ring inline-flex size-9 items-center justify-center rounded-sm border hover:bg-muted"
                    onClick={() => changeRange(line.startMs + direction * stepMs, line.endMs + direction * stepMs)}>
                    {direction < 0 ? <Minus className="size-4" /> : <Plus className="size-4" />}
                  </button>;
                })}
              </div>
            </div>)}
            <div data-timeline-offset-group="true" className="flex min-w-0 flex-1 flex-wrap items-end gap-2 md:ml-auto md:max-w-md">
            <label className="min-w-40 flex-1 text-xs font-medium text-muted-foreground">
              整体偏移（秒，可为负数）
              <input
                type="number"
                data-playback-shortcuts="true"
                step="0.01"
                value={offset}
                onChange={(event) => setOffset(event.target.value)}
                className="focus-ring mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <button
              type="button"
              className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold hover:bg-muted"
              onClick={applyOffset}
            >
              <TimerReset className="size-4" />
              应用偏移
            </button>
            </div>
          </div>
        </section>

        <section
          data-lyrics-disclosure="true"
          className="min-w-0 border-t pt-4"
        >
          <details className="group">
            <summary
              data-lyrics-toggle="true"
              className="focus-ring flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm font-bold hover:bg-muted [&::-webkit-details-marker]:hidden"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Languages className="size-4 shrink-0" />
                <span>编辑歌词与读音</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>

            <div
              data-lyrics-panel="true"
              className="mt-3 divide-y rounded-sm border"
            >
              {line.units.map((unit, unitIndex) => (
                <div
                  key={`unit-editor-${unitIndex}`}
                  className="grid min-w-0 gap-3 p-3 sm:grid-cols-2"
                >
                  <label className="min-w-0 text-xs font-medium text-muted-foreground">
                    主歌词
                    <input
                      type="text"
                      data-unit-surface={unitIndex}
                      value={unit.text}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => changeUnitText(unitIndex, event.target.value)}
                      className="focus-ring mt-1 block w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                  <label className="min-w-0 text-xs font-medium text-muted-foreground">
                    读音
                    <input
                      type="text"
                      data-unit-reading={unitIndex}
                      value={unit.reading}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => changeUnitReading(unitIndex, event.target.value)}
                      className="focus-ring mt-1 block w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                </div>
              ))}
            </div>
          </details>
        </section>
      </div>

      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    </section>
  );
}
