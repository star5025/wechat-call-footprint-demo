import { useEffect, useMemo, useState } from "react";
import { ContactAvatar } from "@/components/ContactAvatar";
import { rankContactsByDuration } from "@/data/rankings";
import { useApp } from "@/state/AppContext";
import { formatCompactDuration } from "@/utils/format";

const medals = ["🥇", "🥈", "🥉"];
const formatRankDuration = (seconds: number) =>
  seconds < 60 ? `${seconds} 秒` : formatCompactDuration(seconds);

export function RankingPage() {
  const { dataset, activeContactId, selectContact, navigate } = useApp();
  const [pendingContactId, setPendingContactId] = useState<string | null>(null);
  const ranking = useMemo(() => rankContactsByDuration(dataset), [dataset]);
  const podium = ranking.slice(0, 3);
  const remaining = ranking.slice(3);

  useEffect(() => {
    if (pendingContactId && activeContactId === pendingContactId) {
      setPendingContactId(null);
      navigate("calls");
    }
  }, [activeContactId, navigate, pendingContactId]);

  const openContactCalls = (contactId: string) => {
    if (activeContactId === contactId) {
      navigate("calls");
      return;
    }
    setPendingContactId(contactId);
    selectContact(contactId);
  };

  return (
    <section className="view active ranking-page">
      <header className="simple-header ranking-header">
        <span className="page-orb orb-ranking">🏆</span>
        <div>
          <h1>通话时长排行</h1>
          <p>按每位联系人的已接通通话总时长排序。</p>
        </div>
      </header>

      {!ranking.length ? (
        <article className="gentle-note ranking-empty">
          <span>📭</span>
          <div><strong>还没有可以排行的通话记录</strong><p>读取通话记录后，这里会自动生成排行榜。</p></div>
        </article>
      ) : (
        <>
          <section className="rank-podium" aria-label="通话时长前三名">
            {podium.map((item, index) => (
              <button
                className={`rank-card rank-${item.rank}`}
                key={item.contact.id}
                onClick={() => openContactCalls(item.contact.id)}
                aria-label={`第 ${item.rank} 名，${item.contact.displayName}，累计 ${formatRankDuration(item.totalDurationSeconds)}，查看通话记录`}
              >
                <span className="rank-medal" aria-hidden="true">{medals[index]}</span>
                <ContactAvatar contact={item.contact} className="rank-avatar" />
                <strong>{item.contact.displayName}</strong>
                <span className="rank-duration">{formatRankDuration(item.totalDurationSeconds)}</span>
                <small>{item.connectedCount} 次接通{item.unknownDurationCount ? ` · ${item.unknownDurationCount} 条未计时` : ""}</small>
                <i>查看记录 →</i>
              </button>
            ))}
          </section>

          {remaining.length > 0 && (
            <section className="ranking-list-panel soft-panel" aria-labelledby="ranking-list-title">
              <div className="ranking-list-heading">
                <div><h2 id="ranking-list-title">更多排名</h2><p>点击联系人查看对应通话记录</p></div>
                <span>共 {ranking.length} 位联系人</span>
              </div>
              <div className="ranking-list">
                {remaining.map((item) => (
                  <button key={item.contact.id} onClick={() => openContactCalls(item.contact.id)}>
                    <b className="rank-number">{item.rank}</b>
                    <ContactAvatar contact={item.contact} className="ranking-list-avatar" />
                    <span className="ranking-contact-copy">
                      <strong>{item.contact.displayName}</strong>
                      <small>{item.connectedCount} 次接通 · 共 {item.attemptedCount} 条记录{item.unknownDurationCount ? ` · ${item.unknownDurationCount} 条未计时` : ""}</small>
                    </span>
                    <span className="ranking-list-duration">
                      <strong>{formatRankDuration(item.totalDurationSeconds)}</strong>
                      <small>累计时长</small>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
