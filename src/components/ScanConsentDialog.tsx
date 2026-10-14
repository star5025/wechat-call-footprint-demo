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
        <span className="dialog-orb scan-consent-orb">⌁</span>
        <h2 id="scan-consent-title">扫描本机微信</h2>
        <p className="dialog-subtitle">开始前，请确认以下本地数据处理方式。</p>

        <div className="scan-consent-list">
          <div><span>01</span><p><strong>只读访问</strong><small>读取当前微信进程内存以验证本机数据库密钥，不修改微信文件。</small></p></div>
          <div><span>02</span><p><strong>临时解密</strong><small>数据库副本仅在应用缓存中临时解密，正常结束后自动删除。</small></p></div>
          <div><span>03</span><p><strong>本地保存</strong><small>仅保存联系人名称和通话元数据，不保存聊天正文或数据库密钥。</small></p></div>
        </div>

        <div className="scan-consent-note"><span>i</span><p>整理后的元数据以未加密 JSON 格式保存在本机，可随时在设置中删除。</p></div>
        <div className="dialog-buttons scan-consent-actions">
          <button className="secondary-action" onClick={cancelWechatScan}>取消</button>
          <button className="primary-action" disabled={wechatScanning} onClick={() => void confirmWechatScan()}>同意并扫描</button>
        </div>
      </section>
    </div>
  );
}
