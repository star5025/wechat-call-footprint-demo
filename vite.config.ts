import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => ({
  base: mode === "pages-demo" ? "/wechat-call-footprint-demo/" : "/",
  build: { outDir: mode === "pages-demo" ? "dist-pages" : "dist" },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(rootDirectory, "src"),
      "@contracts": path.resolve(rootDirectory, "contracts/v1")
    }
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"]
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
}));
