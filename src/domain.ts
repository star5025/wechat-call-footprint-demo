import type {
  CallEvent,
  Contact,
  ContributionDay,
  CoverageInterval,
  DataQuality,
  DateRange,
  OpaqueId,
  RFC3339DateTime
} from "@contracts/models";

export type AppRoute = "home" | "wall" | "discover" | "ranking" | "calls";
export type WallMode = "year" | "month" | "custom";
export type WallMetric = "duration" | "count";
export type DataMode = "empty" | "imported";

export interface Account {
  id: OpaqueId;
  displayName: string;
  avatarRef?: string | null;
}

export interface AppDataset {
  format: "call-footprint-export";
  formatVersion: "1.0";
  contractVersion: "1.0";
  exportedAt: RFC3339DateTime;
  timezone: string;
  source: {
    kind: "empty" | "demo" | "normalized_file";
    displayName: string;
    sourceVersion: string | null;
  };
  account: Account;
  contacts: Contact[];
  events: CallEvent[];
  coverage: CoverageInterval[];
}

export interface AppSettings {
  settingsVersion: 1;
  reducedMotion: boolean;
  weekStartsOn: "monday" | "sunday";
  timezone: string;
  defaultWallMetric: WallMetric;
  lastRoute: AppRoute;
  lastContactId: OpaqueId | null;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  dataDirectory: string;
  isTauri: boolean;
}

export interface ImportFileResult {
  fileName: string;
  content: string;
  sizeBytes: number;
}

export interface ExportResult {
  path: string;
  sizeBytes: number;
}

export interface WechatScanSummary {
  wechatVersion: string;
  accountLabel: string;
  databaseShards: number;
  contactsWithCalls: number;
  callEvents: number;
  warnings: string[];
}

export interface WechatScanResult {
  dataset: AppDataset;
  summary: WechatScanSummary;
}

export interface WechatScanProgress {
  percent: number;
  stage: string;
  detail: string;
}

export interface DatasetValidationResult {
  valid: boolean;
  dataset?: AppDataset;
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  fileName: string;
  contactCount: number;
  eventCount: number;
  connectedCount: number;
  startDate: string | null;
  endDate: string | null;
  warnings: string[];
  dataset: AppDataset;
}

export interface WallResult {
  range: DateRange;
  days: ContributionDay[];
  quality: DataQuality;
}

export interface InsightView {
  id: string;
  tone: "night" | "mint" | "peach" | "blue";
  eyebrow: string;
  title: string;
  description: string;
  value?: string;
  sampleSize: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  settingsVersion: 1,
  reducedMotion: false,
  weekStartsOn: "monday",
  timezone: "Asia/Shanghai",
  defaultWallMetric: "duration",
  lastRoute: "home",
  lastContactId: null
};
