import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Navigation } from "@/components/Navigation";
import { Sheets } from "@/components/Sheets";
import { AccountManager } from "@/components/AccountManager";
import { ImportDialog } from "@/components/ImportDialog";
import { DataLoadDialog } from "@/components/DataLoadDialog";
import { ScanConsentDialog } from "@/components/ScanConsentDialog";
import { MacSetupDialog } from "@/components/MacSetupDialog";
import { useApp } from "@/state/AppContext";
import { applyAppearance, applyTheme, readStoredAppearance, readStoredTheme, saveAppearance, saveTheme, type Appearance, type ColorTheme } from "@/theme";
import { isPagesDemo } from "@/runtime";
import type { AppRoute } from "@/domain";
import { DownloadPage } from "@/pages/DownloadPage";
import { downloadHash } from "@/downloads";

export function AppShell({ children }: { children: ReactNode }) {
  const { navigate, setSettingsOpen, settings, dataMode, toasts, activeContactId, accountScope, macSetupOpen, closeMacSetup, completeMacSetup } = useApp();
  const [theme, setTheme] = useState<ColorTheme>(readStoredTheme);
  const [appearance, setAppearance] = useState<Appearance>(readStoredAppearance);
  const [downloadOpen, setDownloadOpen] = useState(() => isPagesDemo && window.location.hash === downloadHash);

  useEffect(() => {
    if (!isPagesDemo) return;
    const syncDownloadHash = () => {
      const open = window.location.hash === downloadHash;
      setDownloadOpen(open);
      if (open) window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", syncDownloadHash);
    window.addEventListener("popstate", syncDownloadHash);
    return () => {
      window.removeEventListener("hashchange", syncDownloadHash);
      window.removeEventListener("popstate", syncDownloadHash);
    };
  }, []);

  const navigateFromHeader = (route: AppRoute) => {
    if (isPagesDemo && downloadOpen) {
      window.location.hash = "/";
      setDownloadOpen(false);
    }
    navigate(route);
  };

  useLayoutEffect(() => {
    applyAppearance(appearance);
    saveAppearance(appearance);
  }, [appearance]);
  const mainRef = useRef<HTMLElement>(null);
  const contactViewKey = JSON.stringify([accountScope, activeContactId]);
  const previousContact = useRef(contactViewKey);

  useLayoutEffect(() => {
    const changed = previousContact.current !== contactViewKey;
    previousContact.current = contactViewKey;
    if (!changed || settings.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animations: Animation[] = [];
    mainRef.current?.querySelectorAll<HTMLElement>("[data-contact-content]").forEach((element) => {
      if (typeof element.animate !== "function") return;
      // Opacity only: transforms would change the containing block of fixed popovers.
      animations.push(element.animate([{ opacity: .94 }, { opacity: 1 }], {
        duration: 280,
        easing: "cubic-bezier(.22,.61,.36,1)"
      }));
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [contactViewKey, settings.reducedMotion]);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  return (
    <>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className={`app ${isPagesDemo ? "pages-demo" : ""} ${settings.reducedMotion ? "reduced-motion" : ""}`}>
        <header className="topbar">
          <button className="brand" onClick={() => navigateFromHeader("home")} aria-label="回到首页">
            <span className="brand-logo" aria-hidden="true">📞</span><strong>通话足迹</strong>
          </button>
          <Navigation downloadOpen={downloadOpen} onNavigate={navigateFromHeader} />
          <div className="top-actions">
            {isPagesDemo && (
              <a
                className="pages-download"
                href={downloadHash}
                aria-label="打开下载页面"
                aria-current={downloadOpen ? "page" : undefined}
              >下载</a>
            )}
            <span className={`demo-tag ${isPagesDemo ? "pages-demo-tag" : dataMode === "imported" ? "imported-tag" : ""}`}>{isPagesDemo ? "演示" : dataMode === "empty" ? "开始使用" : "已保存"}</span>
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
        <main ref={mainRef}>
          {isPagesDemo ? <>
            {downloadOpen && <DownloadPage />}
            <div hidden={downloadOpen}>{children}</div>
          </> : children}
        </main>
      </div>
      <Sheets appearance={appearance} onAppearanceChange={setAppearance} hideSummaryExport={downloadOpen} />
      <AccountManager />
      {!isPagesDemo && <ImportDialog />}
      <DataLoadDialog />
      {!isPagesDemo && <ScanConsentDialog />}
      {!isPagesDemo && macSetupOpen && <MacSetupDialog onClose={closeMacSetup} onComplete={completeMacSetup} />}
      <div className="toast-zone" aria-live="polite">
        {toasts.map((toast) => <div className="toast" key={toast.id}><span>✅</span>{toast.text}</div>)}
      </div>
    </>
  );
}
