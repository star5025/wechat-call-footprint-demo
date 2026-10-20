import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { AppProvider } from "@/state/AppContext";
import { applyAppearance, applyTheme, readStoredAppearance, readStoredTheme } from "@/theme";
import "@/styles.css";
import "@/github-theme.css";

applyAppearance(readStoredAppearance());
applyTheme(readStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
);
