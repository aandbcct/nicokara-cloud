"use client";

import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { AdminSectionNav } from "@/components/admin-section-nav";
import { AdminLogDetails as LogDetails } from "@/components/admin-log-details";
import { ThemeToggle } from "@/components/theme-toggle";
import { adminStageLabel } from "@/lib/admin-presentation";
import {
  AdminApiError,
  getAdminJobTimeline,
  getAdminLogs,
} from "@/services/admin-api";
import type {
  AdminJobTimelineResponse,
  AdminLogFilters,
  AdminLogItem,
  AdminLogsResponse,
} from "@/types/admin";


const SESSION_TOKEN_KEY = "nicokara-admin-token";
const PAGE_SIZE = 50;
const EMPTY_FILTERS: AdminLogFilters = {
  level: "",
  category: "",
  event: "",
  component: "",
  stage: "",
  referenceId: "",
  runId: "",
  requestId: "",
  createdFrom: "",
  createdTo: "",
  query: "",
  order: "desc",
};


function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}


function levelClass(level: string): string {
  if (["ERROR", "CRITICAL"].includes(level)) return "text-destructive";
  if (level === "WARNING") return "text-amber-700 dark:text-amber-300";
  return "text-foreground";
}


function formatDuration(value?: number | null): string {
  if (value === null || value === undefined) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} 秒`;
}


function normalizeDateTimeFilter(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}


function eventStateClass(item: AdminLogItem): string {
  if (item.event.includes("failed") || ["ERROR", "CRITICAL"].includes(item.level)) {
    return "border-l-4 border-l-destructive bg-destructive/5";
  }
  if (item.event.includes("fallback") || item.level === "WARNING") {
    return "border-l-4 border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/30";
  }
  if (item.event.includes("skipped")) {
    return "border-l-4 border-l-muted-foreground bg-muted/40";
  }
  if (item.event.includes("completed")) {
    return "border-l-4 border-l-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/30";
  }
  return "border-l-4 border-l-transparent";
}


type AdminLogsViewProps = {
  response: AdminLogsResponse;
  loading: boolean;
  page: number;
  onPageChange: (page: number) => void;
  filters?: AdminLogFilters;
  onFiltersChange?: (filters: AdminLogFilters) => void;
  onApplyFilters?: () => void;
  onOpenTimeline?: (jobId: string) => void;
};


export function AdminLogsView({
  response,
  loading,
  page,
  onPageChange,
  filters = EMPTY_FILTERS,
  onFiltersChange = () => undefined,
  onApplyFilters = () => undefined,
  onOpenTimeline = () => undefined,
}: AdminLogsViewProps) {
  const pageCount = Math.max(1, Math.ceil(response.total / response.limit));
  const updateFilter = (key: keyof AdminLogFilters, value: string) => {
    onFiltersChange({ ...filters, [key]: value } as AdminLogFilters);
  };

  return (
    <div className="space-y-5">
      <form
        className="space-y-3 border-y bg-card py-4"
        onSubmit={(event) => {
          event.preventDefault();
          onApplyFilters();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-muted-foreground">
          日志级别
          <select value={filters.level ?? ""} onChange={(event) => updateFilter("level", event.target.value)} className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="">全部级别</option>
            <option value="DEBUG">DEBUG</option>
            <option value="ERROR">错误</option>
            <option value="CRITICAL">严重错误</option>
            <option value="WARNING">警告</option>
            <option value="INFO">信息</option>
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          事件分类
          <select value={filters.category ?? ""} onChange={(event) => updateFilter("category", event.target.value)} className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="">全部分类</option>
            <option value="task">任务</option>
            <option value="upload">上传</option>
            <option value="admin">管理员</option>
            <option value="system">系统</option>
            <option value="pipeline">流水线</option>
            <option value="queue">队列</option>
            <option value="request">请求</option>
            <option value="cleanup">清理</option>
            <option value="external">外部服务</option>
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          关键词
          <input value={filters.query ?? ""} onChange={(event) => updateFilter("query", event.target.value)} className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          任务或上传 ID
          <input value={filters.referenceId ?? ""} onChange={(event) => updateFilter("referenceId", event.target.value)} className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" />
        </label>
        </div>
        <details>
          <summary className="min-h-8 cursor-pointer text-xs font-medium text-primary">高级筛选</summary>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-muted-foreground">
          事件名
          <input value={filters.event ?? ""} onChange={(event) => updateFilter("event", event.target.value)} placeholder="stage.fallback" className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          处理阶段
          <input value={filters.stage ?? ""} onChange={(event) => updateFilter("stage", event.target.value)} placeholder="ALIGNING" className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          组件
          <input value={filters.component ?? ""} onChange={(event) => updateFilter("component", event.target.value)} placeholder="fa_kara" className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          运行批次
          <input value={filters.runId ?? ""} onChange={(event) => updateFilter("runId", event.target.value)} className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          请求 ID
          <input value={filters.requestId ?? ""} onChange={(event) => updateFilter("requestId", event.target.value)} className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          开始时间
          <input type="datetime-local" value={filters.createdFrom ?? ""} onChange={(event) => updateFilter("createdFrom", event.target.value)} className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          结束时间
          <input type="datetime-local" value={filters.createdTo ?? ""} onChange={(event) => updateFilter("createdTo", event.target.value)} className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          排序
          <select value={filters.order ?? "desc"} onChange={(event) => updateFilter("order", event.target.value)} className="focus-ring mt-1 block min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="desc">最新在前</option><option value="asc">最早在前</option>
          </select>
        </label>
          </div>
        </details>
        <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!filters.referenceId} onClick={() => onOpenTimeline(filters.referenceId ?? "")} className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold disabled:opacity-40">
          <Clock3 className="size-4" aria-hidden="true" />任务时间线
        </button>
        <button type="submit" disabled={loading} className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          <Search className="size-4" aria-hidden="true" />筛选
        </button>
        </div>
      </form>

      <div className="min-w-0 border-y bg-card" aria-label="日志列表" aria-busy={loading}>
        {response.items.map((item) => (
          <article key={item.id} className={`grid min-w-0 gap-4 border-b p-4 last:border-b-0 lg:grid-cols-[190px_minmax(0,1fr)_230px] ${eventStateClass(item)}`}>
            <div className="min-w-0 space-y-1 text-xs">
              <p className={`font-semibold ${levelClass(item.level)}`}>{({ ERROR: "错误", CRITICAL: "严重错误", WARNING: "警告", INFO: "信息", DEBUG: "调试" } as Record<string, string>)[item.level] ?? item.level} · {item.level}</p>
              <time className="block text-muted-foreground">{formatTime(item.created_at)}</time>
              <p title={item.stage ?? undefined}>{adminStageLabel(item.stage)}</p>
              <p className="break-all text-muted-foreground">{item.component ?? item.category} · {formatDuration(item.duration_ms)}</p>
            </div>
            <div className="min-w-0">
              <h2 className="mb-2 whitespace-pre-wrap break-words text-sm font-semibold [overflow-wrap:anywhere]">{item.message}</h2>
              <LogDetails item={item} />
            </div>
            <div className="min-w-0 space-y-2 break-all text-xs text-muted-foreground">
              <p className="font-mono">{item.event}</p>
              {item.reference_id && <p><span className="block">关联 ID</span>{item.reference_type === "job" ? <button type="button" onClick={() => onOpenTimeline(item.reference_id!)} title="查看任务时间线" className="focus-ring min-h-8 break-all text-left font-mono text-primary hover:underline">{item.reference_id}</button> : <span className="font-mono">{item.reference_id}</span>}</p>}
              {item.run_id && <p>运行批次 <span className="block font-mono">{item.run_id}</span></p>}
              {item.request_id && <p>请求 ID <span className="block font-mono">{item.request_id}</span></p>}
            </div>
          </article>
        ))}
        {response.items.length === 0 && <p className="p-12 text-center text-sm text-muted-foreground">没有符合条件的日志</p>}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">共 {response.total} 条 · 第 {page} / {pageCount} 页</p>
        <div className="flex gap-2">
          <button type="button" title="上一页" aria-label="上一页" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} className="focus-ring inline-flex size-10 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"><ChevronLeft className="size-4" /></button>
          <button type="button" title="下一页" aria-label="下一页" disabled={loading || page >= pageCount} onClick={() => onPageChange(page + 1)} className="focus-ring inline-flex size-10 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"><ChevronRight className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}


type JobTimelineViewProps = {
  response: AdminJobTimelineResponse;
  selectedRunId: string;
  loading: boolean;
  onRunChange: (runId: string) => void;
  onBack: () => void;
};


export function JobTimelineView({
  response,
  selectedRunId,
  loading,
  onRunChange,
  onBack,
}: JobTimelineViewProps) {
  const terminalPipelineEvent = [...response.items].reverse().find((item) =>
    [
      "pipeline.completed",
      "pipeline.failed",
      "pipeline.canceled",
      "pipeline.paused",
    ].includes(item.event),
  );
  const totalDuration = terminalPipelineEvent?.duration_ms ?? response.items
    .filter((item) => item.event === "stage.completed")
    .reduce((sum, item) => sum + (item.duration_ms ?? 0), 0);
  return (
    <section className="space-y-5">
      <div className="flex flex-col justify-between gap-3 border-y bg-card py-4 sm:flex-row sm:items-end">
        <div>
          <button type="button" onClick={onBack} className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold">
            <ArrowLeft className="size-4" aria-hidden="true" />返回日志列表
          </button>
          <p className="mt-3 text-xs text-muted-foreground">任务 ID</p>
          <p className="break-all font-mono text-sm">{response.job_id}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 max-w-full text-xs font-medium text-muted-foreground">
            运行批次
            <select disabled={loading} value={selectedRunId} onChange={(event) => onRunChange(event.target.value)} className="focus-ring mt-1 block min-h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-3 text-sm text-foreground sm:min-w-56">
              <option value="">全部运行批次</option>
              {response.run_ids.map((runId) => <option key={runId} value={runId}>{runId}</option>)}
            </select>
          </label>
          <p className="pb-2 text-sm text-muted-foreground">{response.total} 个事件 · 任务总耗时 {formatDuration(totalDuration)}</p>
        </div>
      </div>
      <ol className="relative ml-3 border-l border-border pl-6 sm:ml-5 sm:pl-8">
        {response.items.map((item) => (
          <li key={item.id} className="relative pb-6 last:pb-0">
            <span className={`absolute -left-[2.05rem] top-1 size-3 rounded-full border-2 border-background sm:-left-[2.55rem] ${item.level === "ERROR" ? "bg-destructive" : item.event.includes("fallback") || item.level === "WARNING" ? "bg-amber-500" : item.event.includes("completed") ? "bg-emerald-600" : item.event.includes("skipped") ? "bg-muted-foreground" : "bg-primary"}`} />
            <article className={`border-y px-3 py-3 sm:px-4 ${eventStateClass(item)}`}>
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                <div>
                  <p className={`text-xs font-bold ${levelClass(item.level)}`}>{item.level} · {item.event}</p>
                  <h2 className="mt-1 break-words text-sm font-semibold [overflow-wrap:anywhere]">{item.message}</h2>
                </div>
                <time className="whitespace-nowrap text-xs text-muted-foreground">{formatTime(item.created_at)}</time>
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <p title={item.stage ?? undefined}><span className="text-muted-foreground">阶段：</span>{adminStageLabel(item.stage)}</p>
                <p><span className="text-muted-foreground">组件：</span>{item.component ?? "-"}</p>
                <p><span className="text-muted-foreground">耗时：</span>{formatDuration(item.duration_ms)}</p>
                <p className="break-all"><span className="text-muted-foreground">请求 ID：</span><span className="font-mono">{item.request_id ?? "-"}</span></p>
              </div>
              <div className="mt-3"><LogDetails item={item} /></div>
            </article>
          </li>
        ))}
        {response.items.length === 0 && <li className="py-12 text-sm text-muted-foreground">该任务没有符合条件的时间线事件</li>}
      </ol>
    </section>
  );
}


export default function AdminLogsPage() {
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState("");
  const [response, setResponse] = useState<AdminLogsResponse | null>(null);
  const [timelineResponse, setTimelineResponse] = useState<AdminJobTimelineResponse | null>(null);
  const [timelineJobId, setTimelineJobId] = useState("");
  const [timelineRunId, setTimelineRunId] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [draftFilters, setDraftFilters] = useState<AdminLogFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<AdminLogFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
      setToken(stored);
      setTokenInput(stored);
      const jobId = new URLSearchParams(window.location.search).get("jobId")?.trim();
      if (jobId) setTimelineJobId(jobId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadLogs = useCallback(async (
    adminToken: string,
    activeFilters: AdminLogFilters,
    activePage: number,
  ) => {
    if (!adminToken) return;
    setLoading(true);
    try {
      setResponse(await getAdminLogs(adminToken, {
        ...activeFilters,
        limit: PAGE_SIZE,
        offset: (activePage - 1) * PAGE_SIZE,
      }));
      setError(null);
    } catch (reason) {
      setError(reason instanceof AdminApiError ? reason.message : "管理员日志读取失败。");
      if (reason instanceof AdminApiError && reason.status === 401) {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        setToken("");
        setResponse(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTimeline = useCallback(async (
    adminToken: string,
    jobId: string,
    runId: string,
  ) => {
    if (!adminToken || !jobId) return;
    setLoading(true);
    try {
      setTimelineResponse(await getAdminJobTimeline(adminToken, jobId, {
        runId: runId || undefined,
        order: "asc",
        limit: 1000,
      }));
      setError(null);
    } catch (reason) {
      setError(reason instanceof AdminApiError ? reason.message : "任务时间线读取失败。");
      if (reason instanceof AdminApiError && reason.status === 401) {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        setToken("");
        setResponse(null);
        setTimelineResponse(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token || timelineJobId) return;
    const timer = window.setTimeout(() => void loadLogs(token, filters, page), 0);
    return () => window.clearTimeout(timer);
  }, [filters, loadLogs, page, timelineJobId, token]);

  useEffect(() => {
    if (!timelineJobId || !token) return;
    const timer = window.setTimeout(
      () => void loadTimeline(token, timelineJobId, timelineRunId),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [loadTimeline, timelineJobId, timelineRunId, token]);

  useEffect(() => {
    if (!autoRefresh || !token || loading) return;
    const timer = window.setTimeout(() => {
      if (timelineJobId) {
        void loadTimeline(token, timelineJobId, timelineRunId);
      } else {
        void loadLogs(token, filters, page);
      }
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [autoRefresh, filters, loadLogs, loadTimeline, loading, page, timelineJobId, timelineRunId, token]);

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
    setResponse(null);
    setTimelineResponse(null);
    setTimelineJobId("");
    setError(null);
  }

  if (!token) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 py-12">
        <form onSubmit={connect} className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
          <ShieldCheck className="size-8 text-primary" />
          <h1 className="mt-4 text-2xl font-bold">管理员日志</h1>
          <label htmlFor="admin-log-token" className="mt-6 block text-sm font-medium">管理员令牌</label>
          <input id="admin-log-token" type="password" autoComplete="current-password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} className="focus-ring mt-2 min-h-11 w-full rounded-lg border bg-background px-3" />
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          <button type="submit" className="focus-ring mt-5 min-h-11 w-full rounded-lg bg-primary px-4 font-semibold text-primary-foreground">进入日志</button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-dvh pb-12">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div><p className="text-xs text-muted-foreground">NICOKARA CLOUD</p><h1 className="text-xl font-bold">管理员日志</h1></div>
          <div className="flex gap-2">
            <ThemeToggle />
            <label className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-xs font-medium"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />定时刷新</label>
            <button type="button" title="立即刷新" aria-label="立即刷新" disabled={loading} onClick={() => timelineJobId ? void loadTimeline(token, timelineJobId, timelineRunId) : void loadLogs(token, filters, page)} className="focus-ring inline-flex size-10 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></button>
            <button type="button" title="退出管理员日志" aria-label="退出管理员日志" onClick={logout} className="focus-ring inline-flex size-10 items-center justify-center rounded-md border hover:bg-muted"><LogOut className="size-4" /></button>
          </div>
        </div>
        <div className="mx-auto max-w-[1500px] px-5 sm:px-8">
          <AdminSectionNav active="logs" />
        </div>
      </header>
      <div className="mx-auto max-w-[1500px] px-5 pt-6 sm:px-8">
        {error && <div role="alert" className="mb-5 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        {timelineJobId ? (
          timelineResponse ? (
          <JobTimelineView
            response={timelineResponse}
            selectedRunId={timelineRunId}
            loading={loading}
            onRunChange={setTimelineRunId}
            onBack={() => {
              setTimelineJobId("");
              setTimelineRunId("");
              setTimelineResponse(null);
              window.history.replaceState(null, "", window.location.pathname);
            }}
          />
        ) : <div className="py-12 text-sm text-muted-foreground"><button type="button" onClick={() => { setTimelineJobId(""); window.history.replaceState(null, "", window.location.pathname); }} className="focus-ring mb-4 inline-flex min-h-10 items-center gap-2 text-primary"><ArrowLeft className="size-4" />返回日志列表</button><p>{loading ? "读取任务时间线" : "时间线暂不可用，请刷新重试。"}</p></div>
        ) : response ? (
          <AdminLogsView
            response={response}
            loading={loading}
            page={page}
            onPageChange={setPage}
            filters={draftFilters}
            onFiltersChange={setDraftFilters}
            onApplyFilters={() => {
              setPage(1);
              setFilters({
                level: draftFilters.level?.trim(),
                category: draftFilters.category?.trim(),
                event: draftFilters.event?.trim(),
                component: draftFilters.component?.trim(),
                stage: draftFilters.stage?.trim(),
                referenceId: draftFilters.referenceId?.trim(),
                runId: draftFilters.runId?.trim(),
                requestId: draftFilters.requestId?.trim(),
                createdFrom: normalizeDateTimeFilter(draftFilters.createdFrom?.trim()),
                createdTo: normalizeDateTimeFilter(draftFilters.createdTo?.trim()),
                query: draftFilters.query?.trim(),
                order: draftFilters.order ?? "desc",
              });
            }}
            onOpenTimeline={(jobId) => {
              setTimelineRunId("");
              setTimelineResponse(null);
              setTimelineJobId(jobId.trim());
            }}
          />
        ) : loading ? (
          <div className="flex items-center justify-center gap-3 py-24 text-muted-foreground"><LoaderCircle className="size-5 animate-spin" />读取日志</div>
        ) : (
          <div className="py-24 text-center text-sm text-muted-foreground">日志尚未载入，请检查上方提示后重试。</div>
        )}
      </div>
    </main>
  );
}
