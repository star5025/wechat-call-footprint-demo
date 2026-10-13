import { useMemo } from "react";
import { buildInsights, filterEvents } from "@/data/analytics";
import { useApp } from "@/state/AppContext";

export function DiscoverPage() {
  const { dataset, activeContactId, navigate } = useApp();
  const events = useMemo(() => filterEvents(dataset, activeContactId), [dataset, activeContactId]);
  const insights = useMemo(() => buildInsights(events), [events]);
  const [night, duration, weekday] = insights;

  if (events.length < 3) {
    return <section className="view active"><header className="simple-header"><span className="page-orb orb-lavender">✦</span><div><h1>小发现还在积累</h1><p>至少需要 3 条通话记录，才会展示描述性规律。</p></div></header><article className="gentle-note"><span>🌱</span><div><strong>先保留诚实的空白</strong><p>样本不足时，我们不会用少量记录推断规律。</p></div></article></section>;
  }

  return (
    <section className="view active">
      <header className="simple-header"><span className="page-orb orb-lavender">✦</span><div><h1>关于你们的小发现</h1><p>只描述通话记录，不猜测感情和原因。</p></div></header>
      <div className="discovery-grid">
        <article className="discovery-card night-card" onClick={() => navigate("calls")}><span className="discovery-tag">{night?.eyebrow}</span><h2>夜晚，是通话最常<br />开始的时候</h2><p>{night?.description}</p><div className="night-sky"><i /><i /><i /><div className="skyline" /><span className="sky-moon">☾</span></div></article>
        <article className="discovery-card donut-card" onClick={() => navigate("calls")}><span className="discovery-tag mint-tag">{duration?.eyebrow}</span><h2>大多数通话<br />超过 30 分钟</h2><div className="donut" style={{ background: `conic-gradient(#68b99e 0 ${events.length ? Number(duration?.value ?? 0) / events.length * 100 : 0}%, rgba(255,255,255,.72) 0)` }}><div><strong>{duration?.value}</strong><span>次</span></div></div><p>{duration?.description}</p></article>
        <article className="discovery-card week-card" onClick={() => navigate("wall")}><span className="discovery-tag peach-tag">{weekday?.eyebrow}</span><h2>{weekday?.title}</h2><p>{weekday?.description}</p><div className="weekday-bubbles">{[3,8,4,6,5,2,1].map((value,index) => <div className={`weekday ${index === 1 ? "active" : ""}`} key={index}><i style={{ height: value * 9 + 15 }} /><small>{["一","二","三","四","五","六","日"][index]}</small></div>)}</div></article>
        <article className="discovery-card streak-card" onClick={() => navigate("wall")}><span className="discovery-tag blue-tag">连续出现</span><h2>有 3 天<br />连续留下通话记录</h2><p>这里说的只是记录连续出现，不代表关系状态。</p><div className="streak-dots"><i /><i /><i /><i className="off" /><i className="off" /></div></article>
      </div>
      <article className="gentle-note"><span>🌿</span><div><strong>这些只是小发现</strong><p>通话长短和频率有很多现实原因。这个工具只帮你回看记录，不评价任何一段关系。</p></div></article>
    </section>
  );
}
