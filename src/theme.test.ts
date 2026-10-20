import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { applyAppearance, applyTheme, readStoredAppearance, saveAppearance } from "./theme";

const startup = readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
afterEach(() => vi.unstubAllGlobals());

function environment(mode = "desktop") {
  const values = new Map<string, string>();
  const meta = { content: "" };
  const document = {
    currentScript: { dataset: { mode } },
    documentElement: { dataset: {} as Record<string, string>, style: { colorScheme: "" } },
    querySelector: () => meta
  };
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
  return { values, document, localStorage, meta };
}

describe("independent appearance preference", () => {
  it("defaults safely and persists GitHub independently of night mode", () => {
    const env = environment();
    vi.stubGlobal("window", { localStorage: env.localStorage });
    vi.stubGlobal("document", env.document);
    expect(readStoredAppearance()).toBe("default");
    saveAppearance("github");
    expect(readStoredAppearance()).toBe("github");
    applyTheme("dark");
    applyAppearance("github");
    expect(env.document.documentElement.dataset).toEqual({ theme: "dark", appearance: "github" });
    expect(env.meta.content).toBe("#0d1117");
    applyTheme("light");
    expect(env.meta.content).toBe("#ffffff");
    applyAppearance("default");
    expect(env.meta.content).toBe("#fbfaf8");
    expect(env.document.documentElement.style.colorScheme).toBe("light");
  });

  it("keeps operating when storage is blocked", () => {
    vi.stubGlobal("window", { localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } });
    expect(readStoredAppearance()).toBe("default");
    expect(() => saveAppearance("github")).not.toThrow();
  });
});

describe("pre-paint theme initialization", () => {
  it.each(["desktop", "pages-demo"])("restores GitHub dark in %s without reading the other storage", (mode) => {
    const env = environment(mode);
    const prefix = mode === "pages-demo" ? "call-footprint.pages-demo.v1" : "call-footprint";
    env.values.set(`${prefix}.appearance`, "github");
    env.values.set(`${prefix}.theme`, "dark");
    runInNewContext(startup, env);
    expect(env.document.documentElement.dataset).toEqual({ theme: "dark", appearance: "github" });
    expect(env.document.documentElement.style.colorScheme).toBe("dark");
    expect(env.meta.content).toBe("#0d1117");
  });

  it("ignores desktop appearance in Pages and falls back on unknown values", () => {
    const env = environment("pages-demo");
    env.values.set("call-footprint.appearance", "github");
    env.values.set("call-footprint.theme", "dark");
    env.values.set("call-footprint.pages-demo.v1.appearance", "unknown");
    runInNewContext(startup, env);
    expect(env.document.documentElement.dataset).toEqual({ theme: "light", appearance: "default" });
  });
});
