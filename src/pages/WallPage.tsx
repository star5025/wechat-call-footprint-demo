import { useMemo, useState } from "react";
import type { ContributionDay, DateRange } from "@contracts/models";
import { ContactSwitcher } from "@/components/ContactSwitcher";
import { buildWall, contributionLevel, filterEvents, summarize } from "@/data/analytics";
import type { WallMetric, WallMode } from "@/domain";
import { useApp } from "@/state/AppContext";
import { formatCompactDuration, formatDate, formatDuration } from "@/utils/format";

const pad = (value: number) => String(value).padStart(2, "0");
const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDate = (value: string) => new Date(`${value}T12:00:00`);

function rangeFor(mode: WallMode, year: number, month: string, start: string, end: string, timezone: string): DateRange {
  if (mode === "year") return { startDate: `${year}-01-01`, endDate: `${year}-12-31`, timezone };
  if (mode === "month") {
    const [y, m] = month.split("-").map(Number);
    return { startDate: `${month}-01`, endDate: isoDate(new Date(y, m, 0)), timezone };
  }
  return { startDate: start, endDate: end, timezone };
}

export function WallPage() {
  const { dataset, activeContactId, settings, openEvent, navigate } = useApp();
  const [mode, setMode] = useState<WallMode>("year");
  const [metric, setMetric] = useState<WallMetric>(settings.defaultWallMetric);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState("2026-10");
  const [start, setStart] = useState("2026-09-22");
  const [end, setEnd] = useState("2026-10-07");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<{
    day: ContributionDay;
    x: number;
    y: number;
  } | null>(null);
  const range = useMemo(() => rangeFor(mode, year, month, start, end, dataset.timezone), [mode, year, month, start, end, dataset.timezone]);
  const wall = useMemo(() => buildWall(dataset, activeContactId, range), [dataset, activeContactId, range]);
  const rangeEvents = useMemo(() => filterEvents(dataset, activeContactId, range.startDate, range.endDate), [dataset, activeContactId, range]);
  const summary = useMemo(() => summarize(rangeEvents), [rangeEvents]);
  const selectedEvents = selectedDate ? filterEvents(dataset, activeContactId, selectedDate, selectedDate) : [];
  const max = Math.max(1, ...wall.days.map((day) => metric === "duration" ? day.durationSeconds : day.callCount));
  const lead = (parseDate(range.startDate).getDay() + 6) % 7;
  const weekColumns = Math.max(1, Math.ceil((lead + wall.days.length) / 7));
  const calendarColumns = mode === "year"
    ? `repeat(${weekColumns}, var(--wall-cell, 14px))`
    : `repeat(${weekColumns}, minmax(0, 1fr))`;
  const monthStarts: Array<{ date: string; column: number }> = [];
  let previousMonth = "";
  wall.days.forEach((day, index) => {
    const currentMonth = day.date.slice(0, 7);
    if (currentMonth !== previousMonth) {
      monthStarts.push({ date: day.date, column: Math.floor((lead + index) / 7) + 1 });
      previousMonth = currentMonth;
    }
  });
  const completeDays = wall.days.filter((day) => day.coverage === "complete").length;
  const bestDay = wall.days.reduce<ContributionDay | null>((winner, day) => !winner || day.durationSeconds > winner.durationSeconds ? day : winner, null);
  const title = mode === "year" ? `${year} 年` : mode === "month" ? `${Number(month.slice(0,4))} 年 ${Number(month.slice(5))} 月` : `${formatDate(start)} — ${formatDate(end)}`;

  const changeMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(y, m - 1 + delta, 1);
    setMonth(`${next.getFullYear()}-${pad(next.getMonth() + 1)}`);
  };

  const showDayTooltip = (day: ContributionDay, element: HTMLElement) => {
    if (day.callCount === 0) {
      setHoveredDay(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    setHoveredDay({
      day,
      x: Math.max(110, Math.min(window.innerWidth - 110, rect.left + rect.width / 2)),
      y: Math.max(95, rect.top - 10)
    });
  };

  return (
    <section className="view active">
      <header className="wall-header">
        <div className="wall-title"><span className="page-orb orb-wall">📅</span><div><h1>通话日历</h1></div></div>
        <div className="range-switch">{(["year","month","custom"] as WallMode[]).map((value) => <button key={value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{value === "year" ? "一年" : value === "month" ? "一个月" : "自定义"}</button>)}</div>
      </header>

      <section className="wall-controls soft-panel">
        {mode === "year" && <div className="wall-control active"><button className="period-arrow" disabled={year <= 2025} onClick={() => setYear((value) => value - 1)}>‹</button><label><span>年份</span><select value={year} onChange={(event) => setYear(Number(event.target.value))}><option value={2025}>2025 年</option><option value={2026}>2026 年</option></select></label><button className="period-arrow" disabled={year >= 2026} onClick={() => setYear((value) => value + 1)}>›</button></div>}
        {mode === "month" && <div className="wall-control active"><button className="period-arrow" onClick={() => changeMonth(-1)}>‹</button><label><span>月份</span><input type="month" value={month} min="2025-01" max="2026-12" onChange={(event) => setMonth(event.target.value)} /></label><button className="period-arrow" onClick={() => changeMonth(1)}>›</button></div>}
        {mode === "custom" && <div className="wall-control custom-control active"><label><span>开始</span><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><i>—</i><label><span>结束</span><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>}
        <div className="wall-metric-toggle"><button className={metric === "duration" ? "active" : ""} onClick={() => setMetric("duration")}>按时长</button><button className={metric === "count" ? "active" : ""} onClick={() => setMetric("count")}>按次数</button></div>
        <ContactSwitcher />
      </section>

      <section className="wall-summary">
        <article className="wall-stat"><b>📅</b><small>有记录的日期</small><strong>{summary.activeDayCount} 天</strong><span>{completeDays} 天有完整覆盖</span></article>
        <article className="wall-stat"><b>📞</b><small>通话记录</small><strong>{summary.attemptedCount} 次</strong><span>{summary.connectedCount} 次接通</span></article>
        <article className="wall-stat"><b>⏱️</b><small>接通总时长</small><strong>{formatCompactDuration(summary.totalDurationSeconds)}</strong><span>按接通时长累计</span></article>
        <article className="wall-stat"><b>🏆</b><small>接通时长最长日期</small><strong>{bestDay?.callCount ? formatDate(bestDay.date) : "还没有"}</strong><span>{bestDay?.callCount ? formatDuration(bestDay.durationSeconds) : "暂无通话记录"}</span></article>
      </section>

      <section className={`contribution-card mode-${mode}`}>
        <div className="contribution-topline"><div><h2>{title}</h2><p>{wall.quality.overallState === "partial" ? "虚线格表示该日期没有可读取的数据覆盖" : "颜色深度表示当日接通时长"}</p></div><div className="wall-legend"><span>少</span>{[0,1,2,3,4].map((level) => <i key={level} data-level={level} />)}<span>多</span></div></div>
        <div className="wall-scroll"><div className="wall-months" style={{ gridTemplateColumns: calendarColumns }}>{monthStarts.map((item) => <span className="wall-month-label" key={item.date} style={{ gridColumn: `${item.column}/span 3` }}>{Number(item.date.slice(5,7))}月</span>)}</div><div className="wall-grid-wrap"><div className="wall-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div className="contribution-grid" style={{ gridTemplateColumns: calendarColumns }}>{Array.from({ length: lead }, (_, index) => <span className="wall-cell blank" key={`blank-${index}`} />)}{wall.days.map((day) => <button key={day.date} className={`wall-cell ${day.coverage}${day.callCount > 0 ? " has-record" : ""}`} data-level={contributionLevel(day, metric, max)} aria-label={`${formatDate(day.date)}，${day.callCount} 条通话记录，共 ${formatDuration(day.durationSeconds)}`} disabled={day.callCount === 0} onMouseEnter={(event) => showDayTooltip(day, event.currentTarget)} onMouseLeave={() => setHoveredDay(null)} onFocus={(event) => showDayTooltip(day, event.currentTarget)} onBlur={() => setHoveredDay(null)} onClick={() => day.callCount > 0 && setSelectedDate(day.date)} />)}</div></div></div>
        <div className="wall-footnote"><span><b /> 有通话记录</span><span>点击日期查看详情</span><span className={wall.quality.overallState === "partial" ? "quality-pill warning" : "quality-pill"}>{wall.quality.overallState === "partial" ? "部分数据" : "数据完整"}</span></div>
      </section>

      {hoveredDay && hoveredDay.day.callCount > 0 && (
        <div
          className="wall-hover-card"
          role="tooltip"
          style={{ left: hoveredDay.x, top: hoveredDay.y }}
        >
          <strong>{formatDate(hoveredDay.day.date)}</strong>
          <span>{formatDuration(hoveredDay.day.durationSeconds)}</span>
          <small>{hoveredDay.day.callCount} 条记录 · {hoveredDay.day.connectedCount} 次接通</small>
        </div>
      )}

      {selectedDate && selectedEvents.length > 0 && <section className="day-preview soft-panel"><button className="day-preview-close" onClick={() => setSelectedDate(null)}>×</button><div><span className="date-line">{formatDate(selectedDate)}</span><h2>这一天有 {selectedEvents.length} 条记录</h2><p>共计 {formatDuration(selectedEvents.reduce((sum,event) => sum + (event.connectedDurationSeconds ?? 0),0))}</p></div><div className="day-preview-actions">{selectedEvents.slice(0,3).map((event) => <button key={event.id} onClick={() => openEvent(event)}>{event.mediaType === "video" ? "📹" : "🎙️"} {formatDuration(event.connectedDurationSeconds)}</button>)}<button onClick={() => navigate("calls")}>查看全部 →</button></div></section>}

    </section>
  );
}
