import { describe, expect, it } from "vitest";
import { timeGreeting } from "@/utils/greeting";

describe("time greeting", () => {
  it.each([
    [5, "清晨好"],
    [7, "清晨好"],
    [8, "早上好"],
    [11, "早上好"],
    [12, "中午好"],
    [17, "中午好"],
    [18, "晚上好"],
    [22, "晚上好"],
    [23, "夜深了"],
    [0, "夜深了"],
    [4, "夜深了"]
  ])("returns the expected greeting at %i:00", (hour, expected) => {
    expect(timeGreeting(hour)).toBe(expected);
  });
});
