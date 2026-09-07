import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminLogDetails } from "./admin-log-details";
import type { AdminLogItem } from "@/types/admin";

const item: AdminLogItem = {
  id: 1, level: "ERROR", category: "pipeline", event: "stage.failed", message: "对齐失败",
  reference_id: "job-1", reference_type: "job", created_at: "2026-09-07T00:00:00Z", details: {},
};

describe("admin error diagnostics", () => {
  it("shows root cause and actionable timeout information before raw details", () => {
    const html = renderToStaticMarkup(<AdminLogDetails item={{ ...item, details: {
      diagnostic_code: "TIMEOUT", error_summary: "wrapper failed", root_cause: { error_summary: "model timed out", exception_type: "TimeoutExpired" }, timeout_seconds: 120,
    } }} />);
    expect(html).toContain("操作超时");
    expect(html.indexOf("model timed out")).toBeLessThan(html.indexOf("原始技术详情"));
    expect(html).toContain("超时阈值：120 秒");
    expect(html).toContain("排查建议");
  });

  it("keeps old log reasons readable and distinguishes fallback from failure", () => {
    const html = renderToStaticMarkup(<AdminLogDetails item={{ ...item, level: "WARNING", event: "stage.fallback", details: { reason: "low confidence" } }} />);
    expect(html).toContain("low confidence");
    expect(html).toContain("已切换备用方案");
    expect(html).not.toContain("排查建议");
  });

  it("handles missing or malformed diagnostics without inventing a cause", () => {
    const html = renderToStaticMarkup(<AdminLogDetails item={{ ...item, details: { root_cause: 123, error_summary: { nested: "unexpected" } } }} />);
    expect(html).toContain("确认原因后再重试");
    expect(html).not.toContain("原因：</span>");
  });
});
