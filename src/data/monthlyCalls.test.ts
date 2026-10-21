import { describe, expect, it } from "vitest";
import type { CallEvent, CoverageInterval } from "@contracts/models";
import type { AppDataset } from "@/domain";
import { TEST_DATASET } from "@/data/testDataset.fixture";
import { monthlyCalls, monthlyCallsYears, monthlyDurationLabel } from "./monthlyCalls";

const contactId = TEST_DATASET.contacts[0].id;
const now = new Date("2028-03-10T12:00:00+08:00");
const event = (date: string | null, seconds: number | null = 60, overrides: Partial<CallEvent> = {}): CallEvent => ({
  ...TEST_DATASET.events[0], startedAt: date === null ? null : `${date}T23:30:00+08:00`,
  contactId, connectedDurationSeconds: seconds, excluded: false, ...overrides
});
const coverage = (startDate: string, endDate: string, state: CoverageInterval["state"] = "complete"): CoverageInterval => ({
  startDate, endDate, state, sourceIds: [], reasonCode: null
});
const dataset = (events: CallEvent[] = [], intervals: CoverageInterval[] = []): AppDataset => ({
  ...TEST_DATASET, timezone: "Asia/Shanghai", events, coverage: intervals
});

describe("monthly calls", () => {
  it("returns twelve months, scopes connected events, and sums only finite positive durations", () => {
    const source = dataset([
      event("2028-01-01", 30), event("2028-01-31", 90), event("2028-02-29", 180),
      event("2028-01-03", 600, { contactId: "another-contact" }),
      event("2028-01-03", 600, { excluded: true }),
      ...[null, 0, -1, NaN, Infinity].map((seconds) => event("2028-01-02", seconds)),
      event(null), event("2028-02-30"), event("invalid"), event("2027-01-01")
    ]);
    const months = monthlyCalls(source, contactId, 2028, now);
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ key: "2028-01", month: 1, count: 4, durationSeconds: 120 });
    expect(months[1]).toMatchObject({ count: 1, durationSeconds: 180 });
    expect(monthlyCalls(source, null, 2028, now)[0].count).toBe(5);
  });

  it("cuts off this month at today and distinguishes future months from observed zero", () => {
    const months = monthlyCalls(dataset([
      event("2028-03-10", 60), event("2028-03-11", 900), event("2028-04-01", 900)
    ], [coverage("2028-01-01", "2028-03-10")]), contactId, 2028, now);
    expect(months[0]).toMatchObject({ count: 0, coverage: "complete" });
    expect(months[2]).toMatchObject({ count: 1, durationSeconds: 60, coverage: "complete" });
    expect(months[3]).toMatchObject({ count: 0, durationSeconds: 0, coverage: "future" });
  });

  it("requires every elapsed day to be complete, including leap day and overlapping warnings", () => {
    const source = dataset([], [coverage("2028-01-01", "2028-01-15"), coverage("2028-01-16", "2028-02-28"), coverage("2028-03-01", "2028-03-09")]);
    expect(monthlyCalls(source, contactId, 2028, now).slice(0, 3).map((month) => month.coverage)).toEqual(["complete", "partial", "partial"]);
    source.coverage.push(coverage("2028-02-29", "2028-03-10"));
    expect(monthlyCalls(source, contactId, 2028, now).slice(0, 3).map((month) => month.coverage)).toEqual(["complete", "complete", "complete"]);
    for (const state of ["partial", "missing", "failed"] as const) {
      const overlap = { ...source, coverage: [...source.coverage, coverage("2028-01-10", "2028-01-10", state)] };
      expect(monthlyCalls(overlap, contactId, 2028, now)[0].coverage).toBe("partial");
    }
    expect(monthlyCalls(dataset(), contactId, 2027, now).every((month) => month.coverage === "partial")).toBe(true);
  });

  it("uses dataset calendar today and preserves analytics.localDate event boundaries", () => {
    const boundary = new Date("2027-12-31T16:30:00Z");
    const source = dataset([event("2027-12-31"), event("2028-01-01"), event("2028-01-02")], [coverage("2028-01-01", "2028-01-01")]);
    expect(monthlyCallsYears(source, contactId, boundary).maxYear).toBe(2028);
    expect(monthlyCalls(source, contactId, 2028, boundary)[0]).toMatchObject({ count: 1, coverage: "complete" });
    const western = { ...source, timezone: "America/Los_Angeles" };
    expect(monthlyCallsYears(western, contactId, boundary).maxYear).toBe(2027);
    expect(monthlyCalls(western, contactId, 2027, boundary)[11].count).toBe(1);
  });

  it("derives numeric bounded years without enumerating the intervening years", () => {
    const source = dataset([event("2019-01-01"), event("2025-01-01"), event("2026-01-01", 60, { excluded: true }), event("2027-01-01", 60, { contactId: "another-contact" })], [coverage("1900-01-01", "2027-12-31")]);
    expect(monthlyCallsYears(source, contactId, now)).toEqual({ minYear: 1900, maxYear: 2028, defaultYear: 2025 });
    expect(monthlyCallsYears(dataset([event("2035-01-01")]), contactId, now)).toEqual({ minYear: 2028, maxYear: 2028, defaultYear: 2028 });
    expect(monthlyCallsYears(dataset(), contactId, now)).toEqual({ minYear: 2028, maxYear: 2028, defaultYear: 2028 });
    expect(monthlyCallsYears(dataset([], [coverage("2020-01-01", "2021-01-01")]), contactId, now).defaultYear).toBe(2021);
  });

  it("falls back to the device calendar for invalid imported timezone metadata", () => {
    const source = { ...dataset(), timezone: "not/a-timezone" };
    expect(() => monthlyCalls(source, contactId, 2028, now)).not.toThrow();
    expect(monthlyCallsYears(source, contactId, now).maxYear).toBe(now.getFullYear());
  });

  it("keeps tooltip duration exact instead of rounding minutes", () => {
    expect(monthlyDurationLabel(0)).toBe("0 秒");
    expect(monthlyDurationLabel(59)).toBe("59 秒");
    expect(monthlyDurationLabel(3661)).toBe("1 小时 1 分钟 1 秒");
    expect(monthlyDurationLabel(90.5)).toBe("1 分钟 30.5 秒");
  });
});
