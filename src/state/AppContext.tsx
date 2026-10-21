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
  AccountCollection,
  AppDataset,
  AppInfo,
  AppRoute,
  AppSettings,
  DataMode,
  ImportPreview,
  WechatScanResult
} from "@/domain";
import { DEFAULT_SETTINGS } from "@/domain";
import { createAccountCollection, validateAccountCollection, upsertAccountDataset, removeAccountDataset, projectAccountCollection, linkContacts as linkCollectionContacts, unlinkContacts as unlinkCollectionContacts } from "@/data/accountCollection";
import { chooseImportFile, deleteDataset, getAppInfo, loadAccountCollection, loadSettings, saveAccountCollection, saveSettings, scanWechatCalls } from "@/native/bridge";
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
  collection: AccountCollection;
  accountScope: string | null;
  setAccountScope: (id: string | null) => void;
  accountsOpen: boolean;
  setAccountsOpen: (open: boolean) => void;
  removeAccount: (id: string) => Promise<void>;
  linkContacts: (members: AccountCollection["links"][number]["members"]) => Promise<void>;
  unlinkContacts: (index: number) => Promise<void>;
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
  macSetupOpen: boolean;
  closeMacSetup: () => void;
  completeMacSetup: (result: WechatScanResult) => Promise<void>;
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
  const [collection, setCollection] = useState<AccountCollection>(() => createAccountCollection());
  const collectionRef = useRef(collection);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const acquisitionBusy = useRef(false);
  const importBusy = useRef(false);
  const [accountScope, setScope] = useState<string | null>(null);
  const scopeRef = useRef<string | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const dataset = useMemo(() => projectAccountCollection(collection, accountScope), [collection, accountScope]);
  const dataMode: DataMode = collection.datasets.length ? "imported" : "empty";
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [route, setRoute] = useState<AppRoute>("home");
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CallEvent | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wechatScanning, setWechatScanning] = useState(false);
  const [scanConsentOpen, setScanConsentOpen] = useState(false);
  const [macSetupOpen, setMacSetupOpen] = useState(false);
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
        const [storedSettings, storedCollection, info] = await Promise.all([
          loadSettings(),
          loadAccountCollection(),
          getAppInfo()
        ]);
        const nextSettings = { ...DEFAULT_SETTINGS, ...(storedSettings ?? {}) };
        setSettings({ ...nextSettings, lastRoute: "home" });
        setRoute("home");
        setAppInfo(info);
        const nextCollection = storedCollection ?? createAccountCollection();
        const requestedScope = storedSettings && Object.hasOwn(storedSettings, "lastAccountId")
          ? storedSettings.lastAccountId ?? null : nextCollection.datasets[0]?.account.id ?? null;
        const scope = nextCollection.datasets.some((item) => item.account.id === requestedScope) ? requestedScope : null;
        collectionRef.current = nextCollection;
        setCollection(nextCollection);
        scopeRef.current = scope;
        setScope(scope);
        const projection = projectAccountCollection(nextCollection, scope);
        setActiveContactId(projection.contacts.some((contact) => contact.id === nextSettings.lastContactId)
          ? nextSettings.lastContactId : projection.contacts[0]?.id ?? null);
      } catch {
        collectionRef.current = createAccountCollection();
        setCollection(collectionRef.current);
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

  const enqueueMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const task = mutationQueue.current.then(operation);
    mutationQueue.current = task.catch(() => undefined);
    return task;
  }, []);

  const publishCollection = useCallback((next: AccountCollection, requestedScope = scopeRef.current) => {
    const scope = next.datasets.some((item) => item.account.id === requestedScope) ? requestedScope : null;
    const projection = projectAccountCollection(next, scope);
    collectionRef.current = next;
    setCollection(next);
    scopeRef.current = scope;
    setScope(scope);
    setSelectedEvent(null);
    setCallsDateFilter(null);
    setActiveContactId((current) => projection.contacts.some((item) => item.id === current)
      ? current : projection.contacts[0]?.id ?? null);
    return projection;
  }, []);

  const setAccountScope = useCallback((id: string | null) => {
    publishCollection(collectionRef.current, id);
  }, [publishCollection]);

  useEffect(() => {
    if (ready && settings.lastAccountId !== accountScope) {
      void persistSettings({ ...settings, lastAccountId: accountScope });
    }
  }, [accountScope, persistSettings, ready, settings]);

  const mutateCollection = useCallback((transform: (current: AccountCollection) => AccountCollection) =>
    enqueueMutation(async () => {
      const next = transform(collectionRef.current);
      await saveAccountCollection(next);
      publishCollection(next);
      setDataLoadSuccess(null);
    }), [enqueueMutation, publishCollection]);

  const removeAccount = useCallback((id: string) => mutateCollection((current) => removeAccountDataset(current, id)), [mutateCollection]);
  const linkContacts = useCallback((members: AccountCollection["links"][number]["members"]) =>
    mutateCollection((current) => linkCollectionContacts(current, members)), [mutateCollection]);
  const unlinkContacts = useCallback((index: number) => {
    const target = collectionRef.current.links[index];
    if (!target) return Promise.resolve();
    const key = JSON.stringify(target);
    return mutateCollection((current) => {
      const currentIndex = current.links.findIndex((link) => JSON.stringify(link) === key);
      return currentIndex < 0 ? current : unlinkCollectionContacts(current, currentIndex);
    });
  }, [mutateCollection]);

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
    if (contactId === activeContactId) return;
    setActiveContactId(contactId);
    setSelectedEvent(null);
    void persistSettings({ ...settings, lastContactId: contactId });
  }, [activeContactId, persistSettings, settings]);

  const finishDataLoad = useCallback(async (
    nextDataset: AppDataset,
    title: string,
    description: string,
    warnings: string[] = [],
    incomingCollection?: AccountCollection
  ) => enqueueMutation(async () => {
    let next = collectionRef.current;
    for (const incoming of incomingCollection?.datasets ?? [nextDataset]) next = upsertAccountDataset(next, incoming);
    const linkKey = (members: AccountCollection["links"][number]["members"]) =>
      JSON.stringify(members.map((member) => JSON.stringify([member.accountId, member.contactId])).sort());
    for (const link of incomingCollection?.links ?? []) {
      if (!next.links.some((existing) => linkKey(existing.members) === linkKey(link.members))) {
        next = linkCollectionContacts(next, link.members);
      }
    }
    await saveAccountCollection(next);
    const projection = publishCollection(next, incomingCollection ? null : nextDataset.account.id);
    setRoute("home");
    await persistSettings({ ...settings, lastAccountId: scopeRef.current, lastRoute: "home" });
    setDataLoadSuccess({ title, description, eventCount: projection.events.length, contactCount: projection.contacts.length, warnings });
  }), [enqueueMutation, persistSettings, publishCollection, settings]);

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
    if (isPagesDemo || acquisitionBusy.current || wechatScanning || macSetupOpen) return;
    setSettingsOpen(false);
    if (appInfo?.platform === "macos" && appInfo.isTauri) {
      setMacSetupOpen(true);
    } else {
      setScanConsentOpen(true);
    }
  }, [appInfo, macSetupOpen, wechatScanning]);

  const closeMacSetup = useCallback(() => setMacSetupOpen(false), []);

  const completeMacSetup = useCallback(async (result: WechatScanResult) => {
    if (isPagesDemo || appInfo?.platform !== "macos" || !appInfo.isTauri) {
      throw new Error("MACOS_SETUP_NATIVE_REQUIRED");
    }
    const validation = validateDataset(result.dataset);
    if (!validation.valid || !validation.dataset) throw new Error("MACOS_SETUP_RESULT_INVALID");
    if (acquisitionBusy.current) return;
    acquisitionBusy.current = true;
    try {
      await finishDataLoad(
        validation.dataset,
        "微信通话记录已准备好",
        "请选择要查看的联系人。",
        result.summary.warnings.length ? ["部分内容未能完整读取，请检查微信中的记录后重试。"] : []
      );
      notify(`已读取 ${validation.dataset.events.length} 条通话记录`);
    } catch {
      throw new Error("MACOS_SETUP_SAVE_FAILED");
    } finally {
      acquisitionBusy.current = false;
    }
  }, [appInfo, finishDataLoad, notify]);

  const cancelWechatScan = useCallback(() => setScanConsentOpen(false), []);

  const confirmWechatScan = useCallback(async () => {
    if (isPagesDemo || acquisitionBusy.current || wechatScanning) return;
    acquisitionBusy.current = true;
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
      acquisitionBusy.current = false;
    }
  }, [finishDataLoad, notify, wechatScanning]);

  const chooseImport = useCallback(async () => {
    if (isPagesDemo || acquisitionBusy.current) return;
    acquisitionBusy.current = true;
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
      const parsed: unknown = JSON.parse(file.content);
      let incomingCollection: AccountCollection | undefined;
      if (parsed && typeof parsed === "object" && "format" in parsed && parsed.format === "call-footprint-collection") {
        incomingCollection = validateAccountCollection(parsed);
      }
      const result = incomingCollection
        ? { valid: true, dataset: projectAccountCollection(incomingCollection, null), errors: [], warnings: [] }
        : parseDataset(file.content);
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
      setImportPreview({ ...makeImportPreview(file.fileName, result.dataset, result.warnings), collection: incomingCollection });
    } catch {
      setImportErrors(["无法打开这个文件，请重新选择。"]);
    } finally {
      acquisitionBusy.current = false;
      setDataLoading(null);
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (isPagesDemo || !importPreview || importBusy.current) return;
    importBusy.current = true;
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
        preview.warnings,
        preview.collection
      );
      notify(`已打开 ${preview.eventCount} 条通话记录`);
    } catch {
      setImportErrors(["保存失败，请稍后重试。"]);
    } finally {
      importBusy.current = false;
      setDataLoading(null);
    }
  }, [finishDataLoad, importPreview, notify]);

  const clearDataset = useCallback(async () => {
    try {
      await enqueueMutation(async () => {
        const next = isPagesDemo ? await loadAccountCollection() : createAccountCollection();
        if (!next) return;
        if (!isPagesDemo) await deleteDataset();
        publishCollection(next, isPagesDemo ? next.datasets[0]?.account.id ?? null : null);
        setDataLoadSuccess(null);
        setRoute("home");
        await persistSettings({ ...settings, lastContactId: null, lastAccountId: scopeRef.current, lastRoute: "home" });
        setSettingsOpen(false);
        notify(isPagesDemo ? "已重置" : "已保存的通话记录已删除");
      });
    } catch {
      notify("删除失败，请稍后重试");
    }
  }, [enqueueMutation, notify, persistSettings, publishCollection, settings]);

  const value = useMemo<AppContextValue>(() => ({
    ready,
    collection, accountScope, setAccountScope, accountsOpen, setAccountsOpen, removeAccount, linkContacts, unlinkContacts,
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
    macSetupOpen,
    closeMacSetup,
    completeMacSetup,
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
    collection, accountScope, setAccountScope, accountsOpen, removeAccount, linkContacts, unlinkContacts,
    activeContactId, appInfo, callsDateFilter, cancelWechatScan, chooseImport, closeMacSetup, completeMacSetup, confirmImport, confirmWechatScan, macSetupOpen,
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
