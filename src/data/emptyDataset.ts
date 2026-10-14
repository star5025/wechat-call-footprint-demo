import type { AppDataset } from "@/domain";

export function createEmptyDataset(): AppDataset {
  return {
    format: "call-footprint-export",
    formatVersion: "1.0",
    contractVersion: "1.0",
    exportedAt: new Date().toISOString(),
    timezone: "Asia/Shanghai",
    source: {
      kind: "empty",
      displayName: "尚未连接数据",
      sourceVersion: null
    },
    account: {
      id: "acc_local_empty",
      displayName: "尚未连接",
      avatarRef: null
    },
    contacts: [],
    events: [],
    coverage: []
  };
}
