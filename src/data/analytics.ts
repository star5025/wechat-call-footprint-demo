import type {
  CallEvent,
  CallSummary,
  ContributionDay,
  DataQuality,
  DateRange
} from "@contracts/models";
import type { AppDataset, InsightView, WallResult } from "@/domain";

export const isConnected = (event: CallEvent): boolean =>
  (event.connectedDurationSeconds ?? 0) > 0;

export const localDate = (dateTime: string | null): string | null =>
  dateTime?.slice(0, 10) ?? null;

export function contributionLevel(
  day: ContributionDay,
  metric: "duration" | "count",
  max: number
): number {
  if (!day.callCount || !max) return 0;
  const value = metric === "duration" ? day.durationSeconds : day.callCount;
  return Math.max(1, Math.min(4, Math.ceil(value / max * 4)));
}

export function filterEvents(
  dataset: AppDataset,
  contactId: string | null,
  startDate?: string,
  endDate?: string
): CallEvent[] {
  return dataset.events
    .filter((event) => {
      if (event.excluded) return false;
      if (contactId && event.contactId !== contactId) return false;
      const date = localDate(event.startedAt);
      if (startDate && (!date || date < startDate)) return false;
      if (endDate && (!date || date > endDate)) return false;
      return true;
    })
    .sort((left, right) => {
      const byTime = (right.startedAt ?? "").localeCompare(left.startedAt ?? "");
      return byTime || right.id.localeCompare(left.id);
    });
}

export function summarize(events: CallEvent[]): CallSummary {
  const timed = events.filter(isConnected);
  const durations = timed
    .map((event) => event.connectedDurationSeconds ?? 0)
    .sort((a, b) => a - b);
  const total = durations.reduce((sum, value) => sum + value, 0);
  const median = durations.length
    ? durations.length % 2
      ? durations[Math.floor(durations.length / 2)]
      : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
    : null;
  const longest = timed.reduce<CallEvent | null>(
    (winner, event) =>
      !winner || (event.connectedDurationSeconds ?? 0) > (winner.connectedDurationSeconds ?? 0)
        ? event
        : winner,
    null
  );
  const dated = events.filter((event) => event.startedAt !== null);
  const dates = new Set(dated.map((event) => localDate(event.startedAt)).filter(Boolean));

  return {
    attemptedCount: events.length,
    connectedCount: timed.length,
    timedCount: timed.length,
    missedOrCancelledCount: events.length - timed.length,
    totalDurationSeconds: total,
    meanDurationSeconds: durations.length ? total / durations.length : null,
    medianDurationSeconds: median,
    longestDurationSeconds: longest?.connectedDurationSeconds ?? null,
    longestEventId: longest?.id ?? null,
    firstEventAt: dated.at(-1)?.startedAt ?? null,
    lastEventAt: dated[0]?.startedAt ?? null,
    activeDayCount: dates.size,
    completeCoverageDayCount: dates.size
  };
}

const pad = (value: number) => String(value).padStart(2, "0");
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDate = (value: string) => new Date(`${value}T12:00:00`);

export function dateRange(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const result: string[] = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return result;
  for (
    let current = start;
    current <= end && result.length < 366;
    current = new Date(current.getTime() + 86_400_000)
  ) {
    result.push(isoDate(current));
  }
  return result;
}

function coverageForDate(dataset: AppDataset, date: string): ContributionDay["coverage"] {
  const intervals = dataset.coverage.filter(
    (interval) => interval.startDate <= date && interval.endDate >= date
  );
  if (!intervals.length) return "missing";
  if (intervals.some((interval) => interval.state === "failed")) return "failed";
  if (intervals.some((interval) => interval.state === "partial")) return "partial";
  return "complete";
}

export function buildWall(
  dataset: AppDataset,
  contactId: string | null,
  range: DateRange
): WallResult {
  const events = filterEvents(dataset, contactId, range.startDate, range.endDate);
  const grouped = new Map<string, CallEvent[]>();
  for (const event of events) {
    const date = localDate(event.startedAt);
    if (!date) continue;
    grouped.set(date, [...(grouped.get(date) ?? []), event]);
  }

  const days = dateRange(range.startDate, range.endDate).map<ContributionDay>((date) => {
    const dayEvents = grouped.get(date) ?? [];
    return {
      date,
      callCount: dayEvents.length,
      connectedCount: dayEvents.filter(isConnected).length,
      durationSeconds: dayEvents.reduce(
        (sum, event) => sum + (event.connectedDurationSeconds ?? 0),
        0
      ),
      videoCount: dayEvents.filter((event) => event.mediaType === "video").length,
      voiceCount: dayEvents.filter((event) => event.mediaType === "voice").length,
      unknownMediaCount: dayEvents.filter((event) => event.mediaType === "unknown").length,
      coverage: coverageForDate(dataset, date),
      qualityFlags: [...new Set(dayEvents.flatMap((event) => event.qualityFlags))]
    };
  });

  const missingDays = days.filter((day) => day.coverage === "missing").length;
  const quality: DataQuality = {
    overallState: missingDays ? "partial" : "good",
    dimensions: [{
      id: "source_coverage",
      state: missingDays ? "warning" : "good",
      score: days.length ? (days.length - missingDays) / days.length : null,
      summary: missingDays ? `${missingDays} 天没有可读取的数据覆盖。` : "所选日期均有数据覆盖。",
      affectedEventCount: 0
    }],
    issueCount: missingDays ? 1 : 0,
    reviewEventCount: events.filter((event) => event.qualityFlags.length > 0).length,
    coverage: dataset.coverage
  };

  return { range, days, quality };
}

export function buildInsights(events: CallEvent[]): InsightView[] {
  const connected = events.filter(isConnected);
  const overThirty = connected.filter((event) => (event.connectedDurationSeconds ?? 0) >= 1800).length;
  const hours = connected.map((event) => Number(event.startedAt?.slice(11, 13) ?? 0));
  const nightCount = hours.filter((hour) => hour >= 20 || hour < 2).length;
  const weekdayCounts = new Array<number>(7).fill(0);
  connected.forEach((event) => {
    if (event.startedAt) weekdayCounts[new Date(event.startedAt).getDay()] += 1;
  });
  const activeWeekday = weekdayCounts.indexOf(Math.max(...weekdayCounts));
  const weekdayNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

  return [
    {
      id: "night",
      tone: "night",
      eyebrow: "常见时刻",
      title: "夜晚通话较多",
      description: `${nightCount} 次已接通通话在晚上 8 点后开始。`,
      sampleSize: connected.length
    },
    {
      id: "duration",
      tone: "mint",
      eyebrow: "聊了多久",
      title: "超过 30 分钟的通话",
      description: `${connected.length} 次接通中，有 ${overThirty} 次超过半小时。`,
      value: String(overThirty),
      sampleSize: connected.length
    },
    {
      id: "weekday",
      tone: "peach",
      eyebrow: "最常出现",
      title: weekdayNames[activeWeekday] ?? "暂无",
      description: "这一天的已接通记录最多。",
      sampleSize: connected.length
    }
  ];
}
