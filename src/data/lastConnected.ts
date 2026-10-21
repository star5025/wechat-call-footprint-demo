import type { CallEvent } from "@contracts/models";
import { isConfirmedConnected } from "@/data/contactSummary";

function calendarDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day")) / 86_400_000;
}

export function lastConnected(events: CallEvent[], now: Date, timezone: string) {
  const latest = events.filter((event) => !event.excluded && isConfirmedConnected(event) && event.startedAt
    && Number.isFinite(Date.parse(event.startedAt)) && Date.parse(event.startedAt) <= now.getTime())
    .reduce<CallEvent | null>((result, event) => !result || Date.parse(event.startedAt!) > Date.parse(result.startedAt!) ? event : result, null);
  if (!latest) return { event: null, days: null, label: "暂无接通记录" };
  let days: number;
  try {
    days = calendarDay(now, timezone) - calendarDay(new Date(latest.startedAt!), timezone);
  } catch {
    // Invalid imported timezone: use the event's explicit calendar offset instead.
    const offset = latest.utcOffsetMinutes ?? 0;
    days = Math.floor((now.getTime() + offset * 60_000) / 86_400_000)
      - Math.floor((Date.parse(latest.startedAt!) + offset * 60_000) / 86_400_000);
  }
  return { event: latest, days, label: days === 0 ? "今天" : days === 1 ? "昨天" : `${days} 天` };
}
