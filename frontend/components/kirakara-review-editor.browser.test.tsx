/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KirakaraTimeline } from "@/lib/kirakara-timeline";
import { KirakaraReviewEditor, timingDragSeekMs } from "./kirakara-review-editor";

const timeline: KirakaraTimeline = {
  confidence: 1,
  warnings: [],
  durationMs: 5000,
  lines: [
    {
      text: "今日",
      reading: "きょう",
      startMs: 1000,
      endMs: 2000,
      units: [{
        text: "今日",
        reading: "きょう",
        startMs: 1000,
        endMs: 2000,
        moras: [
          { reading: "きょ", startMs: 1000, endMs: 1600, matched: true },
          { reading: "う", startMs: 1600, endMs: 2000, matched: true },
        ],
      }],
    },
    {
      text: "明日",
      reading: "あした",
      startMs: 3000,
      endMs: 4000,
      units: [{
        text: "明日",
        reading: "あした",
        startMs: 3000,
        endMs: 4000,
        moras: [],
      }],
    },
  ],
};

type EditorOverrides = Partial<Parameters<typeof KirakaraReviewEditor>[0]>;

function renderEditor(overrides: EditorOverrides = {}) {
  const props: Parameters<typeof KirakaraReviewEditor>[0] = {
    timeline,
    activeLineIndex: 0,
    previewLeadMs: 100,
    onActiveLineChange: vi.fn(),
    onTimingInteractionChange: vi.fn(),
    onChange: vi.fn(),
    onSeek: vi.fn(),
    ...overrides,
  };
  return { ...render(<KirakaraReviewEditor {...props} />), props };
}

