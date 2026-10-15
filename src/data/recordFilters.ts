import type { CallEvent } from "@contracts/models";

export type CallsTimeRange = "all" | "last7" | "last30" | "custom";
export type CallsDurationRange = "all" | "under5" | "from5to30" | "over30";
export type CallsSortOrder = "newest" | "durationDesc" | "durationAsc";

export interface CallRecordFilterOptions {
  timeRange: CallsTimeRange;
  durationRange: CallsDurationRange;
  sortOrder: CallsSortOrder;
  customStart: string;
  customEnd: string;
}

const eventDate = (event: CallEvent) => event.startedAt?.slice(0, 10) ?? null;

function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() - days);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function applyCallRecordFilters(
  events: CallEvent[],
  options: CallRecordFilterOptions
): CallEvent[] {
  const latestDate = events.map(eventDate).find((date): date is string => Boolean(date));
  const relativeStart = latestDate
    ? options.timeRange === "last7"
      ? subtractDays(latestDate, 6)
      : options.timeRange === "last30"
        ? subtractDays(latestDate, 29)
        : null
    : null;

  const filtered = events.filter((event) => {
    const date = eventDate(event);
    if (relativeStart && (!date || date < relativeStart || date > latestDate!)) return false;
    if (
      options.timeRange === "custom"
      && (
        !date
        || (options.customStart && date < options.customStart)
        || (options.customEnd && date > options.customEnd)
      )
    ) return false;

    const duration = event.connectedDurationSeconds ?? 0;
    if (options.durationRange === "under5" && !(duration > 0 && duration < 300)) return false;
    if (options.durationRange === "from5to30" && !(duration >= 300 && duration <= 1800)) return false;
    if (options.durationRange === "over30" && duration <= 1800) return false;
    return true;
  });

  return [...filtered].sort((left, right) => {
    if (options.sortOrder === "durationDesc") {
      return (right.connectedDurationSeconds ?? 0) - (left.connectedDurationSeconds ?? 0)
        || (right.startedAt ?? "").localeCompare(left.startedAt ?? "");
    }
    if (options.sortOrder === "durationAsc") {
      return (left.connectedDurationSeconds ?? 0) - (right.connectedDurationSeconds ?? 0)
        || (right.startedAt ?? "").localeCompare(left.startedAt ?? "");
    }
    return (right.startedAt ?? "").localeCompare(left.startedAt ?? "")
      || right.id.localeCompare(left.id);
  });
}
