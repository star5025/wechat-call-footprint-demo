import { useEffect, useState } from "react";
import type { AppDataset } from "@/domain";
import { monthlyCalls, monthlyCallsYears, monthlyDurationLabel } from "@/data/monthlyCalls";

interface MonthlyCallsChartProps {
  dataset: AppDataset;
  contactId: string | null;
}

export function MonthlyCallsChart({ dataset, contactId }: MonthlyCallsChartProps) {
  const [metric, setMetric] = useState<"count" | "duration">("count");
  const [selection, setSelection] = useState<{ dataset: AppDataset; contactId: string | null; year: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const { minYear, maxYear, defaultYear } = monthlyCallsYears(dataset, contactId, now);
  const selectedYear = selection?.dataset === dataset && selection.contactId === contactId ? selection.year : defaultYear;
  const year = Math.max(minYear, Math.min(maxYear, selectedYear));
  const months = monthlyCalls(dataset, contactId, year, now);
  const max = Math.max(...months.map((month) => metric === "count" ? month.count : month.durationSeconds));
  const chooseYear = (nextYear: number) => setSelection({ dataset, contactId, year: Math.max(minYear, Math.min(maxYear, nextYear)) });

  return (
    <article className="discovery-card monthly-chart-card" data-monthly-metric={metric}>
      <div className="monthly-chart-header">
        <h2>每月通话</h2>
        <div className="monthly-chart-years" role="group" aria-label="选择年份">
          <button type="button" aria-label="上一年" disabled={year <= minYear} onClick={() => chooseYear(year - 1)}>‹</button>
          <span aria-live="polite" aria-atomic="true">{year} 年</span>
          <button type="button" aria-label="下一年" disabled={year >= maxYear} onClick={() => chooseYear(year + 1)}>›</button>
        </div>
      </div>
      <div className="monthly-chart-toggle" role="group" aria-label="通话统计指标">
        <button type="button" className={metric === "count" ? "active" : ""} aria-pressed={metric === "count"} onClick={() => setMetric("count")}>次数</button>
        <button type="button" className={metric === "duration" ? "active" : ""} aria-pressed={metric === "duration"} onClick={() => setMetric("duration")}>时长</button>
      </div>
      <div className="monthly-chart-bars" role="group" aria-label={`${year} 年每月已接通通话，${metric === "count" ? "次数" : "时长"}`}>
        {months.map((month) => {
          const future = month.coverage === "future";
          const value = metric === "count" ? month.count : month.durationSeconds;
          const details = future ? "尚未到来，暂无数据" : `${month.count} 次，${monthlyDurationLabel(month.durationSeconds)}，${month.coverage === "complete" ? "覆盖完整" : "覆盖不完整"}`;
          return (
            <button type="button" className="monthly-chart-column" key={month.month} data-coverage={month.coverage} disabled={future} aria-label={`${year} 年 ${month.month} 月，${details}`}>
              <span className="monthly-chart-track" data-coverage={month.coverage}>
                <i className="monthly-chart-bar" aria-hidden="true" style={{ height: `${max && !future ? value / max * 100 : 0}%` }} />
                {future && <span aria-hidden="true">—</span>}
              </span>
              <span aria-hidden="true">{month.month}月{month.coverage === "partial" ? "*" : ""}</span>
              <span className="monthly-chart-tip" role="tooltip" aria-hidden="true">{year} 年 {month.month} 月<br />{details}</span>
            </button>
          );
        })}
      </div>
      <p className="monthly-chart-note">次数统计已接通，时长仅汇总明确值；本月截至今天。{months.some((month) => month.coverage === "partial") && "* 和斜纹表示覆盖不完整，所示为已保存记录，并非完整月份总量。"}未来月份以 — 表示。</p>
    </article>
  );
}