describe("KirakaraReviewEditor browser behavior", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => cleanup());

  it("REQ-LIST-01 renders a persistent scrollable desktop lyric list", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "2. 明日" }).closest('[data-desktop-lyric-list="true"]')?.className).toContain("overflow-y-auto");
  });

  it("REQ-LIST-02 keeps a mobile lyric select", () => {
    renderEditor();
    expect(screen.getByLabelText("当前歌词行").closest("label")?.className).toContain("md:hidden");
  });

  it("REQ-LIST-03-A displays lyric line numbers and text", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "2. 明日" })).toBeTruthy();
  });

  it("REQ-LIST-03-B marks the controlled active lyric", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "1. 今日" }).getAttribute("aria-current")).toBe("true");
  });

  it("REQ-LIST-04 scrolls only the newly active lyric into view", () => {
    const { rerender, props } = renderEditor();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    rerender(<KirakaraReviewEditor {...props} activeLineIndex={1} />);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("REQ-SELECT-01 seeks a manually selected lyric with preview lead", () => {
    const onSeek = vi.fn();
    renderEditor({ onSeek });
    fireEvent.click(screen.getByRole("button", { name: "2. 明日" }));
    expect(onSeek).toHaveBeenCalledWith(2900);
  });

  it("REQ-LEAD-01 uses the configured preview lead instead of a fixed value", () => {
    const onSeek = vi.fn();
    renderEditor({ onSeek, previewLeadMs: 250 });
    fireEvent.click(screen.getByRole("button", { name: "2. 明日" }));
    expect(onSeek).toHaveBeenCalledWith(2750);
  });

  it("REQ-SELECT-03 routes the next button through the controlled selection callback", () => {
    const onActiveLineChange = vi.fn();
    renderEditor({ onActiveLineChange });
    fireEvent.click(screen.getByRole("button", { name: "下一句" }));
    expect(onActiveLineChange).toHaveBeenCalledWith(1);
  });

  it("REQ-TIME-01 exposes line-start, Mora, and line-end boundary controls", () => {
    const { container } = renderEditor();
    expect(container.querySelector('[data-time-boundary-kind="line-start"]')).toBeTruthy();
    expect(container.querySelector('[data-time-boundary-kind="mora"]')).toBeTruthy();
    expect(container.querySelector('[data-time-boundary-kind="line-end"]')).toBeTruthy();
  });

  it("REQ-TIME-02 shows the focused boundary absolute time to milliseconds", () => {
    renderEditor();
    fireEvent.focus(screen.getByRole("button", { name: "调整当前歌词行的开始时间" }));
    expect(screen.getByText("1.000").getAttribute("data-time-boundary-tooltip")).toBe("true");
  });

  it("REQ-TIME-03 refreshes the selected boundary tooltip after a timeline update", () => {
    const { rerender, props } = renderEditor();
    fireEvent.focus(screen.getByRole("button", { name: "调整当前歌词行的开始时间" }));
    const updated = { ...timeline, lines: [{ ...timeline.lines[0], startMs: 1100 }, timeline.lines[1]] };
    rerender(<KirakaraReviewEditor {...props} timeline={updated} />);
    expect(screen.getByText("1.100")).toBeTruthy();
  });

  it("REQ-TIME-04 hides the boundary tooltip on blur", () => {
    renderEditor();
    const handle = screen.getByRole("button", { name: "调整当前歌词行的开始时间" });
    fireEvent.focus(handle);
    fireEvent.blur(handle);
    expect(screen.queryByText("1.000")).toBeNull();
  });

  it("REQ-TIME-05 keeps the tooltip above and outside pointer hit testing", () => {
    renderEditor();
    fireEvent.focus(screen.getByRole("button", { name: "调整当前歌词行的开始时间" }));
    expect(screen.getByText("1.000").className).toContain("pointer-events-none");
    expect(screen.getByText("1.000").className).toContain("bottom-full");
  });

  it("REQ-TIME-06 represents all boundary controls with one selection attribute", () => {
    const { container } = renderEditor();
    expect(container.querySelectorAll("[data-time-boundary-kind]")).toHaveLength(3);
  });

  it("REQ-LEAD-04 calculates drag completion seek from the adjusted boundary", () => {
    expect(timingDragSeekMs(timeline, 0, { kind: "mora-boundary", boundaryIndex: 0 }, 100)).toBe(1500);
  });

  it("REQ-LEAD-05 seeks with preview lead after a keyboard boundary adjustment", () => {
    const onSeek = vi.fn();
    renderEditor({ onSeek });
    fireEvent.keyDown(screen.getByRole("button", { name: "调整第 1 个 Mora 分界" }), { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledWith(1510);
  });

  it("REQ-LEAD-06 does not create a timeline change when selecting a lyric", () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    fireEvent.click(screen.getByRole("button", { name: "2. 明日" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("REQ-LAYOUT-01 omits duplicate line-start nudge buttons", () => {
    renderEditor();
    expect(screen.queryByRole("button", { name: "句首提前" })).toBeNull();
  });

  it("REQ-LAYOUT-02 omits duplicate line-end nudge buttons", () => {
    renderEditor();
    expect(screen.queryByRole("button", { name: "句尾延后" })).toBeNull();
  });

  it("REQ-LAYOUT-03 keeps whole-line nudge buttons", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "整句提前" })).toBeTruthy();
  });

  it("REQ-LAYOUT-04 keeps all five timing step options", () => {
    renderEditor();
    expect(screen.getByLabelText("微调步长").querySelectorAll("option")).toHaveLength(5);
  });

  it("REQ-LAYOUT-05 places timing controls in one adjustment row", () => {
    const { container } = renderEditor();
    const row = container.querySelector('[data-timing-adjustment-row="true"]');
    expect(row?.querySelector('[data-timeline-offset-group="true"]')).toBeTruthy();
  });

  it("REQ-LAYOUT-06 shifts the offset group right on desktop", () => {
    const { container } = renderEditor();
    expect(container.querySelector('[data-timeline-offset-group="true"]')?.className).toContain("md:ml-auto");
  });

  it("REQ-LAYOUT-07 lets the timing adjustment row wrap", () => {
    const { container } = renderEditor();
    expect(container.querySelector('[data-timing-adjustment-row="true"]')?.className).toContain("flex-wrap");
  });
});
