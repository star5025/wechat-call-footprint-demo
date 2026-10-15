import type { CallEvent, Contact } from "@contracts/models";
import type { Account, AppDataset } from "@/domain";
import { filterEvents, isConnected, localDate } from "@/data/analytics";

export interface CallTimePeriod {
  id: "lateNight" | "morning" | "afternoon" | "evening" | "tie";
  label: string;
  rangeLabel: string;
  count: number;
}

export interface ContactCallSummary {
  account: Account;
  contact: Contact;
  attemptedCount: number;
  totalDurationSeconds: number;
  connectedCount: number;
  timedCount: number;
  untimedConnectedCount: number;
  durationComplete: boolean;
  timeInsightsComplete: boolean;
  hasQualityWarnings: boolean;
  hasBlockingQualityIssues: boolean;
  longestCallDurationSeconds: number | null;
  longestCallDate: string | null;
  longestStreakDays: number;
  favoritePeriod: CallTimePeriod | null;
  firstCallDate: string | null;
  lastCallDate: string | null;
}

const PERIODS: Array<Omit<CallTimePeriod, "count"> & { start: number; end: number }> = [
  { id: "lateNight", label: "凌晨", rangeLabel: "00:00–06:00", start: 0, end: 6 },
  { id: "morning", label: "上午", rangeLabel: "06:00–12:00", start: 6, end: 12 },
  { id: "afternoon", label: "下午", rangeLabel: "12:00–18:00", start: 12, end: 18 },
  { id: "evening", label: "晚上", rangeLabel: "18:00–24:00", start: 18, end: 24 }
];

const dateValue = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

export const isConfirmedConnected = (event: CallEvent): boolean =>
  (event.connectedDurationSeconds ?? 0) > 0
  || event.answeredAt !== null
  || event.outcome === "completed"
  || event.outcome === "interrupted";

export function longestConnectedStreak(events: CallEvent[]): number {
  const dates = [...new Set(
    events
      .filter(isConfirmedConnected)
      .map((event) => localDate(event.startedAt))
      .filter((date): date is string => Boolean(date))
  )].sort();
  let longest = 0;
  let current = 0;
  let previous: number | null = null;
  for (const date of dates) {
    const value = dateValue(date);
    current = previous !== null && value - previous === 86_400_000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = value;
  }
  return longest;
}

export function favoriteCallPeriod(events: CallEvent[]): CallTimePeriod | null {
  const counts = PERIODS.map((period) => ({ ...period, count: 0 }));
  for (const event of events.filter(isConfirmedConnected)) {
    const hour = Number(event.startedAt?.slice(11, 13));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const period = counts.find((item) => hour >= item.start && hour < item.end);
    if (period) period.count += 1;
  }
  const highestCount = Math.max(...counts.map((period) => period.count));
  if (!highestCount) return null;
  const winners = counts.filter((period) => period.count === highestCount);
  if (winners.length > 1) {
    return {
      id: "tie",
      label: winners.map((period) => period.label).join("、"),
      rangeLabel: "多个时段并列最多",
      count: highestCount
    };
  }
  const winner = winners[0];
  return { id: winner.id, label: winner.label, rangeLabel: winner.rangeLabel, count: winner.count };
}

export function buildContactCallSummary(
  dataset: AppDataset,
  contactId: string
): ContactCallSummary | null {
  const contact = dataset.contacts.find((item) => item.id === contactId);
  if (!contact) return null;
  const events = filterEvents(dataset, contactId);
  const connected = events.filter(isConfirmedConnected);
  const timed = connected.filter(isConnected);
  const timeInsightsComplete = events.every((event) =>
    event.startedAt !== null
    && event.timezone !== null
    && !event.qualityFlags.includes("unknown_timezone")
    && !event.qualityFlags.includes("missing_start_time")
  );
  const hasBlockingQualityIssues = events.some((event) =>
    event.dedupConfidence !== "confirmed"
    || event.qualityFlags.includes("possible_duplicate")
    || event.qualityFlags.includes("conflicting_source_records")
  );
  const hasQualityWarnings = hasBlockingQualityIssues || events.some((event) =>
    event.qualityFlags.includes("missing_start_time")
    || event.qualityFlags.includes("missing_duration")
    || event.qualityFlags.includes("unknown_timezone")
    || event.qualityFlags.includes("possible_duplicate")
    || event.qualityFlags.includes("conflicting_source_records")
    || event.qualityFlags.includes("partial_source_coverage")
    || event.qualityFlags.includes("unsupported_source_variant")
  ) || dataset.coverage.some((interval) => interval.state !== "complete");
  const longest = timed.reduce<CallEvent | null>(
    (best, event) => !best || (event.connectedDurationSeconds ?? 0) > (best.connectedDurationSeconds ?? 0)
      ? event
      : best,
    null
  );
  const dates = events
    .map((event) => localDate(event.startedAt))
    .filter((date): date is string => Boolean(date))
    .sort();

  const untimedConnectedCount = connected.length - timed.length;
  return {
    account: dataset.account,
    contact,
    attemptedCount: events.length,
    totalDurationSeconds: timed.reduce(
      (sum, event) => sum + (event.connectedDurationSeconds ?? 0),
      0
    ),
    connectedCount: connected.length,
    timedCount: timed.length,
    untimedConnectedCount,
    durationComplete: untimedConnectedCount === 0,
    timeInsightsComplete,
    hasQualityWarnings,
    hasBlockingQualityIssues,
    longestCallDurationSeconds: longest?.connectedDurationSeconds ?? null,
    longestCallDate: localDate(longest?.startedAt ?? null),
    longestStreakDays: longestConnectedStreak(events),
    favoritePeriod: timeInsightsComplete ? favoriteCallPeriod(connected) : null,
    firstCallDate: dates[0] ?? null,
    lastCallDate: dates.at(-1) ?? null
  };
}
