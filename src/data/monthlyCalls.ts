import type { AppDataset } from "@/domain";
import { filterEvents, localDate } from "@/data/analytics";
import { isConfirmedConnected } from "@/data/contactSummary";

export interface MonthlyCallsMonth {
  key: string;
  month: number;
  count: number;
  durationSeconds: number;
  coverage: "complete" | "partial" | "future";
}

const pad = (value: number) => String(value).padStart(2, "0");
const validDate = (value: string | null): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime()) &&
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` === value;
};

function todayInDataset(dataset: AppDataset, now: Date): string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en", {
      timeZone: dataset.timezone, year: "numeric", month: "2-digit", day: "2-digit"
    });
  } catch {
    // Invalid timezone metadata in an import falls back to the device calendar.
    formatter = new Intl.DateTimeFormat("en", { year: "numeric", month: "2-digit", day: "2-digit" });
  }
  const parts = formatter.formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function monthlyCallsYears(dataset: AppDataset, contactId: string | null, now = new Date()) {
  const currentYear = Number(todayInDataset(dataset, now).slice(0, 4));
  let earliest = currentYear;
  let latestEvent: number | null = null;
  let latestCoverage: number | null = null;
  for (const event of filterEvents(dataset, contactId)) {
    const date = localDate(event.startedAt);
    if (!validDate(date)) continue;
    const year = Number(date.slice(0, 4));
    earliest = Math.min(earliest, year);
    latestEvent = Math.max(latestEvent ?? year, year);
  }
  for (const interval of dataset.coverage) {
    if (!validDate(interval.startDate) || !validDate(interval.endDate) || interval.startDate > interval.endDate) continue;
    earliest = Math.min(earliest, Number(interval.startDate.slice(0, 4)));
    const year = Number(interval.endDate.slice(0, 4));
    latestCoverage = Math.max(latestCoverage ?? year, year);
  }
  return {
    minYear: earliest,
    maxYear: currentYear,
    defaultYear: Math.min(currentYear, latestEvent ?? latestCoverage ?? currentYear)
  };
}

export function monthlyCalls(dataset: AppDataset, contactId: string | null, year: number, now = new Date()): MonthlyCallsMonth[] {
  const today = todayInDataset(dataset, now);
  const months = Array.from({ length: 12 }, (_, index): MonthlyCallsMonth => {
    const month = index + 1;
    const key = `${year}-${pad(month)}`;
    const start = `${key}-01`;
    const end = `${key}-${new Date(year, month, 0).getDate()}`;
    if (start > today) return { key, month, count: 0, durationSeconds: 0, coverage: "future" };
    const cutoff = end < today ? end : today;
    let complete = true;
    for (let day = 1; day <= Number(cutoff.slice(8, 10)); day += 1) {
      const date = `${key}-${pad(day)}`;
      const intervals = dataset.coverage.filter((interval) => interval.startDate <= date && interval.endDate >= date);
      if (!intervals.length || intervals.some((interval) => interval.state !== "complete")) {
        complete = false;
        break;
      }
    }
    return { key, month, count: 0, durationSeconds: 0, coverage: complete ? "complete" : "partial" };
  });
  for (const event of filterEvents(dataset, contactId)) {
    const seconds = event.connectedDurationSeconds;
    const date = localDate(event.startedAt);
    if (!isConfirmedConnected(event) || (seconds !== null && (!Number.isFinite(seconds) || seconds < 0))
      || !validDate(date) || Number(date.slice(0, 4)) !== year || date > today) continue;
    const month = months[Number(date.slice(5, 7)) - 1];
    month.count += 1;
    if (seconds !== null && Number.isFinite(seconds) && seconds > 0) month.durationSeconds += seconds;
  }
  return months;
}

export function monthlyDurationLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = Number((seconds % 60).toFixed(3));
  return [hours ? `${hours} 小时` : "", minutes ? `${minutes} 分钟` : "", remainder || (!hours && !minutes) ? `${remainder} 秒` : ""].filter(Boolean).join(" ");
}
