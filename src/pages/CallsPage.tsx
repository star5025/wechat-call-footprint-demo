import { useMemo, useState } from "react";
import type { CallEvent } from "@contracts/models";
import { filterEvents } from "@/data/analytics";
import {
  applyCallRecordFilters,
  type CallsDurationRange,
  type CallsSortOrder,
  type CallsTimeRange
} from "@/data/recordFilters";
import { useApp } from "@/state/AppContext";
import { directionLabel, formatDate, formatDuration, formatTime, mediaLabel, outcomeLabel } from "@/utils/format";

export function CallsPage() {
  const { dataset, activeContactId, callsDateFilter, clearCallsDateFilter, openEvent } = useApp();
  const [timeRange, setTimeRange] = useState<CallsTimeRange>("all");
  const [durationRange, setDurationRange] = useState<CallsDurationRange>("all");
  const [sortOrder, setSortOrder] = useState<CallsSortOrder>("newest");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const allEvents = useMemo(() => filterEvents(dataset, activeContactId), [dataset, activeContactId]);
  const [customStart, setCustomStart] = useState(allEvents.at(-1)?.startedAt?.slice(0, 10) ?? "");
  const [customEnd, setCustomEnd] = useState(allEvents[0]?.startedAt?.slice(0, 10) ?? "");

  const filtered = useMemo(() => {
    const dayEvents = callsDateFilter
      ? filterEvents(dataset, activeContactId, callsDateFilter, callsDateFilter)
      : allEvents;
    const ranged = applyCallRecordFilters(dayEvents, {
      timeRange: callsDateFilter ? "all" : timeRange,
      durationRange,
      sortOrder,
      customStart,
      customEnd
    });
    return ranged.filter((event) => {
      const haystack = `${event.startedAt ?? ""} ${outcomeLabel(event.outcome)} ${event.contactSnapshot.displayName ?? ""}`;
      return !search || haystack.toLowerCase().includes(search.toLowerCase());
    });
  }, [activeContactId, allEvents, callsDateFilter, customEnd, customStart, dataset, durationRange, search, sortOrder, timeRange]);

  const groups = useMemo(() => {
    if (sortOrder !== "newest") {
      return [{ key: "duration", title: `${sortOrder === "durationDesc" ? "通话时长从多到少" : "通话时长从少到多"} · ${filtered.length} 次`, items: filtered }];
    }
    const grouped = filtered.reduce<Record<string, CallEvent[]>>((result, event) => {
      const date = event.startedAt?.slice(0, 10) ?? "unknown";
      (result[date] ??= []).push(event);
      return result;
    }, {});
    return Object.entries(grouped).map(([date, items]) => ({
      key: date,
      title: `${date === "unknown" ? "时间未知" : formatDate(date)} · ${items.length} 次`,
      items
    }));
  }, [filtered, sortOrder]);

  return (
    <section className="view active">
      <header className="calls-header"><div><span className="date-line">{filtered.length} 条记录</span><h1>通话记录</h1></div><button className="search-round" aria-label="搜索记录" onClick={() => setSearchOpen(true)}>🔍</button></header>
      {searchOpen && <div className="search-reveal"><span>🔍</span><input autoFocus value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} placeholder="搜索日期、联系人或状态" /><button onClick={() => { setSearchOpen(false); setSearch(""); }}>×</button></div>}

      <section className="record-filter-panel" aria-label="通话记录筛选">
        <label><span>时间范围</span><select disabled={Boolean(callsDateFilter)} value={callsDateFilter ? "day" : timeRange} onChange={(event) => setTimeRange(event.target.value as CallsTimeRange)}>{callsDateFilter && <option value="day">当天</option>}<option value="all">全部时间</option><option value="last7">最近 7 天</option><option value="last30">最近 30 天</option><option value="custom">自定义</option></select></label>
        <label><span>通话时长</span><select value={durationRange} onChange={(event) => setDurationRange(event.target.value as CallsDurationRange)}><option value="all">全部时长</option><option value="under5">5 分钟以内</option><option value="from5to30">5–30 分钟</option><option value="over30">30 分钟以上</option></select></label>
        <label><span>排序方式</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as CallsSortOrder)}><option value="newest">最新通话优先</option><option value="durationDesc">时长从多到少</option><option value="durationAsc">时长从少到多</option></select></label>
        {callsDateFilter && <button className="date-filter-chip" onClick={clearCallsDateFilter}><span>📅 {formatDate(callsDateFilter)}</span><b>×</b></button>}
      </section>
      {!callsDateFilter && timeRange === "custom" && <div className="calls-custom-range"><label><span>开始日期</span><input type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} /></label><i>—</i><label><span>结束日期</span><input type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}

      <div className="call-feed">
        {!filtered.length && <article className="gentle-note"><span>📭</span><div><strong>没有匹配的记录</strong></div></article>}
        {groups.map((group) => (
          <section className="feed-day" key={group.key}>
            <h3>{group.title}</h3>
            {group.items.map((event) => {
              const connected = (event.connectedDurationSeconds ?? 0) > 0;
              const displayName = event.contactSnapshot.displayName ?? "未知联系人";
              return <button className="feed-card" key={event.id} onClick={() => openEvent(event)}><span className={`feed-icon ${connected ? event.mediaType : "missed"}`}>{connected ? event.mediaType === "video" ? "📹" : "🎙️" : "📵"}</span><span className="feed-main"><strong>和{displayName}的{mediaLabel(event.mediaType)}</strong><small>{directionLabel(event.direction)} · {outcomeLabel(event.outcome)}{event.qualityFlags.length ? " · 需留意" : ""}</small></span><span className="feed-time"><strong>{connected ? formatDuration(event.connectedDurationSeconds) : outcomeLabel(event.outcome)}</strong><small>{formatTime(event.startedAt)}</small></span></button>;
            })}
          </section>
        ))}
      </div>
    </section>
  );
}
