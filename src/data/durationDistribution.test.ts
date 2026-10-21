import { describe, expect, it } from "vitest";
import { TEST_DATASET } from "@/data/testDataset.fixture";
import { durationDistribution } from "./durationDistribution";

const event = (seconds: number | null) => ({ ...TEST_DATASET.events[0], excluded: false, outcome: "completed" as const, connectedDurationSeconds: seconds });
describe("call duration distribution", () => {
  it("places each exact boundary into one bucket", () => {
    const result = durationDistribution([1, 299, 300, 899, 900, 1800, 1801].map(event));
    expect(result.buckets.map((bucket) => bucket.count)).toEqual([2, 2, 2, 1]);
    expect(result.total).toBe(7);
    expect(result.leaders).toHaveLength(3);
  });
  it("ignores excluded, unknown, invalid and zero durations", () => {
    expect(durationDistribution([event(null), event(0), event(-1), event(NaN), event(Infinity), { ...event(60), excluded: true }]).total).toBe(0);
    expect(durationDistribution([]).leaders).toEqual([]);
  });
  it("reports a single leader and its proportion", () => {
    const result = durationDistribution([60, 120, 600].map(event));
    expect(result.leaders.map((bucket) => bucket.label)).toEqual(["5 分钟以内"]);
    expect(result.buckets[0].percent).toBe(67);
  });
});
