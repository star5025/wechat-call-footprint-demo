import { describe, expect, it, vi } from "vitest";
import eventSchema from "@contracts/schemas/call-event.schema.json";
import commonSchema from "@contracts/schemas/common.schema.json";
import { buildWall, filterEvents, summarize } from "@/data/analytics";
import { buildContactCallSummary } from "@/data/contactSummary";
import { validateDataset } from "@/data/dataset";
import { rankContactsByDuration } from "@/data/rankings";
import { contactSummaryFileName } from "@/export/contactSummaryImage";
import { createDemoAccountCollection, createDemoDataset } from "@/demo/dataset";
import { projectAccountCollection, upsertAccountDataset } from "@/data/accountCollection";

describe("multi-account preview", () => {
  it("preserves primary data and automatically joins differing remarks using synthetic identities", () => {
    const collection = createDemoAccountCollection();
    expect(collection).toEqual(createDemoAccountCollection());
    expect(collection.datasets).toHaveLength(2);
    expect(collection.datasets[0]).toEqual(createDemoDataset());
    expect(collection.datasets[1].events).toHaveLength(40);
    expect(collection.datasets[1].contacts[0].displayName).toBe("杰哥");
    const all = projectAccountCollection(collection, null);
    const primary = projectAccountCollection(collection, collection.datasets[0].account.id);
    expect(all.contacts).toHaveLength(6);
    expect(primary.contacts).toHaveLength(5);
    expect(all.events).toHaveLength(primary.events.length + 40);
    const person = all.contacts.find((contact) => contact.wechatId === "synthetic-wechat-person-1")!;
    expect(person.aliases).toEqual(expect.arrayContaining(["阿杰", "杰哥"]));
    expect(new Set(all.events.filter((event) => event.contactId === person.id).map((event) => event.accountId)).size).toBe(2);
    expect(upsertAccountDataset(collection, collection.datasets[1]).datasets[1].events).toHaveLength(40);
    expect(JSON.stringify(collection)).not.toMatch(/https?:\/\/|file:\/\/|wxid_/i);
  });
});

const FIXED_END = "2026-10-19T23:59:59+08:00";
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;

function expectLocalTimestamp(value: string | null): void {
  expect(value).toMatch(OFFSET_TIMESTAMP);
  expect(Number.isFinite(Date.parse(value!))).toBe(true);
  expect(Date.parse(value!)).toBeLessThanOrEqual(Date.parse(FIXED_END));
}

