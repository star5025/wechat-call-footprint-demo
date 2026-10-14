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
import { createEmptyDataset } from "@/data/emptyDataset";
import { chooseImportFile, deleteDataset, getAppInfo, loadDataset, loadSettings, saveDataset, saveSettings, scanWechatCalls } from "@/native/bridge";
import { makeImportPreview, parseDataset, validateDataset } from "@/data/dataset";

interface ToastMessage {
  id: number;
  text: string;
}

export interface DataLoadingState {
  title: string;
  detail: string;
  progress: number;
}

export interface DataLoadSuccess {
  title: string;
  description: string;
  eventCount: number;
  contactCount: number;
  warnings: string[];
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
  dataLoading: DataLoadingState | null;
  dataLoadSuccess: DataLoadSuccess | null;
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
  selectLoadedContact: (contactId: string) => Promise<void>;
  finishWithoutContact: () => void;
  clearDataset: () => Promise<void>;
  notify: (text: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);
let toastId = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [dataset, setDataset] = useState<AppDataset>(() => createEmptyDataset());
  const [dataMode, setDataMode] = useState<DataMode>("empty");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [route, setRoute] = useState<AppRoute>("home");
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CallEvent | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wechatScanning, setWechatScanning] = useState(false);
  const [dataLoading, setDataLoading] = useState<DataLoadingState | null>(null);
  const [dataLoadSuccess, setDataLoadSuccess] = useState<DataLoadSuccess | null>(null);
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
          setDataset(createEmptyDataset());
          setDataMode("empty");
          setActiveContactId(null);
        }
      } catch (error) {
        setDataset(createEmptyDataset());
        setDataMode("empty");
        setActiveContactId(null);
        notify(`无法恢复本地状态：${String(error)}`);
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

  const finishDataLoad = useCallback(async (
    nextDataset: AppDataset,
    title: string,
    description: string,
    warnings: string[] = []
  ) => {
    await saveDataset(nextDataset);
    setDataLoading((current) => current ? {
      title: "加载完成",
      detail: "数据已完成验证并保存到本机",
      progress: 100
    } : current);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    setDataset(nextDataset);
    setDataMode("imported");
    setActiveContactId(null);
    setRoute("home");
    await persistSettings({ ...settings, lastContactId: null, lastRoute: "home" });
    setDataLoadSuccess({
      title,
      description,
      eventCount: nextDataset.events.length,
      contactCount: nextDataset.contacts.length,
      warnings
    });
  }, [persistSettings, settings]);

  const selectLoadedContact = useCallback(async (contactId: string) => {
    const contact = dataset.contacts.find((item) => item.id === contactId);
    setActiveContactId(contactId);
    setRoute("home");
    await persistSettings({ ...settings, lastContactId: contactId, lastRoute: "home" });
    setDataLoadSuccess(null);
    notify(`已选择 ${contact?.displayName ?? "联系人"}`);
  }, [dataset.contacts, notify, persistSettings, settings]);

  const finishWithoutContact = useCallback(() => {
    setDataLoadSuccess(null);
    setRoute("home");
  }, []);

  const scanWechat = useCallback(async () => {
    if (wechatScanning) return;
    const consent = window.confirm(
      "扫描会以只读权限读取当前微信进程内存，用于验证本机数据库密钥；数据库副本会在应用缓存中临时解密，并在正常结束后删除。解析后仅保存联系人名称和通话元数据，不保存聊天正文或密钥；这些元数据当前以未加密 JSON 保存在本机。是否继续？"
    );
    if (!consent) return;
    setSettingsOpen(false);
    setDataLoadSuccess(null);
    setWechatScanning(true);
    setDataLoading({
      title: "正在读取微信通话",
      detail: "正在确认已登录的微信进程",
      progress: 0
    });
    try {
      const result = await scanWechatCalls((progress) => {
        setDataLoading({
          title: progress.stage,
          detail: progress.detail,
          progress: progress.percent
        });
      });
      const validation = validateDataset(result.dataset);
      if (!validation.valid || !validation.dataset) {
        throw new Error(validation.errors[0] ?? "扫描结果未通过数据校验。");
      }
      await finishDataLoad(
        validation.dataset,
        "微信记录加载成功",
        "加载完成。请选择要查看的联系人。",
        result.summary.warnings
      );
      notify(`加载成功：${result.summary.callEvents} 条通话记录`);
    } catch (error) {
      notify(`微信扫描未完成：${String(error)}`);
    } finally {
      setDataLoading(null);
      setWechatScanning(false);
    }
  }, [finishDataLoad, notify, wechatScanning]);

  const chooseImport = useCallback(async () => {
    setImportErrors([]);
    try {
      const file = await chooseImportFile();
      if (!file) return;
      setSettingsOpen(false);
      setDataLoadSuccess(null);
      setDataLoading({
        title: "正在解析数据文件",
        detail: "文件读取完成，正在检查格式与数据契约",
        progress: 25
      });
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (file.sizeBytes > 50 * 1024 * 1024) {
        setImportErrors(["首版最多导入 50 MB 的 JSON 文件。"]);
        return;
      }
      const result = parseDataset(file.content);
      setDataLoading({
        title: "正在整理导入内容",
        detail: "格式检查完成，正在统计联系人和通话记录",
        progress: 70
      });
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!result.valid || !result.dataset) {
        setImportErrors(result.errors);
        return;
      }
      setImportPreview(makeImportPreview(file.fileName, result.dataset, result.warnings));
    } catch (error) {
      setImportErrors([`无法读取文件：${String(error)}`]);
    } finally {
      setDataLoading(null);
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (!importPreview) return;
    const preview = importPreview;
    setImportPreview(null);
    setDataLoading({
      title: "正在保存通话数据",
      detail: "正在将联系人和通话记录写入本机应用目录",
      progress: 82
    });
    try {
      await finishDataLoad(
        preview.dataset,
        "数据导入成功",
        "数据已保存到本机。请选择要查看的联系人。",
        preview.warnings
      );
      notify(`加载成功：${preview.eventCount} 条通话记录`);
    } catch (error) {
      setImportErrors([`保存导入数据失败：${String(error)}`]);
    } finally {
      setDataLoading(null);
    }
  }, [finishDataLoad, importPreview, notify]);

  const clearDataset = useCallback(async () => {
    try {
      await deleteDataset();
      setDataset(createEmptyDataset());
      setDataMode("empty");
      setDataLoadSuccess(null);
      setActiveContactId(null);
      setRoute("home");
      await persistSettings({ ...settings, lastContactId: null, lastRoute: "home" });
      setSettingsOpen(false);
      notify("本地通话数据已删除");
    } catch (error) {
      notify(`无法删除本地通话数据：${String(error)}`);
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
    dataLoading,
    dataLoadSuccess,
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
    selectLoadedContact,
    finishWithoutContact,
    clearDataset,
    notify
  }), [
    activeContactId, appInfo, chooseImport, confirmImport, dataLoadSuccess, dataLoading, dataMode, dataset,
    importErrors, clearDataset, finishWithoutContact, importPreview, navigate, notify, ready, route,
    scanWechat, selectContact, selectLoadedContact, selectedEvent, settings, settingsOpen, toasts,
    updateSettings, wechatScanning
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
