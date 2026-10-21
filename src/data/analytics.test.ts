import { describe, expect, it } from "vitest";
import { buildWall, contributionLevel, dateRange, filterEvents, summarize } from "@/data/analytics";
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

  it("summarizes year, month, and custom calendar ranges", () => {
    const year = summarize(filterEvents(TEST_DATASET, contactId, "2026-01-01", "2026-12-31"));
    const month = summarize(filterEvents(TEST_DATASET, contactId, "2026-10-01", "2026-10-31"));
    const custom = summarize(filterEvents(TEST_DATASET, contactId, "2026-10-05", "2026-10-07"));

    expect(year.attemptedCount).toBe(22);
    expect(year.totalDurationSeconds).toBe(44_352);
    expect(year.activeDayCount).toBe(7);
    expect(year.longestDurationSeconds).toBe(8_249);

    expect(month.attemptedCount).toBe(6);
    expect(month.totalDurationSeconds).toBe(17_915);
    expect(month.activeDayCount).toBe(3);
    expect(month.longestDurationSeconds).toBe(8_249);

    expect(custom).toMatchObject({
      attemptedCount: 6,
      totalDurationSeconds: 17_915,
      activeDayCount: 3,
      longestDurationSeconds: 8_249
    });
  });

  it("returns a dense contribution wall", () => {    const result = buildWall(TEST_DATASET, contactId, {
      startDate: "2026-09-22",
      endDate: "2026-10-07",
      timezone: "Asia/Shanghai"
    });
    expect(result.days).toHaveLength(16);
    expect(result.days.reduce((sum, day) => sum + day.callCount, 0)).toBe(22);
    expect(result.days.reduce((sum, day) => sum + day.connectedCount, 0)).toBe(16);
    expect(result.days.reduce((sum, day) => sum + day.durationSeconds, 0)).toBe(44_352);
    expect(result.days.find((day) => day.date === "2026-10-07")?.durationSeconds).toBe(8_249);
  });

  it("does not count missed-only days as calls on the contribution wall", () => {
    const missedOnlyEvents = events.filter((event) => (event.connectedDurationSeconds ?? 0) === 0);
    expect(summarize(missedOnlyEvents).activeDayCount).toBe(0);

    const missedOnlyDay = {
      date: "2026-10-14",
      callCount: 1,
      connectedCount: 0,
      durationSeconds: 0,
      videoCount: 1,
      voiceCount: 0,
      unknownMediaCount: 0,
      coverage: "complete" as const,
      qualityFlags: []
    };
    expect(contributionLevel(missedOnlyDay, "duration", 8_249)).toBe(0);
    expect(contributionLevel(missedOnlyDay, "count", 5)).toBe(0);
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

  it.each(["missing", "partial", "failed"] as const)(
    "does not report all-%s coverage as good",
    (state) => {
      const dataset = {
        ...TEST_DATASET,
        coverage: [{
          ...TEST_DATASET.coverage[0],
          startDate: "2026-09-22",
          endDate: "2026-09-23",
          state
        }]
      };
      const result = buildWall(dataset, contactId, {
        startDate: "2026-09-22",
        endDate: "2026-09-23",
        timezone: dataset.timezone
      });
      expect(result.days.map((day) => day.coverage)).toEqual([state, state]);
      expect(result.quality.overallState).toBe("partial");
      expect(result.quality.dimensions[0]).toMatchObject({ state: "warning", score: 0 });
      expect(result.quality.dimensions[0].summary).not.toContain("记录完整");
      expect(result.quality.issueCount).toBe(1);
    }
  );

  it.each([
    [["complete", "missing"], "missing"],
    [["complete", "missing", "partial"], "partial"],
    [["complete", "missing", "partial", "failed"], "failed"]
  ] as const)("uses conservative coverage priority for %j", (states, expected) => {
    const dataset = {
      ...TEST_DATASET,
      coverage: states.map((state) => ({
        ...TEST_DATASET.coverage[0],
        startDate: "2026-09-22",
        endDate: "2026-09-22",
        state
      }))
    };
    const result = buildWall(dataset, contactId, {
      startDate: "2026-09-22",
      endDate: "2026-09-22",
      timezone: dataset.timezone
    });
    expect(result.days[0].coverage).toBe(expected);
    expect(result.quality.overallState).toBe("partial");
  });

  it("keeps future uncovered days empty and missing, not complete zero-event days", () => {
    const result = buildWall(TEST_DATASET, contactId, {
      startDate: "2099-01-01",
      endDate: "2099-01-02",
      timezone: TEST_DATASET.timezone
    });
    expect(result.days).toHaveLength(2);
    expect(result.days.every((day) => day.callCount === 0 && day.coverage === "missing")).toBe(true);
    expect(result.quality.overallState).toBe("partial");
  });

  it("preserves quality for complete zero-event days and empty ranges", () => {
    const result = buildWall(TEST_DATASET, contactId, {
      startDate: "2026-09-25",
      endDate: "2026-09-25",
      timezone: TEST_DATASET.timezone
    });
    expect(result.days[0]).toMatchObject({ callCount: 0, coverage: "complete" });
    expect(result.quality.overallState).toBe("good");
    const empty = buildWall(TEST_DATASET, contactId, {
      startDate: "2026-10-07",
      endDate: "2026-09-22",
      timezone: TEST_DATASET.timezone
    });
    expect(empty.days).toEqual([]);
    expect(empty.quality.overallState).toBe("good");
    expect(empty.quality.dimensions[0].score).toBeNull();
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
