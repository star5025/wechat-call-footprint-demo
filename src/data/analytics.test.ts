import { describe, expect, it } from "vitest";
import { buildWall, dateRange, filterEvents, summarize } from "@/data/analytics";
import { TEST_DATASET } from "@/data/testDataset.fixture";

describe("call analytics gold standard", () => {
  const contactId = TEST_DATASET.contacts[0].id;
  const events = filterEvents(TEST_DATASET, contactId);

  it("matches the reviewed event totals", () => {
    const summary = summarize(events);
    expect(summary.attemptedCount).toBe(22);
    expect(summary.connectedCount).toBe(16);
    expect(summary.missedOrCancelledCount).toBe(6);
    expect(summary.totalDurationSeconds).toBe(44_352);
    expect(summary.meanDurationSeconds).toBe(2_772);
    expect(summary.longestDurationSeconds).toBe(8_249);
  });

  it("returns a dense contribution wall", () => {
    const result = buildWall(TEST_DATASET, contactId, {
      startDate: "2026-09-22",
      endDate: "2026-10-07",
      timezone: "Asia/Shanghai"
    });
    expect(result.days).toHaveLength(16);
    expect(result.days.reduce((sum, day) => sum + day.callCount, 0)).toBe(22);
    expect(result.days.reduce((sum, day) => sum + day.durationSeconds, 0)).toBe(44_352);
    expect(result.days.find((day) => day.date === "2026-10-07")?.durationSeconds).toBe(8_249);
  });

  it("distinguishes missing coverage from zero events", () => {
    const result = buildWall(TEST_DATASET, contactId, {
      startDate: "2026-09-20",
      endDate: "2026-09-23",
      timezone: "Asia/Shanghai"
    });
    expect(result.days[0].coverage).toBe("missing");
    expect(result.days[2].coverage).toBe("complete");
    expect(result.quality.overallState).toBe("partial");
  });

  it("sorts imported events newest first with a stable id tie breaker", () => {
    const reversed = { ...TEST_DATASET, events: [...TEST_DATASET.events].reverse() };
    const result = filterEvents(reversed, contactId);
    expect(result[0].startedAt).toBe("2026-10-07T00:43:31+08:00");
    expect(result.at(-1)?.startedAt).toBe("2026-09-22T19:11:20+08:00");
  });

  it("caps custom ranges at 366 days and rejects reversed ranges", () => {
    expect(dateRange("2025-01-01", "2026-12-31")).toHaveLength(366);
    expect(dateRange("2026-10-07", "2026-09-22")).toEqual([]);
  });
});
