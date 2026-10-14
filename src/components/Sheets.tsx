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
    scanWechat,
    wechatScanning,
    clearDataset,
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
              <h2>{settings.privacyMode ? `联系人 · ${mediaLabel(selectedEvent.mediaType)}` : `${selectedEvent.contactSnapshot.displayName ?? "未知联系人"} · ${mediaLabel(selectedEvent.mediaType)}`}</h2>
              <p>{selectedEvent.startedAt ? `${formatDate(selectedEvent.startedAt.slice(0, 10))} · ${formatTime(selectedEvent.startedAt)}` : "时间未知"}</p>
            </div>
            <div className="sheet-duration">
              <small>{(selectedEvent.connectedDurationSeconds ?? 0) > 0 ? "接通时长" : "未接通"}</small>
              <strong>{formatDuration(selectedEvent.connectedDurationSeconds)}</strong>
            </div>
            <div className="detail-rows">
              <div className="detail-row"><span>发起方向</span><strong>{directionLabel(selectedEvent.direction)}</strong></div>
              <div className="detail-row"><span>通话类型</span><strong>{mediaLabel(selectedEvent.mediaType)}</strong></div>
              <div className="detail-row"><span>结束状态</span><strong>{outcomeLabel(selectedEvent.outcome)}</strong></div>
              <div className="detail-row"><span>数据状态</span><strong>{selectedEvent.qualityFlags.length ? "需要留意" : "可靠"}</strong></div>
            </div>
          </>
        )}
      </aside>

      <aside className={`settings-sheet ${settingsOpen ? "open" : ""}`} aria-hidden={!settingsOpen}>
        <header><div><h2>设置</h2></div><button onClick={() => setSettingsOpen(false)}>×</button></header>
        <div className="setting-list">
          <button className="setting-item" onClick={() => void updateSettings({ privacyMode: !settings.privacyMode })}>
            <span className="setting-icon lavender">◉</span><span><strong>隐藏联系人名称</strong><small>在界面中隐藏联系人名称和头像</small></span><i>{settings.privacyMode ? "开启" : "关闭"}</i>
          </button>
          <button className={`setting-item scan-setting ${wechatScanning ? "scanning" : ""}`} disabled={wechatScanning || appInfo?.isTauri === false} onClick={() => void scanWechat()}>
            <span className="setting-icon mint">{wechatScanning ? "···" : "⌁"}</span><span><strong>{wechatScanning ? "正在读取微信记录" : "扫描本机微信"}</strong><small>{wechatScanning ? "请保持微信登录" : "只读访问微信文件和进程内存"}</small></span><i>{wechatScanning ? "请稍候" : "›"}</i>
          </button>
          <button className="setting-item" disabled={wechatScanning} onClick={() => void chooseImport()}>
            <span className="setting-icon lavender">⇩</span><span><strong>导入通话数据</strong><small>自动扫描不可用时选择 v1 JSON</small></span><i>›</i>
          </button>
          <button className="setting-item" disabled={wechatScanning} onClick={() => void exportData(false)}>
            <span className="setting-icon peach">⇧</span><span><strong>完整数据导出</strong><small>可重新导入，包含联系人名称</small></span><i>›</i>
          </button>
          <button className="setting-item" disabled={wechatScanning} onClick={() => void exportData(true)}>
            <span className="setting-icon blue-setting">♢</span><span><strong>脱敏导出</strong><small>隐藏联系人和来源标识</small></span><i>›</i>
          </button>
          {dataMode === "imported" && (
            <button className="setting-item danger-setting" disabled={wechatScanning} onClick={() => void clearDataset()}>
              <span className="setting-icon danger-icon">×</span><span><strong>删除本地通话数据</strong><small>不会修改或删除微信原始文件</small></span><i>›</i>
            </button>
          )}
        </div>
        <div className="local-note"><span>✓</span><p><strong>本地数据</strong><br />当前数据：{dataMode === "empty" ? "尚未连接" : dataset.source.displayName}<br />应用版本：{appInfo?.version ?? "读取中"}</p></div>
      </aside>
    </>
  );
}
