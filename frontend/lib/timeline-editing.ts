import type { KirakaraLine, KirakaraTimeline } from "./kirakara-timeline";

export type TimelineHistory = {
  past: KirakaraTimeline[];
  present: KirakaraTimeline;
  future: KirakaraTimeline[];
  group?: string;
};

export function createTimelineHistory(timeline: KirakaraTimeline): TimelineHistory {
  return { past: [], present: timeline, future: [] };
}

export function recordTimelineEdit(history: TimelineHistory, timeline: KirakaraTimeline, group?: string): TimelineHistory {
  if (timeline === history.present) return { ...history, group };
  if (group && history.group === group) {
    return {
      ...history, present: timeline, future: [], group,
      past: history.past.at(-1) === timeline ? history.past.slice(0, -1) : history.past,
    };
  }
  return { past: [...history.past, history.present].slice(-100), present: timeline, future: [], group };
}

export function undoTimelineEdit(history: TimelineHistory): TimelineHistory {
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history;
}

export function redoTimelineEdit(history: TimelineHistory): TimelineHistory {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history;
}

export type PlaybackRange = { startMs: number; endMs: number };

export enum PlaybackShortcut {
  RateDown = "rate-down",
  RateUp = "rate-up",
  RateToggle = "rate-toggle",
  PlayToggle = "play-toggle",
}

export const PLAYBACK_RATES = Array.from(
  { length: 25 },
  (_, index) => (index + 1) / 10,
);

export function loopPlaybackTime(range: PlaybackRange | null, currentTime: number, duration: number, playing: boolean): number | null {
  if (!range || !playing) return null;
  const start = Math.max(0, range.startMs / 1000);
  const end = Math.min(range.endMs / 1000, Number.isFinite(duration) ? duration : Infinity);
  return end > start && (currentTime >= end || currentTime < start) ? start : null;
}

export function lineNeedsReview(line: KirakaraLine): boolean {
  return (line.confidence !== undefined && line.confidence < 0.7)
    || line.units.some(unit => unit.moras.some(mora => !mora.matched));
}

export function activeTimelineLineIndex(
  lines: readonly KirakaraLine[],
  playbackMs: number,
  previousIndex: number | null,
): number | null {
  if (lines.length === 0 || playbackMs < lines[0].startMs) return null;

  if (previousIndex !== null && lines[previousIndex]) {
    const previous = lines[previousIndex];
    const next = lines[previousIndex + 1];
    if (playbackMs >= previous.startMs && (!next || playbackMs < next.startMs)) {
      return previousIndex;
    }
  }

  let activeIndex: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (playbackMs < lines[index].startMs) break;
    activeIndex = index;
  }
  return activeIndex;
}

export function previewSeekMs(
  boundaryMs: number,
  previewLeadMs: number,
  durationMs?: number,
): number {
  const target = Math.max(0, Math.round(boundaryMs - previewLeadMs));
  return durationMs !== undefined && Number.isFinite(durationMs)
    ? Math.min(target, Math.max(0, Math.round(durationMs)))
    : target;
}

export function stepPlaybackRate(rate: number, direction: -1 | 1): number {
  const tenths = Math.round(rate * 10) + direction;
  return Math.min(25, Math.max(1, tenths)) / 10;
}

export function formatPlaybackSeconds(milliseconds: number): string {
  return (Math.max(0, Math.round(milliseconds)) / 1000).toFixed(3);
}

export function playbackShortcut(
  event: Pick<KeyboardEvent, "key" | "repeat" | "ctrlKey" | "metaKey" | "altKey">,
  target: EventTarget | null,
): PlaybackShortcut | null {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return null;

  const element = target as (EventTarget & {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  }) | null;
  const tagName = element?.tagName?.toLowerCase();
  const allowsPlaybackShortcuts = element?.getAttribute?.("data-playback-shortcuts") === "true";
  if (!allowsPlaybackShortcuts
    && (element?.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select")) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "x") return PlaybackShortcut.RateDown;
  if (key === "c") return PlaybackShortcut.RateUp;
  if (key === "z") return PlaybackShortcut.RateToggle;
  if (event.key === " " && (allowsPlaybackShortcuts || (tagName !== "button" && tagName !== "a" && tagName !== "video"))) {
    return PlaybackShortcut.PlayToggle;
  }
  return null;
}
