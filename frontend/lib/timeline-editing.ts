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
