import { useEffect, useMemo, useRef, useState } from "react";
import { ContactAvatar } from "@/components/ContactAvatar";
import { useApp } from "@/state/AppContext";

const kindLabel = (kind: string) =>
  kind === "group" ? "群聊" : kind === "official" ? "公众号" : "联系人";

export function DataLoadDialog() {
  const {
    dataLoading,
    dataLoadSuccess,
    dataset,
    selectLoadedContact,
    finishWithoutContact
  } = useApp();
  const [search, setSearch] = useState("");
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const displayedProgressRef = useRef(0);

  useEffect(() => {
    if (dataLoadSuccess) setSearch("");
  }, [dataLoadSuccess]);

  useEffect(() => {
    if (!dataLoading) {
      displayedProgressRef.current = 0;
      setDisplayedProgress(0);
      return;
    }

    const target = Math.max(0, Math.min(100, dataLoading.progress));
    const startValue = displayedProgressRef.current;
    if (target <= startValue) {
      displayedProgressRef.current = target;
      setDisplayedProgress(target);
      return;
    }

    const startedAt = performance.now();
    const duration = Math.min(650, Math.max(280, (target - startValue) * 14));
    let frame = 0;
    const animate = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const next = Math.min(target, startValue + (target - startValue) * eased);
      displayedProgressRef.current = next;
      setDisplayedProgress(next);
      if (elapsed < 1) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [dataLoading]);

  const callCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of dataset.events) {
      if (event.contactId) counts.set(event.contactId, (counts.get(event.contactId) ?? 0) + 1);
    }
    return counts;
  }, [dataset.events]);
  const contacts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return dataset.contacts.filter((contact) =>
      !needle
      || contact.displayName.toLocaleLowerCase().includes(needle)
      || contact.wechatId?.toLocaleLowerCase().includes(needle)
    );
  }, [dataset.contacts, search]);

  if (!dataLoading && !dataLoadSuccess) return null;

  if (dataLoading) {
    return (
      <div className="modal-backdrop data-process-backdrop" role="alert" aria-live="assertive">
        <section className="data-loading-dialog simple-loading-dialog" aria-labelledby="data-loading-title">
          <span className="simple-loading-icon" aria-hidden="true">⌁</span>
          <h2 id="data-loading-title">{dataLoading.title}</h2>
          <p>{dataLoading.detail}</p>
          <div className="actual-progress-label"><span>处理进度</span><strong>{Math.round(displayedProgress)}%</strong></div>
          <div
            className="actual-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayedProgress)}
          >
            <i style={{ width: `${displayedProgress}%` }} />
          </div>
          <small>进度来自本机实际处理阶段，请不要关闭应用</small>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-backdrop data-process-backdrop" role="presentation">
      <section className="contact-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="load-success-title">
        <div className="success-mark" aria-hidden="true">✓</div>
        <h2 id="load-success-title">{dataLoadSuccess!.title}</h2>
        <p className="dialog-subtitle">{dataLoadSuccess!.description}</p>
        <div className="load-success-stats">
          <div><strong>{dataLoadSuccess!.contactCount}</strong><span>位联系人</span></div>
          <div><strong>{dataLoadSuccess!.eventCount}</strong><span>条通话记录</span></div>
        </div>

        {dataset.contacts.length > 0 ? (
          <>
            <div className="contact-choice-heading">
              <div><strong>选择联系人</strong><small>选择后查看对应通话统计</small></div>
              {dataset.contacts.length > 6 && (
                <label className="contact-choice-search">
                  <span>⌕</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索联系人" autoFocus />
                </label>
              )}
            </div>
            <div className="contact-choice-list">
              {contacts.map((contact) => (
                <button key={contact.id} onClick={() => void selectLoadedContact(contact.id)}>
                  <ContactAvatar contact={contact} className="choice-avatar" />
                  <span className="choice-contact-copy">
                    <strong>{contact.displayName}</strong>
                    <small>{kindLabel(contact.kind)} · {callCounts.get(contact.id) ?? 0} 条通话</small>
                  </span>
                  <i>查看 →</i>
                </button>
              ))}
              {!contacts.length && <p className="contact-choice-empty">没有找到匹配的联系人</p>}
            </div>
          </>
        ) : (
          <div className="no-contact-result">
            <strong>没有可选择的联系人</strong>
            <p>文件已经加载，但其中没有联系人通话记录。</p>
            <button className="primary-action" onClick={finishWithoutContact}>返回首页</button>
          </div>
        )}

        {dataLoadSuccess!.warnings.length > 0 && (
          <div className="load-success-warning">部分数据需要留意：{dataLoadSuccess!.warnings[0]}</div>
        )}
      </section>
    </div>
  );
}
