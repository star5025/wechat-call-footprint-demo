import { useApp } from "@/state/AppContext";
import { formatDate } from "@/utils/format";

export function ImportDialog() {
  const { importPreview, importErrors, confirmImport, cancelImport, chooseImport } = useApp();
  if (!importPreview && !importErrors.length) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <button className="modal-close" onClick={cancelImport}>×</button>
        {importPreview ? (
          <>
            <span className="dialog-orb">📥</span>
            <h2 id="import-title">确认导入</h2>
            <p className="dialog-subtitle">确认文件信息后保存到本地数据目录。</p>
            <div className="import-file-name">{importPreview.fileName}</div>
            <div className="import-stats">
              <div><small>联系人</small><strong>{importPreview.contactCount}</strong></div>
              <div><small>通话记录</small><strong>{importPreview.eventCount}</strong></div>
              <div><small>已接通</small><strong>{importPreview.connectedCount}</strong></div>
            </div>
            <div className="import-range">
              <span>日期范围</span>
              <strong>{importPreview.startDate ? formatDate(importPreview.startDate) : "未知"} — {importPreview.endDate ? formatDate(importPreview.endDate) : "未知"}</strong>
            </div>
            {importPreview.warnings.length > 0 && (
              <div className="import-warning">{importPreview.warnings.slice(0, 3).map((warning) => <p key={warning}>• {warning}</p>)}</div>
            )}
            <div className="dialog-assurance"><span>🔒</span><p>不会读取聊天正文，也不会修改原文件。导入数据可以随时删除。</p></div>
            <div className="dialog-buttons">
              <button className="secondary-action" onClick={cancelImport}>取消</button>
              <button className="primary-action" onClick={() => void confirmImport()}>确认导入</button>
            </div>
          </>
        ) : (
          <>
            <span className="dialog-orb error-orb">⚠️</span>
            <h2 id="import-title">文件无法导入</h2>
            <div className="import-errors">{importErrors.map((error) => <p key={error}>{error}</p>)}</div>
            <div className="dialog-buttons">
              <button className="secondary-action" onClick={cancelImport}>关闭</button>
              <button className="primary-action" onClick={() => void chooseImport()}>选择其他文件</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
