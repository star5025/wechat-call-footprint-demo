import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppDataset,
  AppInfo,
  AppSettings,
  ExportResult,
  ImportFileResult,
  WechatScanProgress,
  WechatScanResult
} from "@/domain";

import { browserStoragePrefix, isPagesDemo } from "@/runtime";

const isTauriRuntime = () =>
  !isPagesDemo && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SETTINGS_KEY = `${browserStoragePrefix}.settings.v1`;
const DATASET_KEY = "call-footprint.dataset.v1";

export async function getAppInfo(): Promise<AppInfo> {
  if (isTauriRuntime()) return invoke<AppInfo>("app_info");
  return {
    name: "通话足迹",
    version: "0.5.0-browser",
    platform: navigator.platform,
    arch: "browser",
    dataDirectory: "浏览器预览模式",
    isTauri: false
  };
}

export async function loadSettings(): Promise<AppSettings | null> {
  if (isTauriRuntime()) return invoke<AppSettings | null>("load_settings");
  if (isPagesDemo) {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      return stored?.settingsVersion === 1 ? stored as AppSettings : null;
    } catch {
      return null;
    }
  }
  const raw = localStorage.getItem(SETTINGS_KEY);
  return raw ? (JSON.parse(raw) as AppSettings) : null;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (isPagesDemo) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Optional in the public demo. */ }
    return;
  }
  if (isTauriRuntime()) {
    await invoke("save_settings", { settings });
    return;
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadDataset(): Promise<AppDataset | null> {
  if (isTauriRuntime()) {
    const content = await invoke<string | null>("load_dataset");
    return content ? (JSON.parse(content) as AppDataset) : null;
  }
  if (isPagesDemo) {
    const { createDemoDataset } = await import("@/demo/dataset");
    return createDemoDataset();
  }
  const raw = localStorage.getItem(DATASET_KEY);
  return raw ? (JSON.parse(raw) as AppDataset) : null;
}

export async function saveDataset(dataset: AppDataset): Promise<void> {
  if (isPagesDemo) return;
  const content = JSON.stringify(dataset);
  if (isTauriRuntime()) {
    await invoke("save_dataset", { content });
    return;
  }
  localStorage.setItem(DATASET_KEY, content);
}

export async function deleteDataset(): Promise<void> {
  if (isPagesDemo) return;
  if (isTauriRuntime()) {
    await invoke("delete_dataset");
    return;
  }
  localStorage.removeItem(DATASET_KEY);
}

export async function chooseImportFile(): Promise<ImportFileResult | null> {
  if (isPagesDemo) return null;
  if (isTauriRuntime()) return invoke<ImportFileResult | null>("choose_import_file");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve({ fileName: file.name, content: await file.text(), sizeBytes: file.size });
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

export async function scanWechatCalls(
  onProgress?: (progress: WechatScanProgress) => void
): Promise<WechatScanResult> {
  if (!isTauriRuntime()) {
    throw new Error("自动扫描仅在 Windows 或 macOS 桌面版中可用。");
  }
  const unlisten = onProgress
    ? await listen<WechatScanProgress>("wechat-scan-progress", (event) => onProgress(event.payload))
    : null;
  try {
    return await invoke<WechatScanResult>("scan_wechat_calls");
  } finally {
    unlisten?.();
  }
}

export async function exportPng(
  suggestedName: string,
  image: Blob
): Promise<ExportResult | null> {
  if (isTauriRuntime()) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("无法读取生成的图片。"));
      reader.readAsDataURL(image);
    });
    const dataBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return invoke<ExportResult | null>("export_png", { suggestedName, dataBase64 });
  }
  const url = URL.createObjectURL(image);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return { path: suggestedName, sizeBytes: image.size };
}

export async function exportJson(
  suggestedName: string,
  dataset: AppDataset
): Promise<ExportResult | null> {
  if (isPagesDemo) return null;
  const content = JSON.stringify(dataset, null, 2);
  if (isTauriRuntime()) {
    return invoke<ExportResult | null>("export_json", { suggestedName, content });
  }
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  URL.revokeObjectURL(url);
  return { path: suggestedName, sizeBytes: blob.size };
}

export { isTauriRuntime };
