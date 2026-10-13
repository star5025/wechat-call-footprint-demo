import { AppShell } from "@/components/AppShell";
import { CallsPage } from "@/pages/CallsPage";
import { DiscoverPage } from "@/pages/DiscoverPage";
import { HomePage } from "@/pages/HomePage";
import { WallPage } from "@/pages/WallPage";
import { useApp } from "@/state/AppContext";

export default function App() {
  const { ready, route } = useApp();
  if (!ready) {
    return <div className="splash-screen"><span className="brand-logo splash-logo"><i /><i /><i /></span><h1>通话足迹</h1><p>正在整理本地时光…</p><div className="splash-pulse" /></div>;
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
