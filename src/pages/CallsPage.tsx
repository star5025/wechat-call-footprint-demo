import { useMemo, useState } from "react";
import type { CallEvent } from "@contracts/models";
import { filterEvents } from "@/data/analytics";
import type { CallFilterMode } from "@/domain";
import { useApp } from "@/state/AppContext";
import { directionLabel, formatDate, formatDuration, formatTime, mediaLabel, outcomeLabel } from "@/utils/format";

export function CallsPage() {
  const { dataset, activeContactId, settings, openEvent } = useApp();
  const [filter, setFilter] = useState<CallFilterMode>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const events = useMemo(() => filterEvents(dataset, activeContactId), [dataset, activeContactId]);
  const filtered = useMemo(() => events.filter((event) => {
    if (filter === "video" && event.mediaType !== "video") return false;
    if (filter === "voice" && event.mediaType !== "voice") return false;
    if (filter === "missed" && (event.connectedDurationSeconds ?? 0) > 0) return false;
    const haystack = `${event.startedAt ?? ""} ${outcomeLabel(event.outcome)} ${event.contactSnapshot.displayName ?? ""}`;
    return !search || haystack.toLowerCase().includes(search.toLowerCase());
  }), [events, filter, search]);
  const grouped = filtered.reduce<Record<string, CallEvent[]>>((result, event) => {
    const date = event.startedAt?.slice(0, 10) ?? "unknown";
    (result[date] ??= []).push(event);
    return result;
  }, {});

  return (
    <section className="view active">
      <header className="calls-header"><div><span className="date-line">{events.length} 条记录</span><h1>每一次通话</h1><p>按时间轻松翻看，点开就能看到详情。</p></div><button className="search-round" aria-label="搜索记录" onClick={() => setSearchOpen(true)}>⌕</button></header>
      {searchOpen && <div className="search-reveal"><span>⌕</span><input autoFocus value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} placeholder="搜索日期、联系人或状态" /><button onClick={() => { setSearchOpen(false); setSearch(""); }}>×</button></div>}
      <div className="bubble-filters">{(["all","video","voice","missed"] as CallFilterMode[]).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "全部" : value === "video" ? "📹 视频" : value === "voice" ? "🎙 语音" : "未接通"}</button>)}</div>
      <div className="call-feed">
        {!filtered.length && <article className="gentle-note"><span>☁</span><div><strong>没有找到记录</strong><p>换一个筛选条件或搜索词试试看。</p></div></article>}
        {Object.entries(grouped).map(([date, items]) => (
          <section className="feed-day" key={date}>
            <h3>{date === "unknown" ? "时间未知" : formatDate(date)} · {items.length} 次</h3>
            {items.map((event) => {
              const connected = (event.connectedDurationSeconds ?? 0) > 0;
              const displayName = settings.privacyMode ? "重要的人" : event.contactSnapshot.displayName ?? "未知联系人";
              return <button className="feed-card" key={event.id} onClick={() => openEvent(event)}><span className={`feed-icon ${connected ? event.mediaType : "missed"}`}>{connected ? event.mediaType === "video" ? "▻" : "◖" : "×"}</span><span className="feed-main"><strong>和{displayName}的{mediaLabel(event.mediaType)}</strong><small>{directionLabel(event.direction)} · {outcomeLabel(event.outcome)}{event.qualityFlags.length ? " · 需留意" : ""}</small></span><span className="feed-time"><strong>{connected ? formatDuration(event.connectedDurationSeconds) : outcomeLabel(event.outcome)}</strong><small>{formatTime(event.startedAt)}</small></span></button>;
            })}
          </section>
        ))}
      </div>
    </section>
  );
}
