use super::discovery::WechatAccount;
use md5::{Digest, Md5};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use zeroize::{Zeroize, Zeroizing};

const WECHAT_BUNDLE_ID: &str = "com.tencent.xinWeChat";

#[derive(Debug)]
pub struct WechatInstallation {
    pub app_path: PathBuf,
    pub version: String,
    pub build: Option<String>,
}

#[derive(Debug, Eq, PartialEq)]
pub struct KeyMetadataSummary {
    pub database_count: usize,
    pub matching_records: usize,
}

#[derive(Deserialize)]
struct PrivateKeyManifest {
    keys: HashMap<String, PrivateKeyEntry>,
}

#[derive(Deserialize)]
struct PrivateKeyEntry {
    enc_key: String,
}

pub fn find_wechat_installation() -> Result<WechatInstallation, String> {
    let mut candidates = vec![PathBuf::from("/Applications/WeChat.app")];
    if let Some(home) = env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join("Applications").join("WeChat.app"));
    }

    for app_path in candidates {
        let info_path = app_path.join("Contents").join("Info.plist");
        if !info_path.is_file() {
            continue;
        }
        if plist_string(&info_path, "CFBundleIdentifier")?.as_deref() != Some(WECHAT_BUNDLE_ID) {
            continue;
        }
        let version = plist_string(&info_path, "CFBundleShortVersionString")?
            .ok_or_else(|| "微信版本信息中缺少版本号。".to_string())?;
        let build = plist_string(&info_path, "CFBundleVersion")?;
        return Ok(WechatInstallation {
            app_path,
            version,
            build,
        });
    }

    Err("没有在应用程序目录中找到 macOS 微信。".into())
}

fn plist_string(path: &Path, key: &str) -> Result<Option<String>, String> {
    let output = Command::new("/usr/bin/plutil")
        .args(["-extract", key, "raw", "-o", "-"])
        .arg(path)
        .output()
        .map_err(|error| format!("无法启动系统版本信息工具：{error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let value =
        String::from_utf8(output.stdout).map_err(|_| "微信版本信息不是有效文本。".to_string())?;
    let value = value.trim();
    Ok((!value.is_empty()).then(|| value.to_owned()))
}

pub fn inspect_key_metadata(account: &WechatAccount) -> Result<KeyMetadataSummary, String> {
    let xwechat_root = account
        .contact_database
        .ancestors()
        .find(|path| path.file_name().and_then(|name| name.to_str()) == Some("xwechat_files"))
        .ok_or_else(|| "无法确定微信数据根目录。".to_string())?;
    let login_root = xwechat_root.join("all_users").join("login");
    let entries = fs::read_dir(&login_root)
        .map_err(|error| format!("无法读取微信密钥元数据目录：{error}"))?;
    let account_hashes = account_hash_candidates(account);
    let mut database_count = 0usize;
    let mut matching_records = 0usize;

    for entry in entries.flatten().take(100) {
        let database = entry.path().join("key_info.db");
        if !database.is_file() {
            continue;
        }
        database_count += 1;
        matching_records += count_matching_records(&database, &account_hashes)?;
    }

    if database_count == 0 {
        return Err("没有找到 macOS 微信的密钥元数据。请保持微信登录后重试。".into());
    }
    Ok(KeyMetadataSummary {
        database_count,
        matching_records,
    })
}

pub fn load_verified_key_manifest(
    account: &WechatAccount,
    manifest_path: &Path,
) -> Result<super::crypto::KeyMaterial, String> {
    let manifest_bytes = Zeroizing::new(
        fs::read(manifest_path).map_err(|error| format!("无法读取私有密钥清单：{error}"))?,
    );
    if manifest_bytes.len() > 1024 * 1024 {
        return Err("私有密钥清单超过 1 MB 安全限制。".into());
    }
    let mut manifest: PrivateKeyManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "私有密钥清单格式无效。".to_string())?;
    let database_root = account
        .contact_database
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "无法确定账号数据库目录。".to_string())?;
    let required = required_databases(account, database_root)?;
    let mut keyring = super::crypto::KeyMaterial::empty_raw_keyring();

    for (relative, database) in required {
        let entry = manifest
            .keys
            .get_mut(&relative)
            .ok_or_else(|| format!("私有密钥清单缺少数据库：{relative}"))?;
        let decoded = Zeroizing::new(
            hex::decode(&entry.enc_key)
                .map_err(|_| format!("数据库 {relative} 的密钥编码无效。"))?,
        );
        entry.enc_key.zeroize();
        let raw_key: [u8; 32] = decoded
            .as_slice()
            .try_into()
            .map_err(|_| format!("数据库 {relative} 的密钥长度无效。"))?;
        let raw_key = Zeroizing::new(raw_key);
        keyring
            .insert_verified_raw_key(database, &raw_key)
            .map_err(|_| format!("数据库 {relative} 的密钥认证失败。"))?;
    }
    Ok(keyring)
}

