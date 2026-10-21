import { describe, expect, it } from "vitest";
import type { AppDataset } from "@/domain";
import { TEST_DATASET } from "@/data/testDataset.fixture";
import {
  createAccountCollection, validateAccountCollection, upsertAccountDataset,
  removeAccountDataset, projectAccountCollection, linkContacts, unlinkContacts
} from "./accountCollection";

function dataset(accountId = "a", wechatId: string | null = "wx_person"): AppDataset {
  const d = structuredClone(TEST_DATASET);
  d.account = { id: accountId, displayName: `Own ${accountId}` };
  d.contacts[0] = { ...d.contacts[0], id: "contact_ab12", accountId, wechatId, displayName: "同名" };
  d.events = d.events.slice(0, 2).map((e, i) => ({ ...e, id: `event_${i}`, accountId, contactId: "contact_ab12" }));
  d.coverage = [{ startDate: "2026-10-01", endDate: "2026-10-10", state: "complete", sourceIds: ["source_demo_001"], reasonCode: null }];
  return d;
}
const combine = (...datasets: AppDataset[]) => datasets.reduce((c, d) => upsertAccountDataset(c, d), createAccountCollection());
const member = (accountId: string, contactId = "contact_ab12") => ({ accountId, contactId });
const project = (...datasets: AppDataset[]) => projectAccountCollection(combine(...datasets), null);

describe("account collection raw store", () => {
  it("creates an empty, detached collection and a safe empty aggregate", () => {
    const empty = createAccountCollection();
    expect(empty.datasets).toEqual([]);
    expect(projectAccountCollection(empty, null)).toMatchObject({ source: { kind: "empty" }, account: { id: "all-accounts", displayName: "全部账号" }, contacts: [], events: [], coverage: [] });
    const raw = dataset();
    const collection = createAccountCollection(raw);
    expect(collection.datasets[0]).toEqual(raw);
    collection.datasets[0].contacts[0].displayName = "changed";
    expect(raw.contacts[0].displayName).toBe("同名");
  });

  it("retains old unique records, updates by event ID only, and preserves both source references", () => {
    const old = dataset();
    const before = structuredClone(old);
    const next = dataset();
    next.events = [next.events[0]];
    next.events[0].connectedDurationSeconds = 17;
    next.events[0].lineage.sourceRefs[0].sourceId = "new_source";
    const extra = { ...next.contacts[0], id: "extra", wechatId: null };
    next.contacts = [extra, { ...next.contacts[0], displayName: "新名字" }];
    next.coverage = [];
    const original = createAccountCollection(old);
    const result = upsertAccountDataset(original, next);
    expect(result.datasets[0].events).toHaveLength(2);
    expect(result.datasets[0].contacts).toHaveLength(2);
    expect(result.datasets[0].events[0].connectedDurationSeconds).toBe(17);
    expect(result.datasets[0].events[0].lineage.sourceRefs.map((r) => r.sourceId)).toEqual(["source_demo_001", "new_source"]);
    expect(result.datasets[0].coverage).toEqual(old.coverage);
    expect(upsertAccountDataset(result, next)).toEqual(result);
    expect(original.datasets[0]).toEqual(before);
    expect(old).toEqual(before);
  });

  it("does not sum repeated scans or collapse separate event IDs with identical time and evidence", () => {
    const raw = dataset();
    raw.events[1] = { ...structuredClone(raw.events[0]), id: "distinct" };
    const result = upsertAccountDataset(createAccountCollection(raw), raw);
    expect(projectAccountCollection(result, null).events).toHaveLength(2);
  });

  it("retains old contacts absent from an incremental scan", () => {
    const raw = dataset();
    const next = dataset();
    next.contacts = [];
    next.events = [];
    expect(upsertAccountDataset(createAccountCollection(raw), next).datasets[0].contacts).toEqual(raw.contacts);
  });
});

