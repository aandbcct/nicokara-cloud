import { ADMIN_DIAGNOSTICS } from "@/lib/admin-presentation";
import type { AdminLogItem } from "@/types/admin";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function AdminLogDetails({ item }: { item: AdminLogItem }) {
  const details = item.details;
  const root = details.root_cause && typeof details.root_cause === "object"
    ? details.root_cause as Record<string, unknown> : {};
  const reason = text(root.error_summary) ?? text(details.error_summary)
    ?? text(details.error_message) ?? text(details.reason);
  const type = text(root.exception_type) ?? text(details.exception_type);
  const diagnostic = ADMIN_DIAGNOSTICS[text(details.diagnostic_code) ?? ""];
  const isError = ["ERROR", "CRITICAL"].includes(item.level);
  const fallback = item.event.includes("fallback");
  return (
    <div className="min-w-0 space-y-2 text-xs leading-5">
      {diagnostic && <p className="font-semibold">{diagnostic.title}</p>}
      {reason && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"><span className="text-muted-foreground">原因：</span>{reason}</p>}
      {type && <p className="break-all font-mono text-muted-foreground">{type}</p>}
      {fallback && <p className="text-amber-800 dark:text-amber-300">此步骤已切换备用方案，任务是否成功请查看后续事件。</p>}
      {(diagnostic || isError) && <p><span className="text-muted-foreground">排查建议：</span>{diagnostic?.suggestion ?? "查看同一运行批次中较早的错误和程序输出，确认原因后再重试。"}</p>}
      {(typeof details.exit_code === "number" || typeof details.timeout_seconds === "number") && (
        <p className="text-muted-foreground">{typeof details.exit_code === "number" && `退出码：${details.exit_code} `}{typeof details.timeout_seconds === "number" && `超时阈值：${details.timeout_seconds} 秒`}</p>
      )}
      {text(details.stderr_tail) && <details><summary className="cursor-pointer font-medium text-primary">程序错误输出</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all bg-muted p-3">{text(details.stderr_tail)}</pre></details>}
      {Object.keys(details).length > 0 && <details><summary className="cursor-pointer font-medium text-primary">原始技术详情</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all bg-muted p-3 text-muted-foreground">{JSON.stringify(details, null, 2)}</pre></details>}
    </div>
  );
}
