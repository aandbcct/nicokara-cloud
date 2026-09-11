import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { KirakaraStyleEditor } from "./kirakara-style-editor";
import { DEFAULT_KIRAKARA_STYLE } from "@/lib/kirakara-style";

describe("KirakaraStyleEditor", () => {
  it("REQ-STYLE-LAYOUT-01 keeps narrow-panel labels horizontal", () => {
    const html = renderToStaticMarkup(
      <KirakaraStyleEditor
        style={DEFAULT_KIRAKARA_STYLE}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain("字幕样式");
    expect(html).toContain("字体");
    expect(html).toContain("主字大小");
    expect(html).toContain("注音大小");
    expect(html).toContain("未唱");
    expect(html).toContain("已唱");
    expect(html).toContain("上行位置");
    expect(html).toContain("下行位置");
    expect(html).toContain("恢复 Kirakara 默认样式");
    expect(html).toContain('placeholder="输入字体名"');
    expect(html).toContain('data-kirakara-style-layout="responsive"');
    expect(html).toContain('data-kirakara-font-control="kirakara"');
    expect(html).toContain('aria-label="选择字体预设"');
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("grid-cols-2");
    expect(html).not.toContain("xl:grid-cols-4");
    expect(html).not.toContain("<datalist");
  });

  it("REQ-STYLE-CONTROLS-01 exposes all requested style controls and presets", () => {
    const html = renderToStaticMarkup(
      <KirakaraStyleEditor style={DEFAULT_KIRAKARA_STYLE} onChange={vi.fn()} />,
    );

    for (const label of [
      "样式预设",
      "字体粗细",
      "主字字间距",
      "注音字间距",
      "注音偏移",
      "描边粗细",
      "阴影深度",
      "阴影颜色",
      "横向安全边距",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("经典卡拉 OK");
    expect(html).toContain("紧凑小字");
    expect(html).toContain("柔和阴影");
  });

  it("REQ-STYLE-CONTROLS-02 renders the widened main-font slider range", () => {
    const html = renderToStaticMarkup(
      <KirakaraStyleEditor style={DEFAULT_KIRAKARA_STYLE} onChange={vi.fn()} />,
    );

    expect(html).toMatch(/type="range" min="24" max="120"[^>]*value="64"/u);
  });
});
