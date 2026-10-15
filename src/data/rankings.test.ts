import type { CallEvent, Contact } from "@contracts/models";
import { describe, expect, it } from "vitest";
import { rankContactsByDuration } from "@/data/rankings";
import { TEST_DATASET } from "@/data/testDataset.fixture";

const contact = (id: string, displayName: string): Contact => ({
  ...TEST_DATASET.contacts[0],
  id,
  displayName,
  wechatId: `wxid_${id}`
});

const event = (
  id: string,
  contactId: string | null,
  duration: number | null,
  startedAt: string,
  excluded = false
): CallEvent => ({
  ...TEST_DATASET.events[0],
  id,
  contactId,
  contactSnapshot: { displayName: contactId ?? "未知", kind: "person" },
  connectedDurationSeconds: duration,
  startedAt,
  excluded
});

describe("contact duration ranking", () => {
  it("ranks contacts by connected duration with deterministic tie breakers", () => {
    const contacts = [
      contact("alpha", "阿青"),
      contact("beta", "白露"),
      contact("gamma", "春风"),
      contact("delta", "冬至"),
      contact("unknown", "时长未知"),
      contact("unused", "没有记录")
    ];
    const dataset = {
      ...TEST_DATASET,
      contacts,
      events: [
        event("a1", "alpha", 360, "2026-10-01T10:00:00+08:00"),
        event("a2", "alpha", 240, "2026-10-02T10:00:00+08:00"),
        event("a3", "alpha", null, "2026-10-02T11:00:00+08:00"),
        event("b1", "beta", 200, "2026-10-03T10:00:00+08:00"),
        event("b2", "beta", 200, "2026-10-04T10:00:00+08:00"),
        event("c1", "gamma", 400, "2026-10-05T10:00:00+08:00"),
        event("d1", "delta", 0, "2026-10-06T10:00:00+08:00"),
        event("u1", "unknown", null, "2026-10-06T11:00:00+08:00"),
        event("ignored", "beta", 9_999, "2026-10-07T10:00:00+08:00", true),
        event("missing-contact", "missing", 9_999, "2026-10-08T10:00:00+08:00")
      ]
    };

    const ranking = rankContactsByDuration(dataset);

    expect(ranking.map((item) => item.contact.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(ranking.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(ranking[0]).toMatchObject({
      totalDurationSeconds: 600,
      connectedCount: 2,
      attemptedCount: 3,
      unknownDurationCount: 1
    });
  });

  it("returns an empty ranking when no contact has call records", () => {
    expect(rankContactsByDuration({ ...TEST_DATASET, events: [] })).toEqual([]);
  });
});
