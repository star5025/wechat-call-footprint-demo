import type { CallEvent, Contact } from "@contracts/models";
import type { AppDataset } from "@/domain";
import { createAccountCollection, upsertAccountDataset, type AccountCollection } from "@/data/accountCollection";

const TIMEZONE = "Asia/Shanghai";
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const EXPORTED_AT = "2026-10-19T23:59:59+08:00";
const ACCOUNT_ID = "synthetic-demo-account";
const SOURCE_ID = "synthetic-demo-source";

function localTimestamp(milliseconds: number): string {
  return `${new Date(milliseconds + OFFSET_MS).toISOString().slice(0, 19)}+08:00`;
}

function avatar(index: number): string {
  const backgrounds = ["#eee7ff", "#dff5ed", "#ffe8d8", "#e1edff", "#ffe3ef", "#e8e4ff", "#e7f4ed", "#fff0d9"];
  const emojis = ["🐶", "🐼", "🐱", "🦊", "🐰", "😎", "🐨", "🙂"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="32" fill="${backgrounds[index]}"/><text x="64" y="88" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif" font-size="80">${emojis[index]}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Entirely fabricated, fixed-date records for the public preview; never reads local data. */
export function createDemoDataset(): AppDataset {
  const contacts: Contact[] = [
    "阿杰",
    "老周",
    "Lily",
    "小王",
    "张同学"
  ].map((displayName, index) => ({
    id: `synthetic-demo-contact-${index + 1}`,
    accountId: ACCOUNT_ID,
    kind: "person",
    displayName,
    wechatId: `synthetic-wechat-person-${index + 1}`,
    avatarRef: avatar(index),
    aliases: [],
    identityConfidence: "confirmed",
    needsReview: false,
    mergedFromContactIds: [],
    firstCallAt: null,
    lastCallAt: null
  }));
  const events: CallEvent[] = [];
  const firstDay = Date.parse("2025-01-01T00:00:00+08:00");
  const lastDay = Date.parse("2026-10-19T00:00:00+08:00");
  const cadence = [3, 5, 7, 9, 11];
  const hours = [18, 7, 14, 10, 20];
  const durations = [28, 95, 240, 487, 930, 1840, 2760, 4320, 7535];
  const outcomes: CallEvent["outcome"][] = [
    "missed", "cancelled_by_self", "cancelled_by_peer", "rejected", "busy", "failed",
    "interrupted"
  ];

  for (let day = firstDay, dayIndex = 0; day <= lastDay; day += DAY_MS, dayIndex += 1) {
    const date = localTimestamp(day).slice(0, 10);
    for (const [contactIndex, contact] of contacts.entries()) {
      const streak = contactIndex === 0 && date >= "2026-10-05";
      if (!streak && (dayIndex + contactIndex * 3) % cadence[contactIndex] !== 0) continue;

      const outcome = streak ? "completed" : outcomes[(dayIndex * 3 + contactIndex * 7) % 17] ?? "completed";
      const connected = outcome === "completed" || outcome === "interrupted";
      const duration = connected ? durations[(dayIndex + contactIndex * 2) % durations.length] : 0;
      const start = day + ((hours[contactIndex] + dayIndex % 2) * 3600 + dayIndex % 45 * 60) * 1000;
      const number = String(events.length + 1).padStart(4, "0");
      const direction = outcome === "missed" || outcome === "cancelled_by_peer" || outcome === "rejected"
        ? "incoming"
        : outcome === "cancelled_by_self" || outcome === "busy"
          ? "outgoing"
          : (dayIndex + contactIndex) % 2 === 0 ? "incoming" : "outgoing";

      events.push({
        id: `synthetic-demo-event-${number}`,
        accountId: ACCOUNT_ID,
        contactId: contact.id,
        contactSnapshot: { displayName: contact.displayName, kind: contact.kind },
        conversationId: `synthetic-demo-conversation-${contactIndex + 1}`,
        startedAt: localTimestamp(start),
        answeredAt: connected ? localTimestamp(start + 8000) : null,
        endedAt: localTimestamp(start + (connected ? duration + 8 : 20) * 1000),
        timezone: TIMEZONE,
        utcOffsetMinutes: 480,
        connectedDurationSeconds: duration,
        mediaType: (dayIndex + contactIndex) % 4 === 0 ? "video" : "voice",
        direction,
        outcome,
        parseConfidence: "confirmed",
        identityConfidence: "confirmed",
        dedupConfidence: "confirmed",
        qualityFlags: [],
        excluded: false,
        lineage: {
          sourceRefs: [{
            sourceId: SOURCE_ID,
            sourceRecordIdHash: `synthetic-demo-record-${number}`,
            sourceDatabaseKind: "synthetic_generator",
            sourcePartition: date.slice(0, 4)
          }],
          adapterId: "synthetic-demo-generator",
          adapterVersion: "1.0",
          parserVersion: "1.0",
          dedupVersion: "1.0",
          normalizedAt: EXPORTED_AT
        }
      });
    }
  }

  events.sort((left, right) => right.startedAt!.localeCompare(left.startedAt!) || right.id.localeCompare(left.id));
  for (const contact of contacts) {
    const calls = events.filter((event) => event.contactId === contact.id);
    contact.firstCallAt = calls.at(-1)?.startedAt ?? null;
    contact.lastCallAt = calls[0]?.startedAt ?? null;
  }

  return {
    format: "call-footprint-export",
    formatVersion: "1.0",
    contractVersion: "1.0",
    exportedAt: EXPORTED_AT,
    timezone: TIMEZONE,
    source: {
      kind: "demo",
      displayName: "合成演示数据 · 所有人物与通话均为虚构",
      sourceVersion: "1.0"
    },
    account: {
      id: ACCOUNT_ID,
      displayName: "小陈",
      avatarRef: avatar(5)
    },
    contacts,
    events,
    coverage: [{
      startDate: "2025-01-01",
      endDate: "2026-10-19",
      state: "complete",
      sourceIds: [SOURCE_ID],
      reasonCode: null
    }]
  };
}

export function createDemoAccountCollection(): AccountCollection {
  const primary = createDemoDataset();
  const secondary = structuredClone(primary);
  const accountId = "synthetic-demo-account-secondary";
  const sourceId = "synthetic-demo-source-secondary";
  secondary.account = { id: accountId, displayName: "小陈的小号", avatarRef: avatar(7) };
  const remarks = ["杰哥", "周哥", "Lily", "小王", "张同学"];
  secondary.contacts = secondary.contacts.map((contact, index) => ({
    ...contact, accountId, displayName: remarks[index]
  }));
  const extra: Contact = {
    ...secondary.contacts[0], id: "synthetic-demo-secondary-only", accountId,
    displayName: "小林", wechatId: "synthetic-wechat-person-6", avatarRef: avatar(6)
  };
  secondary.contacts.push(extra);
  secondary.events = primary.events.slice(-40).map((event, index) => {
    const contact = index === 0 ? extra : secondary.contacts.find((item) => item.id === event.contactId)!;
    return {
      ...structuredClone(event), id: `synthetic-secondary-event-${index}`, accountId,
      contactId: contact.id, contactSnapshot: { displayName: contact.displayName, kind: contact.kind },
      conversationId: `synthetic-secondary-conversation-${contact.id}`,
      startedAt: event.startedAt ? localTimestamp(Date.parse(event.startedAt) - 60_000) : null,
      answeredAt: event.answeredAt ? localTimestamp(Date.parse(event.answeredAt) - 60_000) : null,
      endedAt: event.endedAt ? localTimestamp(Date.parse(event.endedAt) - 60_000) : null,
      lineage: { ...structuredClone(event.lineage), sourceRefs: event.lineage.sourceRefs.map((ref) => ({
        ...ref, sourceId, sourceRecordIdHash: `synthetic-secondary-record-${index}`
      })) }
    };
  });
  secondary.coverage = [{ startDate: "2025-01-01", endDate: "2026-10-19", state: "complete", sourceIds: [sourceId], reasonCode: null }];
  return upsertAccountDataset(createAccountCollection(primary), secondary);
}
