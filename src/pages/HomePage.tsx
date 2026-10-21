import { useEffect, useMemo, useState } from "react";
import { ContactSwitcher } from "@/components/ContactSwitcher";
import { AccountScopeSelect } from "@/components/AccountScopeSelect";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Avatar, ContactAvatar } from "@/components/ContactAvatar";
import { buildWall, filterEvents, isConnected, localDate, summarize } from "@/data/analytics";
import { lastConnected } from "@/data/lastConnected";
import { favoriteCallPeriod } from "@/data/contactSummary";
import { useApp } from "@/state/AppContext";
import { formatCompactDuration, formatDate, formatDuration, formatTime, mediaLabel, outcomeLabel, pad } from "@/utils/format";
import { timeGreeting } from "@/utils/greeting";
import { isPagesDemo } from "@/runtime";

const formatCount = (value: number | null) => String(value ?? 0);
const formatTotalMinutes = (value: number | null) => `${Math.floor((value ?? 0) / 60)}小时 ${(value ?? 0) % 60}分`;
const formatMeanDuration = (value: number | null) => formatCompactDuration(value ?? 0);

const formatChartDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(remaining)}` : `${minutes}:${pad(remaining)}`;
};

export function HomePage() {
  const { dataset, activeContactId, navigate, openCallsForDate, openEvent, chooseImport, scanWechat, wechatScanning, appInfo, settings } = useApp();
  const [metric, setMetric] = useState<"duration" | "count">("duration");
  const [now, setNow] = useState(() => new Date());
  const currentHour = now.getHours();
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const events = useMemo(() => filterEvents(dataset, activeContactId), [dataset, activeContactId]);
  const summary = useMemo(() => summarize(events), [events]);
  const recentStart = events.at(-1)?.startedAt?.slice(0, 10) ?? "2026-01-01";
  const recentEnd = events[0]?.startedAt?.slice(0, 10) ?? recentStart;
  const wall = useMemo(() => buildWall(dataset, activeContactId, { startDate: recentStart, endDate: recentEnd, timezone: dataset.timezone }), [dataset, activeContactId, recentStart, recentEnd]);
  const activeDays = useMemo(() => {
    const days = new Map<string, { date: string; durationSeconds: number; connectedCount: number }>();
    for (const event of events) {
      const date = localDate(event.startedAt);
      if (!date || !isConnected(event)) continue;
      const day = days.get(date) ?? { date, durationSeconds: 0, connectedCount: 0 };
      day.durationSeconds += event.connectedDurationSeconds ?? 0;
      day.connectedCount += 1;
      days.set(date, day);
    }
    return [...days.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-14);
  }, [events]);
  const max = Math.max(1, ...activeDays.map((day) => metric === "duration" ? day.durationSeconds : day.connectedCount));
  const favoritePeriod = useMemo(() => favoriteCallPeriod(events), [events]);
  const lastCall = useMemo(() => lastConnected(events, now, dataset.timezone), [events, now, dataset.timezone]);
  const latest = lastCall.event;
  const contact = dataset.contacts.find((item) => item.id === activeContactId) ?? dataset.contacts[0];
  const contactName = dataset.contacts.find((item) => item.id === latest?.contactId)?.displayName
    ?? latest?.contactSnapshot.displayName ?? "联系人";
  const accountName = dataset.source.kind === "empty"
    ? "微信用户"
    : dataset.account.displayName.trim() || "微信用户";
  const totalMinutes = Math.floor(summary.totalDurationSeconds / 60);
  const videoCount = events.filter((event) => event.mediaType === "video" && (event.connectedDurationSeconds ?? 0) > 0).length;
  const voiceCount = events.filter((event) => event.mediaType === "voice" && (event.connectedDurationSeconds ?? 0) > 0).length;

  return (
    <section className="view active">
      <header className="welcome">
        <div><h1>{timeGreeting(currentHour)}，{accountName}</h1><div className="account-overview-scope"><p>通话概览</p><AccountScopeSelect /></div></div>
        <ContactSwitcher />
      </header>

      {!events.length ? (
        <section className="empty-state-card first-use-card">
          <span className="empty-art">📥</span>
          <span className="soft-label">还没有通话记录</span>
          <h2>添加微信通话记录</h2>
          {!isPagesDemo && <div className="empty-state-actions">
            <button className="primary-action" disabled={wechatScanning || appInfo?.isTauri === false} onClick={() => void scanWechat()}>
              {wechatScanning ? "读取中…" : "读取微信"}
            </button>
            <button className="secondary-action" disabled={wechatScanning} onClick={() => void chooseImport()}>打开文件</button>
          </div>}
        </section>
      ) : (
        <>
          <section className="memory-hero" data-contact-content>
            <div className="hero-glow glow-a" /><div className="hero-glow glow-b" />
            <div className="hero-copy"><span className="soft-label">接通总时长</span><AnimatedNumber className="big-number" value={totalMinutes} format={formatTotalMinutes} reducedMotion={settings.reducedMotion}>{(value) => <><strong>{Math.floor((value ?? 0) / 60)}</strong><span className="duration-unit">小时</span><strong>{(value ?? 0) % 60}</strong><span className="duration-unit">分</span></>}</AnimatedNumber><p>{formatDate(recentStart)}到 {formatDate(recentEnd)}</p><button className="hero-button" onClick={() => navigate("calls")}>查看记录</button></div>
            <div className="connection-art" aria-hidden="true"><div className="person-profile"><Avatar avatarRef={dataset.account.avatarRef} label={dataset.account.displayName} className="person person-me" /><small>{dataset.account.displayName}</small></div><div className="sound-path">{[18,34,50,28,62,42,24,48,30].map((height, index) => <i key={index} style={{ "--h": `${height}px` } as React.CSSProperties} />)}</div>{contact && <div className="person-profile"><ContactAvatar contact={contact} className="person person-you" /><small>{contact.displayName}</small></div>}<div className="float-note note-one">💬</div><div className="float-note note-two">✨</div></div>
            <div className="hero-chips"><span>📹 视频 <AnimatedNumber value={videoCount} format={formatCount} reducedMotion={settings.reducedMotion} /> 次</span><span>🎙 语音 <AnimatedNumber value={voiceCount} format={formatCount} reducedMotion={settings.reducedMotion} /> 次</span><span>✨ 共接通 <AnimatedNumber value={summary.connectedCount} format={formatCount} reducedMotion={settings.reducedMotion} /> 次</span></div>
          </section>

          <section className="quick-stories" data-contact-content>
            <article className="story-card story-purple"><div className="story-icon moon-icon"><span>🌙</span></div><div><small>最长通话</small><strong><AnimatedNumber value={summary.longestDurationSeconds} format={formatDuration} reducedMotion={settings.reducedMotion} /></strong></div></article>
            <article className="story-card story-peach"><div className="story-icon clock-icon"><span>🕘</span></div><div><small>常见开始时段</small><strong>{favoritePeriod?.label ?? "暂无"}</strong>{favoritePeriod && <p>{favoritePeriod.rangeLabel} · <AnimatedNumber value={favoritePeriod.count} format={formatCount} reducedMotion={settings.reducedMotion} /> 次</p>}</div></article>
            <article className="story-card story-mint"><div className="story-icon ring-icon"><span>📞</span></div><div><small>接通次数</small><strong><AnimatedNumber value={summary.connectedCount} format={formatCount} reducedMotion={settings.reducedMotion} /> 次</strong><p>平均每次 <AnimatedNumber value={Math.round(summary.meanDurationSeconds ?? 0)} format={formatMeanDuration} reducedMotion={settings.reducedMotion} /></p></div></article>
          </section>

          <section className="soft-panel rhythm-panel" data-contact-content>
            <div className="section-heading"><div><span className="section-emoji">📊</span><div><h2>近期接通统计</h2></div></div><div className="soft-tabs"><button className={metric === "duration" ? "active" : ""} onClick={() => setMetric("duration")}>时长</button><button className={metric === "count" ? "active" : ""} onClick={() => setMetric("count")}>次数</button></div></div>
            <div className="soft-chart">{activeDays.map((day, index) => { const value = metric === "duration" ? day.durationSeconds : day.connectedCount; const metricValue = metric === "duration" ? formatChartDuration(day.durationSeconds) : String(day.connectedCount); return <button className="soft-column" key={index} aria-label={`${formatDate(day.date)}，${metric === "duration" ? `接通时长 ${metricValue}` : `通话 ${metricValue} 次`}`} onClick={() => openCallsForDate(day.date)}><span className="bar-wrap"><i className="bar" style={{ height: `${Math.max(7, value / max * 100)}%` }}><span className="soft-column-tip">{metricValue}</span></i></span><small>{Number(day.date.slice(8))}日</small></button>; })}</div>
          </section>

          <section className="bottom-row" data-contact-content>
            <article className="soft-panel latest-panel"><div className="section-heading compact"><div><span className="section-emoji coral">🕘</span><div><h2>距离上次接通</h2><p>以已保存记录为准</p></div></div><button className="link-btn" onClick={() => navigate("calls")}>全部记录</button></div><div className="last-connected-gap">{lastCall.label}</div>{latest?.startedAt && <p className="last-connected-date">{latest.startedAt.slice(0, 4)} 年 {formatDate(latest.startedAt.slice(0, 10))} · {formatTime(latest.startedAt)}</p>}{latest && <button className="latest-call" onClick={() => openEvent(latest)}><span className={`call-bubble ${latest.mediaType}`}>{latest.mediaType === "video" ? "📹" : "🎙️"}</span><span className="latest-main"><strong>和{contactName}的{mediaLabel(latest.mediaType)}</strong><small>{outcomeLabel(latest.outcome)}</small></span><span className="latest-time"><strong>{formatDuration(latest.connectedDurationSeconds)}</strong><small>查看详情</small></span></button>}</article>
            <article className="soft-panel tiny-calendar-panel"><div className="section-heading compact"><div><span className="section-emoji yellow">📅</span><div><h2>有记录的日期</h2><p>{formatDate(recentStart)} — {formatDate(recentEnd)}</p></div></div><button className="link-btn" onClick={() => navigate("wall")}>查看日历</button></div><div className="tiny-calendar">{wall.days.slice(-9).map((day) => <div className={`tiny-day ${day.connectedCount ? "active" : ""}`} key={day.date}><span>{Number(day.date.slice(8))}</span><small>{day.connectedCount ? `${day.connectedCount}次` : "·"}</small></div>)}</div></article>
          </section>
        </>
      )}
    </section>
  );
}