fn required_databases<'a>(
    account: &'a WechatAccount,
    database_root: &Path,
) -> Result<Vec<(String, &'a Path)>, String> {
    let mut databases = vec![account.contact_database.as_path()];
    databases.extend(account.message_databases.iter().map(PathBuf::as_path));
    if let Some(head_image) = account.head_image_database.as_deref() {
        databases.push(head_image);
    }
    databases
        .into_iter()
        .map(|database| {
            let relative = database
                .strip_prefix(database_root)
                .map_err(|_| "数据库路径超出当前账号目录。".to_string())?;
            if relative
                .components()
                .any(|component| !matches!(component, std::path::Component::Normal(_)))
            {
                return Err("数据库相对路径无效。".into());
            }
            let relative = relative
                .to_str()
                .ok_or_else(|| "数据库路径不是有效文本。".to_string())?
                .to_owned();
            Ok((relative, database))
        })
        .collect()
}

fn account_hash_candidates(account: &WechatAccount) -> Vec<String> {
    [account.account_name.as_str(), account.account_wxid.as_str()]
        .into_iter()
        .map(|value| format!("{:x}", Md5::digest(value.as_bytes())))
        .collect()
}

fn count_matching_records(database: &Path, account_hashes: &[String]) -> Result<usize, String> {
    let connection = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("无法只读打开微信密钥元数据：{error}"))?;
    connection
        .execute_batch("PRAGMA query_only=ON;")
        .map_err(|error| format!("无法限制微信密钥元数据为只读模式：{error}"))?;

    let mut statement = connection
        .prepare(
            "SELECT COUNT(*) FROM LoginKeyInfoTable \
             WHERE user_name_md5 = ?1 AND length(key_info_data) BETWEEN 64 AND 4096",
        )
        .map_err(|_| "macOS 微信密钥元数据结构与当前适配器不兼容。".to_string())?;
    let mut count = 0usize;
    for hash in account_hashes {
        let found: i64 = statement
            .query_row([hash], |row| row.get(0))
            .map_err(|error| format!("无法检查微信密钥元数据：{error}"))?;
        count = count.saturating_add(found.max(0) as usize);
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_hashes_are_anonymized_and_stable() {
        let account = WechatAccount {
            account_name: "wxid_example_123".into(),
            account_wxid: "wxid_example".into(),
            message_databases: Vec::new(),
            contact_database: PathBuf::from("contact.db"),
            head_image_database: None,
        };
        let hashes = account_hash_candidates(&account);
        assert_eq!(hashes.len(), 2);
        assert!(hashes.iter().all(|hash| hash.len() == 32));
        assert!(hashes.iter().all(|hash| !hash.contains("wxid")));
    }

    #[test]
    fn rejects_a_manifest_that_does_not_cover_required_databases() {
        let directory = std::env::temp_dir().join(format!(
            "call-footprint-manifest-test-{}",
            std::process::id()
        ));
        let contact = directory.join("db_storage/contact/contact.db");
        let message = directory.join("db_storage/message/message_0.db");
        fs::create_dir_all(contact.parent().unwrap()).unwrap();
        fs::create_dir_all(message.parent().unwrap()).unwrap();
        fs::write(&contact, [0u8; 4096]).unwrap();
        fs::write(&message, [0u8; 4096]).unwrap();
        let manifest = directory.join("keys.json");
        fs::write(&manifest, br#"{"keys":{}}"#).unwrap();
        let account = WechatAccount {
            account_name: "account".into(),
            account_wxid: "wxid_example".into(),
            message_databases: vec![message],
            contact_database: contact,
            head_image_database: None,
        };
        let error = match load_verified_key_manifest(&account, &manifest) {
            Ok(_) => panic!("incomplete manifest should be rejected"),
            Err(error) => error,
        };
        assert!(error.contains("contact/contact.db"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    #[ignore = "requires a local macOS WeChat installation and logged-in account"]
    fn probes_local_wechat_without_exposing_private_data() {
        let installation = find_wechat_installation().expect("WeChat installation should exist");
        let account = crate::wechat::discovery::discover_active_account()
            .expect("active WeChat account should exist");
        let metadata = inspect_key_metadata(&account).expect("key metadata should exist");
        eprintln!(
            "macOS probe: version={}, build={}, shards={}, key_metadata_databases={}, matching_records={}",
            installation.version,
            installation.build.as_deref().unwrap_or("unknown"),
            account.message_databases.len(),
            metadata.database_count,
            metadata.matching_records
        );
        assert!(!installation.version.is_empty());
        assert!(!account.message_databases.is_empty());
        assert!(metadata.database_count > 0);
    }
}
