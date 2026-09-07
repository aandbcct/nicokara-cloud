"use client";

import {
  Activity,
  AlertTriangle,
  CircleX,
  Cpu,
  HardDrive,
  ListVideo,
  LoaderCircle,
  LogOut,
  MemoryStick,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { AdminSectionNav } from "@/components/admin-section-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { adminStageLabel, adminStatusLabel } from "@/lib/admin-presentation";
import { jobFailureFeedback } from "@/lib/error-feedback";
import { TrafficAnalyticsPanel } from "@/components/traffic-analytics-panel";
import {
  AdminApiError,
  cancelAdminJob,
  cancelAdminUploadTicket,
  getAdminOverview,
  requeueAdminJob,
} from "@/services/admin-api";
import type { AdminOverview } from "@/types/admin";


const SESSION_TOKEN_KEY = "nicokara-admin-token";


function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "不可用";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}


function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "-";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}


function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}


function count(values: Record<string, number>, status: string): number {
  return values[status] ?? 0;
}


type AdminDashboardViewProps = {
  overview: AdminOverview;
  adminToken?: string;
  pendingAction: string | null;
  onCancelUpload: (ticketId: string) => void;
  onCancelJob: (jobId: string) => void;
  onRequeueJob: (jobId: string) => void;
  onTrafficChanged?: () => void;
};


