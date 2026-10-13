import type { CallEvent, CallOutcome, CallMediaType } from "@contracts/models";
import type { AppDataset } from "@/domain";

interface RawCall {
  id: number;
  at: string;
  seconds: number;
  type: Exclude<CallMediaType, "unknown">;
  outcome: CallOutcome;
  direction: "incoming" | "outgoing";
}

const rawCalls: RawCall[] = [
  { id: 22, at: "2026-10-07T00:43:31+08:00", seconds: 8249, type: "video", outcome: "completed", direction: "outgoing" },
  { id: 21, at: "2026-10-06T23:14:20+08:00", seconds: 4800, type: "video", outcome: "interrupted", direction: "incoming" },
  { id: 20, at: "2026-10-06T20:08:42+08:00", seconds: 3985, type: "voice", outcome: "completed", direction: "outgoing" },
  { id: 19, at: "2026-10-06T18:25:08+08:00", seconds: 0, type: "video", outcome: "cancelled_by_peer", direction: "incoming" },
  { id: 18, at: "2026-10-05T22:40:10+08:00", seconds: 881, type: "video", outcome: "completed", direction: "outgoing" },
  { id: 17, at: "2026-10-05T19:13:02+08:00", seconds: 0, type: "voice", outcome: "cancelled_by_self", direction: "outgoing" },
  { id: 16, at: "2026-09-29T23:08:12+08:00", seconds: 3500, type: "video", outcome: "completed", direction: "incoming" },
  { id: 15, at: "2026-09-29T21:25:34+08:00", seconds: 2228, type: "voice", outcome: "interrupted", direction: "outgoing" },
  { id: 14, at: "2026-09-29T18:03:44+08:00", seconds: 0, type: "video", outcome: "missed", direction: "incoming" },
  { id: 13, at: "2026-09-24T22:31:06+08:00", seconds: 2800, type: "video", outcome: "completed", direction: "outgoing" },
  { id: 12, at: "2026-09-24T20:20:40+08:00", seconds: 1860, type: "video", outcome: "completed", direction: "incoming" },
  { id: 11, at: "2026-09-24T18:41:00+08:00", seconds: 0, type: "voice", outcome: "cancelled_by_self", direction: "outgoing" },
  { id: 10, at: "2026-09-23T23:02:11+08:00", seconds: 4200, type: "video", outcome: "completed", direction: "incoming" },
  { id: 9, at: "2026-09-23T21:10:29+08:00", seconds: 2640, type: "video", outcome: "completed", direction: "outgoing" },
  { id: 8, at: "2026-09-23T19:05:48+08:00", seconds: 32, type: "voice", outcome: "interrupted", direction: "incoming" },
  { id: 7, at: "2026-09-23T16:11:09+08:00", seconds: 0, type: "video", outcome: "missed", direction: "incoming" },
  { id: 6, at: "2026-09-22T23:12:50+08:00", seconds: 2600, type: "video", outcome: "completed", direction: "outgoing" },
  { id: 5, at: "2026-09-22T21:38:27+08:00", seconds: 2200, type: "video", outcome: "completed", direction: "incoming" },
  { id: 4, at: "2026-09-22T20:02:03+08:00", seconds: 1600, type: "voice", outcome: "completed", direction: "outgoing" },
  { id: 3, at: "2026-09-22T19:42:35+08:00", seconds: 1400, type: "video", outcome: "interrupted", direction: "incoming" },
  { id: 2, at: "2026-09-22T19:22:09+08:00", seconds: 1377, type: "voice", outcome: "completed", direction: "outgoing" },
  { id: 1, at: "2026-09-22T19:11:20+08:00", seconds: 0, type: "video", outcome: "cancelled_by_self", direction: "outgoing" }
];

function toEvent(call: RawCall): CallEvent {
  const connected = call.seconds > 0;
  return {
    id: `evt_demo_${String(call.id).padStart(3, "0")}`,
    accountId: "acc_demo_primary",
    contactId: "contact_demo_yin",
    contactSnapshot: { displayName: "音", kind: "person" },
    conversationId: "conversation_demo_yin",
    startedAt: call.at,
    answeredAt: null,
    endedAt: null,
    timezone: "Asia/Shanghai",
    utcOffsetMinutes: 480,
    connectedDurationSeconds: connected ? call.seconds : 0,
    mediaType: call.type,
    direction: call.direction,
    outcome: call.outcome,
    parseConfidence: "confirmed",
    identityConfidence: "confirmed",
    dedupConfidence: "confirmed",
    qualityFlags: [],
    excluded: false,
    lineage: {
      sourceRefs: [{
        sourceId: "source_demo_001",
        sourceRecordIdHash: `demo-sha256-${String(call.id).padStart(4, "0")}`,
        sourceDatabaseKind: "synthetic_fixture",
        sourcePartition: "demo"
      }],
      adapterId: "demo-call-adapter",
      adapterVersion: "1.0.0",
      parserVersion: "1.0.0",
      dedupVersion: "1.0.0",
      normalizedAt: "2026-10-13T12:00:00+08:00"
    }
  };
}

export const DEMO_DATASET: AppDataset = {
  format: "call-footprint-export",
  formatVersion: "1.0",
  contractVersion: "1.0",
  exportedAt: "2026-10-13T12:00:00+08:00",
  timezone: "Asia/Shanghai",
  source: {
    kind: "demo",
    displayName: "内置示例数据",
    sourceVersion: "demo-v1"
  },
  account: { id: "acc_demo_primary", displayName: "示例账号" },
  contacts: [{
    id: "contact_demo_yin",
    accountId: "acc_demo_primary",
    kind: "person",
    displayName: "音",
    avatarRef: null,
    aliases: [],
    identityConfidence: "confirmed",
    needsReview: false,
    mergedFromContactIds: [],
    firstCallAt: "2026-09-22T19:11:20+08:00",
    lastCallAt: "2026-10-07T00:43:31+08:00"
  }],
  events: rawCalls.map(toEvent),
  coverage: [{
    startDate: "2026-09-22",
    endDate: "2026-10-07",
    state: "complete",
    sourceIds: ["source_demo_001"],
    reasonCode: null
  }]
};
