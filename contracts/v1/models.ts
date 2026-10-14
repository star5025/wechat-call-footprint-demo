/**
 * 通话足迹跨前端、Rust Core 与持久化边界的稳定 DTO。
 *
 * 规则：
 * - 所有 ID 都是应用生成的不透明字符串，UI 不解析其内容。
 * - 时间点使用带时区偏移的 RFC 3339；日历日期使用 YYYY-MM-DD。
 * - 未知值使用显式 `unknown`，不使用空字符串或臆测默认值。
 * - 可空字段只表示“来源没有可靠值”，不能被 UI 当作 0。
 */

export type ContractVersion = "1.0";
export type ISODate = string;
export type RFC3339DateTime = string;
export type OpaqueId = string;

export type CallMediaType = "voice" | "video" | "unknown";
export type CallDirection = "incoming" | "outgoing" | "unknown";
export type ContactKind = "person" | "group" | "official" | "unknown";
export type CallOutcome =
  | "completed"
  | "interrupted"
  | "missed"
  | "cancelled_by_self"
  | "cancelled_by_peer"
  | "rejected"
  | "busy"
  | "failed"
  | "unknown";

export type Confidence = "confirmed" | "inferred" | "unknown";
export type CoverageState = "complete" | "partial" | "missing" | "failed";
export type SupportLevel =
  | "supported"
  | "preview"
  | "import_only"
  | "research"
  | "unsupported";

export type QualityFlag =
  | "missing_start_time"
  | "missing_duration"
  | "unknown_timezone"
  | "unknown_contact"
  | "unknown_media_type"
  | "unknown_direction"
  | "unknown_outcome"
  | "possible_duplicate"
  | "conflicting_source_records"
  | "partial_source_coverage"
  | "unsupported_source_variant"
  | "parser_recovered_value"
  | "user_corrected";

export interface ContractEnvelope<T> {
  contractVersion: ContractVersion;
  requestId: string;
  dataRevision: string;
  generatedAt: RFC3339DateTime;
  data: T;
  warnings: ApiWarning[];
}

export interface ApiWarning {
  code: string;
  message: string;
  affectedFields?: string[];
  action?: ErrorAction;
}

export interface ApiError {
  contractVersion: ContractVersion;
  requestId: string;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    stage?: ScanStage;
    details?: Record<string, string | number | boolean | null>;
    actions: ErrorAction[];
  };
}

export type ErrorCode =
  | "INVALID_ARGUMENT"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_ACCESS_DENIED"
  | "SOURCE_BUSY"
  | "SNAPSHOT_INCONSISTENT"
  | "UNSUPPORTED_SOURCE"
  | "KEY_UNAVAILABLE"
  | "KEY_VERIFICATION_FAILED"
  | "DATABASE_CORRUPT"
  | "SCHEMA_UNSUPPORTED"
  | "PARSER_FAILED"
  | "INDEX_UNAVAILABLE"
  | "STORAGE_FULL"
  | "OPERATION_CANCELLED"
  | "INTERNAL_ERROR";

export type ErrorAction =
  | "retry"
  | "choose_source"
  | "reauthorize"
  | "close_wechat_and_retry"
  | "import_offline_copy"
  | "view_quality"
  | "export_diagnostics"
  | "clear_local_index"
  | "contact_support";

export interface SourceRef {
  sourceId: OpaqueId;
  sourceRecordIdHash: string;
  sourceDatabaseKind: string;
  sourcePartition?: string;
}

export interface EventLineage {
  sourceRefs: SourceRef[];
  adapterId: string;
  adapterVersion: string;
  parserVersion: string;
  dedupVersion: string;
  normalizedAt: RFC3339DateTime;
}

export interface ContactSnapshot {
  displayName: string | null;
  kind: ContactKind;
}

export interface CallEvent {
  id: OpaqueId;
  accountId: OpaqueId;
  contactId: OpaqueId | null;
  contactSnapshot: ContactSnapshot;
  conversationId: OpaqueId | null;

  startedAt: RFC3339DateTime | null;
  answeredAt: RFC3339DateTime | null;
  endedAt: RFC3339DateTime | null;
  timezone: string | null;
  utcOffsetMinutes: number | null;
  connectedDurationSeconds: number | null;

  mediaType: CallMediaType;
  direction: CallDirection;
  outcome: CallOutcome;

  parseConfidence: Confidence;
  identityConfidence: Confidence;
  dedupConfidence: Confidence;
  qualityFlags: QualityFlag[];
  excluded: boolean;
  lineage: EventLineage;
}

