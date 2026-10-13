import { useEffect } from "react";
import { useApp } from "@/state/AppContext";
import { anonymizeDataset } from "@/data/dataset";
import { exportJson } from "@/native/bridge";
import {
  directionLabel,
  formatDate,
  formatDuration,
  formatTime,
  mediaLabel,
  outcomeLabel
} from "@/utils/format";

export function Sheets() {
  const {
    selectedEvent,
    closeEvent,
    settingsOpen,
    setSettingsOpen,
    settings,
    updateSettings,
    dataset,
    dataMode,
    chooseImport,
    restoreDemo,
    appInfo,
    notify
  } = useApp();
  const anyOpen = Boolean(selectedEvent || settingsOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeEvent();
        setSettingsOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeEvent, setSettingsOpen]);

  const exportData = async (anonymized: boolean) => {
    try {
      const target = anonymized ? anonymizeDataset(dataset) : dataset;
      const suffix = anonymized ? "anonymous" : "private";
      const result = await exportJson(`call-footprint-${suffix}.json`, target);
      if (result) notify(`导出完成：${result.path}`);
    } catch (error) {
      notify(`导出失败：${String(error)}`);
    }
  };

  return (
    <>
      {anyOpen && <button className="sheet-backdrop react-backdrop" aria-label="关闭抽屉" onClick={() => { closeEvent(); setSettingsOpen(false); }} />}
      <aside className={`detail-sheet ${selectedEvent ? "open" : ""}`} aria-hidden={!selectedEvent}>
        <button className="sheet-close" onClick={closeEvent}>×</button>
        {selectedEvent && (
          <>
            <div className="sheet-hero">
              <div className="sheet-avatar">{settings.privacyMode ? "♡" : selectedEvent.contactSnapshot.displayName?.slice(0, 1) ?? "?"}</div>
              <h2>{settings.privacyMode ? "和重要的人的通话" : `和${selectedEvent.contactSnapshot.displayName ?? "未知联系人"}的${mediaLabel(selectedEvent.mediaType)}`}</h2>
              <p>{selectedEvent.startedAt ? `${formatDate(selectedEvent.startedAt.slice(0, 10))} · ${formatTime(selectedEvent.startedAt)}` : "时间未知"}</p>
            </div>
            <div className="sheet-duration">
              <small>{(selectedEvent.connectedDurationSeconds ?? 0) > 0 ? "这一次聊了" : "这次没有接通"}</small>
              <strong>{formatDuration(selectedEvent.connectedDurationSeconds)}</strong>
            </div>
            <div className="detail-rows">
              <div className="detail-row"><span>谁先发起</span><strong>{directionLabel(selectedEvent.direction)}</strong></div>
              <div className="detail-row"><span>通话类型</span><strong>{mediaLabel(selectedEvent.mediaType)}</strong></div>
              <div className="detail-row"><span>结束状态</span><strong>{outcomeLabel(selectedEvent.outcome)}</strong></div>
              <div className="detail-row"><span>数据状态</span><strong>{selectedEvent.qualityFlags.length ? "需要留意" : "可靠"}</strong></div>
            </div>
            <div className="sheet-note">所有内容都在本机处理。应用只保存规范化通话元数据，不包含聊天正文或数据库密钥。</div>
          </>
        )}
      </aside>

      <aside className={`settings-sheet ${settingsOpen ? "open" : ""}`} aria-hidden={!settingsOpen}>
        <header><div><small>轻松设置</small><h2>按你的习惯来</h2></div><button onClick={() => setSettingsOpen(false)}>×</button></header>
        <div className="setting-list">
          <button className="setting-item" onClick={() => void updateSettings({ privacyMode: !settings.privacyMode })}>
            <span className="setting-icon lavender">◉</span><span><strong>隐藏名字</strong><small>投屏或分享画面时更安心</small></span><i>{settings.privacyMode ? "开启" : "关闭"}</i>
          </button>
          <button className="setting-item" onClick={() => void chooseImport()}>
            <span className="setting-icon mint">⇩</span><span><strong>导入通话数据</strong><small>选择通话足迹 v1 JSON</small></span><i>›</i>
          </button>
          <button className="setting-item" onClick={() => void exportData(false)}>
            <span className="setting-icon peach">⇧</span><span><strong>完整私人导出</strong><small>可重新导入，包含联系人名称</small></span><i>›</i>
          </button>
          <button className="setting-item" onClick={() => void exportData(true)}>
            <span className="setting-icon blue-setting">♢</span><span><strong>脱敏导出</strong><small>隐藏联系人和来源标识</small></span><i>›</i>
          </button>
          {dataMode === "imported" && (
            <button className="setting-item danger-setting" onClick={() => void restoreDemo()}>
              <span className="setting-icon danger-icon">×</span><span><strong>删除本地导入数据</strong><small>不会删除你选择的原始文件</small></span><i>›</i>
            </button>
          )}
        </div>
        <div className="local-note"><span>✓</span><p><strong>所有内容都在本地</strong><br />当前数据：{dataMode === "demo" ? "内置示例" : dataset.source.displayName}<br />应用版本：{appInfo?.version ?? "读取中"}</p></div>
      </aside>
    </>
  );
}
