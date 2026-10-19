import { useMemo } from "react";
import { buildInsights, filterEvents, isConnected, localDate } from "@/data/analytics";
import { longestConnectedStreak } from "@/data/contactSummary";
import { useApp } from "@/state/AppContext";

export function DiscoverPage() {
  const { dataset, activeContactId } = useApp();
  const events = useMemo(() => filterEvents(dataset, activeContactId), [dataset, activeContactId]);
  const connectedEvents = useMemo(() => events.filter(isConnected), [events]);
  const insights = useMemo(() => buildInsights(connectedEvents), [connectedEvents]);
  const [, duration] = insights;
  const weekdayCounts = useMemo(() => {
    const counts = new Array<number>(7).fill(0);
    for (const event of connectedEvents) {
      const date = localDate(event.startedAt);
      if (!date) continue;
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (!Number.isNaN(weekday)) counts[(weekday + 6) % 7] += 1;
    }
    return counts;
  }, [connectedEvents]);
  const weekdayNames = ["一", "二", "三", "四", "五", "六", "日"];
  const maxWeekdayCount = Math.max(...weekdayCounts);
  const busiestWeekdays = weekdayNames.filter((_, index) => maxWeekdayCount > 0 && weekdayCounts[index] === maxWeekdayCount);
  const nightCount = connectedEvents.filter((event) => {
    if (!event.startedAt) return false;
    const hour = Number(event.startedAt.slice(11, 13));
    return hour >= 20 || hour < 2;
  }).length;
  const streak = useMemo(() => longestConnectedStreak(events), [events]);
  const streakDotCount = Math.min(7, Math.max(5, streak));

  if (connectedEvents.length < 3) {
    return <section className="view active"><header className="simple-header"><span className="page-orb orb-lavender">💡</span><div><h1>小发现</h1><p>接通 3 次后解锁</p></div></header></section>;
  }

  return (
    <section className="view active">
      <header className="simple-header"><span className="page-orb orb-lavender">💡</span><div><h1>关于你们的小发现</h1></div></header>
      <div className="discovery-grid">
        <article className="discovery-card night-card"><span className="discovery-tag">通话时刻</span><h2>夜间通话</h2><p>{nightCount} 次已接通通话在晚上 8 点至次日凌晨 2 点之间开始。</p><div className="night-sky"><i /><i /><i /><div className="skyline" /><span className="sky-moon">🌙</span></div></article>
        <article className="discovery-card donut-card"><span className="discovery-tag mint-tag">{duration?.eyebrow}</span><h2>超过 30 分钟<br />的通话</h2><div className="donut" style={{ background: `conic-gradient(#68b99e 0 ${connectedEvents.length ? Number(duration?.value ?? 0) / connectedEvents.length * 100 : 0}%, var(--donut-track, rgba(255,255,255,.72)) 0)` }}><div><strong>{duration?.value}</strong><span>次</span></div></div><p>{duration?.description}</p></article>
        <article className="discovery-card week-card"><span className="discovery-tag peach-tag">最常出现</span><h2>{busiestWeekdays.length ? busiestWeekdays.map((name) => `星期${name}`).join("、") : "暂无日期"}</h2><p>{maxWeekdayCount ? `${busiestWeekdays.length > 1 ? "这些天并列最多，各" : "这一天的已接通记录最多，共"} ${maxWeekdayCount} 次。` : "暂无可统计的接通日期。"}</p><div className="weekday-bubbles">{weekdayCounts.map((value, index) => <div className={`weekday ${maxWeekdayCount > 0 && value === maxWeekdayCount ? "active" : ""}`} key={index} aria-label={`星期${weekdayNames[index]}，接通 ${value} 次`}><i style={{ height: maxWeekdayCount ? value / maxWeekdayCount * 72 + 15 : 15 }} /><small>{weekdayNames[index]}</small></div>)}</div></article>
        <article className="discovery-card streak-card"><span className="discovery-tag blue-tag">最长连续</span><h2>连续 {streak} 天<br />有接通记录</h2><div className="streak-dots" aria-hidden="true">{Array.from({ length: streakDotCount }, (_, index) => <i key={index} className={index < streak ? "" : "off"} />)}</div></article>
      </div>
    </section>
  );
}
