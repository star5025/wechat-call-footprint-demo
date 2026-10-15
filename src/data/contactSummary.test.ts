import type { CallEvent } from "@contracts/models";
import { describe, expect, it } from "vitest";
import { buildContactCallSummary, favoriteCallPeriod, longestConnectedStreak } from "@/data/contactSummary";
import { TEST_DATASET } from "@/data/testDataset.fixture";

const event = (
  id: string,
  startedAt: string | null,
  seconds: number | null
): CallEvent => ({
  ...TEST_DATASET.events[0],
  id,
  startedAt,
  connectedDurationSeconds: seconds,
  outcome: seconds === 0 ? "missed" : "completed",
  excluded: false
});

describe("contact call summary", () => {
  it("builds the requested metrics for the selected contact", () => {
    const summary = buildContactCallSummary(TEST_DATASET, TEST_DATASET.contacts[0].id);
    expect(summary).not.toBeNull();
    expect(summary).toMatchObject({
      attemptedCount: 22,
      totalDurationSeconds: 44_352,
      connectedCount: 16,
      timedCount: 16,
      untimedConnectedCount: 0,
      durationComplete: true,
      timeInsightsComplete: true,
      hasBlockingQualityIssues: false,
      longestCallDurationSeconds: 8_249,
      longestCallDate: "2026-10-07",
      longestStreakDays: 3,
      firstCallDate: "2026-09-22",
      lastCallDate: "2026-10-07"
    });
    expect(summary?.favoritePeriod).toMatchObject({ id: "evening", label: "晚上", count: 15 });
  });

  it("counts consecutive connected calendar days and skips missed-only days", () => {
    const events = [
      event("one", "2026-10-01T20:00:00+08:00", 60),
      event("two", "2026-10-02T21:00:00+08:00", 60),
      event("missed", "2026-10-03T21:00:00+08:00", 0),
      event("four", "2026-10-04T21:00:00+08:00", 60),
      event("five", "2026-10-05T21:00:00+08:00", 60),
      event("six", "2026-10-06T21:00:00+08:00", 60)
    ];
    expect(longestConnectedStreak(events)).toBe(3);
  });

  it("uses stable time buckets and ignores records without a usable start time", () => {
    const events = [
      event("morning", "2026-10-01T08:00:00+08:00", 60),
      event("evening-1", "2026-10-01T20:00:00+08:00", 60),
      event("evening-2", "2026-10-02T23:00:00+08:00", 60),
      event("unknown", null, 60)
    ];
    expect(favoriteCallPeriod(events)).toMatchObject({ id: "evening", count: 2 });
  });

  it("keeps confirmed connections separate from reliable durations and gates time insights", () => {
    const untimed = {
      ...event("untimed", "2026-10-08T20:00:00+08:00", null),
      answeredAt: "2026-10-08T20:00:10+08:00",
      timezone: null,
      qualityFlags: ["missing_duration", "unknown_timezone"] as CallEvent["qualityFlags"]
    };
    const summary = buildContactCallSummary(
      { ...TEST_DATASET, events: [untimed] },
      TEST_DATASET.contacts[0].id
    );
    expect(summary).toMatchObject({
      attemptedCount: 1,
      connectedCount: 1,
      timedCount: 0,
      untimedConnectedCount: 1,
      durationComplete: false,
      timeInsightsComplete: false,
      hasQualityWarnings: true,
      hasBlockingQualityIssues: false,
      totalDurationSeconds: 0,
      favoritePeriod: null
    });
  });

  it("marks uncertain deduplication as blocking for image export", () => {
    const duplicate = {
      ...event("duplicate", "2026-10-08T20:00:00+08:00", 60),
      dedupConfidence: "unknown" as const,
      qualityFlags: ["possible_duplicate"] as CallEvent["qualityFlags"]
    };
    const summary = buildContactCallSummary(
      { ...TEST_DATASET, events: [duplicate] },
      TEST_DATASET.contacts[0].id
    );
    expect(summary).toMatchObject({ hasQualityWarnings: true, hasBlockingQualityIssues: true });
  });

  it("reports tied favorite periods instead of choosing one arbitrarily", () => {
    const tied = favoriteCallPeriod([
      event("morning", "2026-10-01T08:00:00+08:00", 60),
      event("evening", "2026-10-01T20:00:00+08:00", 60)
    ]);
    expect(tied).toMatchObject({ id: "tie", label: "上午、晚上", count: 1 });
  });

  it("returns null for an unknown contact", () => {
    expect(buildContactCallSummary(TEST_DATASET, "missing")).toBeNull();
  });
});
