import type { CallDirection, CallMediaType, CallOutcome } from "@contracts/models";

export const pad = (value: number) => String(value).padStart(2, "0");

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "时长未知";
  if (seconds === 0) return "未接通";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours) return `${hours}小时 ${minutes}分${remaining ? ` ${remaining}秒` : ""}`;
  return `${minutes}分 ${pad(remaining)}秒`;
}

export function formatCompactDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}

export function formatDate(date: string): string {
  return `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`;
}

export function formatTime(dateTime: string | null): string {
  return dateTime?.slice(11, 16) ?? "时间未知";
}

export function mediaLabel(type: CallMediaType): string {
  return type === "video" ? "视频通话" : type === "voice" ? "语音通话" : "类型未知";
}

export function directionLabel(direction: CallDirection): string {
  return direction === "outgoing" ? "我呼出" : direction === "incoming" ? "对方呼入" : "方向未知";
}

export function outcomeLabel(outcome: CallOutcome): string {
  const labels: Record<CallOutcome, string> = {
    completed: "正常结束",
    interrupted: "通话中断",
    missed: "未接听",
    cancelled_by_self: "已取消",
    cancelled_by_peer: "对方已取消",
    rejected: "已拒绝",
    busy: "忙线",
    failed: "呼叫失败",
    unknown: "结果未知"
  };
  return labels[outcome];
}
