import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const requirementTestFiles = [
  "../lib/timeline-editing.test.ts",
  "../lib/kirakara-review.test.ts",
  "../lib/playback-preferences.test.ts",
  "./kirakara-review-editor.browser.test.tsx",
  "./kirakara-review-editor.test.tsx",
  "./kirakara-preview.test.tsx",
  "./kirakara-preview.browser.test.tsx",
  "./kirakara-style-editor.test.tsx",
  "./subtitle-playback-requirements.test.ts",
];

const requirementTitles = requirementTestFiles.flatMap((relativePath) => {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  return [...source.matchAll(/it\("([^"]*REQ-[A-Z]+(?:-[A-Z]+)*-[0-9]+[^\"]*)"/g)].map((match) => match[1]);
});

const automatedRequirementIds = [
  "REQ-DENSITY-01", "REQ-DENSITY-02", "REQ-DENSITY-03", "REQ-DENSITY-04",
  "REQ-EXPORT-01",
  "REQ-FOLLOW-03", "REQ-FOLLOW-04",
  "REQ-KEY-01", "REQ-KEY-02", "REQ-KEY-03", "REQ-KEY-04", "REQ-KEY-05",
  "REQ-LAYOUT-01", "REQ-LAYOUT-02", "REQ-LAYOUT-03", "REQ-LAYOUT-04", "REQ-LAYOUT-05", "REQ-LAYOUT-06", "REQ-LAYOUT-07",
  "REQ-LEAD-01", "REQ-LEAD-02", "REQ-LEAD-03", "REQ-LEAD-04", "REQ-LEAD-05", "REQ-LEAD-06", "REQ-LEAD-07", "REQ-LEAD-08", "REQ-LEAD-09", "REQ-LEAD-10",
  "REQ-LIST-01", "REQ-LIST-02", "REQ-LIST-03", "REQ-LIST-04", "REQ-LIST-05",
  "REQ-INPUT-01", "REQ-INPUT-02", "REQ-INPUT-03",
  "REQ-MORA-EDGE-01", "REQ-MORA-EDGE-02", "REQ-MORA-SELECT-01",
  "REQ-OPERATION-01", "REQ-OPERATION-02", "REQ-OPERATION-03",
  "REQ-PIN-01", "REQ-PIN-02", "REQ-PIN-03",
  "REQ-PLACEMENT-01", "REQ-PLACEMENT-02", "REQ-PLACEMENT-03", "REQ-PLACEMENT-06", "REQ-PLACEMENT-07", "REQ-PLACEMENT-08",
  "REQ-STYLE-LAYOUT-01", "REQ-STYLE-LAYOUT-02", "REQ-STYLE-LAYOUT-03",
  "REQ-PLAY-01", "REQ-PLAY-02", "REQ-PLAY-03", "REQ-PLAY-05", "REQ-PLAY-06", "REQ-PLAY-07",
  "REQ-RATE-01", "REQ-RATE-02", "REQ-RATE-03", "REQ-RATE-04", "REQ-RATE-05", "REQ-RATE-06", "REQ-RATE-07", "REQ-RATE-08", "REQ-RATE-09", "REQ-RATE-10", "REQ-RATE-11", "REQ-RATE-12", "REQ-RATE-13", "REQ-RATE-14",
  "REQ-SCROLL-01", "REQ-SCROLL-02",
  "REQ-SEEK-01", "REQ-SEEK-02", "REQ-SEEK-03", "REQ-SEEK-04", "REQ-SEEK-05",
  "REQ-SELECT-01", "REQ-SELECT-02", "REQ-SELECT-03",
  "REQ-SET-01", "REQ-SET-02", "REQ-SET-03", "REQ-SET-04", "REQ-SET-05",
  "REQ-TIME-01", "REQ-TIME-02", "REQ-TIME-03", "REQ-TIME-04", "REQ-TIME-05", "REQ-TIME-06",
  "REQ-VIDEO-TIME-01", "REQ-VIDEO-TIME-02", "REQ-VIDEO-TIME-03", "REQ-VIDEO-TIME-04", "REQ-VIDEO-TIME-05",
];

describe("subtitle playback requirement test contract", () => {
  it("REQ-TEST-01 keeps each requirement test focused on one atomic requirement", () => {
    expect(requirementTitles.every((title) => (title.match(/REQ-[A-Z]+(?:-[A-Z]+)*-[0-9]+/g) ?? []).length === 1)).toBe(true);
  });

  it("REQ-TEST-02 includes every automated requirement identifier in a test name", () => {
    const covered = new Set(requirementTitles.flatMap((title) => title.match(/REQ-[A-Z]+(?:-[A-Z]+)*-[0-9]+/g) ?? []));
    expect(automatedRequirementIds.filter((requirementId) => !covered.has(requirementId))).toEqual([]);
  });

  it("REQ-TEST-03 gives split boundary scenarios distinct atomic suffixes", () => {
    const suffixedTitles = requirementTitles.filter((title) => /REQ-[A-Z]+(?:-[A-Z]+)*-[0-9]+-[A-Z]\b/.test(title));
    expect(new Set(suffixedTitles).size).toBe(suffixedTitles.length);
  });

  it("REQ-TEST-04 avoids treating correctness tests as experience metrics", () => {
    expect(requirementTitles.some((title) => /提升百分比|体验提升|效率提升/.test(title))).toBe(false);
  });
});
