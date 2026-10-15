import { useEffect, useState, type ReactNode } from "react";
import { Navigation } from "@/components/Navigation";
import { Sheets } from "@/components/Sheets";
import { ImportDialog } from "@/components/ImportDialog";
import { DataLoadDialog } from "@/components/DataLoadDialog";
import { ScanConsentDialog } from "@/components/ScanConsentDialog";
import { useApp } from "@/state/AppContext";
import { applyTheme, readStoredTheme, saveTheme, type ColorTheme } from "@/theme";

export function AppShell({ children }: { children: ReactNode }) {
  const { navigate, setSettingsOpen, settings, dataMode, toasts } = useApp();
  const [theme, setTheme] = useState<ColorTheme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

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
            <button
              className={`theme-toggle ${theme === "dark" ? "dark" : ""}`}
              aria-label={theme === "dark" ? "切换到日间模式" : "切换到黑夜模式"}
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            >
              <span className="theme-toggle-track" aria-hidden="true">
                <i className="theme-toggle-thumb">{theme === "dark" ? "🌙" : "☀️"}</i>
              </span>
            </button>
            <button className="round-btn" aria-label="打开设置" onClick={() => setSettingsOpen(true)}>⚙️</button>
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
