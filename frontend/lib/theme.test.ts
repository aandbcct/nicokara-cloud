import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { normalizeTheme, THEME_INITIALIZATION_SCRIPT } from "./theme";

describe("page theme", () => {
  it("accepts only the supported persisted palettes", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme(null)).toBe("light");
    expect(normalizeTheme("unknown")).toBe("light");
  });

  it("restores the dark palette before hydration", () => {
    const document = { documentElement: { dataset: { theme: "light" } } };
    runInNewContext(THEME_INITIALIZATION_SCRIPT, {
      document,
      localStorage: { getItem: () => "dark" },
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("still renders when access to browser storage is denied", () => {
    const document = { documentElement: { dataset: { theme: "" } } };
    runInNewContext(THEME_INITIALIZATION_SCRIPT, {
      document,
      localStorage: { getItem: () => { throw new Error("Storage disabled"); } },
    });
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
