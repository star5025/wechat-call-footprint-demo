import { useEffect } from "react";
import { useApp } from "@/state/AppContext";

export function ScanConsentDialog() {
  const {
    scanConsentOpen,
    confirmWechatScan,
    cancelWechatScan,
    wechatScanning
  } = useApp();

  useEffect(() => {
    if (!scanConsentOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelWechatScan();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelWechatScan, scanConsentOpen]);

  if (!scanConsentOpen) return null;

  return (
    <div className="modal-backdrop scan-consent-backdrop" role="presentation" onMouseDown={cancelWechatScan}>
      <section
        className="scan-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-consent-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" aria-label="取消扫描" onClick={cancelWechatScan}>×</button>
        <span className="dialog-orb scan-consent-orb">🔍</span>
        <h2 id="scan-consent-title">扫描本机微信</h2>
        <p className="dialog-subtitle">开始前，请了解应用会怎样读取和保存你的数据。</p>

        <div className="scan-consent-list">
          <div><span>01</span><p><strong>只读取，不改动</strong><small>扫描时会读取当前正在使用的微信，但不会修改或删除任何微信内容。</small></p></div>
          <div><span>02</span><p><strong>完成后自动清理</strong><small>扫描时会暂时生成一份用于整理的副本，扫描完成后会自动删除。</small></p></div>
          <div><span>03</span><p><strong>只保存通话信息</strong><small>只保存联系人名称、头像、通话时间和时长等信息，不保存聊天内容。</small></p></div>
        </div>

        <div className="scan-consent-note"><span>ℹ️</span><p>整理后的通话记录只保存在这台电脑上，不会上传。这些记录没有额外的密码保护，请妥善保管电脑；你也可以随时在设置中删除。</p></div>
        <div className="dialog-buttons scan-consent-actions">
          <button className="secondary-action" onClick={cancelWechatScan}>取消</button>
          <button className="primary-action" disabled={wechatScanning} onClick={() => void confirmWechatScan()}>知道了，开始扫描</button>
        </div>
      </section>
    </div>
  );
}