export interface Contact {
  id: OpaqueId;
  accountId: OpaqueId;
  kind: ContactKind;
  displayName: string;
  /** Source-visible WeChat ID. Null for sources that do not provide one. */
  wechatId?: string | null;
  /** Local data URL for WeChat scans; never an original filesystem path. */
  avatarRef: string | null;
  aliases: string[];
  identityConfidence: Confidence;
  needsReview: boolean;
  mergedFromContactIds: OpaqueId[];
  firstCallAt: RFC3339DateTime | null;
  lastCallAt: RFC3339DateTime | null;
}

export interface CoverageInterval {
  startDate: ISODate;
  endDate: ISODate;
  state: CoverageState;
  sourceIds: OpaqueId[];
  reasonCode: string | null;
}

export interface QualityDimension {
  id:
    | "source_coverage"
    | "field_completeness"
    | "time_continuity"
    | "structural_consistency"
    | "identity_certainty"
    | "dedup_certainty";
  state: "good" | "warning" | "poor" | "unknown";
  score: number | null;
  summary: string;
  affectedEventCount: number;
}

export interface DataQuality {
  overallState: "good" | "partial" | "needs_review" | "unavailable";
  dimensions: QualityDimension[];
  issueCount: number;
  reviewEventCount: number;
  coverage: CoverageInterval[];
}

export interface ContributionDay {
  date: ISODate;
  callCount: number;
  connectedCount: number;
  durationSeconds: number;
  videoCount: number;
  voiceCount: number;
  unknownMediaCount: number;
  coverage: CoverageState;
  qualityFlags: QualityFlag[];
}

export interface CallSummary {
  attemptedCount: number;
  connectedCount: number;
  timedCount: number;
  missedOrCancelledCount: number;
  totalDurationSeconds: number;
  meanDurationSeconds: number | null;
  medianDurationSeconds: number | null;
  longestDurationSeconds: number | null;
  longestEventId: OpaqueId | null;
  firstEventAt: RFC3339DateTime | null;
  lastEventAt: RFC3339DateTime | null;
  activeDayCount: number;
  completeCoverageDayCount: number;
}

export interface DateRange {
  startDate: ISODate;
  endDate: ISODate;
  timezone: string;
}

export interface CallFilter {
  accountId: OpaqueId;
  contactIds?: OpaqueId[];
  range: DateRange;
  mediaTypes?: CallMediaType[];
  directions?: CallDirection[];
  outcomes?: CallOutcome[];
  includeExcluded?: boolean;
  minimumConfidence?: Confidence;
}

export interface ContributionWallRequest {
  filter: CallFilter;
  metric: "duration" | "count";
  granularity: "day";
}

export interface ContributionWallResult {
  range: DateRange;
  metric: "duration" | "count";
  days: ContributionDay[];
  summary: CallSummary;
  quality: DataQuality;
}

export interface CallListRequest {
  filter: CallFilter;
  cursor?: string;
  limit?: number;
  sort?: "started_at_desc" | "started_at_asc" | "duration_desc";
  search?: string;
}

export interface CallListResult {
  events: CallEvent[];
  nextCursor: string | null;
  totalCount: number;
  quality: DataQuality;
}

export type ScanStage =
  | "discovering"
  | "preflight"
  | "snapshotting"
  | "verifying_key"
  | "decrypting"
  | "probing_schema"
  | "parsing"
  | "deduplicating"
  | "checking_quality"
  | "indexing"
  | "cleaning_up"
  | "completed";

export interface ScanProgress {
  scanId: OpaqueId;
  stage: ScanStage;
  state: "queued" | "running" | "cancelling" | "completed" | "partial" | "failed" | "cancelled";
  completedUnits: number | null;
  totalUnits: number | null;
  percent: number | null;
  message: string;
  startedAt: RFC3339DateTime;
  updatedAt: RFC3339DateTime;
  canCancel: boolean;
}

export interface DataSource {
  id: OpaqueId;
  kind: "demo" | "normalized_file" | "decrypted_database" | "wechat_local";
  platform: "windows" | "macos" | "unknown";
  displayName: string;
  accountHint: string | null;
  sourceVersion: string | null;
  supportLevel: SupportLevel;
  lastScannedAt: RFC3339DateTime | null;
  coverageStartDate: ISODate | null;
  coverageEndDate: ISODate | null;
}
