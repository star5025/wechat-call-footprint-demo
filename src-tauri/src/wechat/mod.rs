#[cfg_attr(target_os = "macos", allow(dead_code))]
mod crypto;
#[cfg_attr(target_os = "macos", allow(dead_code))]
mod discovery;
#[cfg(target_os = "macos")]
mod macos;
#[cfg_attr(target_os = "macos", allow(dead_code))]
mod parser;
pub mod setup;
#[cfg(windows)]
mod windows;

use serde::Serialize;
#[cfg(any(windows, target_os = "macos"))]
use std::fs;
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
};

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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatScanProgress {
    pub percent: u8,
    pub stage: &'static str,
    pub detail: &'static str,
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
    pub avatar_ref: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: String,
    pub account_id: String,
    pub kind: &'static str,
    pub display_name: String,
    pub wechat_id: Option<String>,
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

#[cfg(any(windows, target_os = "macos"))]
struct SnapshotCleanup(std::path::PathBuf);

#[cfg(any(windows, target_os = "macos"))]
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

pub fn scan_with_progress<F>(
    app_cache_dir: &Path,
    mut report: F,
) -> Result<WechatScanResult, String>
where
    F: FnMut(WechatScanProgress),
{
    #[cfg(not(any(windows, target_os = "macos")))]
    return Err("当前自动扫描仅支持 Windows 和 macOS 微信 4.x。".into());

    #[cfg(windows)]
    {
        let emit = |report: &mut F, percent, stage, detail| {
            report(WechatScanProgress {
                percent,
                stage,
                detail,
            });
        };
        let lock = SCAN_LOCK.get_or_init(|| Mutex::new(()));
        let _guard = lock
            .try_lock()
            .map_err(|_| "正在读取微信通话记录，请等待完成。".to_string())?;

        emit(&mut report, 3, "正在准备", "请保持微信打开");
        let installation = windows::find_wechat_installation()
            .map_err(|_| "没有找到正在使用的微信，请打开微信并保持登录后重试。".to_string())?;
        if installation.version != "4.1.15.13" {
            return Err("当前微信暂不支持，请更新通话足迹后重试。".into());
        }
        emit(&mut report, 10, "正在查找通话记录", "请稍候");
        let account = discovery::discover_active_account().map_err(|_| {
            "没有找到可读取的通话记录，请先打开微信并进入任意聊天后重试。".to_string()
        })?;

        emit(&mut report, 18, "正在读取通话记录", "不会修改微信中的内容");
        let snapshot = discovery::create_snapshot(&account, app_cache_dir)
            .map_err(|_| "微信正在忙，请稍等几秒后重试。".to_string())?;
        let _cleanup = SnapshotCleanup(snapshot.root.clone());
        emit(&mut report, 32, "正在整理通话记录", "请稍候");

        let xor_keys = crypto::extract_static_xor_keys(&installation.dll_path)
            .map_err(|_| "暂时无法读取通话记录，请更新通话足迹后重试。".to_string())?;
        emit(
            &mut report,
            38,
            "验证密钥",
            "正在从微信内存中查找并验证数据库密钥",
        );
        let key =
            windows::recover_account_key(&installation, &snapshot.validation_database, &xor_keys)?;
        let key_material = crypto::KeyMaterial::account_passphrase(key);
        emit(
            &mut report,
            62,
            "解析记录",
            "密钥已验证，正在解密并解析通话与头像",
        );
        emit(&mut report, 62, "正在整理联系人和头像", "请稍候");

        let parsed =
            parser::parse_snapshot(&snapshot, &account, &key_material, &installation.version)?;
        emit(
            &mut report,
            94,
            "整理数据",
            "解析完成，正在生成联系人和通话统计",
        );
        let result = WechatScanResult {
            summary: WechatScanSummary {
                wechat_version: installation.version,
                account_label: "当前登录账号".into(),
                database_shards: snapshot.message_databases.len(),
                contacts_with_calls: parsed.dataset.contacts.len(),
                call_events: parsed.dataset.events.len(),
                warnings: parsed.warnings,
            },
            dataset: parsed.dataset,
        };
        emit(&mut report, 100, "加载完成", "本机微信通话数据已整理完成");
        Ok(result)
    }

    #[cfg(target_os = "macos")]
    {
        let emit = |report: &mut F, percent, stage, detail| {
            report(WechatScanProgress {
                percent,
                stage,
                detail,
            });
        };
        let _operation = setup::begin_operation()?;

        emit(&mut report, 3, "定位微信", "正在确认本机微信版本");
        let installation = macos::find_wechat_installation()?;
        if installation.version != "4.1.13" {
            return Err("[MACOS_VERSION_UNSUPPORTED] 微信版本不支持".into());
        }
        emit(
            &mut report,
            10,
            "定位数据",
            "微信版本已确认，正在查找账号数据",
        );
        let account = macos::discover_account()?;
        emit(&mut report, 18, "检查记录", "检查密钥状态");
        macos::inspect_key_metadata(&account)?;
        let Some(manifest_path) = std::env::var_os("CALL_FOOTPRINT_MACOS_KEY_MANIFEST") else {
            return Err("[MACOS_MANIFEST_REQUIRED] 请先初始化密钥".into());
        };
        macos::scan_account(
            &account,
            Path::new(&manifest_path),
            app_cache_dir,
            &installation.version,
            "当前登录账号",
            report,
            setup::cancel_requested,
        )
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
        let mut progress = Vec::new();
        let result = scan_with_progress(&cache, |update| progress.push(update.percent))
            .expect("local WeChat scan should succeed");
        let avatars = result
            .dataset
            .contacts
            .iter()
            .filter(|contact| contact.avatar_ref.is_some())
            .count();
        eprintln!(
            "live scan: shards={}, contacts={}, calls={}, avatars={}, warnings={}",
            result.summary.database_shards,
            result.summary.contacts_with_calls,
            result.summary.call_events,
            avatars,
            result.summary.warnings.len()
        );
        assert!(result.summary.database_shards > 0);
        assert!(result.summary.call_events > 0);
        assert_eq!(result.dataset.format, "call-footprint-export");
        assert_ne!(result.dataset.account.display_name, "我");
        assert_ne!(
            result.dataset.account.display_name, "微信用户",
            "local self contact should provide the WeChat nickname"
        );
        assert_eq!(progress.last(), Some(&100));
        assert!(progress.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(result.dataset.account.avatar_ref.is_some());
        assert!(result.dataset.contacts.iter().all(|contact| contact
            .wechat_id
            .as_deref()
            .is_some_and(|value| !value.is_empty())));
        for event in &result.dataset.events {
            if let Some(duration) = event.connected_duration_seconds.filter(|value| *value > 0) {
                let started = chrono::DateTime::parse_from_rfc3339(
                    event
                        .started_at
                        .as_deref()
                        .expect("connected call should have a start time"),
                )
                .unwrap();
                let ended = chrono::DateTime::parse_from_rfc3339(
                    event
                        .ended_at
                        .as_deref()
                        .expect("connected call should have an end time"),
                )
                .unwrap();
                assert_eq!((ended - started).num_seconds(), duration as i64);
            }
        }
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
            if let Ok(review_date) = std::env::var("CALL_FOOTPRINT_TEST_DATE") {
                let reviewed_times = target_events
                    .iter()
                    .filter(|event| {
                        event
                            .started_at
                            .as_deref()
                            .is_some_and(|value| value.starts_with(&review_date))
                    })
                    .map(|event| {
                        (
                            event.started_at.as_deref().unwrap_or("unknown"),
                            event.ended_at.as_deref().unwrap_or("unknown"),
                            event.connected_duration_seconds,
                        )
                    })
                    .collect::<Vec<_>>();
                eprintln!("reviewed date {review_date}: {reviewed_times:?}");
            }
        }
        assert!(!cache
            .join("wechat-snapshots")
            .read_dir()
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false));
        let _ = fs::remove_dir_all(cache);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_live_tests {
    use super::*;

    #[test]
    #[ignore = "requires a logged-in local WeChat account and a private key manifest"]
    fn scans_local_wechat_without_exposing_private_data() {
        let cache =
            std::env::temp_dir().join(format!("call-footprint-live-test-{}", std::process::id()));
        let mut progress = Vec::new();
        let result = scan_with_progress(&cache, |update| progress.push(update.percent))
            .expect("local WeChat scan should succeed");

        assert!(result.summary.database_shards > 0);
        assert!(result.summary.call_events > 0);
        assert_eq!(result.dataset.format, "call-footprint-export");
        assert_eq!(progress.last(), Some(&100));
        assert!(progress.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(!cache
            .join("wechat-snapshots")
            .read_dir()
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false));
        let _ = fs::remove_dir_all(cache);
    }
}
