import { useEffect, useState } from "react";
import { Avatar } from "@/components/ContactAvatar";
import { ThemeSelect } from "@/components/ThemeSelect";
import type { Appearance } from "@/theme";
import { buildContactCallSummary } from "@/data/contactSummary";
import { contactSummaryFileName, createContactSummaryPng } from "@/export/contactSummaryImage";
import { useApp } from "@/state/AppContext";
import { exportJson, exportPng } from "@/native/bridge";
import { isPagesDemo } from "@/runtime";
import {
  directionLabel,
  formatDate,
  formatDuration,
  formatTime,
  mediaLabel,
  outcomeLabel
} from "@/utils/format";

export function Sheets({ appearance, onAppearanceChange, hideSummaryExport = false }: {
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
  hideSummaryExport?: boolean;
}) {
  const {
    selectedEvent,
    closeEvent,
    settingsOpen,
    setSettingsOpen,
    dataset,
    dataMode,
    activeContactId,
    chooseImport,
    scanWechat,
    wechatScanning,
    clearDataset,
    appInfo,
    notify
  } = useApp();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [exportingSummary, setExportingSummary] = useState(false);
  const sheetOpen = Boolean(selectedEvent || settingsOpen);
  const anyOpen = sheetOpen || exportConfirmOpen;
  const summaryContact = dataset.contacts.find((contact) => contact.id === activeContactId)
    ?? dataset.contacts[0]
    ?? null;
  const summaryContactId = summaryContact?.id ?? null;
  const selectedContact = selectedEvent?.contactId
    ? dataset.contacts.find((contact) => contact.id === selectedEvent.contactId)
    : null;

  useEffect(() => {
    if (!anyOpen) return;
    const scrollTop = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const previous = {
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
      rootOverflow: root.style.overflow
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollTop}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";

    return () => {
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      body.style.width = previous.bodyWidth;
      body.style.overflow = previous.bodyOverflow;
      root.style.overflow = previous.rootOverflow;
      window.scrollTo({ top: scrollTop, behavior: "auto" });
    };
  }, [anyOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (deleteConfirmOpen) {
          if (!deleting) setDeleteConfirmOpen(false);
          return;
        }
        if (exportConfirmOpen) {
          setExportConfirmOpen(false);
          return;
        }
        if (document.querySelector('.settings-sheet.open .theme-select-trigger[aria-expanded="true"]')) return;
        closeEvent();
        setSettingsOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeEvent, deleteConfirmOpen, deleting, exportConfirmOpen, setSettingsOpen]);

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await clearDataset();
      setDeleteConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const exportData = async () => {
    try {
      const result = await exportJson("call-footprint-private.json", dataset);
      if (result) notify("记录文件已保存");
    } catch {
      notify("保存失败，请重选位置");
    }
  };

  const exportSummaryImage = async () => {
    if (!summaryContactId || exportingSummary) return;
    const summary = buildContactCallSummary(dataset, summaryContactId);
    if (!summary || summary.attemptedCount === 0) {
      notify("暂无通话记录");
      return;
    }
    if (summary.hasBlockingQualityIssues) {
      notify("记录待确认，暂不能导出");
      return;
    }
    setExportingSummary(true);
    try {
      const image = await createContactSummaryPng(summary);
      const result = await exportPng(contactSummaryFileName(summary), image);
      if (result) notify(appInfo?.isTauri === false ? "长图已开始下载" : "长图已保存");
    } catch {
      notify("生成失败，请重试");
    } finally {
      setExportingSummary(false);
    }
  };

  const confirmSummaryExport = () => {
    setExportConfirmOpen(false);
    void exportSummaryImage();
  };

  return (
    <>
      {sheetOpen && <button className="sheet-backdrop react-backdrop" aria-label="关闭抽屉" onClick={() => { closeEvent(); setSettingsOpen(false); }} />}
      {!hideSummaryExport && dataMode === "imported" && summaryContactId && !anyOpen && (
        <button
          className={`summary-image-fab ${exportingSummary ? "exporting" : ""}`}
          disabled={wechatScanning || exportingSummary}
          aria-label={`为${summaryContact?.displayName ?? "当前联系人"}导出通话总结长图`}
          onClick={() => setExportConfirmOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v11m0-11 4 4m-4-4L8 7" />
            <path d="M5 13v6h14v-6" />
          </svg>
        </button>
      )}
      <aside className={`detail-sheet ${selectedEvent ? "open" : ""}`} aria-hidden={!selectedEvent}>
        <button className="sheet-close" onClick={closeEvent}>×</button>
        {selectedEvent && (
          <>
            <div className="sheet-hero">
              <Avatar
                avatarRef={selectedContact?.avatarRef}
                label={selectedEvent.contactSnapshot.displayName ?? "未知联系人"}
                className="sheet-avatar"
              />
              <h2>{selectedEvent.contactSnapshot.displayName ?? "未知联系人"} · {mediaLabel(selectedEvent.mediaType)}</h2>
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
            </div>
          </>
        )}
      </aside>

      <aside className={`settings-sheet ${settingsOpen ? "open" : ""}`} aria-hidden={!settingsOpen}>
        <header><div><h2>设置</h2></div><button onClick={() => setSettingsOpen(false)}>×</button></header>
        <div className="setting-list">
          <div className="appearance-setting">
            <span>主题</span>
            <ThemeSelect label="主题风格" value={appearance} options={[{ value: "default", label: "默认" }, { value: "github", label: "GitHub" }]} onChange={(value) => onAppearanceChange(value as Appearance)} />
          </div>
          {!isPagesDemo && <>
          <button className={`setting-item scan-setting ${wechatScanning ? "scanning" : ""}`} disabled={wechatScanning || appInfo?.isTauri === false} onClick={() => void scanWechat()}>
            <span className="setting-icon mint">{wechatScanning ? "⏳" : "🔍"}</span><span><strong>{wechatScanning ? "读取中…" : "读取微信"}</strong><small>{wechatScanning ? "请保持微信打开" : "不改动微信内容"}</small></span><i>›</i>
          </button>
          <button className="setting-item" disabled={wechatScanning} onClick={() => void chooseImport()}>
            <span className="setting-icon lavender">📥</span><span><strong>打开文件</strong></span><i>›</i>
          </button>
          <button className="setting-item" disabled={wechatScanning} onClick={() => void exportData()}>
            <span className="setting-icon peach">📤</span><span><strong>保存文件</strong><small>含联系人名称</small></span><i>›</i>
          </button>
          {dataMode === "imported" && (
            <button className="setting-item danger-setting" disabled={wechatScanning} onClick={() => setDeleteConfirmOpen(true)}>
              <span className="setting-icon danger-icon">🗑️</span><span><strong>删除记录</strong><small>不改动微信内容</small></span><i>›</i>
            </button>
          )}
          </>}
          {isPagesDemo && <button className="setting-item" onClick={() => void clearDataset()}>
            <span className="setting-icon lavender">↻</span><span><strong>重置</strong></span><i>›</i>
          </button>}
        </div>
        {!isPagesDemo && <div className="local-note"><span>📁</span><p><strong>保存情况</strong><br />{dataMode === "empty" ? "暂无本地记录" : "记录保存在本机"}</p></div>}
      </aside>

      {exportConfirmOpen && (
        <div className="modal-backdrop export-confirm-backdrop" role="presentation" onMouseDown={() => setExportConfirmOpen(false)}>
          <section
            className="export-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-confirm-title"
            aria-describedby="export-confirm-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" aria-label="取消导出" onClick={() => setExportConfirmOpen(false)}>×</button>
            <h2 id="export-confirm-title">导出通话总结？</h2>
            <p id="export-confirm-description">将总结导出为 PNG</p>
            <div className="dialog-buttons export-confirm-actions">
              <button className="secondary-action" onClick={() => setExportConfirmOpen(false)}>取消</button>
              <button className="primary-action" onClick={confirmSummaryExport}>确认</button>
            </div>
          </section>
        </div>
      )}

      {deleteConfirmOpen && (
        <div className="modal-backdrop delete-confirm-backdrop" role="presentation" onMouseDown={() => !deleting && setDeleteConfirmOpen(false)}>
          <section
            className="delete-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            aria-describedby="delete-confirm-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" disabled={deleting} aria-label="取消删除" onClick={() => setDeleteConfirmOpen(false)}>×</button>
            <span className="delete-confirm-orb" aria-hidden="true">🗑️</span>
            <h2 id="delete-confirm-title">确认删除已保存的通话记录？</h2>
            <p id="delete-confirm-description">删除后，应用中的联系人和通话统计将被清空。</p>
            <div className="delete-confirm-note"><span>🔒</span><p>不会修改或删除微信中的内容。之后可以重新读取或从文件打开。</p></div>
            <div className="dialog-buttons delete-confirm-actions">
              <button className="secondary-action" disabled={deleting} onClick={() => setDeleteConfirmOpen(false)}>取消</button>
              <button className="danger-action" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "正在删除…" : "确认删除"}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