describe("synthetic Pages demonstration dataset", () => {
  it("passes dataset validation with complete contract-shaped events and synthetic provenance", () => {
    const dataset = createDemoDataset();
    const result = validateDataset(JSON.parse(JSON.stringify(dataset)));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(dataset.source).toMatchObject({ kind: "demo", sourceVersion: "1.0" });
    expect(dataset.source.displayName).toContain("虚构");
    expect(dataset.account.id).toBe("synthetic-demo-account");
    expect(dataset.contacts).toHaveLength(5);
    expect(new Set(dataset.contacts.map((contact) => contact.id)).size).toBe(5);
    expect(new Set(dataset.events.map((event) => event.id)).size).toBe(dataset.events.length);

    for (const event of dataset.events) {
      expect(Object.keys(event).sort()).toEqual([...eventSchema.required].sort());
      expect(event.id).toMatch(/^synthetic-demo-event-\d{4}$/);
      expect(event.accountId).toBe(dataset.account.id);
      expect(event.conversationId).toMatch(/^synthetic-demo-conversation-[1-5]$/);
      const contact = dataset.contacts.find((item) => item.id === event.contactId);
      expect(contact).toBeDefined();
      expect(event.contactSnapshot).toEqual({ displayName: contact!.displayName, kind: contact!.kind });
      expect(commonSchema.$defs.mediaType.enum).toContain(event.mediaType);
      expect(commonSchema.$defs.direction.enum).toContain(event.direction);
      expect(commonSchema.$defs.outcome.enum).toContain(event.outcome);
      expect(event).toMatchObject({
        parseConfidence: "confirmed",
        identityConfidence: "confirmed",
        dedupConfidence: "confirmed",
        qualityFlags: [],
        excluded: false
      });
      expect(Object.keys(event.lineage).sort()).toEqual([...commonSchema.$defs.lineage.required].sort());
      expect(event.lineage).toMatchObject({
        adapterId: "synthetic-demo-generator",
        adapterVersion: "1.0",
        parserVersion: "1.0",
        dedupVersion: "1.0",
        normalizedAt: FIXED_END
      });
      expect(event.lineage.sourceRefs).toHaveLength(1);
      const source = event.lineage.sourceRefs[0];
      expect(source.sourceId).toBe("synthetic-demo-source");
      expect(source.sourceRecordIdHash).toMatch(/^synthetic-demo-record-\d{4}$/);
      expect(source.sourceRecordIdHash.length).toBeGreaterThanOrEqual(commonSchema.$defs.sourceRef.properties.sourceRecordIdHash.minLength);
      expect(source.sourceDatabaseKind).toBe("synthetic_generator");
      expect(source.sourcePartition).toBe(event.startedAt!.slice(0, 4));
    }
  });

  it("spans both years and every month through the fixed cutoff, newest first", () => {
    const dataset = createDemoDataset();
    expect(dataset.events.length).toBeGreaterThan(200);
    expect(dataset.exportedAt).toBe(FIXED_END);
    expect(dataset.timezone).toBe("Asia/Shanghai");
    expect(dataset.events[0].startedAt?.slice(0, 10)).toBe("2026-10-19");
    expect(dataset.events.at(-1)?.startedAt?.slice(0, 10)).toBe("2025-01-01");
    const months = [...new Set(dataset.events.map((event) => event.startedAt!.slice(0, 7)))].sort();
    expect(months).toEqual([
      ...Array.from({ length: 12 }, (_, index) => `2025-${String(index + 1).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`)
    ]);
    for (let index = 1; index < dataset.events.length; index += 1) {
      expect(Date.parse(dataset.events[index - 1].startedAt!))
        .toBeGreaterThanOrEqual(Date.parse(dataset.events[index].startedAt!));
    }
    expect(dataset.coverage).toEqual([{
      startDate: "2025-01-01",
      endDate: "2026-10-19",
      state: "complete",
      sourceIds: ["synthetic-demo-source"],
      reasonCode: null
    }]);
  });

  it("keeps +08:00 timestamps, answer times and connected durations consistent", () => {
    const dataset = createDemoDataset();
    expectLocalTimestamp(dataset.exportedAt);
    for (const event of dataset.events) {
      expect(event.timezone).toBe(dataset.timezone);
      expect(event.utcOffsetMinutes).toBe(480);
      expectLocalTimestamp(event.startedAt);
      expectLocalTimestamp(event.endedAt);
      expectLocalTimestamp(event.lineage.normalizedAt);
      expect(Date.parse(event.startedAt!)).toBeGreaterThanOrEqual(Date.parse("2025-01-01T00:00:00+08:00"));
      expect(Date.parse(event.endedAt!)).toBeGreaterThan(Date.parse(event.startedAt!));
      expect(Number.isInteger(event.connectedDurationSeconds)).toBe(true);
      expect(event.connectedDurationSeconds).toBeGreaterThanOrEqual(0);
      expect(event.connectedDurationSeconds).toBeLessThanOrEqual(eventSchema.properties.connectedDurationSeconds.maximum);
      if (event.outcome === "completed" || event.outcome === "interrupted") {
        expectLocalTimestamp(event.answeredAt);
        expect(Date.parse(event.answeredAt!)).toBeGreaterThanOrEqual(Date.parse(event.startedAt!));
        expect((Date.parse(event.endedAt!) - Date.parse(event.answeredAt!)) / 1000)
          .toBe(event.connectedDurationSeconds);
        expect(event.connectedDurationSeconds).toBeGreaterThan(0);
      } else {
        expect(event.answeredAt).toBeNull();
        expect(event.connectedDurationSeconds).toBe(0);
      }
    }
  });

  it("offers voice, video, missed and cancelled calls, directions and varied durations", () => {
    const { events } = createDemoDataset();
    expect(new Set(events.map((event) => event.mediaType))).toEqual(new Set(["voice", "video"]));
    expect(new Set(events.map((event) => event.direction))).toEqual(new Set(["incoming", "outgoing"]));
    expect(new Set(events.map((event) => event.outcome))).toEqual(new Set([
      "completed", "interrupted", "missed", "cancelled_by_self", "cancelled_by_peer", "rejected", "busy", "failed"
    ]));
    for (const mediaType of ["voice", "video"]) {
      expect(events.some((event) => event.mediaType === mediaType && event.outcome === "missed")).toBe(true);
      expect(events.some((event) => event.mediaType === mediaType && event.outcome === "completed")).toBe(true);
    }
    const durations = events.map((event) => event.connectedDurationSeconds!);
    expect(new Set(durations).size).toBeGreaterThan(6);
    expect(durations.some((duration) => duration > 0 && duration < 60)).toBe(true);
    expect(Math.max(...durations)).toBeGreaterThan(3600);
  });

  it("feeds summaries, accurate contact bounds, a connected streak and unblocked export", () => {
    const dataset = createDemoDataset();
    const overall = summarize(dataset.events);
    expect(overall.attemptedCount).toBe(dataset.events.length);
    expect(overall.totalDurationSeconds).toBe(dataset.events.reduce((sum, event) => sum + event.connectedDurationSeconds!, 0));
    for (const contact of dataset.contacts) {
      const events = filterEvents(dataset, contact.id);
      const totals = summarize(events);
      const summary = buildContactCallSummary(dataset, contact.id);
      expect(contact.firstCallAt).toBe(events.at(-1)!.startedAt);
      expect(contact.lastCallAt).toBe(events[0].startedAt);
      expect(summary).toMatchObject({
        attemptedCount: totals.attemptedCount,
        connectedCount: totals.connectedCount,
        timedCount: totals.timedCount,
        totalDurationSeconds: totals.totalDurationSeconds,
        durationComplete: true,
        timeInsightsComplete: true,
        hasQualityWarnings: false,
        hasBlockingQualityIssues: false,
        untimedConnectedCount: 0,
        firstCallDate: contact.firstCallAt!.slice(0, 10),
        lastCallDate: contact.lastCallAt!.slice(0, 10)
      });
      expect(summary!.favoritePeriod).not.toBeNull();
      expect(contactSummaryFileName(summary!)).toBe(`${contact.displayName}-通话总结.png`);
    }
    expect(buildContactCallSummary(dataset, dataset.contacts[0].id)!.longestStreakDays).toBeGreaterThanOrEqual(15);
    const wall = buildWall(dataset, dataset.contacts[0].id, {
      startDate: "2026-10-05", endDate: "2026-10-19", timezone: dataset.timezone
    });
    expect(wall.days).toHaveLength(15);
    expect(wall.days.every((day) => day.connectedCount > 0 && day.coverage === "complete")).toBe(true);
    expect(wall.quality.overallState).toBe("good");
  });

  it("ranks all five contacts with totals matching their independent summaries", () => {
    const dataset = createDemoDataset();
    const ranking = rankContactsByDuration(dataset);
    expect(ranking).toHaveLength(5);
    expect(ranking.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5]);
    for (const [index, entry] of ranking.entries()) {
      const summary = buildContactCallSummary(dataset, entry.contact.id)!;
      expect(entry.totalDurationSeconds).toBe(summary.totalDurationSeconds);
      expect(entry.connectedCount).toBe(summary.connectedCount);
      expect(entry.attemptedCount).toBe(summary.attemptedCount);
      expect(entry.unknownDurationCount).toBe(0);
      expect(entry.lastCallAt).toBe(entry.contact.lastCallAt);
      if (index) expect(ranking[index - 1].totalDurationSeconds).toBeGreaterThanOrEqual(entry.totalDurationSeconds);
    }
    expect(ranking.reduce((sum, entry) => sum + entry.attemptedCount, 0)).toBe(dataset.events.length);
  });

  it("is deterministic regardless of the clock and returns fresh nested objects", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      const first = createDemoDataset();
      vi.setSystemTime(new Date("2040-08-08T12:00:00Z"));
      const second = createDemoDataset();
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      first.contacts[0].aliases.push("changed");
      first.events[0].lineage.sourceRefs[0].sourceId = "changed";
      first.coverage[0].sourceIds.push("changed");
      expect(second).toEqual(createDemoDataset());
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses only fictional identities and self-contained SVG avatars without external assets", () => {
    const dataset = createDemoDataset();
    const people = [dataset.account, ...dataset.contacts];
    const avatars = people.map((person) => person.avatarRef!);
    expect(new Set(avatars).size).toBe(6);
    for (const person of people) {
      expect(person.id).toMatch(/^synthetic-demo-/);
      expect(person.displayName).not.toMatch(/虚构|演示|合成/);
      expect(person.avatarRef).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      const svg = decodeURIComponent(person.avatarRef!.split(",")[1]);
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('viewBox="0 0 128 128"');
      expect(svg).toMatch(/<text\b[^>]*>[🐶🐼🐱🦊🐰😎]+<\/text>/u);
      expect(svg).toContain('font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif"');
      expect(svg).not.toMatch(/<(?:circle|path|polygon|ellipse)\b/);
      expect(svg).toMatch(/<\/svg>$/);
      expect(svg).not.toMatch(/(?:href|src)\s*=|url\s*\(|@import|<(?:script|image|foreignObject)\b/i);
      // The XML namespace is an identifier, not a remote resource request.
      expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:|file:|blob:/i);
    }
    for (const contact of dataset.contacts) {
      expect(contact.wechatId).toMatch(/^synthetic-wechat-person-/);
      expect(contact.aliases).toEqual([]);
      expect(contact.mergedFromContactIds).toEqual([]);
    }
    expect(JSON.stringify(dataset)).not.toMatch(/https?:\/\/|file:\/\/|wxid_/i);
  });
});
