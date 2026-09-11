import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { KirakaraTimeline } from "@/lib/kirakara-timeline";
import * as ReviewEditor from "./kirakara-review-editor";

const timeline: KirakaraTimeline = {
  confidence: 1,
  warnings: [],
  durationMs: 2000,
  lines: [
    {
      text: "今日",
      reading: "きょう",
      startMs: 1000,
      endMs: 2000,
      units: [
        {
          text: "今日",
          reading: "きょう",
          startMs: 1000,
          endMs: 2000,
          moras: [
            { reading: "きょ", startMs: 1000, endMs: 1600, matched: true },
            { reading: "う", startMs: 1600, endMs: 2000, matched: true },
          ],
        },
      ],
    },
  ],
};

describe("KirakaraReviewEditor", () => {
  it("resolves the preview position from the adjusted Mora boundary", () => {
    expect(ReviewEditor.timingDragPreviewMs).toBeTypeOf("function");
    if (typeof ReviewEditor.timingDragPreviewMs !== "function") return;
    const adjusted: KirakaraTimeline = {
      ...timeline,
      lines: [{
        ...timeline.lines[0],
        units: [{
          ...timeline.lines[0].units[0],
          moras: [
            { reading: "きょ", startMs: 1000, endMs: 1725, matched: true },
            { reading: "う", startMs: 1725, endMs: 2000, matched: true },
          ],
        }],
      }],
    };

    expect(ReviewEditor.timingDragPreviewMs(
      adjusted,
      0,
      { kind: "mora-boundary", boundaryIndex: 0 },
    )).toBe(1725);
  });

  it("resolves the preview position from the adjusted line edge", () => {
    expect(ReviewEditor.timingDragPreviewMs).toBeTypeOf("function");
    if (typeof ReviewEditor.timingDragPreviewMs !== "function") return;
    const adjusted: KirakaraTimeline = {
      ...timeline,
      lines: [{ ...timeline.lines[0], startMs: 1125, endMs: 2250 }],
    };

    expect(ReviewEditor.timingDragPreviewMs(
      adjusted,
      0,
      { kind: "line-edge", edge: "start" },
    )).toBe(1125);
    expect(ReviewEditor.timingDragPreviewMs(
      adjusted,
      0,
      { kind: "line-edge", edge: "end" },
    )).toBe(2250);
  });

  it("shows lyric, reading, and mora timing controls after FA-Kara alignment", () => {
    const html = renderToStaticMarkup(
      <ReviewEditor.KirakaraReviewEditor
        timeline={timeline}
        editingLineIndex={0}
        previewLeadMs={100}
        onEditingLineChange={vi.fn()}
        onChange={vi.fn()}
        onSeek={vi.fn()}
      />,
    );

    expect(html).toContain("时间轴检查");
    expect(html).toContain('data-lyrics-panel="true"');
    expect(html).toContain('data-timing-panel="true"');
    expect(html).toContain("编辑歌词与读音");
    expect(html).toContain("主歌词");
    expect(html).toContain("读音");
    expect(html).toContain('data-unit-surface="0"');
    expect(html).toContain('data-unit-reading="0"');
    expect(html).toContain('value="今日"');
    expect(html).toContain('value="きょう"');
    expect(html).toContain("设置时间轴");
    expect(html.match(/data-mora-segment=/g)).toHaveLength(2);
    expect(html).toContain("きょ");
    expect(html).toContain("う");
    expect(html).not.toContain('data-timeline-line-draggable="true"');
    expect(html).not.toContain("拖动第 1 句");
    expect(html).toContain('data-line-edge="start"');
    expect(html).toContain('data-line-edge="end"');
    expect(html).toContain('data-line-move="true"');
    expect(html).toContain("整句开始（按比例拉伸）");
    expect(html).toContain("整句平移");
    expect(html).toContain("cursor-ew-resize");
    expect(html).toContain("touch-none");
    expect(html).toContain("开始时间");
    expect(html).toContain("结束时间");
    expect(html).toContain("今日");
  });

  it("places lyric editing below the timeline in a collapsed disclosure", () => {
    const html = renderToStaticMarkup(
      <ReviewEditor.KirakaraReviewEditor
        timeline={timeline}
        editingLineIndex={0}
        previewLeadMs={100}
        onEditingLineChange={vi.fn()}
        onChange={vi.fn()}
        onSeek={vi.fn()}
      />,
    );

    const timingPanel = html.indexOf('data-timing-panel="true"');
    const lyricsDisclosure = html.indexOf('data-lyrics-disclosure="true"');

    expect(timingPanel).toBeGreaterThan(-1);
    expect(lyricsDisclosure).toBeGreaterThan(timingPanel);
    expect(html).toContain('data-lyrics-toggle="true"');
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
  });

  it("REQ-DENSITY-01 enables direct dragging when both pixel gaps are sufficient", () => {
    expect([...ReviewEditor.directlyDraggableBoundaryIndexes([0, 25, 50, 80], 20)]).toEqual([0, 1]);
  });

  it("REQ-DENSITY-02 limits dense mode to locally overlapping boundaries", () => {
    expect([...ReviewEditor.directlyDraggableBoundaryIndexes([0, 25, 35, 70, 100], 20)]).toEqual([2]);
  });
});
