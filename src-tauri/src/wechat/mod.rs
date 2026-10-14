mod crypto;
mod discovery;
mod parser;
#[cfg(windows)]
mod windows;

use serde::Serialize;
use std::{
    fs,
    path::Path,
    sync::{Mutex, OnceLock},
};
use zeroize::Zeroizing;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatScanResult {
    pub dataset: AppDataset,
    pub summary: WechatScanSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatScanSummary {
    pub wechat_version: String,
    pub account_label: String,
    pub database_shards: usize,
    pub contacts_with_calls: usize,
    pub call_events: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataset {
    pub format: &'static str,
    pub format_version: &'static str,
    pub contract_version: &'static str,
    pub exported_at: String,
    pub timezone: String,
    pub source: DatasetSource,
    pub account: Account,
    pub contacts: Vec<Contact>,
    pub events: Vec<CallEvent>,
    pub coverage: Vec<CoverageInterval>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetSource {
    pub kind: &'static str,
    pub display_name: String,
    pub source_version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: String,
    pub account_id: String,
    pub kind: &'static str,
    pub display_name: String,
    pub avatar_ref: Option<String>,
    pub aliases: Vec<String>,
    pub identity_confidence: &'static str,
    pub needs_review: bool,
    pub merged_from_contact_ids: Vec<String>,
    pub first_call_at: Option<String>,
    pub last_call_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallEvent {
    pub id: String,
    pub account_id: String,
    pub contact_id: Option<String>,
    pub contact_snapshot: ContactSnapshot,
    pub conversation_id: Option<String>,
    pub started_at: Option<String>,
    pub answered_at: Option<String>,
    pub ended_at: Option<String>,
    pub timezone: Option<String>,
    pub utc_offset_minutes: Option<i32>,
    pub connected_duration_seconds: Option<u64>,
    pub media_type: &'static str,
    pub direction: &'static str,
    pub outcome: &'static str,
    pub parse_confidence: &'static str,
    pub identity_confidence: &'static str,
    pub dedup_confidence: &'static str,
    pub quality_flags: Vec<&'static str>,
    pub excluded: bool,
    pub lineage: EventLineage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactSnapshot {
    pub display_name: Option<String>,
    pub kind: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLineage {
    pub source_refs: Vec<SourceRef>,
    pub adapter_id: &'static str,
    pub adapter_version: &'static str,
    pub parser_version: &'static str,
    pub dedup_version: &'static str,
    pub normalized_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub source_id: String,
    pub source_record_id_hash: String,
    pub source_database_kind: &'static str,
    pub source_partition: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageInterval {
    pub start_date: String,
    pub end_date: String,
    pub state: &'static str,
    pub source_ids: Vec<String>,
    pub reason_code: Option<String>,
}

static SCAN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct SnapshotCleanup(std::path::PathBuf);

impl Drop for SnapshotCleanup {
    fn drop(&mut self) {
        for attempt in 0..3 {
            if fs::remove_dir_all(&self.0).is_ok() || !self.0.exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50 * (attempt + 1)));
        }
    }
}

pub fn cleanup_cache(app_cache_dir: &Path) {
    discovery::cleanup_stale_snapshots(&app_cache_dir.join("wechat-snapshots"));
}

pub fn scan(app_cache_dir: &Path) -> Result<WechatScanResult, String> {
    #[cfg(not(windows))]
    return Err("当前自动扫描仅支持 Windows 微信 4.x。".into());

    #[cfg(windows)]
    {
        let lock = SCAN_LOCK.get_or_init(|| Mutex::new(()));
        let _guard = lock
            .try_lock()
            .map_err(|_| "已有微信扫描正在进行，请等待完成。".to_string())?;
        let installation = windows::find_wechat_installation()?;
        if installation.version != "4.1.15.13" {
            return Err(format!(
                "当前微信版本 {} 尚未通过安全适配验证，暂不自动读取。",
                installation.version
            ));
        }
        let account = discovery::discover_active_account()?;
        let snapshot = discovery::create_snapshot(&account, app_cache_dir)?;
        let _cleanup = SnapshotCleanup(snapshot.root.clone());

        let xor_keys = crypto::extract_static_xor_keys(&installation.dll_path)?;
        let key = Zeroizing::new(windows::recover_account_key(
            &installation,
            &snapshot.validation_database,
            &xor_keys,
        )?);

        let parsed = parser::parse_snapshot(&snapshot, &account, &key, &installation.version)?;
        Ok(WechatScanResult {
            summary: WechatScanSummary {
                wechat_version: installation.version,
                account_label: "当前登录账号".into(),
                database_shards: snapshot.message_databases.len(),
                contacts_with_calls: parsed.dataset.contacts.len(),
                call_events: parsed.dataset.events.len(),
                warnings: parsed.warnings,
            },
            dataset: parsed.dataset,
        })
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a logged-in local WeChat account"]
    fn scans_local_wechat_without_exposing_private_data() {
        let cache =
            std::env::temp_dir().join(format!("call-footprint-live-test-{}", std::process::id()));
        let result = scan(&cache).expect("local WeChat scan should succeed");
        eprintln!(
            "live scan: shards={}, contacts={}, calls={}, warnings={}",
            result.summary.database_shards,
            result.summary.contacts_with_calls,
            result.summary.call_events,
            result.summary.warnings.len()
        );
        assert!(result.summary.database_shards > 0);
        assert!(result.summary.call_events > 0);
        assert_eq!(result.dataset.format, "call-footprint-export");
        if let Ok(target_name) = std::env::var("CALL_FOOTPRINT_TEST_CONTACT") {
            let target = result
                .dataset
                .contacts
                .iter()
                .find(|contact| contact.display_name == target_name)
                .expect("configured reviewed contact should be present");
            let target_events = result
                .dataset
                .events
                .iter()
                .filter(|event| event.contact_id.as_deref() == Some(target.id.as_str()))
                .collect::<Vec<_>>();
            let unknown = target_events
                .iter()
                .filter(|event| event.media_type == "unknown")
                .count();
            eprintln!(
                "reviewed contact: calls={}, unknown_media={}",
                target_events.len(),
                unknown
            );
            assert!(!target_events.is_empty());
            assert_eq!(unknown, 0, "reviewed contact media should be classified");
        }
        assert!(!cache
            .join("wechat-snapshots")
            .read_dir()
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false));
        let _ = fs::remove_dir_all(cache);
    }
}
