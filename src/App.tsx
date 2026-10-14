import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CallsPage } from "@/pages/CallsPage";
import { DiscoverPage } from "@/pages/DiscoverPage";
import { HomePage } from "@/pages/HomePage";
import { WallPage } from "@/pages/WallPage";
import { useApp } from "@/state/AppContext";

export default function App() {
  const { ready, route } = useApp();
  const [introComplete, setIntroComplete] = useState(false);
  const [launchPhase, setLaunchPhase] = useState<"enter" | "leaving" | "done">("enter");

  useEffect(() => {
    const timer = window.setTimeout(() => setIntroComplete(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (ready && introComplete && launchPhase === "enter") setLaunchPhase("leaving");
  }, [introComplete, launchPhase, ready]);

  if (launchPhase !== "done") {
    return (
      <div
        className={`launch-screen ${launchPhase === "leaving" ? "leaving" : ""}`}
        onAnimationEnd={(event) => {
          if (launchPhase === "leaving" && event.animationName === "launch-out") {
            setLaunchPhase("done");
          }
        }}
      >
        <div className="launch-mark" aria-hidden="true">📞</div>
        <h1>通话足迹</h1>
        <p>本地通话记录统计</p>
      </div>
    );
  }
  return (
    <AppShell>
      {route === "home" && <HomePage />}
      {route === "wall" && <WallPage />}
      {route === "discover" && <DiscoverPage />}
      {route === "calls" && <CallsPage />}
    </AppShell>
  );
}
