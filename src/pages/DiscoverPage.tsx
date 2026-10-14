import { useMemo } from "react";
import { buildInsights, filterEvents } from "@/data/analytics";
import { useApp } from "@/state/AppContext";

export function DiscoverPage() {
  const { dataset, activeContactId } = useApp();
  const events = useMemo(() => filterEvents(dataset, activeContactId), [dataset, activeContactId]);
  const insights = useMemo(() => buildInsights(events), [events]);
  const [night, duration, weekday] = insights;

  if (events.length < 3) {
    return <section className="view active"><header className="simple-header"><span className="page-orb orb-lavender">💡</span><div><h1>小发现</h1><p>有 3 条通话记录后，这里会出现一些小发现。</p></div></header></section>;
  }

  return (
    <section className="view active">
      <header className="simple-header"><span className="page-orb orb-lavender">💡</span><div><h1>关于你们的小发现</h1><p>从已有通话记录中整理而来。</p></div></header>
      <div className="discovery-grid">
        <article className="discovery-card night-card"><span className="discovery-tag">{night?.eyebrow}</span><h2>夜晚，是通话更常<br />开始的时候</h2><p>{night?.description}</p><div className="night-sky"><i /><i /><i /><div className="skyline" /><span className="sky-moon">🌙</span></div></article>
        <article className="discovery-card donut-card"><span className="discovery-tag mint-tag">{duration?.eyebrow}</span><h2>超过 30 分钟<br />的通话</h2><div className="donut" style={{ background: `conic-gradient(#68b99e 0 ${events.length ? Number(duration?.value ?? 0) / events.length * 100 : 0}%, rgba(255,255,255,.72) 0)` }}><div><strong>{duration?.value}</strong><span>次</span></div></div><p>{duration?.description}</p></article>
        <article className="discovery-card week-card"><span className="discovery-tag peach-tag">{weekday?.eyebrow}</span><h2>{weekday?.title}</h2><p>{weekday?.description}</p><div className="weekday-bubbles">{[3,8,4,6,5,2,1].map((value,index) => <div className={`weekday ${index === 1 ? "active" : ""}`} key={index}><i style={{ height: value * 9 + 15 }} /><small>{["一","二","三","四","五","六","日"][index]}</small></div>)}</div></article>
        <article className="discovery-card streak-card"><span className="discovery-tag blue-tag">连续出现</span><h2>连续 3 天<br />有通话记录</h2><div className="streak-dots"><i /><i /><i /><i className="off" /><i className="off" /></div></article>
      </div>
    </section>
  );
}
