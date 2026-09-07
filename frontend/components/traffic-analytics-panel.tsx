"use client";

import {
  Activity,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Eye,
  LoaderCircle,
  Save,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  getAdminTraffic,
  updateAdminDailyTraffic,
} from "@/services/admin-api";
import type { AdminOverview, AdminTrafficReport } from "@/types/admin";


type TrafficAnalyticsPanelProps = {
  traffic: AdminOverview["traffic"];
  adminToken?: string;
  onTrafficChanged?: () => void;
};


function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}


function initialReport(traffic: AdminOverview["traffic"]): AdminTrafficReport {
  const lastCloudflarePeriod = [...traffic.periods]
    .reverse()
    .find((period) => period.source.startsWith("Cloudflare"));
  return {
    date_from: localDate(new Date(traffic.tracking_started_at)),
    date_to: localDate(new Date()),
    pageviews: traffic.pageviews,
    visits: traffic.visits,
    pages_per_visit: traffic.pages_per_visit,
    has_partial_pdf_period: false,
    manual_entry_min_date: localDate(
      new Date(lastCloudflarePeriod?.ended_at ?? traffic.tracking_started_at),
    ),
    series: traffic.periods.map((period) => ({ ...period, editable: period.key === "live" })),
  };
}


function TrendChart({ report }: { report: AdminTrafficReport }) {
  const points = report.series;
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.pageviews, point.visits]));
  const x = (index: number) => points.length <= 1 ? 500 : 48 + (index * 904) / (points.length - 1);
  const y = (value: number) => 220 - (value / maxValue) * 180;
  const pageviewPoints = points.map((point, index) => `${x(index)},${y(point.pageviews)}`).join(" ");
  const visitPoints = points.map((point, index) => `${x(index)},${y(point.visits)}`).join(" ");

  if (points.length === 0) {
    return <div className="flex h-56 items-center justify-center border-y text-sm text-muted-foreground">所选时间段暂无数据</div>;
  }

  return (
    <div className="overflow-x-auto border-y bg-background/50 px-3 py-4">
      <svg viewBox="0 0 1000 260" role="img" aria-label="访问趋势图" className="h-64 min-w-[680px] w-full">
        {[0, 1, 2, 3, 4].map((index) => {
          const gridY = 40 + index * 45;
          return <line key={gridY} x1="48" x2="952" y1={gridY} y2={gridY} className="stroke-border" strokeWidth="1" />;
        })}
        <polyline points={pageviewPoints} fill="none" className="stroke-primary" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={visitPoints} fill="none" className="stroke-emerald-500" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => (
          <g key={point.key}>
            <circle cx={x(index)} cy={y(point.pageviews)} r="6" className="fill-primary stroke-background" strokeWidth="3">
              <title>{`${point.label}: Pageviews ${point.pageviews}`}</title>
            </circle>
            <circle cx={x(index)} cy={y(point.visits)} r="6" className="fill-emerald-500 stroke-background" strokeWidth="3">
              <title>{`${point.label}: Visits ${point.visits}`}</title>
            </circle>
            <text x={x(index)} y="248" textAnchor="middle" className="fill-muted-foreground text-[18px]">{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}


export function TrafficAnalyticsPanel({
  traffic,
  adminToken = "",
  onTrafficChanged,
}: TrafficAnalyticsPanelProps) {
  const fallback = useMemo(() => initialReport(traffic), [traffic]);
  const [expanded, setExpanded] = useState(true);
  const [report, setReport] = useState(fallback);
  const [dateFrom, setDateFrom] = useState(fallback.date_from);
  const [dateTo, setDateTo] = useState(fallback.date_to);
  const [editDate, setEditDate] = useState(fallback.date_to);
  const [pageviews, setPageviews] = useState("");
  const [visits, setVisits] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRange(from = dateFrom, to = dateTo) {
    if (!adminToken) return;
    setLoading(true);
    try {
      setReport(await getAdminTraffic(adminToken, from, to));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "访问数据读取失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!adminToken) return;
    let canceled = false;
    void getAdminTraffic(adminToken, fallback.date_from, fallback.date_to)
      .then((nextReport) => {
        if (canceled) return;
        setReport(nextReport);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (canceled) return;
        setError(reason instanceof Error ? reason.message : "访问数据读取失败。");
      });
    return () => {
      canceled = true;
    };
  }, [adminToken, fallback.date_from, fallback.date_to]);

  function selectRecent(days: number) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - days + 1);
    const from = localDate(start);
    const to = localDate(end);
    setDateFrom(from);
    setDateTo(to);
    void loadRange(from, to);
  }

  function selectAll() {
    setDateFrom(fallback.date_from);
    setDateTo(fallback.date_to);
    void loadRange(fallback.date_from, fallback.date_to);
  }

  async function saveDaily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminToken) return;
    setSaving(true);
    try {
      await updateAdminDailyTraffic(adminToken, editDate, {
        pageviews: Number(pageviews),
        visits: Number(visits),
      });
      await loadRange();
      onTrafficChanged?.();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "每日数据保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="traffic-heading" className="border-y bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-primary" />
            <h2 id="traffic-heading" className="text-lg font-semibold">访问分析</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Cloudflare PDF 历史汇总与站内实时记录持续保存</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {expanded ? "收起访问分析" : "展开访问分析"}
        </button>
      </div>

      {expanded && (
        <div className="border-t">
          <div className="flex flex-wrap items-end gap-3 px-4 py-4 sm:px-5">
            <div className="mr-auto">
              <p className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4" />选择分析时间段</p>
              <div className="mt-2 inline-flex overflow-hidden rounded-md border" aria-label="快捷时间范围">
                <button type="button" onClick={() => selectRecent(7)} className="min-h-9 border-r px-3 text-xs hover:bg-muted">近 7 天</button>
                <button type="button" onClick={() => selectRecent(30)} className="min-h-9 border-r px-3 text-xs hover:bg-muted">近 30 天</button>
                <button type="button" onClick={selectAll} className="min-h-9 px-3 text-xs hover:bg-muted">全部</button>
              </div>
            </div>
            <label className="text-xs text-muted-foreground">开始日期<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="focus-ring mt-1 block min-h-10 rounded-md border bg-background px-2 text-sm text-foreground" /></label>
            <label className="text-xs text-muted-foreground">结束日期<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="focus-ring mt-1 block min-h-10 rounded-md border bg-background px-2 text-sm text-foreground" /></label>
            <button type="button" disabled={loading || !adminToken} onClick={() => void loadRange()} className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {loading && <LoaderCircle className="size-4 animate-spin" />}应用
            </button>
          </div>

          {error && <p role="alert" className="mx-4 mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive sm:mx-5">{error}</p>}
          {report.has_partial_pdf_period && <p className="mx-4 mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 sm:mx-5">所选日期切分了 PDF 汇总区间；该区间只有总量，没有可可靠拆分的逐日明细，图表仍显示整段汇总。</p>}

          <div className="grid border-y sm:grid-cols-3">
            <div className="border-b p-4 sm:border-b-0 sm:border-r sm:p-5"><p className="flex items-center gap-2 text-sm font-semibold"><Eye className="size-4 text-primary" />Page Views summary</p><p className="mt-3 text-3xl font-bold tabular-nums">{report.pageviews.toLocaleString("zh-CN")}</p></div>
            <div className="border-b p-4 sm:border-b-0 sm:border-r sm:p-5"><p className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-emerald-600" />Visits summary</p><p className="mt-3 text-3xl font-bold tabular-nums">{report.visits.toLocaleString("zh-CN")}</p></div>
            <div className="p-4 sm:p-5"><p className="text-sm font-semibold">平均浏览深度</p><p className="mt-3 text-3xl font-bold tabular-nums">{report.pages_per_visit.toFixed(2)}</p><p className="mt-1 text-xs text-muted-foreground">页 / 次访问</p></div>
          </div>

          <div className="px-4 pt-5 sm:px-5"><h3 className="text-sm font-semibold">访问趋势图</h3><p className="mt-1 text-xs text-muted-foreground">粉色为 Pageviews，绿色为 Visits</p></div>
          <TrendChart report={report} />

          <div className="grid gap-px border-b bg-border sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["近 24 小时浏览", traffic.pageviews_24h, "Pageviews"],
              ["近 24 小时访问", traffic.visits_24h, "Visits"],
              ["近 5 分钟活跃", traffic.active_visits, "访问会话"],
              ["累计平均深度", traffic.pages_per_visit.toFixed(2), "页 / 次访问"],
            ].map(([label, value, detail]) => (
              <div key={label} className="bg-card p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString("zh-CN") : value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="overflow-x-auto border-b lg:border-b-0 lg:border-r">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b bg-muted/60 text-xs text-muted-foreground"><tr><th className="p-3">时间</th><th className="p-3">来源</th><th className="p-3 text-right">Pageviews</th><th className="p-3 text-right">Visits</th></tr></thead>
                <tbody>{report.series.map((point) => <tr key={point.key} data-traffic-period={point.key} className="border-b last:border-b-0"><td className="p-3 font-medium">{point.label}</td><td className="p-3 text-xs text-muted-foreground">{point.source.startsWith("Cloudflare") ? "Cloudflare 历史数据" : point.source}</td><td className="p-3 text-right tabular-nums">{point.pageviews.toLocaleString("zh-CN")}</td><td className="p-3 text-right tabular-nums">{point.visits.toLocaleString("zh-CN")}</td></tr>)}</tbody>
              </table>
            </div>
            <form onSubmit={saveDaily} className="p-4 sm:p-5">
              <h3 className="text-sm font-semibold">修改每日数据</h3>
              <p className="mt-1 text-xs text-muted-foreground">保存后覆盖该日的站内统计值，不会删除其他日期记录。</p>
              <label className="mt-4 block text-xs text-muted-foreground">日期<input required type="date" min={report.manual_entry_min_date} value={editDate} onChange={(event) => setEditDate(event.target.value)} className="focus-ring mt-1 min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" /></label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-xs text-muted-foreground">Pageviews<input required min="0" type="number" value={pageviews} onChange={(event) => setPageviews(event.target.value)} className="focus-ring mt-1 min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" /></label>
                <label className="text-xs text-muted-foreground">Visits<input required min="0" type="number" value={visits} onChange={(event) => setVisits(event.target.value)} className="focus-ring mt-1 min-h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground" /></label>
              </div>
              <button type="submit" disabled={saving || !adminToken} className="focus-ring mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50">
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存当日数据
              </button>
            </form>
          </div>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">统计起始：{localDate(new Date(traffic.tracking_started_at))} · 数据写入 SQLite，服务重启后继续保留</p>
        </div>
      )}
    </section>
  );
}
