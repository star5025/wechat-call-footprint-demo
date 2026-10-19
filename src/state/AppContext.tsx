import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { scanErrorMessage } from "@/native/scanErrors";
import { isPagesDemo } from "@/runtime";

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
  scanConsentOpen: boolean;
  dataLoading: DataLoadingState | null;
  dataLoadSuccess: DataLoadSuccess | null;
  toasts: ToastMessage[];
  callsDateFilter: string | null;
  navigate: (route: AppRoute) => void;
  openCallsForDate: (date: string) => void;
  clearCallsDateFilter: () => void;
  selectContact: (contactId: string | null) => void;
  openEvent: (event: CallEvent) => void;
  closeEvent: () => void;
  setSettingsOpen: (open: boolean) => void;
  chooseImport: () => Promise<void>;
  scanWechat: () => Promise<void>;
  confirmWechatScan: () => Promise<void>;
  cancelWechatScan: () => void;
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
  const [scanConsentOpen, setScanConsentOpen] = useState(false);
  const [dataLoading, setDataLoading] = useState<DataLoadingState | null>(null);
  const [dataLoadSuccess, setDataLoadSuccess] = useState<DataLoadSuccess | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [callsDateFilter, setCallsDateFilter] = useState<string | null>(null);
  const promptedEmptyRoutes = useRef(new Set<AppRoute>());
  const activeToastTexts = useRef(new Set<string>());
  const toastQueue = useRef<ToastMessage[]>([]);
  const currentToast = useRef<ToastMessage | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showNextToast = useRef<() => void>(() => undefined);

  showNextToast.current = () => {
    if (currentToast.current || !toastQueue.current.length) return;
    const next = toastQueue.current.shift()!;
    currentToast.current = next;
    setToasts([next]);
    toastTimer.current = window.setTimeout(() => {
      activeToastTexts.current.delete(next.text);
      currentToast.current = null;
      toastTimer.current = null;
      setToasts([]);
      showNextToast.current();
    }, 3200);
  };

  const notify = useCallback((text: string) => {
    if (activeToastTexts.current.has(text)) return;
    activeToastTexts.current.add(text);
    toastQueue.current.push({ id: ++toastId, text });
    showNextToast.current();
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastQueue.current = [];
    currentToast.current = null;
    activeToastTexts.current.clear();
  }, []);

  useEffect(() => {
    if (dataMode === "imported") promptedEmptyRoutes.current.clear();
  }, [dataMode]);

  useEffect(() => {
    void (async () => {
      try {
        const [storedSettings, storedDataset, info] = await Promise.all([
          loadSettings(),
          loadDataset(),
          getAppInfo()
        ]);
        const nextSettings = { ...DEFAULT_SETTINGS, ...(storedSettings ?? {}) };
        setSettings({ ...nextSettings, lastRoute: "home" });
        setRoute("home");
        setAppInfo(info);
        if (storedDataset) {
          setDataset(storedDataset);
          setDataMode("imported");
          setActiveContactId(storedDataset.contacts.some((contact) => contact.id === nextSettings.lastContactId)
            ? nextSettings.lastContactId : storedDataset.contacts[0]?.id ?? null);
        } else {
          setDataset(createEmptyDataset());
          setDataMode("empty");
          setActiveContactId(null);
        }
      } catch {
        setDataset(createEmptyDataset());
        setDataMode("empty");
        setActiveContactId(null);
        notify("无法打开上次保存的内容，请重新读取或从文件打开");
      } finally {
        setReady(true);
      }
    })();
  }, [notify]);

  const persistSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    try {
      await saveSettings(next);
    } catch {
      notify("设置未能保存，请稍后重试");
    }
  }, [notify]);

  const navigate = useCallback((nextRoute: AppRoute) => {
    if (
      nextRoute !== "home" &&
      dataset.events.length === 0 &&
      !promptedEmptyRoutes.current.has(nextRoute)
    ) {
      promptedEmptyRoutes.current.add(nextRoute);
      notify("添加通话记录后可使用完整功能");
    }
    if (nextRoute === "calls") setCallsDateFilter(null);
    setRoute(nextRoute);
    void persistSettings({ ...settings, lastRoute: nextRoute });
    window.scrollTo({ top: 0, behavior: settings.reducedMotion ? "auto" : "smooth" });
  }, [dataset.events.length, notify, persistSettings, settings]);

  const openCallsForDate = useCallback((date: string) => {
    setCallsDateFilter(date);
    setRoute("calls");
    void persistSettings({ ...settings, lastRoute: "calls" });
    window.scrollTo({ top: 0, behavior: settings.reducedMotion ? "auto" : "smooth" });
  }, [persistSettings, settings]);

  const selectContact = useCallback((contactId: string | null) => {
    setActiveContactId(contactId);
    void persistSettings({ ...settings, lastContactId: contactId });
  }, [persistSettings, settings]);

  const finishDataLoad = useCallback(async (
    nextDataset: AppDataset,
    title: string,
    description: string,
    warnings: string[] = []
  ) => {
    await saveDataset(nextDataset);
    setDataLoading((current) => current ? {
      title: "准备完成",
      detail: "请选择要查看的联系人",
      progress: 100
    } : current);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 650));
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
    if (isPagesDemo || wechatScanning) return;
    setSettingsOpen(false);
    setScanConsentOpen(true);
  }, [wechatScanning]);

  const cancelWechatScan = useCallback(() => setScanConsentOpen(false), []);

  const confirmWechatScan = useCallback(async () => {
    if (isPagesDemo || wechatScanning) return;
    setScanConsentOpen(false);
    setDataLoadSuccess(null);
    setWechatScanning(true);
    setDataLoading({
      title: "正在读取通话记录",
      detail: "请保持微信打开",
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
        throw new Error("读取到的内容暂时无法使用");
      }
      await finishDataLoad(
        validation.dataset,
        "微信通话记录已准备好",
        "请选择要查看的联系人。",
        result.summary.warnings
      );
      notify(`已读取 ${result.summary.callEvents} 条通话记录`);
    } catch (error) {
      notify(scanErrorMessage(error));
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
        title: "正在读取通话记录",
        detail: "请稍候",
        progress: 25
      });
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (file.sizeBytes > 50 * 1024 * 1024) {
        setImportErrors(["这个文件太大，请选择较小的通话记录文件。"]);
        return;
      }
      const result = parseDataset(file.content);
      setDataLoading({
        title: "正在整理通话记录",
        detail: "请稍候",
        progress: 70
      });
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!result.valid || !result.dataset) {
        setImportErrors(result.errors);
        return;
      }
      setImportPreview(makeImportPreview(file.fileName, result.dataset, result.warnings));
    } catch {
      setImportErrors(["无法打开这个文件，请重新选择。"]);
    } finally {
      setDataLoading(null);
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (!importPreview) return;
    const preview = importPreview;
    setImportPreview(null);
    setDataLoading({
      title: "正在保存通话记录",
      detail: "请稍候",
      progress: 82
    });
    try {
      await finishDataLoad(
        preview.dataset,
        "通话记录已打开",
        "记录已保存在这台电脑上。请选择要查看的联系人。",
        preview.warnings
      );
      notify(`已打开 ${preview.eventCount} 条通话记录`);
    } catch {
      setImportErrors(["保存失败，请稍后重试。"]);
    } finally {
      setDataLoading(null);
    }
  }, [finishDataLoad, importPreview, notify]);

  const clearDataset = useCallback(async () => {
    try {
      if (isPagesDemo) {
        const nextDataset = await loadDataset();
        if (!nextDataset) return;
        setDataset(nextDataset);
        setDataMode("imported");
        setActiveContactId(nextDataset.contacts[0]?.id ?? null);
        setSelectedEvent(null);
        setCallsDateFilter(null);
        setDataLoadSuccess(null);
        setRoute("home");
        await persistSettings({ ...DEFAULT_SETTINGS });
        setSettingsOpen(false);
        notify("已重置");
        return;
      }
      await deleteDataset();
      setDataset(createEmptyDataset());
      setDataMode("empty");
      setDataLoadSuccess(null);
      setActiveContactId(null);
      setRoute("home");
      await persistSettings({ ...settings, lastContactId: null, lastRoute: "home" });
      setSettingsOpen(false);
      notify("已保存的通话记录已删除");
    } catch {
      notify("删除失败，请稍后重试")
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
    scanConsentOpen,
    dataLoading,
    dataLoadSuccess,
    toasts,
    callsDateFilter,
    navigate,
    openCallsForDate,
    clearCallsDateFilter: () => setCallsDateFilter(null),
    selectContact,
    openEvent: setSelectedEvent,
    closeEvent: () => setSelectedEvent(null),
    setSettingsOpen,
    chooseImport,
    scanWechat,
    confirmWechatScan,
    cancelWechatScan,
    confirmImport,
    cancelImport: () => { setImportPreview(null); setImportErrors([]); },
    selectLoadedContact,
    finishWithoutContact,
    clearDataset,
    notify
  }), [
    activeContactId, appInfo, callsDateFilter, cancelWechatScan, chooseImport, confirmImport, confirmWechatScan,
    dataLoadSuccess, dataLoading, dataMode, dataset, importErrors, clearDataset, finishWithoutContact,
    importPreview, navigate, notify, openCallsForDate, ready, route, scanConsentOpen, scanWechat, selectContact,
    selectLoadedContact, selectedEvent, settings, settingsOpen, toasts, wechatScanning
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
