import type { WechatScanProgress } from "@/domain";
import { scanErrorMessage } from "@/native/scanErrors";

export interface MacSetupAccount {
  id: string;
  label: string;
  keyReady: boolean;
}

export interface MacSetupStatus {
  accounts: MacSetupAccount[];
  wechatVersion: string | null;
  canInitialize: boolean;
  blocker: string | null;
  recoveryRequired: boolean;
}

export type MacSetupProgress = WechatScanProgress;
export type MacSetupAction = "check" | "initialize" | "scan" | "save";

export const MAC_RECOVERY_GUIDANCE = "清理尚未完成，已暂停初始化和读取。请正常退出临时微信副本及调试工具，不要删除原版微信或微信数据，不要关闭系统安全保护。强制中断后的恢复标记不会自动清除；请停止操作，待人工核验本次私有状态后再重试。";

export function selectMacSetupAccount(status: MacSetupStatus, previousId: string): string {
  return status.accounts.some((account) => account.id === previousId)
    ? previousId : status.accounts[0]?.id ?? "";
}

export function macSetupAvailability(status: MacSetupStatus | null, accountId: string) {
  const account = status?.accounts.find((item) => item.id === accountId);
  const recoveryRequired = status?.recoveryRequired === true;
  return {
    account,
    recoveryRequired,
    canRead: Boolean(account?.keyReady && !recoveryRequired),
    canInitialize: Boolean(account && !account.keyReady && status?.canInitialize && !status.blocker && !recoveryRequired)
  };
}

function errorCode(error: unknown): string {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return /^\[(MACOS_[A-Z0-9_]+)\](?:\s|$)/.exec(text)?.[1]
    ?? /^(MACOS_[A-Z0-9_]+)(?::|\s|$)/.exec(text)?.[1] ?? "";
}

const SETUP_MESSAGES: Record<string, string> = {
  MACOS_ONLY: "此功能仅适用于 Mac 桌面版。",
  MACOS_SETUP_NATIVE_REQUIRED: "请在 Mac 桌面版中使用此功能。",
  MACOS_STATE_SECURITY: "本机私有状态无法安全验证，请检查本应用的访问权限；不要放宽密钥文件权限。",
  MACOS_INITIALIZE_FAILED: "初始化未完成，请确认登录的是所选账号后重试。未开始读取通话记录。",
  MACOS_ACCOUNT_INVALID: "账号状态已变化，请点“重试”后重新选择账号。",
  MACOS_ACK_REQUIRED: "请先阅读并勾选初始化说明。",
  MACOS_NATIVE_ARM64_REQUIRED: "初始化需要原生 Apple Silicon 会话，不支持 Intel 或 Rosetta。已就绪账号仍可读取。",
  MACOS_DEVELOPER_MODE_REQUIRED: "初始化需要已获授权的开发者模式。本应用不会启用该模式或关闭系统安全保护；请先确认系统的开发者模式状态，或使用已就绪账号读取。",
  MACOS_LLDB_REQUIRED: "缺少调试工具，请安装苹果官方 Xcode 命令行工具及配套 LLDB 后重试。",
  MACOS_PYTHON_LLDB_REQUIRED: "系统 Python 无法使用 LLDB，请检查苹果官方开发工具是否完整安装。",
  MACOS_HELPER_MISSING: "安装包缺少初始化组件，请重新安装完整的 Mac 桌面版。",
  MACOS_WECHAT_MUST_QUIT: "请从微信菜单正常退出原版微信，再点“重试”。",
  MACOS_PROCESS_CHECK_FAILED: "无法确认微信已正常退出，请检查微信状态后重试。",
  MACOS_SETUP_UNSUPPORTED: "当前环境不支持初始化，请使用已适配的官方微信版本。",
  MACOS_SETUP_CONSENT_REQUIRED: "请先阅读并勾选初始化说明。",
  MACOS_SETUP_ACK_REQUIRED: "请先阅读并勾选初始化说明。",
  MACOS_SETUP_WECHAT_RUNNING: "请从微信菜单正常退出原版微信，再点“重试”。",
  MACOS_WECHAT_RUNNING: "请从微信菜单正常退出原版微信，再点“重试”。",
  MACOS_SETUP_TOOLS_MISSING: "缺少初始化所需工具，请安装所需开发工具后重试。",
  MACOS_SETUP_BUSY: "另一个操作尚未结束，请等待清理完成后重试。",
  MACOS_SETUP_CANCELLED: "操作已取消，原有通话记录未改变。",
  MACOS_CANCELLED: "操作已取消，原有通话记录未改变。",
  MACOS_SETUP_TIMEOUT: "等待超时，请正常退出临时微信副本后重试。",
  MACOS_SETUP_FAILED: "初始化未完成，请正常退出临时微信副本后重试。",
  MACOS_SETUP_CHECK_FAILED: "状态检查失败，请重试。",
  MACOS_SETUP_RESULT_INVALID: "读取到的内容无法使用，原有通话记录未改变。",
  MACOS_SETUP_SAVE_FAILED: "保存失败，原有通话记录未改变，请重试。"
};

export function macSetupIssue(error: unknown): { message: string; recoveryRequired: boolean } {
  const code = errorCode(error);
  const recoveryRequired = /^MACOS_(?:SETUP_)?(?:CLEANUP_FAILED|RECOVERY_REQUIRED|RECOVERY_FAILED)$/.test(code);
  if (recoveryRequired) return { message: MAC_RECOVERY_GUIDANCE, recoveryRequired: true };
  const scanMessage = scanErrorMessage(code);
  return {
    message: SETUP_MESSAGES[code] ?? (scanMessage !== "读取失败，请重试" ? scanMessage : "操作未完成，请重试；原有通话记录未改变。"),
    recoveryRequired: false
  };
}

export function macSetupInitializationIssue(status: MacSetupStatus) {
  if (status.recoveryRequired) return { message: MAC_RECOVERY_GUIDANCE, recoveryRequired: true };
  return status.blocker ? macSetupIssue(status.blocker) : null;
}

export function macSetupVersion(version: string | null | undefined): string {
  return version && /^\d+(?:\.\d+){1,3}$/.test(version) ? version : "未确认";
}

// Native events can contain diagnostics. Only the percentage crosses into the UI.
export function macSetupProgress(progress: MacSetupProgress, action: MacSetupAction): MacSetupProgress {
  const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0;
  const cleaning = ["cancelling", "cleanup", "cleaning", "restoring"].includes(progress.stage);
  return {
    stage: cleaning ? "正在清理" : action === "initialize" ? "正在初始化" : "正在读取",
    detail: cleaning ? "请等待原生操作和清理结束，不要退出应用。" : action === "initialize" ? "请留意临时微信窗口的提示，不要关闭此窗口。" : "正在本机整理通话记录，请稍候。",
    percent
  };
}
