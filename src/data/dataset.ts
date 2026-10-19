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
    return { valid: false, errors: ["这个文件无法使用，请选择由通话足迹保存的文件。"], warnings };
  }
  const value = input as Partial<AppDataset>;
  if (value.format !== "call-footprint-export") errors.push("无法识别这个文件。");
  if (value.formatVersion !== "1.0") errors.push("这个文件由其他版本生成，当前应用暂时无法打开。");
  if (value.contractVersion?.split(".")[0] !== "1") errors.push("这个文件由其他版本生成，当前应用暂时无法打开。");
  if (!Array.isArray(value.contacts)) errors.push("文件中缺少联系人信息。");
  if (!Array.isArray(value.events)) errors.push("文件中缺少通话记录。");
  if (!Array.isArray(value.coverage)) errors.push("文件中的记录不完整。");
  if (!value.account?.id || !value.account.displayName) errors.push("文件中缺少微信账号信息。");
  if (!value.timezone) warnings.push("部分时间信息可能不够准确。");
  if (errors.length) return { valid: false, errors: [errors[0]], warnings };

  const contactIds = new Set(value.contacts!.map((contact) => contact.id));
  const eventIds = new Set<string>();
  for (const [index, event] of value.events!.entries()) {
    const prefix = `第 ${index + 1} 条记录`;
    if (!event.id || eventIds.has(event.id)) errors.push(`${prefix}的信息不完整。`);
    eventIds.add(event.id);
    if (!ALLOWED_MEDIA.has(event.mediaType)) errors.push(`${prefix}的通话类型无效。`);
    if (!ALLOWED_DIRECTION.has(event.direction)) errors.push(`${prefix}的方向无效。`);
    if (!ALLOWED_OUTCOMES.has(event.outcome)) errors.push(`${prefix}的结果状态无效。`);
    if (event.connectedDurationSeconds !== null && event.connectedDurationSeconds < 0) {
      errors.push(`${prefix}的通话时长不能为负数。`);
    }
    if (event.contactId && !contactIds.has(event.contactId)) {
      warnings.push(`${prefix}的联系人信息不完整。`);
    }
    if (!event.startedAt) warnings.push(`${prefix}缺少开始时间。`);
  }

  if (value.events!.length > 1_000_000) errors.push("通话记录太多，暂时无法一次打开。");
  return errors.length
    ? { valid: false, errors: ["这个文件中的部分记录无法使用，请重新保存后再试。"], warnings: [] }
    : { valid: true, dataset: value as AppDataset, errors, warnings: [...new Set(warnings)] };
}

export function parseDataset(content: string): DatasetValidationResult {
  try {
    return validateDataset(JSON.parse(content));
  } catch {
    return { valid: false, errors: ["无法打开这个文件，请确认它是由通话足迹保存的。"], warnings: [] };
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
