import type {
  AppDataset,
  DatasetValidationResult,
  ImportPreview
} from "@/domain";
import { isConnected, localDate } from "@/data/analytics";

const ALLOWED_MEDIA = new Set(["voice", "video", "unknown"]);
const ALLOWED_DIRECTION = new Set(["incoming", "outgoing", "unknown"]);
const ALLOWED_OUTCOMES = new Set([
  "completed",
  "interrupted",
  "missed",
  "cancelled_by_self",
  "cancelled_by_peer",
  "rejected",
  "busy",
  "failed",
  "unknown"
]);

export function validateDataset(input: unknown): DatasetValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input || typeof input !== "object") {
    return { valid: false, errors: ["文件内容必须是 JSON 对象。"], warnings };
  }
  const value = input as Partial<AppDataset>;
  if (value.format !== "call-footprint-export") errors.push("无法识别文件格式。应为 call-footprint-export。");
  if (value.formatVersion !== "1.0") errors.push("暂不支持这个导出格式版本。当前支持 1.0。");
  if (value.contractVersion?.split(".")[0] !== "1") errors.push("暂不支持这个数据契约主版本。当前支持 v1。");
  if (!Array.isArray(value.contacts)) errors.push("缺少 contacts 联系人列表。");
  if (!Array.isArray(value.events)) errors.push("缺少 events 通话记录列表。");
  if (!Array.isArray(value.coverage)) errors.push("缺少 coverage 数据覆盖信息。");
  if (!value.account?.id || !value.account.displayName) errors.push("缺少有效的账号信息。");
  if (!value.timezone) warnings.push("文件没有指定时区，将使用 Asia/Shanghai。");
  if (errors.length) return { valid: false, errors, warnings };

  const contactIds = new Set(value.contacts!.map((contact) => contact.id));
  const eventIds = new Set<string>();
  for (const [index, event] of value.events!.entries()) {
    const prefix = `第 ${index + 1} 条记录`;
    if (!event.id || eventIds.has(event.id)) errors.push(`${prefix}的 ID 缺失或重复。`);
    eventIds.add(event.id);
    if (!ALLOWED_MEDIA.has(event.mediaType)) errors.push(`${prefix}的通话类型无效。`);
    if (!ALLOWED_DIRECTION.has(event.direction)) errors.push(`${prefix}的方向无效。`);
    if (!ALLOWED_OUTCOMES.has(event.outcome)) errors.push(`${prefix}的结果状态无效。`);
    if (event.connectedDurationSeconds !== null && event.connectedDurationSeconds < 0) {
      errors.push(`${prefix}的通话时长不能为负数。`);
    }
    if (event.contactId && !contactIds.has(event.contactId)) {
      warnings.push(`${prefix}引用了未包含在文件中的联系人。`);
    }
    if (!event.startedAt) warnings.push(`${prefix}缺少开始时间。`);
  }

  if (value.events!.length > 1_000_000) errors.push("记录数量超过首版 100 万条限制。");
  return errors.length
    ? { valid: false, errors, warnings }
    : { valid: true, dataset: value as AppDataset, errors, warnings };
}

export function parseDataset(content: string): DatasetValidationResult {
  try {
    return validateDataset(JSON.parse(content));
  } catch {
    return { valid: false, errors: ["JSON 文件无法解析，请检查文件是否完整。"], warnings: [] };
  }
}

export function makeImportPreview(
  fileName: string,
  dataset: AppDataset,
  warnings: string[]
): ImportPreview {
  const dates = dataset.events
    .map((event) => localDate(event.startedAt))
    .filter((date): date is string => Boolean(date))
    .sort();
  return {
    fileName,
    contactCount: dataset.contacts.length,
    eventCount: dataset.events.length,
    connectedCount: dataset.events.filter(isConnected).length,
    startDate: dates[0] ?? null,
    endDate: dates.at(-1) ?? null,
    warnings,
    dataset
  };
}
