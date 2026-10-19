import type { CallEvent, Contact } from "@contracts/models";
import type { AppDataset } from "@/domain";

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
  const palettes = [
    ["#eee7ff", "#8065c7"],
    ["#dff5ed", "#378d77"],
    ["#ffe8d8", "#c17b45"],
    ["#e1edff", "#537ec3"],
    ["#ffe3ef", "#bc6791"],
    ["#e8e4ff", "#7163ae"]
  ];
  const [background, foreground] = palettes[index];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="32" fill="${background}"/><circle cx="${42 + index * 7}" cy="42" r="23" fill="${foreground}"/><path d="M16 112 Q64 ${42 + index * 4} 112 112Z" fill="${foreground}"/><circle cx="96" cy="25" r="7" fill="#ffffff"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Entirely fabricated, fixed-date records for the public preview; never reads local data. */
export function createDemoDataset(): AppDataset {
  const contacts: Contact[] = [
    "云朵邮差（虚构）",
    "月球园丁（虚构）",
    "星砂船长（虚构）",
    "薄荷机器人（虚构）",
    "纸飞机向导（虚构）"
  ].map((displayName, index) => ({
    id: `synthetic-demo-contact-${index + 1}`,
    accountId: ACCOUNT_ID,
    kind: "person",
    displayName,
    wechatId: null,
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
      displayName: "演示旅人（虚构）",
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
