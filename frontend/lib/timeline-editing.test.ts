import { describe, expect, it } from "vitest";
import * as editing from "./timeline-editing";
import { updateLineRange } from "./kirakara-review";
import type { KirakaraTimeline } from "./kirakara-timeline";

const timeline: KirakaraTimeline = { confidence: 1, warnings: [], durationMs: 2000, lines: [
  { text: "a", reading: "a", startMs: 1000, endMs: 2000, units: [
    { text: "a", reading: "a", startMs: 1000, endMs: 2000, moras: [
      { reading: "a", startMs: 1000, endMs: 2000, matched: false },
    ] },
  ] },
] };

describe("timeline edit history", () => {
  it("undoes a complete drag in one step and clears redo after a new edit", () => {
    let history = editing.createTimelineHistory(timeline);
    const first = updateLineRange(timeline, 0, 1100, 2100);
    const last = updateLineRange(timeline, 0, 1200, 2200);
    history = editing.recordTimelineEdit(history, first, "drag");
    history = editing.recordTimelineEdit(history, last, "drag");
    history = editing.recordTimelineEdit(history, last);
    history = editing.undoTimelineEdit(history);
    expect(history.present).toBe(timeline);
    expect(editing.redoTimelineEdit(history).present).toBe(last);
    expect(editing.recordTimelineEdit(history, first).future).toEqual([]);
    expect(timeline.lines[0].units[0].startMs).toBe(1000);
  });

  it("discards a canceled drag and bounds undo storage", () => {
    let history = editing.createTimelineHistory(timeline);
    history = editing.recordTimelineEdit(history, updateLineRange(timeline, 0, 1100, 2100), "drag");
    history = editing.recordTimelineEdit(history, timeline, "drag");
    expect(history.past).toEqual([]);
    for (let i = 1; i < 150; i++) history = editing.recordTimelineEdit(history, updateLineRange(timeline, 0, 1000 + i, 2000 + i));
    expect(history.past).toHaveLength(100);
  });
});

describe("line review playback", () => {
  it("loops at the current line end, clamps to video length, and respects pause", () => {
    const range = { startMs: 1000, endMs: 2000 };
    expect(editing.loopPlaybackTime(range, 2.01, 10, true)).toBe(1);
    expect(editing.loopPlaybackTime(range, 1.5, 10, true)).toBeNull();
    expect(editing.loopPlaybackTime(range, 1.8, 1.8, true)).toBe(1);
    expect(editing.loopPlaybackTime(range, 2.1, 10, false)).toBeNull();
    expect(editing.loopPlaybackTime(range, 2, 0.5, true)).toBeNull();
  });

  it("locates weak confidence and unmatched syllables without flagging all lines", () => {
    expect(editing.lineNeedsReview(timeline.lines[0])).toBe(true);
    const confident = { ...timeline.lines[0], units: [], confidence: 0.95 };
    expect(editing.lineNeedsReview(confident)).toBe(false);
    expect(editing.lineNeedsReview({ ...confident, confidence: 0.4 })).toBe(true);
  });
});