describe("reliable identity projection", () => {
  it("links exact trimmed, confirmed WeChat identities and keeps raw data unchanged", () => {
    const a = dataset("a", " wx_person "), b = dataset("b");
    b.contacts[0].displayName = "另一昵称";
    const collection = combine(a, b), before = structuredClone(collection);
    const all = projectAccountCollection(collection, null);
    expect(all.contacts).toHaveLength(1);
    expect(all.events).toHaveLength(4);
    expect(new Set(all.events.map((e) => e.id)).size).toBe(4);
    expect(new Set(all.events.map((e) => e.contactId)).size).toBe(1);
    expect(all.contacts[0].aliases).toEqual(["同名", "另一昵称"]);
    expect(all.account).toEqual({ id: "all-accounts", displayName: "Own a" });
    expect(collection).toEqual(before);
    expect(collection.datasets).toEqual([a, b]);
  });

  it("uses global canonical IDs for single scopes and survives removal of an identity peer", () => {
    const collection = combine(dataset("a"), dataset("b"));
    const all = projectAccountCollection(collection, null);
    const scoped = projectAccountCollection(collection, "b");
    expect(scoped.contacts[0].id).toBe(all.contacts[0].id);
    expect(scoped.contacts[0].id).not.toBe("contact_ab12");
    expect(scoped.events.map((e) => e.id)).toEqual(all.events.filter((e) => e.accountId === "b").map((e) => e.id));
    expect(scoped.events.every((e) => e.accountId === "b")).toBe(true);
    expect(projectAccountCollection(removeAccountDataset(collection, "a"), null).contacts[0].id).toBe(all.contacts[0].id);
    expect(() => projectAccountCollection(collection, "absent")).toThrow("无效的账号集合。");
  });

  it.each([
    ["different WeChat IDs", "other", "confirmed", false],
    ["case-sensitive IDs", "WX_PERSON", "confirmed", false],
    ["missing IDs", null, "confirmed", false],
    ["blank IDs", "  ", "confirmed", false],
    ["inferred identities", "wx_person", "inferred", false],
    ["unknown identities", "wx_person", "unknown", false],
    ["needs review", "wx_person", "confirmed", true]
  ] as const)("never links by same native ID, nickname or avatar for %s", (_label, identity, confidence, needsReview) => {
    const a = dataset("a"), b = dataset("b", identity);
    b.contacts[0].identityConfidence = confidence;
    b.contacts[0].needsReview = needsReview;
    a.contacts[0].avatarRef = b.contacts[0].avatarRef = "same-image";
    expect(project(a, b).contacts).toHaveLength(2);
  });

  it("isolates null identities, ignores non-person identities, preserves null event contacts", () => {
    const a = dataset("a", null), b = dataset("b", null);
    a.events[0].contactId = null;
    const all = project(a, b);
    expect(all.contacts).toHaveLength(2);
    expect(all.events[0].contactId).toBeNull();
    const c = dataset("c"), d = dataset("d");
    c.contacts[0].kind = "group";
    expect(project(c, d).contacts).toHaveLength(2);
  });

  it("keeps original account IDs, scoped lineage, and distinct cross-account streams without fuzzy dedup", () => {
    const all = project(dataset("a"), dataset("b"));
    expect(all.events.map((e) => e.accountId)).toEqual(["a", "a", "b", "b"]);
    const a = all.events[0], b = all.events[2];
    expect(a.startedAt).toBe(b.startedAt);
    expect(a.connectedDurationSeconds).toBe(b.connectedDurationSeconds);
    expect(a.lineage.sourceRefs[0].sourceRecordIdHash).toBe(b.lineage.sourceRefs[0].sourceRecordIdHash);
    expect(a.lineage.sourceRefs[0].sourceId).not.toBe(b.lineage.sourceRefs[0].sourceId);
    expect(a.conversationId).not.toBe(b.conversationId);
    expect(all.coverage[0].sourceIds).toEqual([a.lineage.sourceRefs[0].sourceId, b.lineage.sourceRefs[0].sourceId]);
  });

  it("cannot collide through delimiters or special map keys", () => {
    const a = dataset("__proto__", null), b = dataset('a\",\"b', null);
    b.events[0].id = 'x:y:["z"]';
    expect(new Set(project(a, b).events.map((e) => e.id)).size).toBe(4);
  });
});

describe("manual links", () => {
  it("is idempotent for identical member sets regardless of order", () => {
    const original = linkContacts(combine(dataset("a", null), dataset("b", null)), [member("a"), member("b")]);
    expect(linkContacts(original, [member("b"), member("a")])).toEqual(original);
  });

  it("unions transitive overlaps, allows user-confirmed same-account handles, and unlinks by index", () => {
    const a = dataset("a", null), b = dataset("b", null), c = dataset("c", null);
    a.contacts.push({ ...a.contacts[0], id: "other" });
    const original = combine(a, b, c);
    let linked = linkContacts(original, [member("a"), member("b")]);
    linked = linkContacts(linked, [member("b"), member("c"), member("a", "other")]);
    expect(projectAccountCollection(linked, null).contacts).toHaveLength(1);
    const unlinked = unlinkContacts(linked, 1);
    expect(projectAccountCollection(unlinked, null).contacts).toHaveLength(3);
    expect(original.links).toEqual([]);
    expect(linked.links).toHaveLength(2);
    expect(() => unlinkContacts(linked, -1)).toThrow();
    expect(() => unlinkContacts(linked, 0.5)).toThrow();
    expect(() => unlinkContacts(linked, 2)).toThrow();
  });

  it("prunes removed members and drops singleton links without mutating the old collection", () => {
    const original = linkContacts(combine(dataset("a", null), dataset("b", null), dataset("c", null)), [member("a"), member("b"), member("c")]);
    const removed = removeAccountDataset(original, "a");
    expect(removed.links[0].members).toEqual([member("b"), member("c")]);
    expect(removeAccountDataset(removed, "b").links).toEqual([]);
    expect(original.datasets).toHaveLength(3);
  });

  it("rejects invalid members, duplicate members, and non-person links", () => {
    const raw = dataset();
    raw.contacts[0].kind = "group";
    const collection = combine(raw, dataset("b"));
    expect(() => linkContacts(collection, [member("a"), member("b")])).toThrow();
    expect(() => linkContacts(collection, [member("b"), member("missing")])).toThrow();
    expect(() => linkContacts(collection, [member("b"), member("b")])).toThrow();
  });
});

