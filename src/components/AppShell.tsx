import type { ReactNode } from "react";
import { Navigation } from "@/components/Navigation";
import { Sheets } from "@/components/Sheets";
import { ImportDialog } from "@/components/ImportDialog";
import { DataLoadDialog } from "@/components/DataLoadDialog";
import { ScanConsentDialog } from "@/components/ScanConsentDialog";
import { useApp } from "@/state/AppContext";

export function AppShell({ children }: { children: ReactNode }) {
  const { navigate, setSettingsOpen, settings, dataMode, toasts } = useApp();
  return (
    <>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className={`app ${settings.reducedMotion ? "reduced-motion" : ""}`}>
        <header className="topbar">
          <button className="brand" onClick={() => navigate("home")} aria-label="回到首页">
            <span className="brand-logo" aria-hidden="true">📞</span><strong>通话足迹</strong>
          </button>
          <Navigation />
          <div className="top-actions">
            <span className={`demo-tag ${dataMode === "imported" ? "imported-tag" : ""}`}>{dataMode === "empty" ? "开始使用" : "本地数据"}</span>
            <button className="round-btn" title="设置" aria-label="打开设置" onClick={() => setSettingsOpen(true)}>⚙️</button>
          </div>
        </header>
        <main>{children}</main>
      </div>
      <Sheets />
      <ImportDialog />
      <DataLoadDialog />
      <ScanConsentDialog />
      <div className="toast-zone" aria-live="polite">
        {toasts.map((toast) => <div className="toast" key={toast.id}><span>✅</span>{toast.text}</div>)}
      </div>
    </>
  );
}
