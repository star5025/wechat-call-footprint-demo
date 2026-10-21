import type { AppRoute } from "@/domain";
import { useApp } from "@/state/AppContext";

const routes: Array<{ id: AppRoute; icon: string; label: string }> = [
  { id: "home", icon: "🏠", label: "首页" },
  { id: "wall", icon: "📅", label: "通话日历" },
  { id: "discover", icon: "💡", label: "小发现" },
  { id: "calls", icon: "📞", label: "记录" },
  { id: "ranking", icon: "🏆", label: "排行" }
];

export function Navigation({ downloadOpen = false, onNavigate }: {
  downloadOpen?: boolean;
  onNavigate?: (route: AppRoute) => void;
}) {
  const { route, navigate } = useApp();
  return (
    <nav className="pill-nav" aria-label="主导航">
      {routes.map((item) => (
        <button
          key={item.id}
          className={!downloadOpen && route === item.id ? "active" : ""}
          aria-current={!downloadOpen && route === item.id ? "page" : undefined}
          onClick={() => (onNavigate ?? navigate)(item.id)}
        >
          <span>{item.icon}</span>{item.label}
        </button>
      ))}
    </nav>
  );
}
