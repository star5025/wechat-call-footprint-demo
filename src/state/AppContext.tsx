import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { CallEvent } from "@contracts/models";
import type {
  AppDataset,
  AppInfo,
  AppRoute,
  AppSettings,
  DataMode,
  ImportPreview
} from "@/domain";
import { DEFAULT_SETTINGS } from "@/domain";
import { DEMO_DATASET } from "@/data/demoDataset";
import { chooseImportFile, deleteDataset, getAppInfo, loadDataset, loadSettings, saveDataset, saveSettings, scanWechatCalls } from "@/native/bridge";
import { makeImportPreview, parseDataset, validateDataset } from "@/data/dataset";

interface ToastMessage {
  id: number;
  text: string;
}

interface AppContextValue {
  ready: boolean;
  dataset: AppDataset;
  dataMode: DataMode;
  settings: AppSettings;
  appInfo: AppInfo | null;
  route: AppRoute;
  activeContactId: string | null;
  selectedEvent: CallEvent | null;
  importPreview: ImportPreview | null;
  importErrors: string[];
  settingsOpen: boolean;
  wechatScanning: boolean;
  toasts: ToastMessage[];
  navigate: (route: AppRoute) => void;
  selectContact: (contactId: string | null) => void;
  openEvent: (event: CallEvent) => void;
  closeEvent: () => void;
  setSettingsOpen: (open: boolean) => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  chooseImport: () => Promise<void>;
  scanWechat: () => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelImport: () => void;
  restoreDemo: () => Promise<void>;
  notify: (text: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);
let toastId = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [dataset, setDataset] = useState<AppDataset>(DEMO_DATASET);
  const [dataMode, setDataMode] = useState<DataMode>("demo");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [route, setRoute] = useState<AppRoute>("home");
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CallEvent | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wechatScanning, setWechatScanning] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((text: string) => {
    const id = ++toastId;
    setToasts((items) => [...items, { id, text }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 2800);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [storedSettings, storedDataset, info] = await Promise.all([
          loadSettings(),
          loadDataset(),
          getAppInfo()
        ]);
        const nextSettings = { ...DEFAULT_SETTINGS, ...(storedSettings ?? {}) };
        setSettings(nextSettings);
        setRoute(nextSettings.lastRoute);
        setAppInfo(info);
        if (storedDataset) {
          setDataset(storedDataset);
          setDataMode("imported");
          setActiveContactId(nextSettings.lastContactId ?? storedDataset.contacts[0]?.id ?? null);
        } else {
          setActiveContactId(DEMO_DATASET.contacts[0]?.id ?? null);
        }
      } catch (error) {
        notify(`无法恢复本地状态，已使用示例数据：${String(error)}`);
      } finally {
        setReady(true);
      }
    })();
  }, [notify]);

  const persistSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    try {
      await saveSettings(next);
    } catch (error) {
      notify(`设置未能保存：${String(error)}`);
    }
  }, [notify]);

  const navigate = useCallback((nextRoute: AppRoute) => {
    setRoute(nextRoute);
    void persistSettings({ ...settings, lastRoute: nextRoute });
    window.scrollTo({ top: 0, behavior: settings.reducedMotion ? "auto" : "smooth" });
  }, [persistSettings, settings]);

  const selectContact = useCallback((contactId: string | null) => {
    setActiveContactId(contactId);
    void persistSettings({ ...settings, lastContactId: contactId });
  }, [persistSettings, settings]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    await persistSettings({ ...settings, ...patch });
  }, [persistSettings, settings]);

  const scanWechat = useCallback(async () => {
    if (wechatScanning) return;
    const consent = window.confirm(
      "扫描会以只读权限读取当前微信进程内存，用于验证本机数据库密钥；数据库副本会在应用缓存中临时解密，并在正常结束后删除。解析后仅保存联系人名称和通话元数据，不保存聊天正文或密钥；这些元数据当前以未加密 JSON 保存在本机。是否继续？"
    );
    if (!consent) return;
    setWechatScanning(true);
    try {
      const result = await scanWechatCalls();
      const validation = validateDataset(result.dataset);
      if (!validation.valid || !validation.dataset) {
        throw new Error(validation.errors[0] ?? "扫描结果未通过数据校验。");
      }
      await saveDataset(validation.dataset);
      setDataset(validation.dataset);
      setDataMode("imported");
      const contactId = validation.dataset.contacts[0]?.id ?? null;
      setActiveContactId(contactId);
      await persistSettings({ ...settings, lastContactId: contactId });
      setSettingsOpen(false);
      notify(`已读取 ${result.summary.callEvents} 条微信通话记录`);
      if (result.summary.warnings.length) notify(result.summary.warnings[0]);
    } catch (error) {
      notify(`微信扫描未完成：${String(error)}`);
    } finally {
      setWechatScanning(false);
    }
  }, [notify, persistSettings, settings, wechatScanning]);

  const chooseImport = useCallback(async () => {
    setImportErrors([]);
    try {
      const file = await chooseImportFile();
      if (!file) return;
      if (file.sizeBytes > 50 * 1024 * 1024) {
        setImportErrors(["首版最多导入 50 MB 的 JSON 文件。"]);
        return;
      }
      const result = parseDataset(file.content);
      if (!result.valid || !result.dataset) {
        setImportErrors(result.errors);
        return;
      }
      setImportPreview(makeImportPreview(file.fileName, result.dataset, result.warnings));
    } catch (error) {
      setImportErrors([`无法读取文件：${String(error)}`]);
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (!importPreview) return;
    try {
      await saveDataset(importPreview.dataset);
      setDataset(importPreview.dataset);
      setDataMode("imported");
      const contactId = importPreview.dataset.contacts[0]?.id ?? null;
      setActiveContactId(contactId);
      await persistSettings({ ...settings, lastContactId: contactId });
      setImportPreview(null);
      notify(`已导入 ${importPreview.eventCount} 条通话记录`);
    } catch (error) {
      setImportErrors([`保存导入数据失败：${String(error)}`]);
    }
  }, [importPreview, notify, persistSettings, settings]);

  const restoreDemo = useCallback(async () => {
    try {
      await deleteDataset();
      setDataset(DEMO_DATASET);
      setDataMode("demo");
      const contactId = DEMO_DATASET.contacts[0]?.id ?? null;
      setActiveContactId(contactId);
      await persistSettings({ ...settings, lastContactId: contactId });
      setSettingsOpen(false);
      notify("已恢复示例数据");
    } catch (error) {
      notify(`无法删除本地导入数据：${String(error)}`);
    }
  }, [notify, persistSettings, settings]);

  const value = useMemo<AppContextValue>(() => ({
    ready,
    dataset,
    dataMode,
    settings,
    appInfo,
    route,
    activeContactId,
    selectedEvent,
    importPreview,
    importErrors,
    settingsOpen,
    wechatScanning,
    toasts,
    navigate,
    selectContact,
    openEvent: setSelectedEvent,
    closeEvent: () => setSelectedEvent(null),
    setSettingsOpen,
    updateSettings,
    chooseImport,
    scanWechat,
    confirmImport,
    cancelImport: () => { setImportPreview(null); setImportErrors([]); },
    restoreDemo,
    notify
  }), [
    activeContactId, appInfo, chooseImport, confirmImport, dataMode, dataset, importErrors,
    importPreview, navigate, notify, ready, restoreDemo, route, scanWechat, selectContact, selectedEvent,
    settings, settingsOpen, toasts, updateSettings, wechatScanning
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
