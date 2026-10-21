import { useEffect, useRef, useState } from "react";
import type { WechatScanResult } from "@/domain";
import { cancelMacSetup, initializeMacSetup, preflightMacSetup, scanMacSetup } from "@/native/bridge";
import {
  MAC_RECOVERY_GUIDANCE, macSetupAvailability, macSetupInitializationIssue, macSetupIssue, macSetupProgress,
  macSetupVersion, selectMacSetupAccount,
  type MacSetupAction, type MacSetupProgress, type MacSetupStatus
} from "@/macSetup";

export interface MacSetupDialogProps {
  onClose: () => void;
  onComplete: (result: WechatScanResult) => Promise<void>;
}

interface PendingAction {
  epoch: number;
  cancelled: boolean;
  saving: boolean;
  cancelRequest: Promise<void> | null;
  cancelFailed: boolean;
}

export function MacSetupDialog({ onClose, onComplete }: MacSetupDialogProps) {
  const [status, setStatus] = useState<MacSetupStatus | null>(null);
  const [accountId, setAccountId] = useState("");
  const [view, setView] = useState<"status" | "initialize" | "consent">("status");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<MacSetupAction | null>("check");
  const [cleaning, setCleaning] = useState(false);
  const [progress, setProgress] = useState<MacSetupProgress | null>(null);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState(false);
  const pending = useRef<PendingAction | null>(null);
  const epoch = useRef(0);
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const available = macSetupAvailability(status, accountId);
  const recoveryRequired = recovery || available.recoveryRequired;

  function closeIdle() {
    if (!pending.current) close.current();
  }

  async function run(action: "check" | "initialize" | "scan") {
    if (pending.current) return;
    if (action !== "check" && (recoveryRequired || (action === "initialize"
      ? !available.canInitialize || !acknowledged : !available.canRead || view !== "consent"))) return;
    const current: PendingAction = {
      epoch: ++epoch.current, cancelled: false, saving: false, cancelRequest: null, cancelFailed: false
    };
    pending.current = current;
    const isCurrent = () => epoch.current === current.epoch && pending.current === current;
    setBusy(action);
    setCleaning(false);
    setMessage("");
    setProgress(null);
    let nextStatus: MacSetupStatus | null = null;
    let initializationStatus: MacSetupStatus | null = null;
    let result: WechatScanResult | null = null;
    let failure: unknown = null;
    const onProgress = (value: MacSetupProgress) => {
      if (isCurrent() && !current.cancelled) setProgress(macSetupProgress(value, action));
    };
    try {
      if (action === "check") nextStatus = await preflightMacSetup();
      else if (action === "initialize") initializationStatus = await initializeMacSetup(accountId, acknowledged, onProgress);
      else result = await scanMacSetup(accountId, onProgress);
    } catch (error) {
      failure = error;
    }
    // The cancel command only requests cancellation; the original invocation must settle too.
    await current.cancelRequest;
    if (!isCurrent()) return;
    const initializationIssue = initializationStatus ? macSetupInitializationIssue(initializationStatus) : null;
    // A recovery outcome is sticky until the user explicitly requests a new check.
    if (initializationIssue?.recoveryRequired || macSetupIssue(failure).recoveryRequired) {
      nextStatus = initializationStatus;
    } else if (action !== "check") {
      try {
        nextStatus = await preflightMacSetup();
      } catch (error) {
        if (!failure || macSetupIssue(error).recoveryRequired) failure = error;
      }
    }
    await current.cancelRequest;
    if (!isCurrent()) return;
    const failureIssue = failure ? macSetupIssue(failure) : null;
    const issue = failureIssue?.recoveryRequired ? failureIssue : initializationIssue ?? failureIssue;
    const cleanupUnconfirmed = action !== "check" && !nextStatus;
    setRecovery((previous) => action === "check" && current.cancelled
      ? previous || Boolean(issue?.recoveryRequired)
      : cleanupUnconfirmed || Boolean(issue?.recoveryRequired));
    // A cancelled check must not install an old account selection.
    setStatus(action === "check" && current.cancelled ? null : nextStatus);
    if (nextStatus && !(action === "check" && current.cancelled)) {
      setAccountId((previous) => selectMacSetupAccount(nextStatus, previous));
    }
    setAcknowledged(false);
    setView("status");
    try {
      if (cleanupUnconfirmed || issue?.recoveryRequired || nextStatus?.recoveryRequired) {
        setMessage(MAC_RECOVERY_GUIDANCE);
      } else if (current.cancelled) {
        setMessage(current.cancelFailed
          ? "取消请求未获确认，操作现已结束。请检查微信状态后重试；原有通话记录未改变。"
          : "操作已取消，原有通话记录未改变。");
      } else if (issue) {
        setMessage(issue.message);
      } else if (!nextStatus) {
        setMessage("无法确认清理状态，请点“重试”。确认前不会初始化或读取。");
      } else if (action === "initialize") {
        setMessage(nextStatus.accounts.find((account) => account.id === accountId)?.keyReady
          ? "密钥已就绪。请正常退出临时微信副本；准备好后另行点击“读取”。"
          : "密钥尚未就绪，请检查微信登录状态后重试。未开始读取。");
      } else if (result && !macSetupAvailability(nextStatus, accountId).canRead) {
        setMessage("账号状态已变化，未保存本次读取。请重新检查，原有通话记录未改变。");
      } else if (result) {
        current.saving = true;
        setBusy("save");
        setProgress({ stage: "正在保存", detail: "正在本机保存通话记录。", percent: 100 });
        await onComplete(result);
        if (isCurrent()) close.current();
      }
    } catch (error) {
      if (isCurrent()) setMessage(macSetupIssue(error).message);
    } finally {
      if (isCurrent()) {
        pending.current = null;
        setBusy(null);
        setCleaning(false);
        setProgress(null);
      }
    }
  }

  function requestCancel() {
    const current = pending.current;
    if (!current || current.cancelled || current.saving) return;
    current.cancelled = true;
    setCleaning(true);
    current.cancelRequest = cancelMacSetup().catch(() => { current.cancelFailed = true; });
  }

  useEffect(() => {
    const mountedEpoch = epoch.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    // StrictMode's discarded mount cannot start a second native operation.
    queueMicrotask(() => { if (epoch.current === mountedEpoch) void run("check"); });
    return () => {
      ++epoch.current;
      const current = pending.current;
      pending.current = null;
      if (current && !current.saving && !current.cancelRequest) void cancelMacSetup().catch(() => undefined);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeIdle(); }
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled)");
      if (!controls?.length) { event.preventDefault(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      const outside = !dialog.current?.contains(document.activeElement);
      if (event.shiftKey && (outside || document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (outside || document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="modal-backdrop scan-consent-backdrop" role="presentation" onMouseDown={closeIdle}>
      <section ref={dialog} tabIndex={-1} className="scan-consent-dialog" role="dialog" aria-modal="true"
        aria-labelledby="mac-setup-title" aria-busy={Boolean(busy)} style={{ maxHeight: "90vh", overflowY: "auto" }}
        onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="关闭设置" disabled={Boolean(busy)} onClick={closeIdle}>×</button>
        <h2 id="mac-setup-title">{view === "consent" ? "读取微信通话记录" : view === "initialize" ? "初始化微信密钥" : "Mac 微信准备"}</h2>
        <p className="dialog-subtitle">微信版本：{macSetupVersion(status?.wechatVersion)}</p>
        {status && <div className="scan-consent-list">
          <div><span>账号</span><p>
            <label htmlFor="mac-setup-account"><strong>选择本机账号</strong></label>
            <select id="mac-setup-account" value={accountId} disabled={Boolean(busy) || recoveryRequired}
              onChange={(event) => { setAccountId(event.target.value); setAcknowledged(false); setView("status"); setMessage(""); }}>
              {!status.accounts.length && <option value="">暂无账号</option>}
              {status.accounts.map((account, index) => <option key={account.id} value={account.id}>账号 {index + 1}</option>)}
            </select>
            <small>{available.account ? available.account.keyReady ? "密钥已就绪" : "需要初始化密钥" : "请先登录原版微信并进入聊天，再正常退出微信后重试。"}</small>
          </p></div>
        </div>}
        {recoveryRequired && <p className="load-success-warning" role="alert">{MAC_RECOVERY_GUIDANCE}</p>}
        {!recoveryRequired && status?.blocker && <p className="load-success-warning">初始化暂不可用：{macSetupIssue(status.blocker).message}{available.canRead ? " 已就绪账号仍可读取。" : ""}</p>}
        {/* Initialization is intentionally separate from the read-only consent. */}
        {view === "initialize" && <div className="scan-consent-list">
          <div><span>01</span><p><strong>使用临时调试副本</strong><small>初始化会创建经过修改、可调试的微信临时副本，不会修改原版微信。请先从微信菜单正常退出原版，不要强制结束正在写入的微信。</small></p></div>
          <div><span>02</span><p><strong>副本可访问真实数据</strong><small>临时副本能够访问真实微信数据和网络，可能要求登录、改变登录状态或同步内容。初始化不是仅只读的扫描，请自行确认微信窗口中的操作。</small></p></div>
          <div><span>03</span><p><strong>密钥保存在本机</strong><small>数据库密钥会保存在当前用户的私有目录中，但没有额外加密。请保护本机账号。无需也不要关闭 SIP、Gatekeeper 等系统安全保护；若系统阻止，请停止操作。</small></p></div>
          <label><input type="checkbox" checked={acknowledged} disabled={Boolean(busy)} onChange={(event) => setAcknowledged(event.target.checked)} />我已理解上述风险，并已正常退出原版微信</label>
        </div>}
        {view === "consent" && <div className="scan-consent-list">
          <div><span>01</span><p><strong>仅本次读取</strong><small>使用已保存的密钥，在本机复制并读取所选账号的记录；本次读取不会初始化密钥，也不会启动或修改微信副本。</small></p></div>
          <div><span>02</span><p><strong>完成后清理</strong><small>临时读取内容会在完成或取消后清理。只保存联系人、头像、通话时间和时长等通话信息，不保存聊天内容。</small></p></div>
          <div><span>03</span><p><strong>记录留在本机</strong><small>通话记录不会上传，但没有额外密码保护。新账号会加入本应用，已有账号会更新并去重；失败或取消不会改变原有记录。</small></p></div>
        </div>}
        {message && !recoveryRequired && <p className="load-success-warning" role="status">{message}</p>}
        {busy && <div aria-live="polite">
          <div className="actual-progress-label"><span>{cleaning ? "正在清理" : progress?.stage ?? (busy === "check" ? "正在检查" : busy === "save" ? "正在保存" : busy === "initialize" ? "正在初始化" : "正在读取")}</span><strong>{Math.round(progress?.percent ?? 0)}%</strong></div>
          <div className="actual-progress-track" role="progressbar" aria-label="处理进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress?.percent ?? 0)}><i style={{ width: `${progress?.percent ?? 0}%` }} /></div>
          <p>{cleaning ? "已请求取消，请等待原生操作和清理结束。此时不要退出应用。" : progress?.detail ?? "请稍候，确认状态前不会读取记录。"}</p>
        </div>}
        <div className="dialog-buttons scan-consent-actions">
          {busy ? <button className="secondary-action" disabled={cleaning || busy === "save"} onClick={requestCancel}>{cleaning ? "正在清理" : busy === "save" ? "保存中" : "取消"}</button> : <>
            <button className="secondary-action" onClick={closeIdle}>关闭</button>
            <button className="secondary-action" onClick={() => void run("check")}>重试</button>
            {!recoveryRequired && view === "status" && available.canRead && <button className="primary-action" onClick={() => { setMessage(""); setView("consent"); }}>读取</button>}
            {!recoveryRequired && view === "status" && available.canInitialize && <button className="primary-action" onClick={() => { setAcknowledged(false); setMessage(""); setView("initialize"); }}>准备密钥</button>}
            {!recoveryRequired && view === "initialize" && <button className="primary-action" disabled={!acknowledged || !available.canInitialize} onClick={() => void run("initialize")}>初始化</button>}
            {!recoveryRequired && view === "consent" && <button className="primary-action" disabled={!available.canRead} onClick={() => void run("scan")}>同意读取</button>}
          </>}
        </div>
      </section>
    </div>
  );
}
