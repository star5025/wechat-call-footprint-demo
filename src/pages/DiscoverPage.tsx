import { useMemo } from "react";
import { filterEvents, isConnected } from "@/data/analytics";
import { MonthlyCallsChart } from "@/components/MonthlyCallsChart";
import { durationDistribution } from "@/data/durationDistribution";
import { longestConnectedStreak } from "@/data/contactSummary";
import { useApp } from "@/state/AppContext";

export function DiscoverPage() {
  const { dataset, activeContactId } = useApp();
  const events = useMemo(() => filterEvents(dataset, activeContactId), [dataset, activeContactId]);
  const connectedEvents = useMemo(() => events.filter(isConnected), [events]);
  const distribution = useMemo(() => durationDistribution(events), [events]);
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
        <MonthlyCallsChart dataset={dataset} contactId={activeContactId} />
        <article className="discovery-card week-card duration-distribution"><span className="discovery-tag peach-tag">通话时长分布</span><h2>{distribution.leaders.length === 1 ? `${distribution.leaders[0].label}最多` : distribution.total ? "多个时长区间并列" : "暂无明确时长"}</h2><p>{distribution.total ? `共 ${distribution.total} 次时长明确的已接通通话${distribution.leaders.length > 1 ? `，并列区间各 ${distribution.max} 次` : `，最多的区间占 ${Math.round(distribution.max / distribution.total * 100)}%`}。` : "有明确接通时长后可查看分布。"}</p><div className="duration-distribution-rows">{distribution.buckets.map((bucket) => <div className="duration-distribution-row" key={bucket.label} aria-label={`${bucket.label}，${bucket.count} 次，占 ${bucket.percent}%`}><span>{bucket.label}</span><span className="duration-distribution-track" aria-hidden="true"><i style={{ width: `${distribution.max ? bucket.count / distribution.max * 100 : 0}%` }} /></span><strong>{bucket.count} 次</strong><small>{bucket.percent}%</small></div>)}</div><small>区间：少于 5 分钟、5 至不足 15 分钟、15 至 30 分钟、超过 30 分钟。</small></article>
        <article className="discovery-card streak-card"><span className="discovery-tag blue-tag">最长连续</span><h2>连续 {streak} 天<br />有接通记录</h2><div className="streak-dots" aria-hidden="true">{Array.from({ length: streakDotCount }, (_, index) => <i key={index} className={index < streak ? "" : "off"} />)}</div></article>
      </div>
    </section>
  );
}
