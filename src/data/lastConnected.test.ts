import { describe, expect, it } from "vitest";
import { TEST_DATASET } from "@/data/testDataset.fixture";
import { lastConnected } from "./lastConnected";
const event = (startedAt: string) => ({ ...TEST_DATASET.events[0], startedAt, outcome: "completed" as const, connectedDurationSeconds: 60, excluded: false });
describe("time since last connected call", () => {
  it("ignores later unconnected, excluded, invalid and future calls", () => {
    const connected = event("2026-10-09T20:36:00+08:00");
    const result = lastConnected([connected, { ...event("2026-10-20T20:36:00+08:00"), outcome: "missed", connectedDurationSeconds: null, answeredAt: null }, { ...event("2026-10-20T21:36:00+08:00"), excluded: true }, event("bad"), event("2026-11-01T00:00:00+08:00")], new Date("2026-10-21T10:00:00+08:00"), "Asia/Shanghai");
    expect(result.event).toBe(connected);
    expect(result.days).toBe(12);
    expect(result.label).toBe("12 天");
  });
  it("uses calendar days at midnight, not rounded elapsed hours", () => {
    const calls = [event("2026-10-20T23:59:00+08:00")];
    expect(lastConnected(calls, new Date("2026-10-21T00:01:00+08:00"), "Asia/Shanghai").label).toBe("昨天");
    expect(lastConnected(calls, new Date("2026-10-20T23:59:30+08:00"), "Asia/Shanghai").label).toBe("今天");
  });
  it("recognizes a confirmed connection even when its duration is unknown", () => {
    const call = { ...event("2026-10-20T10:00:00+08:00"), connectedDurationSeconds: null };
    expect(lastConnected([call], new Date("2026-10-21T10:00:00+08:00"), "Asia/Shanghai").event).toBe(call);
  });
  it("returns an empty state without guessing missing timestamps", () => {
    expect(lastConnected([], new Date(), "Asia/Shanghai")).toEqual({ event: null, days: null, label: "暂无接通记录" });
  });
  it("handles daylight-saving and invalid timezone imports", () => {
    expect(lastConnected([event("2026-03-07T23:59:00-05:00")], new Date("2026-03-09T00:01:00-04:00"), "America/New_York").days).toBe(2);
    expect(lastConnected([event("2026-10-20T23:59:00+08:00")], new Date("2026-10-21T10:00:00+08:00"), "Invalid").days).toBe(1);
  });
});
