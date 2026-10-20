use std::{
    env, fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Debug)]
pub struct WechatAccount {
    pub account_name: String,
    pub account_wxid: String,
    pub message_databases: Vec<PathBuf>,
    pub contact_database: PathBuf,
    pub head_image_database: Option<PathBuf>,
}

#[derive(Debug)]
pub struct WechatSnapshot {
    pub root: PathBuf,
    pub message_databases: Vec<PathBuf>,
    pub contact_database: PathBuf,
    pub head_image_database: Option<PathBuf>,
    pub validation_database: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FileState {
    length: u64,
    modified: Option<SystemTime>,
}

pub fn discover_active_account() -> Result<WechatAccount, String> {
    let roots = candidate_data_roots();
    let mut accounts = Vec::new();
    for root in roots.into_iter().filter(|path| path.is_dir()) {
        let entries =
            fs::read_dir(&root).map_err(|error| format!("无法读取微信数据目录：{error}"))?;
        for entry in entries.flatten() {
            let account_root = entry.path();
            if !account_root.is_dir() || is_reserved_account_dir(&account_root) {
                continue;
            }
            if let Some(account) = inspect_account(account_root) {
                accounts.push(account);
            }
        }
    }
    accounts.sort_by_key(latest_message_time);
    accounts.pop().ok_or_else(|| {
        "没有找到微信 4.x 聊天数据库。请先登录桌面微信，并确认应用能够读取微信数据目录。".into()
    })
}

// Managed onboarding never consults CLI overrides or chooses the most recent account.
#[cfg(target_os = "macos")]
pub fn enumerate_managed_accounts(root: &Path) -> Result<Vec<WechatAccount>, String> {
    let error =
        || "[MACOS_DATA_UNAVAILABLE] 无法安全读取微信账号，请检查文件访问权限。".to_string();
    if !root.exists() {
        return Ok(Vec::new());
    }
    if fs::canonicalize(root).map_err(|_| error())? != root {
        return Err(error());
    }
    let mut accounts = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (index, entry) in fs::read_dir(root).map_err(|_| error())?.enumerate() {
        if index >= 1000 {
            return Err(error());
        }
        let entry = entry.map_err(|_| error())?;
        let path = entry.path();
        if is_reserved_account_dir(&path) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path).map_err(|_| error())?;
        if metadata.file_type().is_symlink() {
            return Err(error());
        }
        if !metadata.is_dir() {
            continue;
        }
        let storage = path.join("db_storage");
        if !storage.exists() {
            continue;
        }
        if fs::canonicalize(&storage).map_err(|_| error())? != storage {
            return Err(error());
        }
        let messages = storage.join("message");
        if messages.is_dir() {
            let mut count = 0;
            for item in fs::read_dir(&messages).map_err(|_| error())? {
                let item = item.map_err(|_| error())?;
                count += 1;
                if count > 10000 || item.file_type().map_err(|_| error())?.is_symlink() {
                    return Err(error());
                }
            }
        }
        if let Some(account) = inspect_account(path) {
            super::macos::preflight_account(&account)?;
            let canonical = fs::canonicalize(&account.contact_database).map_err(|_| error())?;
            if seen.insert(canonical) {
                accounts.push(account);
            }
        }
    }
    accounts.sort_by(|a, b| a.contact_database.cmp(&b.contact_database));
    Ok(accounts)
}

fn candidate_data_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(configured) = env::var_os("CALL_FOOTPRINT_WECHAT_DATA_DIR") {
        add_root_variants(&PathBuf::from(configured), &mut roots);
    }

    #[cfg(windows)]
    {
        if let Some(profile) = env::var_os("USERPROFILE") {
            roots.push(
                PathBuf::from(&profile)
                    .join("Documents")
                    .join("xwechat_files"),
            );
        }
        if let Some(one_drive) = env::var_os("OneDrive") {
            roots.push(
                PathBuf::from(one_drive)
                    .join("Documents")
                    .join("xwechat_files"),
            );
        }
        for variable in ["APPDATA", "LOCALAPPDATA"] {
            let Some(base) = env::var_os(variable).map(PathBuf::from) else {
                continue;
            };
            for directory in [
                base.join("Tencent").join("xwechat"),
                base.join("Tencent").join("xwechat").join("config"),
                base.join("Tencent").join("WeChat"),
            ] {
                collect_config_paths(&directory, &mut roots);
            }
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        roots.push(
            PathBuf::from(home)
                .join("Library")
                .join("Containers")
                .join("com.tencent.xinWeChat")
                .join("Data")
                .join("Documents")
                .join("xwechat_files"),
        );
    }

    roots.retain(|path| path.is_dir());
    roots.sort();
    roots.dedup();
    roots
}

