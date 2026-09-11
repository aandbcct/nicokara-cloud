import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_KIRAKARA_STYLE } from "@/lib/kirakara-style";
import type { KirakaraFrame } from "@/lib/kirakara-timeline";

async function loadDomFrame() {
  const modulePath = "./kirakara-dom-frame";
  return import(/* @vite-ignore */ modulePath).catch(() => null);
}

describe("KirakaraDomFrame", () => {
  it("renders one clipped DOM mask for each independently timed character", async () => {
    const renderer = await loadDomFrame();
    expect(renderer, "Kirakara DOM renderer should exist").not.toBeNull();
    if (!renderer) return;

    const frame = {
      lines: [
        {
          slot: "upper" as const,
          text: "東京",
          opacity: 0.25,
          indicatorOpacities: [1, 0, 0, 0],
          units: [
            {
              text: "東京",
              progress: 0.625,
              characters: [
                { text: "東", progress: 1 },
                { text: "京", progress: 0.25 },
              ],
              ruby: [{
                text: "とうきょう",
                startCharacter: 0,
                endCharacter: 2,
                characters: [
                  { text: "と", progress: 1 },
                  { text: "う", progress: 0.75 },
                  { text: "き", progress: 0 },
                  { text: "ょ", progress: 0 },
                  { text: "う", progress: 0 },
                ],
              }],
            },
          ],
        },
      ],
    } as unknown as KirakaraFrame;

    const html = renderToStaticMarkup(
      <renderer.KirakaraDomFrame
        frame={frame}
        style={DEFAULT_KIRAKARA_STYLE}
      />,
    );

    expect(html).toContain('data-kirakara-dom-preview="true"');
    expect(html.match(/data-kirakara-character=/g)).toHaveLength(2);
    expect(html).toContain("clip-path:inset(-50% calc(75% + 0.5px) -50% -5px)");
    expect(html).toContain("clip-path:inset(-50% calc(25% + 0.5px) -50% -4px)");
    expect(html).toContain('data-kirakara-ruby-sizer="true"');
    expect(html).toContain("opacity:0.25");
    expect(html.match(/data-kirakara-indicator-dot=/g)).toHaveLength(4);
    expect(html).not.toContain("letter-spacing:5px");
  });

  it("renders lyric groups without ruby annotations", async () => {
    const renderer = await loadDomFrame();
    expect(renderer, "Kirakara DOM renderer should exist").not.toBeNull();
    if (!renderer) return;

    const frame = {
      lines: [
        {
          slot: "upper" as const,
          text: "ラララ",
          opacity: 1,
          indicatorOpacities: [1, 0, 0, 0],
          units: [
            {
              text: "ラララ",
              progress: 0.5,
              characters: [
                { text: "ラ", progress: 1 },
                { text: "ラ", progress: 0.5 },
                { text: "ラ", progress: 0 },
              ],
              ruby: [],
            },
          ],
        },
      ],
    } as unknown as KirakaraFrame;

    const html = renderToStaticMarkup(
      <renderer.KirakaraDomFrame
        frame={frame}
        style={DEFAULT_KIRAKARA_STYLE}
      />,
    );

    expect(html.match(/data-kirakara-character=/g)).toHaveLength(3);
    expect(html).not.toContain('data-kirakara-ruby-sizer="true"');
  });

  it("REQ-STYLE-DOM-01 applies typography, outline, shadow, and safe margin", async () => {
    const renderer = await loadDomFrame();
    expect(renderer, "Kirakara DOM renderer should exist").not.toBeNull();
    if (!renderer) return;

    const frame = {
      lines: [{
        slot: "upper" as const,
        text: "歌",
        units: [{
          text: "歌",
          progress: 0,
          characters: [{ text: "歌", progress: 0 }],
          ruby: [{ text: "うた", startCharacter: 0, endCharacter: 1 }],
        }],
      }],
    } as unknown as KirakaraFrame;
    const html = renderToStaticMarkup(
      <renderer.KirakaraDomFrame
        frame={frame}
        style={{
          ...DEFAULT_KIRAKARA_STYLE,
          fontBold: false,
          letterSpacing: 3,
          rubyLetterSpacing: 2,
          rubyOffset: 8,
          strokeColorBefore: "#123456",
          strokeColorAfter: "#abcdef",
          shadowColor: "#654321",
          shadowDepth: 4,
          horizontalMargin: 96,
        }}
      />,
    );

    expect(html).toContain("left:96px");
    expect(html).toContain("font-weight:400");
    expect(html).toContain("bottom:calc(100% + 8px)");
    expect(html).toContain("4px 4px 2px #654321");
    expect(html).toContain("#123456");
    expect(html).toContain("#abcdef");
  });
});