export function AdminDashboardView({
  overview,
  adminToken,
  pendingAction,
  onCancelUpload,
  onCancelJob,
  onRequeueJob,
  onTrafficChanged,
}: AdminDashboardViewProps) {
  const memory = overview.resources.memory;
  const disk = overview.resources.disk;
  const load = overview.resources.load_average;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="order-1 grid grid-cols-2 border-y bg-card lg:grid-cols-6">
        {[
          ["等待上传", count(overview.upload_counts, "WAITING")],
          ["已获上传名额", count(overview.upload_counts, "READY")],
          ["正在上传", count(overview.upload_counts, "UPLOADING")],
          ["等待处理", count(overview.job_counts, "UPLOADED")],
          ["正在处理", count(overview.job_counts, "PROCESSING")],
          ["失败任务", count(overview.job_counts, "FAILED")],
        ].map(([label, value]) => (
          <div key={label} className="border-b p-4 last:border-b-0 sm:border-r lg:border-b-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <div className="order-6 min-w-0"><TrafficAnalyticsPanel
        traffic={overview.traffic}
        adminToken={adminToken}
        onTrafficChanged={onTrafficChanged}
      /></div>

      <section className="order-2 min-w-0" aria-labelledby="runtime-heading">
        <div className="flex items-center gap-2">
          <Activity className="size-5 text-primary" />
          <h2 id="runtime-heading" className="text-lg font-semibold">运行状态</h2>
        </div>
        {!overview.runner.healthy && <p role="status" className="mt-3 flex items-start gap-2 border-l-4 border-destructive bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />处理服务异常，队列任务可能无法推进。请检查工作进程和最近心跳。</p>}
        <div className="mt-3 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card p-4">
            <p className="text-xs text-muted-foreground">Worker</p>
            <p className={`mt-2 font-semibold ${overview.runner.healthy ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>
              {overview.runner.healthy ? "Worker 正常" : "Worker 异常"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {overview.runner.alive_workers ?? 0} / {overview.runner.worker_count ?? 0} 存活
            </p>
          </div>
          <div className="bg-card p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Cpu className="size-4" />CPU</p>
            <p className="mt-2 font-semibold">{overview.resources.cpu_count ?? "-"} 核</p>
            <p className="mt-1 text-xs text-muted-foreground">1 分钟负载 {load?.one_minute?.toFixed(2) ?? "-"}</p>
          </div>
          <div className="bg-card p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><MemoryStick className="size-4" />内存使用</p>
            <p className="mt-2 font-semibold">{formatBytes(memory?.used_bytes)}</p>
            <p className="mt-1 text-xs text-muted-foreground">总计 {formatBytes(memory?.total_bytes)}</p>
          </div>
          <div className="bg-card p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><HardDrive className="size-4" />磁盘可用</p>
            <p className="mt-2 font-semibold">{formatBytes(disk?.free_bytes)}</p>
            <p className="mt-1 text-xs text-muted-foreground">总计 {formatBytes(disk?.total_bytes)}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          心跳：{formatTime(overview.runner.last_heartbeat_at)} · 内存队列：{overview.runner.queued_in_memory ?? "-"}
          {overview.runner.queue_capacity != null && ` / ${overview.runner.queue_capacity}`}
        </p>
        {overview.runner.accepting_jobs === false && overview.runner.healthy && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">调度缓冲区暂不可接收任务，待处理任务将等待后续调度。</p>}
      </section>

      <section className="order-4 min-w-0" aria-labelledby="upload-queue-heading">
        <div className="flex items-center gap-2">
          <Upload className="size-5 text-primary" />
          <h2 id="upload-queue-heading" className="text-lg font-semibold">上传队列</h2>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b bg-muted/70 text-xs text-muted-foreground">
              <tr><th className="p-3">状态</th><th className="p-3">位置</th><th className="p-3">文件</th><th className="p-3">大小</th><th className="p-3">最后心跳</th><th className="p-3 text-right">操作</th></tr>
            </thead>
            <tbody>
              {overview.upload_tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b last:border-b-0">
                  <td className="p-3 font-medium" title={ticket.status}>{adminStatusLabel(ticket.status)}</td>
                  <td className="p-3 tabular-nums">{ticket.queue_position ? `第 ${ticket.queue_position} 位` : "-"}</td>
                  <td className="max-w-64 truncate p-3" title={ticket.video_name}>{ticket.video_name}</td>
                  <td className="p-3 tabular-nums">{formatBytes(ticket.video_size_bytes)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{formatTime(ticket.last_seen_at)}</td>
                  <td className="p-3 text-right">
                    <button type="button" title="取消上传票据" aria-label={`取消 ${ticket.video_name}`} disabled={pendingAction === `upload:${ticket.id}`} onClick={() => onCancelUpload(ticket.id)} className="focus-ring inline-flex size-9 items-center justify-center rounded-lg border text-destructive hover:bg-destructive/10 disabled:opacity-50">
                      {pendingAction === `upload:${ticket.id}` ? <LoaderCircle className="size-4 animate-spin" /> : <CircleX className="size-4" />}
                    </button>
                  </td>
                </tr>
              ))}
              {overview.upload_tickets.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">当前没有活跃上传</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="order-3 min-w-0" aria-labelledby="job-queue-heading">
        <div className="flex items-center gap-2">
          <ListVideo className="size-5 text-primary" />
          <h2 id="job-queue-heading" className="text-lg font-semibold">处理队列</h2>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b bg-muted/70 text-xs text-muted-foreground">
              <tr><th className="p-3">状态</th><th className="p-3">阶段</th><th className="p-3">进度</th><th className="p-3">文件</th><th className="p-3">距状态更新</th><th className="p-3">错误</th><th className="p-3 text-right">操作</th></tr>
            </thead>
            <tbody>
              {overview.jobs.map((job) => (
                <tr key={job.id} className="border-b last:border-b-0">
                  <td className={`p-3 font-medium ${job.status === "FAILED" ? "text-destructive" : ""}`} title={job.status}>{adminStatusLabel(job.status)}</td>
                  <td className="p-3 text-xs" title={job.stage}>{adminStageLabel(job.stage)}</td>
                  <td className="p-3 tabular-nums"><span>{job.progress}%</span><progress aria-label={`${job.original_video_name} 处理进度`} max={100} value={job.progress} className="mt-1 block h-1 w-16 accent-primary" /></td>
                  <td className="max-w-56 truncate p-3" title={job.original_video_name}>{job.original_video_name}</td>
                  <td className="p-3 tabular-nums">{formatDuration(job.stage_age_seconds)}</td>
                  <td className="min-w-56 max-w-80 break-words p-3 text-xs [overflow-wrap:anywhere]">
                    {job.status === "FAILED" ? <><p className="font-semibold text-destructive">{jobFailureFeedback(job.error_code, job.stage, job.error_message, job.id).title}</p><p className="mt-1">{job.error_message || "未记录具体原因，请查看任务日志。"}</p><p className="mt-1 font-mono text-muted-foreground">{job.error_code}</p></> : "-"}
                    <a href={`/admin/logs?jobId=${encodeURIComponent(job.id)}`} className="focus-ring mt-2 inline-flex min-h-8 items-center gap-1 text-primary hover:underline"><ScrollText className="size-4" />任务日志</a>
                  </td>
                  <td className="p-3 text-right">
                    {job.status === "FAILED" ? (
                      <button type="button" disabled={pendingAction === `job:${job.id}`} onClick={() => onRequeueJob(job.id)} className="focus-ring inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50"><RotateCcw className="size-4" />重新入队</button>
                    ) : (
                      <button type="button" title="取消任务" aria-label={`取消 ${job.original_video_name}`} disabled={pendingAction === `job:${job.id}`} onClick={() => onCancelJob(job.id)} className="focus-ring inline-flex size-9 items-center justify-center rounded-lg border text-destructive hover:bg-destructive/10 disabled:opacity-50"><CircleX className="size-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {overview.jobs.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">当前没有等待、处理或失败任务</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="order-5 min-w-0" aria-labelledby="audit-heading">
        <h2 id="audit-heading" className="text-lg font-semibold">管理员操作记录</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b bg-muted/70 text-xs text-muted-foreground"><tr><th className="p-3">时间</th><th className="p-3">操作</th><th className="p-3">目标</th><th className="p-3">结果</th></tr></thead>
            <tbody>
              {overview.audit_events.map((event) => <tr key={event.id} className="border-b last:border-b-0"><td className="p-3 text-xs text-muted-foreground">{formatTime(event.created_at)}</td><td className="p-3">{event.action}</td><td className="max-w-64 truncate p-3 font-mono text-xs" title={event.target_id}>{event.target_id}</td><td className="p-3">{event.outcome}</td></tr>)}
              {overview.audit_events.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">暂无管理员操作</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}


export default function AdminPage() {
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState("");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
      setToken(stored);
      setTokenInput(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const load = useCallback(async (adminToken: string) => {
    if (!adminToken) return;
    setLoading(true);
    try {
      setOverview(await getAdminOverview(adminToken));
      setError(null);
    } catch (reason) {
      const message = reason instanceof AdminApiError ? reason.message : "后台监控刷新失败。";
      setError(message);
      if (reason instanceof AdminApiError && reason.status === 401) {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        setToken("");
        setOverview(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const initialRefresh = window.setTimeout(() => void load(token), 0);
    return () => {
      window.clearTimeout(initialRefresh);
    };
  }, [load, token]);

  useEffect(() => {
    if (!token || !autoRefresh || loading || pendingAction) return;
    const timer = window.setTimeout(() => void load(token), 5_000);
    return () => window.clearTimeout(timer);
  }, [autoRefresh, load, loading, pendingAction, token]);

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = tokenInput.trim();
    if (!value) return;
    sessionStorage.setItem(SESSION_TOKEN_KEY, value);
    setToken(value);
  }

  function logout() {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    setToken("");
    setTokenInput("");
    setOverview(null);
    setError(null);
  }

  async function runAction(key: string, action: () => Promise<unknown>) {
    if (!token) return;
    setPendingAction(key);
    try {
      await action();
      await load(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "管理员操作失败。");
    } finally {
      setPendingAction(null);
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 py-12">
        <form onSubmit={connect} className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
          <ShieldCheck className="size-8 text-primary" />
          <h1 className="mt-4 text-2xl font-bold">管理员监控</h1>
          <label htmlFor="admin-token" className="mt-6 block text-sm font-medium">管理员令牌</label>
          <input id="admin-token" type="password" autoComplete="current-password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} className="focus-ring mt-2 min-h-11 w-full rounded-lg border bg-background px-3" />
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          <button type="submit" className="focus-ring mt-5 min-h-11 w-full rounded-lg bg-primary px-4 font-semibold text-primary-foreground">进入监控</button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-dvh pb-12">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div><p className="text-xs text-muted-foreground">NICOKARA CLOUD</p><h1 className="text-xl font-bold">管理员监控</h1></div>
          <div className="flex gap-2">
            <label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />自动刷新</label>
            <ThemeToggle />
            <button type="button" title="立即刷新" aria-label="立即刷新" disabled={loading} onClick={() => void load(token)} className="focus-ring inline-flex size-10 items-center justify-center rounded-lg border hover:bg-muted disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></button>
            <button type="button" title="退出管理员监控" aria-label="退出管理员监控" onClick={logout} className="focus-ring inline-flex size-10 items-center justify-center rounded-lg border hover:bg-muted"><LogOut className="size-4" /></button>
          </div>
        </div>
        <div className="mx-auto max-w-[1500px] px-5 sm:px-8">
          <AdminSectionNav active="monitor" />
        </div>
      </header>
      <div className="mx-auto max-w-[1500px] px-5 pt-6 sm:px-8">
        {overview && <p className="mb-3 text-xs text-muted-foreground">数据更新时间：{formatTime(overview.generated_at)}{error ? " · 刷新失败，当前为上次成功读取的数据" : ""}</p>}
        {error && <div role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        {overview ? (
          <AdminDashboardView
            overview={overview}
            adminToken={token}
            pendingAction={pendingAction}
            onCancelUpload={(id) => void runAction(`upload:${id}`, () => cancelAdminUploadTicket(token, id))}
            onCancelJob={(id) => void runAction(`job:${id}`, () => cancelAdminJob(token, id))}
            onRequeueJob={(id) => void runAction(`job:${id}`, () => requeueAdminJob(token, id))}
            onTrafficChanged={() => void load(token)}
          />
        ) : loading ? (
          <div className="flex items-center justify-center gap-3 py-24 text-muted-foreground"><LoaderCircle className="size-5 animate-spin" />读取监控数据</div>
        ) : (
          <div className="py-24 text-center text-sm text-muted-foreground">监控数据尚未载入，请检查上方提示后重试。</div>
        )}
      </div>
    </main>
  );
}
