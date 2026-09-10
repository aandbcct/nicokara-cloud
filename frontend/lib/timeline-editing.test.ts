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

const playbackLines = [
  { ...timeline.lines[0], startMs: 1000, endMs: 2000 },
  { ...timeline.lines[0], text: "b", startMs: 3000, endMs: 4000 },
];

describe("subtitle playback requirements", () => {
  it("REQ-FOLLOW-03-A returns null before the first lyric", () => {
    expect(editing.activeTimelineLineIndex(playbackLines, 999, null)).toBeNull();
  });

  it("REQ-FOLLOW-03-B keeps the previous lyric in a gap", () => {
    expect(editing.activeTimelineLineIndex(playbackLines, 2500, 0)).toBe(0);
  });

  it("REQ-FOLLOW-03-C resolves an earlier lyric after playback moves backward", () => {
    expect(editing.activeTimelineLineIndex(playbackLines, 1500, 1)).toBe(0);
  });

  it("REQ-LEAD-03-A clamps a negative preview seek to zero", () => {
    expect(editing.previewSeekMs(50, 100, 5000)).toBe(0);
  });

  it("REQ-LEAD-03-B clamps a preview seek to known video duration", () => {
    expect(editing.previewSeekMs(6000, 100, 5000)).toBe(5000);
  });

  it("REQ-RATE-09-A exposes a 0.1x minimum playback rate", () => {
    expect(editing.PLAYBACK_RATES.at(0)).toBe(0.1);
  });

  it("REQ-RATE-09-B exposes a 2.5x maximum playback rate", () => {
    expect(editing.PLAYBACK_RATES.at(-1)).toBe(2.5);
  });

  it("REQ-RATE-10-A clamps playback rate decreases at 0.1x", () => {
    expect(editing.stepPlaybackRate(0.1, -1)).toBe(0.1);
  });

  it("REQ-RATE-10-B clamps playback rate increases at 2.5x", () => {
    expect(editing.stepPlaybackRate(2.5, 1)).toBe(2.5);
  });

  it("REQ-VIDEO-TIME-02-A formats 18800ms as total seconds", () => {
    expect(editing.formatPlaybackSeconds(18800)).toBe("18.800");
  });

  it("REQ-VIDEO-TIME-02-B keeps total seconds beyond one minute", () => {
    expect(editing.formatPlaybackSeconds(78800)).toBe("78.800");
  });

  it("REQ-RATE-13 ignores repeated playback shortcuts", () => {
    expect(editing.playbackShortcut({ key: "x", repeat: true, ctrlKey: false, metaKey: false, altKey: false }, null)).toBeNull();
  });

  it("REQ-PLAY-06 resolves Space as a play toggle", () => {
    expect(editing.playbackShortcut({ key: " ", repeat: false, ctrlKey: false, metaKey: false, altKey: false }, null)).toBe(editing.PlaybackShortcut.PlayToggle);
  });

  it("REQ-PLAY-07-A ignores playback shortcuts from input targets", () => {
    const target = { tagName: "INPUT" } as unknown as EventTarget;
    expect(editing.playbackShortcut({ key: "c", repeat: false, ctrlKey: false, metaKey: false, altKey: false }, target)).toBeNull();
  });

  it("REQ-PLAY-07-B leaves Space on native buttons to the browser", () => {
    const target = { tagName: "BUTTON" } as unknown as EventTarget;
    expect(editing.playbackShortcut({ key: " ", repeat: false, ctrlKey: false, metaKey: false, altKey: false }, target)).toBeNull();
  });
});