describe("strict collection validation", () => {
  it.each([
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets.push(structuredClone(c.datasets[0])); },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].events.push(structuredClone(c.datasets[0].events[0])); },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].contacts.push(structuredClone(c.datasets[0].contacts[0])); },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].events[0].accountId = "other"; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].contacts[0].accountId = "other"; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].events[0].contactId = "missing"; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].events[0].connectedDurationSeconds = NaN; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].events[0].connectedDurationSeconds = Infinity; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].events[0].connectedDurationSeconds = -1; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].events[0].startedAt = "2026-02-30T00:00:00Z"; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].events[0].startedAt = "2026-10-01T24:00:00Z"; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].coverage[0].endDate = "2026-02-30"; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].coverage[0].endDate = "2026-09-01"; },
    (c: ReturnType<typeof createAccountCollection>) => { c.datasets[0].events[0].lineage.sourceRefs[0].sourceId = ""; },
    (c: ReturnType<typeof createAccountCollection>) => { c.links.push({ members: [member("a"), member("missing")] }); }
  ])("always throws the fixed public error for invalid raw records (%#)", (mutate) => {
    const c = createAccountCollection(dataset());
    mutate(c);
    expect(() => validateAccountCollection(c)).toThrow(new Error("无效的账号集合。"));
  });

  it.each([null, [], {}, { format: "call-footprint-collection", formatVersion: "1.0", datasets: [null], links: [] }])("handles malformed containers without leaking internal errors", (input) => {
    expect(() => validateAccountCollection(input)).toThrow(new Error("无效的账号集合。"));
  });

  it("rejects unsafe nested objects, accessors, cycles, and over-limit arrays", () => {
    const c = createAccountCollection(dataset());
    const polluted = JSON.parse(JSON.stringify(c));
    polluted.datasets[0].extra = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => validateAccountCollection(polluted)).toThrow("无效的账号集合。");
    const getter = { ...c };
    Object.defineProperty(getter, "datasets", { enumerable: true, get: () => { throw new Error("secret"); } });
    expect(() => validateAccountCollection(getter)).toThrow(new Error("无效的账号集合。"));
    const cycle = { ...c, extra: {} };
    cycle.extra = cycle;
    expect(() => validateAccountCollection(cycle)).toThrow();
    const large = { ...c, datasets: new Array(1_000_001) };
    expect(() => validateAccountCollection(large)).toThrow();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("rejects flattened all-account and single-scope projections as raw imports", () => {
    const c = combine(dataset("a"), dataset("b"));
    expect(() => createAccountCollection(projectAccountCollection(c, null))).toThrow();
    expect(() => upsertAccountDataset(c, projectAccountCollection(c, "a"))).toThrow();
  });
});

describe("conservative time coverage", () => {
  it("emits complete only over the intersection of all included accounts", () => {
    const a = dataset("a"), b = dataset("b");
    b.coverage[0].startDate = "2026-10-05";
    b.coverage[0].endDate = "2026-10-15";
    const all = project(a, b);
    expect(all.coverage.map(({ startDate, endDate, state }) => [startDate, endDate, state])).toEqual([
      ["2026-10-01", "2026-10-04", "partial"], ["2026-10-05", "2026-10-10", "complete"], ["2026-10-11", "2026-10-15", "partial"]
    ]);
    expect(projectAccountCollection(combine(a, b), "a").coverage[0].state).toBe("complete");
  });

  it.each(["partial", "missing", "failed", "absent"] as const)("does not claim completeness for %s accounts", (state) => {
    const a = dataset("a"), b = dataset("b");
    if (state === "absent") b.coverage = [];
    else b.coverage[0].state = state;
    expect(project(a, b).coverage.every((c) => c.state === "partial")).toBe(true);
  });

  it("coalesces adjacent intervals, conservatively handles overlaps, and leaves uncovered gaps absent", () => {
    const a = dataset();
    a.coverage = [
      { ...a.coverage[0], endDate: "2026-10-03" },
      { ...a.coverage[0], startDate: "2026-10-04", endDate: "2026-10-06" },
      { ...a.coverage[0], startDate: "2026-10-09" }
    ];
    expect(project(a).coverage.map((c) => [c.startDate, c.endDate])).toEqual([["2026-10-01", "2026-10-06"], ["2026-10-09", "2026-10-10"]]);
    a.coverage.push({ ...a.coverage[0], startDate: "2026-10-02", endDate: "2026-10-02", state: "partial" });
    expect(project(a).coverage.find((c) => c.startDate === "2026-10-02")?.state).toBe("partial");
  });
});
