import { describe, expect, it, vi } from "vitest";

import * as preferences from "./playback-preferences";

describe("playback preview lead preferences", () => {
  it("REQ-LEAD-02 defines 100ms as the default preview lead", () => {
    expect(preferences.DEFAULT_PREVIEW_LEAD_MS).toBe(100);
  });

  it("REQ-LEAD-07-A clamps a negative preview lead to zero", () => {
    expect(preferences.normalizePreviewLeadMs(-1)).toBe(0);
  });

  it("REQ-LEAD-07-B clamps a preview lead above 2000ms", () => {
    expect(preferences.normalizePreviewLeadMs(2001)).toBe(2000);
  });

  it("REQ-LEAD-07-C truncates a fractional preview lead", () => {
    expect(preferences.normalizePreviewLeadMs(100.9)).toBe(100);
  });

  it("REQ-LEAD-08 treats an empty input as zero", () => {
    expect(preferences.normalizePreviewLeadMs("")).toBe(0);
  });

  it("REQ-SET-04-A falls back to 100ms for an invalid stored value", () => {
    expect(preferences.loadPreviewLeadMs({ getItem: () => "invalid" })).toBe(100);
  });

  it("REQ-SET-04-B falls back to 100ms when storage reading fails", () => {
    expect(preferences.loadPreviewLeadMs({ getItem: () => { throw new Error("blocked"); } })).toBe(100);
  });

  it("REQ-SET-04-C falls back to 100ms for an out-of-range stored value", () => {
    expect(preferences.loadPreviewLeadMs({ getItem: () => "2001" })).toBe(100);
  });

  it("REQ-SET-05 keeps the normalized session value when storage writing fails", () => {
    expect(preferences.savePreviewLeadMs({ setItem: () => { throw new Error("blocked"); } }, 250)).toBe(250);
  });

  it("REQ-SET-02 saves preview lead with the fixed storage key", () => {
    const setItem = vi.fn();
    preferences.savePreviewLeadMs({ setItem }, 250);
    expect(setItem).toHaveBeenCalledWith(preferences.PREVIEW_LEAD_STORAGE_KEY, "250");
  });

  it("REQ-SHORTCUT-06 saves and reloads customized shortcut bindings", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const editing = {
      ...preferences.loadPlaybackShortcutBindings(storage),
      "rate-up": "v",
    };
    preferences.savePlaybackShortcutBindings(storage, editing);
    expect(preferences.loadPlaybackShortcutBindings(storage)["rate-up"]).toBe("v");
  });

  it("REQ-MORA-SHORTCUT-03 keeps bracket defaults when loading old bindings", () => {
    const oldBindings = {
      "previous-line": "u",
      "next-line": "i",
      "replay-line": "o",
      "toggle-line-loop": "p",
      "rate-toggle": "z",
      "rate-down": "x",
      "rate-up": "c",
    };
    const loaded = preferences.loadPlaybackShortcutBindings({
      getItem: () => JSON.stringify(oldBindings),
    });
    expect(loaded["previous-mora"]).toBe("[");
    expect(loaded["next-mora"]).toBe("]");
  });
});
