import { describe, expect, it } from "vitest";
import { filterEvents } from "@/data/analytics";
import { applyCallRecordFilters } from "@/data/recordFilters";
import { TEST_DATASET } from "@/data/testDataset.fixture";

const events = filterEvents(TEST_DATASET, TEST_DATASET.contacts[0].id);
const options = {
  timeRange: "all" as const,
  durationRange: "all" as const,
  sortOrder: "newest" as const,
  customStart: "",
  customEnd: ""
};

describe("call record filters", () => {
  it("filters recent and custom date ranges relative to the latest record", () => {
    expect(applyCallRecordFilters(events, { ...options, timeRange: "last7" })).toHaveLength(6);
    expect(applyCallRecordFilters(events, {
      ...options,
      timeRange: "custom",
      customStart: "2026-10-05",
      customEnd: "2026-10-07"
    })).toHaveLength(6);
  });

  it("filters connected calls by duration range", () => {
    const under5 = applyCallRecordFilters(events, { ...options, durationRange: "under5" });
    const medium = applyCallRecordFilters(events, { ...options, durationRange: "from5to30" });
    const over30 = applyCallRecordFilters(events, { ...options, durationRange: "over30" });
    expect([...under5, ...medium, ...over30]).toHaveLength(16);
    expect(under5.every((event) => (event.connectedDurationSeconds ?? 0) > 0 && (event.connectedDurationSeconds ?? 0) < 300)).toBe(true);
    expect(over30.every((event) => (event.connectedDurationSeconds ?? 0) > 1800)).toBe(true);
  });

  it("sorts all records by duration in both directions", () => {
    const descending = applyCallRecordFilters(events, { ...options, sortOrder: "durationDesc" });
    const ascending = applyCallRecordFilters(events, { ...options, sortOrder: "durationAsc" });
    expect(descending[0].connectedDurationSeconds).toBe(8_249);
    expect(ascending[0].connectedDurationSeconds ?? 0).toBe(0);
    expect(descending.every((event, index) => index === 0 || (descending[index - 1].connectedDurationSeconds ?? 0) >= (event.connectedDurationSeconds ?? 0))).toBe(true);
    expect(ascending.every((event, index) => index === 0 || (ascending[index - 1].connectedDurationSeconds ?? 0) <= (event.connectedDurationSeconds ?? 0))).toBe(true);
  });
});
