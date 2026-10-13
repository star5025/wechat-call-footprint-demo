import { useMemo, useState } from "react";
import { ContactSwitcher } from "@/components/ContactSwitcher";
import { buildInsights, buildWall, filterEvents, summarize } from "@/data/analytics";
import { useApp } from "@/state/AppContext";
import { formatCompactDuration, formatDate, formatDuration, formatTime, mediaLabel, outcomeLabel } from "@/utils/format";

export function HomePage() {
  const { dataset, activeContactId, navigate, openEvent, settings, chooseImport } = useApp();
  const [metric, setMetric] = useState<"duration" | "count">("duration");
  const events = useMemo(() => filterEvents(dataset, activeContactId), [dataset, activeContactId]);
  const summary = useMemo(() => summarize(events), [events]);
  const recentStart = events.at(-1)?.startedAt?.slice(0, 10) ?? "2026-01-01";
  const recentEnd = events[0]?.startedAt?.slice(0, 10) ?? recentStart;
  const wall = useMemo(() => buildWall(dataset, activeContactId, { startDate: recentStart, endDate: recentEnd, timezone: dataset.timezone }), [dataset, activeContactId, recentStart, recentEnd]);
  const activeDays = wall.days.filter((day) => day.callCount > 0);
  const max = Math.max(1, ...activeDays.map((day) => metric === "duration" ? day.durationSeconds : day.callCount));
  const insights = buildInsights(events);
  const longest = events.find((event) => event.id === summary.longestEventId) ?? null;
  const latest = events[0] ?? null;
  const contact = dataset.contacts.find((item) => item.id === activeContactId) ?? dataset.contacts[0];
  const contactName = settings.privacyMode ? "重要的人" : contact?.displayName ?? "联系人";
  const hours = Math.floor(summary.totalDurationSeconds / 3600);
  const minutes = Math.floor((summary.totalDurationSeconds % 3600) / 60);
  const videoCount = events.filter((event) => event.mediaType === "video" && (event.connectedDurationSeconds ?? 0) > 0).length;
  const voiceCount = events.filter((event) => event.mediaType === "voice" && (event.connectedDurationSeconds ?? 0) > 0).length;

  return (
    <section className="view active">
      <header className="welcome">
        <div><span className="date-line">本地时光 · {dataset.source.displayName}</span><h1>下午好 <span className="wave">👋</span></h1><p>来看看你和重要的人，留下了哪些通话时光。</p></div>
        <ContactSwitcher />
      </header>

      {!events.length ? (
        <section className="empty-state-card">
          <span className="empty-art">☁</span><h2>还没有可以展示的通话</h2><p>导入一份通话足迹 JSON，或者切回示例数据体验完整界面。</p><button className="primary-action" onClick={() => void chooseImport()}>选择数据文件</button>
        </section>
      ) : (
        <>
          <section className="memory-hero">
            <div className="hero-glow glow-a" /><div className="hero-glow glow-b" />
            <div className="hero-copy"><span className="soft-label">你们的通话时光</span><div className="big-number"><strong>{hours}</strong><span>小时</span><strong>{minutes}</strong><span>分</span></div><p>{formatDate(recentStart)}到 {formatDate(recentEnd)}</p><button className="hero-button" onClick={() => navigate("calls")}>看看每一次 <span>→</span></button></div>
            <div className="connection-art" aria-hidden="true"><div className="person person-me"><span>我</span></div><div className="sound-path">{[18,34,50,28,62,42,24,48,30].map((height, index) => <i key={index} style={{ "--h": `${height}px` } as React.CSSProperties} />)}</div><div className="person person-you"><span>{settings.privacyMode ? "♡" : contact?.displayName.slice(0, 1)}</span></div><div className="float-note note-one">♡</div><div className="float-note note-two">✦</div></div>
            <div className="hero-chips"><span>📹 视频 {videoCount} 次</span><span>🎙 语音 {voiceCount} 次</span><span>✨ 共接通 {summary.connectedCount} 次</span></div>
          </section>

          <section className="quick-stories">
            <article className="story-card story-purple" onClick={() => longest && openEvent(longest)}><div className="story-icon moon-icon"><span>☾</span></div><div><small>最长的一次</small><strong>{formatDuration(summary.longestDurationSeconds)}</strong><p>轻点查看这次通话</p></div><button aria-label="查看最长通话">↗</button></article>
            <article className="story-card story-peach" onClick={() => navigate("discover")}><div className="story-icon clock-icon"><span>9</span><i /></div><div><small>常见时刻</small><strong>晚上 9 点</strong><p>{insights[0]?.description}</p></div><button aria-label="查看时间规律">↗</button></article>
            <article className="story-card story-mint" onClick={() => navigate("calls")}><div className="story-icon ring-icon"><span>{summary.connectedCount}</span></div><div><small>已经接通</small><strong>{summary.connectedCount} 次</strong><p>平均每次 {formatCompactDuration(Math.round(summary.meanDurationSeconds ?? 0))}</p></div><button aria-label="查看接通记录">↗</button></article>
          </section>

          <section className="soft-panel rhythm-panel">
            <div className="section-heading"><div><span className="section-emoji">〰</span><div><h2>最近的通话时光</h2><p>每根柱子，都是一天的声音</p></div></div><div className="soft-tabs"><button className={metric === "duration" ? "active" : ""} onClick={() => setMetric("duration")}>时长</button><button className={metric === "count" ? "active" : ""} onClick={() => setMetric("count")}>次数</button></div></div>
            <div className="soft-chart">{activeDays.map((day) => { const value = metric === "duration" ? day.durationSeconds : day.callCount; return <button className="soft-column" key={day.date} title={`${formatDate(day.date)} · ${day.callCount} 次 · ${formatDuration(day.durationSeconds)}`} onClick={() => navigate("wall")}><span className="bar-wrap"><i className="bar" style={{ height: `${Math.max(7, value / max * 100)}%` }} /></span><small>{Number(day.date.slice(8))}日</small></button>; })}</div>
            <div className="chart-pop">轻点柱子进入时光墙</div>
          </section>

          <section className="bottom-row">
            <article className="soft-panel latest-panel"><div className="section-heading compact"><div><span className="section-emoji coral">↗</span><div><h2>最近一次</h2><p>{latest?.startedAt ? `${formatDate(latest.startedAt.slice(0,10))} · ${formatTime(latest.startedAt)}` : "暂无"}</p></div></div><button className="link-btn" onClick={() => navigate("calls")}>全部记录</button></div>{latest && <button className="latest-call" onClick={() => openEvent(latest)}><span className={`call-bubble ${latest.mediaType}`}>{latest.mediaType === "video" ? "▻" : "◖"}</span><span className="latest-main"><strong>和{contactName}的{mediaLabel(latest.mediaType)}</strong><small>{outcomeLabel(latest.outcome)}</small></span><span className="latest-time"><strong>{formatDuration(latest.connectedDurationSeconds)}</strong><small>查看详情 →</small></span></button>}</article>
            <article className="soft-panel tiny-calendar-panel"><div className="section-heading compact"><div><span className="section-emoji yellow">☀</span><div><h2>有声音的日子</h2><p>{formatDate(recentStart)} — {formatDate(recentEnd)}</p></div></div><button className="link-btn" onClick={() => navigate("wall")}>打开时光墙</button></div><div className="tiny-calendar">{wall.days.slice(-9).map((day) => <div className={`tiny-day ${day.callCount ? "active" : ""}`} key={day.date}><span>{Number(day.date.slice(8))}</span><small>{day.callCount ? `${day.callCount}次` : "·"}</small></div>)}</div></article>
          </section>
        </>
      )}
    </section>
  );
}