fn collect_config_paths(directory: &Path, roots: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten().take(200) {
        let path = entry.path();
        if path.is_dir() {
            if entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case("config")
            {
                collect_config_paths(&path, roots);
            }
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() == 0 || metadata.len() > 1024 * 1024 {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let mut texts = vec![String::from_utf8_lossy(&bytes).into_owned()];
        if bytes.len() >= 4 {
            let units = bytes
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>();
            texts.push(String::from_utf16_lossy(&units));
        }
        for text in texts {
            for candidate in extract_absolute_paths(&text) {
                add_root_variants(&candidate, roots);
            }
        }
    }
}

fn extract_absolute_paths(text: &str) -> Vec<PathBuf> {
    let normalized = text.replace("\\\\", "\\");
    let bytes = normalized.as_bytes();
    let mut paths = Vec::new();
    let mut index = 0usize;
    while index + 3 <= bytes.len() {
        let starts_path = bytes[index].is_ascii_alphabetic()
            && bytes[index + 1] == b':'
            && matches!(bytes[index + 2], b'\\' | b'/');
        if !starts_path {
            index += 1;
            continue;
        }
        let mut end = index + 3;
        while end < bytes.len()
            && end - index < 520
            && !matches!(
                bytes[end],
                0 | b'\r' | b'\n' | b'"' | b'\'' | b'<' | b'>' | b'|' | b',' | b'}'
            )
        {
            end += 1;
        }
        let value = String::from_utf8_lossy(&bytes[index..end]);
        let value = value.trim().trim_end_matches([' ', ';']);
        if value.len() >= 3 {
            paths.push(PathBuf::from(value));
        }
        index = end.max(index + 1);
    }
    paths
}

fn add_root_variants(candidate: &Path, roots: &mut Vec<PathBuf>) {
    if candidate
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("xwechat_files"))
    {
        roots.push(candidate.to_path_buf());
    }
    roots.push(candidate.join("xwechat_files"));
    for ancestor in candidate.ancestors() {
        if ancestor
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("xwechat_files"))
        {
            roots.push(ancestor.to_path_buf());
            break;
        }
    }
}

fn is_reserved_account_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some("all_users" | "Backup" | "backup" | "old_backup")
    )
}

fn inspect_account(root: PathBuf) -> Option<WechatAccount> {
    let db_storage = root.join("db_storage");
    let contact_database = db_storage.join("contact").join("contact.db");
    let head_image_path = db_storage.join("head_image").join("head_image.db");
    let head_image_database = head_image_path.is_file().then_some(head_image_path);
    let message_dir = db_storage.join("message");
    if !contact_database.is_file() || !message_dir.is_dir() {
        return None;
    }
    let mut message_databases = fs::read_dir(message_dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| is_message_database(path))
        .collect::<Vec<_>>();
    message_databases.sort_by_key(|path| message_shard_number(path));
    if message_databases.is_empty() {
        return None;
    }
    let account_name = root.file_name()?.to_str()?.to_owned();
    let account_wxid = account_name
        .rsplit_once('_')
        .map(|(wxid, _)| wxid)
        .filter(|value| value.starts_with("wxid_"))
        .unwrap_or(&account_name)
        .to_owned();
    Some(WechatAccount {
        account_name,
        account_wxid,
        message_databases,
        contact_database,
        head_image_database,
    })
}

fn is_message_database(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(number) = name
        .strip_prefix("message_")
        .and_then(|value| value.strip_suffix(".db"))
    else {
        return false;
    };
    !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
}

fn message_shard_number(path: &Path) -> u32 {
    path.file_stem()
        .and_then(|value| value.to_str())
        .and_then(|value| value.strip_prefix("message_"))
        .and_then(|value| value.parse().ok())
        .unwrap_or(u32::MAX)
}

fn latest_message_time(account: &WechatAccount) -> SystemTime {
    account
        .message_databases
        .iter()
        .filter_map(|path| fs::metadata(path).ok()?.modified().ok())
        .max()
        .unwrap_or(UNIX_EPOCH)
}

