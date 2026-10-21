import type { Contact, CoverageInterval } from "@contracts/models";
import type { AppDataset } from "@/domain";

export interface AccountCollection {
  format: "call-footprint-collection";
  formatVersion: "1.0";
  datasets: AppDataset[];
  links: Array<{ members: Array<{ accountId: string; contactId: string }> }>;
}

type Member = AccountCollection["links"][number]["members"][number];
const INVALID = "无效的账号集合。";
const LIMIT = 1_000_000;
const confidence = ["confirmed", "inferred", "unknown"];
const kinds = ["person", "group", "official", "unknown"];
const flags = ["missing_start_time", "missing_duration", "unknown_timezone", "unknown_contact", "unknown_media_type", "unknown_direction", "unknown_outcome", "possible_duplicate", "conflicting_source_records", "partial_source_coverage", "unsupported_source_variant", "parser_recovered_value", "user_corrected"];
const ns = (kind: string, accountId: string, id: string) => `${kind}:${JSON.stringify([accountId, id])}`;
const memberKey = (member: Member) => ns("contact", member.accountId, member.contactId);
function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new Error(INVALID);
}
function object(value: unknown): Record<string, unknown> {
  requireValid(value !== null && typeof value === "object" && !Array.isArray(value));
  requireValid(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  requireValid(!Object.keys(value).some((key) => ["__proto__", "constructor", "prototype"].includes(key)));
  return value as Record<string, unknown>;
}
const text = (v: unknown): v is string => typeof v === "string";
const id = (v: unknown): v is string => text(v) && v.trim().length > 0;
const nullableText = (v: unknown) => v === null || text(v);
function array(value: unknown): unknown[] {
  requireValid(Array.isArray(value) && value.length <= LIMIT);
  return value;
}
function strings(value: unknown): string[] {
  const items = array(value);
  requireValid(items.every(id));
  return items as string[];
}
function timestamp(v: unknown): boolean {
  if (v === null) return true;
  if (!text(v) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  day(v.slice(0, 10));
  return Number(v.slice(11, 13)) < 24 && Number(v.slice(14, 16)) < 60 && Number(v.slice(17, 19)) < 60;
}
function day(v: unknown): number {
  requireValid(text(v) && /^\d{4}-\d\d-\d\d$/.test(v));
  const result = Date.parse(`${v}T00:00:00Z`);
  requireValid(Number.isFinite(result) && new Date(result).toISOString().slice(0, 10) === v);
  return result / 86_400_000;
}
function validateTree(input: unknown): void {
  const ancestors = new Set<object>();
  let count = 0;
  const visit = (value: unknown, depth: number) => {
    requireValid(depth <= 40 && ++count <= 100_000_000);
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") { requireValid(Number.isFinite(value)); return; }
    requireValid(typeof value === "object" && !ancestors.has(value));
    if (Array.isArray(value)) requireValid(value.length <= LIMIT);
    else object(value);
    ancestors.add(value);
    for (const key of Object.keys(value)) {
      requireValid(!["__proto__", "constructor", "prototype"].includes(key));
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      requireValid("value" in descriptor);
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  };
  visit(input, 0);
}

function validateRaw(input: unknown): AppDataset {
  const d = object(input);
  requireValid(d.format === "call-footprint-export" && d.formatVersion === "1.0" && d.contractVersion === "1.0");
  requireValid(timestamp(d.exportedAt) && d.exportedAt !== null && id(d.timezone));
  const account = object(d.account);
  requireValid(id(account.id) && account.id !== "all-accounts" && id(account.displayName));
  requireValid(account.avatarRef === undefined || nullableText(account.avatarRef));
  const source = object(d.source);
  requireValid(["empty", "demo", "normalized_file"].includes(source.kind as string) && text(source.displayName) && nullableText(source.sourceVersion));
  requireValid(source.sourceVersion !== "account-collection-1.0");
  const contacts = array(d.contacts);
  const contactIds = new Set<string>();
  for (const value of contacts) {
    const c = object(value);
    requireValid(id(c.id) && !contactIds.has(c.id) && c.accountId === account.id);
    contactIds.add(c.id);
    requireValid(kinds.includes(c.kind as string) && text(c.displayName));
    requireValid(c.wechatId === undefined || nullableText(c.wechatId));
    requireValid(nullableText(c.avatarRef) && confidence.includes(c.identityConfidence as string) && typeof c.needsReview === "boolean");
    strings(c.aliases); strings(c.mergedFromContactIds);
    requireValid(timestamp(c.firstCallAt) && timestamp(c.lastCallAt));
  }
  const eventIds = new Set<string>();
  for (const value of array(d.events)) {
    const e = object(value);
    requireValid(id(e.id) && !eventIds.has(e.id) && e.accountId === account.id);
    eventIds.add(e.id);
    requireValid(e.contactId === null || (id(e.contactId) && contactIds.has(e.contactId)));
    requireValid(e.conversationId === null || id(e.conversationId));
    const snapshot = object(e.contactSnapshot);
    requireValid(nullableText(snapshot.displayName) && kinds.includes(snapshot.kind as string));
    requireValid(timestamp(e.startedAt) && timestamp(e.answeredAt) && timestamp(e.endedAt));
    requireValid(nullableText(e.timezone));
    requireValid(e.utcOffsetMinutes === null || (typeof e.utcOffsetMinutes === "number" && Number.isFinite(e.utcOffsetMinutes) && Math.abs(e.utcOffsetMinutes) <= 1440));
    requireValid(e.connectedDurationSeconds === null || (typeof e.connectedDurationSeconds === "number" && Number.isFinite(e.connectedDurationSeconds) && e.connectedDurationSeconds >= 0));
    requireValid(["voice", "video", "unknown"].includes(e.mediaType as string));
    requireValid(["incoming", "outgoing", "unknown"].includes(e.direction as string));
    requireValid(["completed", "interrupted", "missed", "cancelled_by_self", "cancelled_by_peer", "rejected", "busy", "failed", "unknown"].includes(e.outcome as string));
    requireValid([e.parseConfidence, e.identityConfidence, e.dedupConfidence].every((v) => confidence.includes(v as string)));
    requireValid(array(e.qualityFlags).every((v) => flags.includes(v as string)) && typeof e.excluded === "boolean");
    const lineage = object(e.lineage);
    requireValid([lineage.adapterId, lineage.adapterVersion, lineage.parserVersion, lineage.dedupVersion].every(id));
    requireValid(timestamp(lineage.normalizedAt) && lineage.normalizedAt !== null);
    for (const value of array(lineage.sourceRefs)) {
      const ref = object(value);
      requireValid(id(ref.sourceId) && id(ref.sourceRecordIdHash) && id(ref.sourceDatabaseKind));
      requireValid(ref.sourcePartition === undefined || text(ref.sourcePartition));
    }
  }
  for (const value of array(d.coverage)) {
    const interval = object(value);
    requireValid(day(interval.startDate) <= day(interval.endDate));
    requireValid(["complete", "partial", "missing", "failed"].includes(interval.state as string));
    strings(interval.sourceIds);
    requireValid(nullableText(interval.reasonCode));
  }
  return input as AppDataset;
}

export function validateAccountCollection(input: unknown): AccountCollection {
  try {
    validateTree(input);
    const value = object(input);
    requireValid(value.format === "call-footprint-collection" && value.formatVersion === "1.0");
    const accounts = new Map<string, Set<string>>();
    const people = new Set<string>();
    let events = 0;
    for (const raw of array(value.datasets)) {
      const dataset = validateRaw(raw);
      requireValid(!accounts.has(dataset.account.id));
      accounts.set(dataset.account.id, new Set(dataset.contacts.map((c) => c.id)));
      for (const contact of dataset.contacts) {
        if (contact.kind === "person") people.add(memberKey({ accountId: dataset.account.id, contactId: contact.id }));
      }
      events += dataset.events.length;
      requireValid(events <= LIMIT);
    }
    for (const raw of array(value.links)) {
      const link = object(raw);
      const members = array(link.members);
      requireValid(members.length >= 2);
      const seen = new Set<string>();
      for (const rawMember of members) {
        const m = object(rawMember);
        requireValid(id(m.accountId) && id(m.contactId) && accounts.get(m.accountId)?.has(m.contactId));
        const key = memberKey(m as Member);
        requireValid(!seen.has(key) && people.has(key));
        seen.add(key);
      }
    }
    // Return detached raw data. Never let an import retain references into the store.
    return structuredClone(input as AccountCollection);
  } catch {
    throw new Error(INVALID);
  }
}

export function createAccountCollection(dataset?: AppDataset): AccountCollection {
  return validateAccountCollection({ format: "call-footprint-collection", formatVersion: "1.0", datasets: dataset === undefined ? [] : [dataset], links: [] });
}

export function upsertAccountDataset(collection: AccountCollection, incoming: AppDataset): AccountCollection {
  const result = validateAccountCollection(collection);
  const next = validateAccountCollection({ format: "call-footprint-collection", formatVersion: "1.0", datasets: [incoming], links: [] }).datasets[0];
  const index = result.datasets.findIndex((d) => d.account.id === next.account.id);
  if (index < 0) result.datasets.push(next);
  else {
    const previous = result.datasets[index];
    const contacts = new Map(previous.contacts.map((c) => [c.id, c]));
    const events = new Map(previous.events.map((e) => [e.id, e]));
    for (const contact of next.contacts) contacts.set(contact.id, contact);
    for (const event of next.events) {
      const previousEvent = events.get(event.id);
      if (!previousEvent) events.set(event.id, event);
      else {
        const refs = new Map(previousEvent.lineage.sourceRefs.map((ref) => [JSON.stringify([ref.sourceId, ref.sourceRecordIdHash, ref.sourceDatabaseKind, ref.sourcePartition]), ref]));
        for (const ref of event.lineage.sourceRefs) refs.set(JSON.stringify([ref.sourceId, ref.sourceRecordIdHash, ref.sourceDatabaseKind, ref.sourcePartition]), ref);
        events.set(event.id, { ...event, lineage: { ...event.lineage, sourceRefs: [...refs.values()] } });
      }
    }
    const coverage = new Map(previous.coverage.map((c) => [JSON.stringify(c), c]));
    for (const interval of next.coverage) coverage.set(JSON.stringify(interval), interval);
    result.datasets[index] = { ...next, contacts: [...contacts.values()], events: [...events.values()], coverage: [...coverage.values()] };
  }
  return validateAccountCollection(result);
}

export function removeAccountDataset(collection: AccountCollection, accountId: string): AccountCollection {
  const result = validateAccountCollection(collection);
  result.datasets = result.datasets.filter((d) => d.account.id !== accountId);
  result.links = result.links.map((link) => ({ members: link.members.filter((m) => m.accountId !== accountId) })).filter((link) => link.members.length >= 2);
  return result;
}

export function linkContacts(collection: AccountCollection, members: Member[]): AccountCollection {
  const result = validateAccountCollection(collection);
  result.links.push({ members });
  const validated = validateAccountCollection(result);
  const keys = new Set(members.map(memberKey));
  if (validated.links.slice(0, -1).some((link) => link.members.length === keys.size && link.members.every((m) => keys.has(memberKey(m))))) validated.links.pop();
  return validated;
}

export function unlinkContacts(collection: AccountCollection, index: number): AccountCollection {
  const result = validateAccountCollection(collection);
  requireValid(Number.isInteger(index) && index >= 0 && index < result.links.length);
  result.links.splice(index, 1);
  return result;
}

function contactGroups(collection: AccountCollection): Map<string, string> {
  const parents = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parents.get(root) !== root) root = parents.get(root)!;
    while (key !== root) {
      const next = parents.get(key)!;
      parents.set(key, root);
      key = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const left = find(a), right = find(b);
    if (left !== right) parents.set(left < right ? right : left, left < right ? left : right);
  };
  const identities = new Map<string, string>();
  for (const dataset of collection.datasets) {
    for (const contact of dataset.contacts) {
      const key = memberKey({ accountId: dataset.account.id, contactId: contact.id });
      parents.set(key, key);
      const identity = contact.wechatId?.trim();
      if (contact.kind !== "person" || contact.identityConfidence !== "confirmed" || contact.needsReview || !identity) continue;
      const previous = identities.get(identity);
      if (previous) union(previous, key);
      else identities.set(identity, key);
    }
  }
  for (const link of collection.links) {
    const first = memberKey(link.members[0]);
    for (const member of link.members.slice(1)) union(first, memberKey(member));
  }
  const canonical = new Map<string, string>();
  for (const [identity, key] of identities) {
    const root = find(key);
    const stableId = ns("identity", "wechat", identity);
    const previous = canonical.get(root);
    if (!previous || stableId < previous) canonical.set(root, stableId);
  }
  return new Map([...parents.keys()].map((key) => {
    const root = find(key);
    return [key, canonical.get(root) ?? root];
  }));
}

function projectCoverage(datasets: AppDataset[]): CoverageInterval[] {
  type Change = { account: number; complete: boolean; sources: string[]; delta: number };
  const changes = new Map<number, Change[]>();
  datasets.forEach((dataset, account) => {
    for (const interval of dataset.coverage) {
      const sources = [...new Set(interval.sourceIds.map((s) => ns("source", dataset.account.id, s)))];
      for (const [date, delta] of [[day(interval.startDate), 1], [day(interval.endDate) + 1, -1]]) {
        const list = changes.get(date) ?? [];
        list.push({ account, complete: interval.state === "complete", sources, delta });
        changes.set(date, list);
      }
    }
  });
  const dates = [...changes.keys()].sort((a, b) => a - b);
  const complete = datasets.map(() => 0), uncertain = datasets.map(() => 0);
  let covered = 0, active = 0;
  const sources = new Map<string, number>();
  const result: CoverageInterval[] = [];
  const dateText = (date: number) => new Date(date * 86_400_000).toISOString().slice(0, 10);
  for (let i = 0; i < dates.length - 1; i++) {
    const date = dates[i];
    for (const change of changes.get(date)!) {
      const a = change.account;
      const before = complete[a] > 0 && uncertain[a] === 0;
      if (change.complete) complete[a] += change.delta;
      else uncertain[a] += change.delta;
      const after = complete[a] > 0 && uncertain[a] === 0;
      covered += Number(after) - Number(before);
      active += change.delta;
      for (const source of change.sources) {
        const count = (sources.get(source) ?? 0) + change.delta;
        if (count) sources.set(source, count);
        else sources.delete(source);
      }
    }
    if (!active) continue;
    const interval: CoverageInterval = {
      startDate: dateText(date), endDate: dateText(dates[i + 1] - 1),
      state: covered === datasets.length ? "complete" : "partial",
      sourceIds: [...sources.keys()].sort(),
      reasonCode: covered === datasets.length ? null : "partial_account_coverage"
    };
    const previous = result.at(-1);
    if (previous && day(previous.endDate) + 1 === date && previous.state === interval.state && JSON.stringify(previous.sourceIds) === JSON.stringify(interval.sourceIds)) {
      previous.endDate = interval.endDate;
    } else result.push(interval);
  }
  return result;
}

export function projectAccountCollection(collection: AccountCollection, scope: string | null): AppDataset {
  const raw = validateAccountCollection(collection);
  const groups = contactGroups(raw);
  const datasets = scope === null ? raw.datasets : raw.datasets.filter((d) => d.account.id === scope);
  requireValid(scope === null || datasets.length === 1);
  const buckets = new Map<string, Contact[]>();
  const events: AppDataset["events"] = [];
  for (const dataset of datasets) {
    for (const contact of dataset.contacts) {
      const key = groups.get(memberKey({ accountId: dataset.account.id, contactId: contact.id }))!;
      const members = buckets.get(key) ?? [];
      members.push(contact);
      buckets.set(key, members);
    }
    for (const event of dataset.events) {
      events.push({
        ...event,
        id: ns("event", dataset.account.id, event.id),
        // accountId deliberately remains the original account, even in the all view.
        contactId: event.contactId === null ? null : groups.get(memberKey({ accountId: dataset.account.id, contactId: event.contactId }))!,
        conversationId: event.conversationId === null ? null : ns("conversation", dataset.account.id, event.conversationId),
        lineage: { ...event.lineage, sourceRefs: event.lineage.sourceRefs.map((ref) => ({ ...ref, sourceId: ns("source", dataset.account.id, ref.sourceId) })) }
      });
    }
  }
  const contacts: Contact[] = [];
  for (const [key, members] of buckets) {
    let representative = members[0];
    let representativeKey = memberKey({ accountId: representative.accountId, contactId: representative.id });
    let first: string | null = null, last: string | null = null;
    for (const contact of members) {
      const contactKey = memberKey({ accountId: contact.accountId, contactId: contact.id });
      if (contactKey < representativeKey) { representative = contact; representativeKey = contactKey; }
      if (contact.firstCallAt !== null && (first === null || Date.parse(contact.firstCallAt) < Date.parse(first))) first = contact.firstCallAt;
      if (contact.lastCallAt !== null && (last === null || Date.parse(contact.lastCallAt) > Date.parse(last))) last = contact.lastCallAt;
    }
    const identities = new Set(members.map((c) => c.wechatId?.trim()).filter(Boolean));
    contacts.push({
      ...representative, id: key, accountId: scope ?? "all-accounts",
      wechatId: identities.size === 1 ? [...identities][0] : null,
      aliases: [...new Set(members.flatMap((c) => [c.displayName, ...c.aliases]))],
      needsReview: members.some((c) => c.needsReview),
      mergedFromContactIds: members.flatMap((c) => [c.id, ...c.mergedFromContactIds].map((id) => ns("contact", c.accountId, id))),
      firstCallAt: first, lastCallAt: last
    });
  }
  const first = datasets[0];
  return {
    format: "call-footprint-export", formatVersion: "1.0", contractVersion: "1.0",
    exportedAt: first?.exportedAt ?? "1970-01-01T00:00:00Z",
    timezone: first?.timezone ?? "Asia/Shanghai",
    source: { kind: first ? "normalized_file" : "empty", displayName: scope === null ? "全部账号" : first.source.displayName, sourceVersion: "account-collection-1.0" },
    account: scope === null ? { id: "all-accounts", displayName: first?.account.displayName || "全部账号" } : { ...first.account },
    contacts, events, coverage: projectCoverage(datasets)
  };
}