pub fn create_snapshot(
    account: &WechatAccount,
    cache_root: &Path,
) -> Result<WechatSnapshot, String> {
    let snapshots_root = cache_root.join("wechat-snapshots");
    cleanup_stale_snapshots(&snapshots_root);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let root = snapshots_root.join(format!("scan-{}-{nonce}", std::process::id()));
    let contact_dir = root.join("contact");
    let head_image_dir = root.join("head_image");
    let message_dir = root.join("message");
    fs::create_dir_all(&contact_dir).map_err(|error| format!("无法创建安全快照目录：{error}"))?;
    fs::create_dir_all(&head_image_dir)
        .map_err(|error| format!("无法创建安全快照目录：{error}"))?;
    fs::create_dir_all(&message_dir).map_err(|error| format!("无法创建安全快照目录：{error}"))?;

    let result = (|| {
        let contact_database = stable_copy_database(&account.contact_database, &contact_dir)?;
        let head_image_database = account
            .head_image_database
            .as_ref()
            .map(|database| stable_copy_database(database, &head_image_dir))
            .transpose()?;
        let mut message_databases = Vec::with_capacity(account.message_databases.len());
        for database in &account.message_databases {
            message_databases.push(stable_copy_database(database, &message_dir)?);
        }
        let validation_database = message_databases
            .first()
            .cloned()
            .ok_or_else(|| "快照中没有消息数据库。".to_string())?;
        Ok(WechatSnapshot {
            root: root.clone(),
            message_databases,
            contact_database,
            head_image_database,
            validation_database,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&root);
    }
    result
}

pub(crate) fn cleanup_stale_snapshots(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let cutoff = SystemTime::now().checked_sub(Duration::from_secs(5 * 60));
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !entry.file_name().to_string_lossy().starts_with("scan-") {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok());
        if cutoff
            .zip(modified)
            .map(|(cutoff, modified)| modified < cutoff)
            .unwrap_or(false)
        {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn stable_copy_database(source: &Path, destination_dir: &Path) -> Result<PathBuf, String> {
    let name = source
        .file_name()
        .ok_or_else(|| "数据库文件名无效。".to_string())?;
    let destination = destination_dir.join(name);
    let sidecars = [
        source.to_path_buf(),
        PathBuf::from(format!("{}-wal", source.display())),
        PathBuf::from(format!("{}-shm", source.display())),
    ];

    for attempt in 0..4 {
        let before = states(&sidecars)?;
        for (index, path) in sidecars.iter().enumerate() {
            let target = if index == 0 {
                destination.clone()
            } else {
                PathBuf::from(format!(
                    "{}{}",
                    destination.display(),
                    if index == 1 { "-wal" } else { "-shm" }
                ))
            };
            if path.exists() {
                fs::copy(path, &target)
                    .map_err(|error| format!("无法复制微信数据库快照：{error}"))?;
            } else if target.exists() {
                let _ = fs::remove_file(target);
            }
        }
        let after = states(&sidecars)?;
        if before == after {
            return Ok(destination);
        }
        if attempt < 3 {
            thread::sleep(Duration::from_millis(80 * (attempt + 1)));
        }
    }
    Err("微信正在持续写入数据库，暂时无法取得一致快照。请稍后重试，或让微信保持空闲几秒。".into())
}

fn states(paths: &[PathBuf]) -> Result<Vec<Option<FileState>>, String> {
    paths
        .iter()
        .map(|path| {
            if !path.exists() {
                return Ok(None);
            }
            let metadata =
                fs::metadata(path).map_err(|error| format!("无法读取数据库状态：{error}"))?;
            Ok(Some(FileState {
                length: metadata.len(),
                modified: metadata.modified().ok(),
            }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_numbered_message_shards() {
        assert!(is_message_database(Path::new("message_0.db")));
        assert!(is_message_database(Path::new("message_12.db")));
        assert!(!is_message_database(Path::new("message_fts.db")));
        assert!(!is_message_database(Path::new("biz_message_0.db")));
    }

    #[test]
    fn extracts_custom_windows_data_paths() {
        let paths =
            extract_absolute_paths(r#"{\"fileSavePath\":\"D:\\\\微信资料\\\\xwechat_files\"}"#);
        assert!(paths
            .iter()
            .any(|path| path.to_string_lossy().contains("xwechat_files")));
    }
}
