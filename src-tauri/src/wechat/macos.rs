use super::discovery::WechatAccount;
use md5::{Digest, Md5};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use std::{
    collections::HashMap,
    env, fs,
    io::{self, Read},
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
#[serde(deny_unknown_fields)]
struct PrivateKeyManifest {
    keys: HashMap<String, PrivateKeyEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PrivateKeyEntry {
    enc_key: String,
}

impl Drop for PrivateKeyEntry {
    fn drop(&mut self) {
        self.enc_key.zeroize();
    }
}

// Only fixed, actionable diagnostics cross the UI boundary: never OS/SQLite errors or paths.
fn io_diagnostic(stage: &str, error: &io::Error) -> String {
    let (code, advice) = match error.kind() {
        io::ErrorKind::PermissionDenied => (
            "PERMISSION",
            "访问被拒绝；请在系统设置的隐私与安全性中检查文件访问/完全磁盘访问权限，授权后重新启动本应用。",
        ),
        io::ErrorKind::NotFound => ("MISSING", "所需文件或目录不存在；请确认微信已安装、登录且数据未被移动。"),
        _ => ("IO", "无法只读访问所需文件；请检查文件是否可用后重试。"),
    };
    format!("[MACOS_{stage}_{code}] {advice}")
}

fn validate_version(version: &str) -> Result<(), String> {
    if version != "4.1.13" {
        return Err("[MACOS_VERSION_UNSUPPORTED] 当前 macOS 微信版本未通过安全适配验证；仅支持 4.1.13，未读取数据库。".into());
    }
    Ok(())
}

fn readable_file(path: &Path, stage: &str) -> Result<fs::File, String> {
    // Check the type before opening, so a configured FIFO/device is not read as a manifest.
    let metadata = fs::metadata(path).map_err(|error| io_diagnostic(stage, &error))?;
    if !metadata.is_file() {
        return Err(format!("[MACOS_{stage}_TYPE] 所需路径不是普通文件。"));
    }
    let file = fs::File::open(path).map_err(|error| io_diagnostic(stage, &error))?;
    if !file
        .metadata()
        .map_err(|error| io_diagnostic(stage, &error))?
        .is_file()
    {
        return Err(format!("[MACOS_{stage}_TYPE] 所需路径不是普通文件。"));
    }
    Ok(file)
}

pub fn discover_account() -> Result<WechatAccount, String> {
    let mut roots = Vec::new();
    // Keep these variants aligned with discovery::candidate_data_roots on macOS.
    if let Some(configured) = env::var_os("CALL_FOOTPRINT_WECHAT_DATA_DIR") {
        let configured = PathBuf::from(configured);
        roots.push(configured.join("xwechat_files"));
        if let Some(root) = configured.ancestors().find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("xwechat_files"))
        }) {
            roots.push(root.to_path_buf());
        }
    }
    if let Some(home) = env::var_os("HOME") {
        roots.push(
            PathBuf::from(home)
                .join("Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files"),
        );
    }
    roots.sort();
    roots.dedup();
    preflight_data_roots(&roots)?;
    let account = super::discovery::discover_active_account().map_err(|_| {
        "[MACOS_ACCOUNT_NOT_FOUND] 没有找到包含联系人和消息分库的账号；请登录微信并进入聊天后重试。".to_string()
    })?;
    preflight_account(&account)?;
    Ok(account)
}

fn optional_metadata(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_diagnostic("DATA", &error)),
    }
}

fn preflight_data_roots(roots: &[PathBuf]) -> Result<(), String> {
    let mut found = false;
    for root in roots {
        let Some(metadata) = optional_metadata(root)? else {
            continue;
        };
        if !metadata.is_dir() {
            return Err("[MACOS_DATA_TYPE] 微信数据根路径不是目录。".into());
        }
        found = true;
        let entries = fs::read_dir(root).map_err(|error| io_diagnostic("DATA", &error))?;
        for (index, entry) in entries.enumerate() {
            if index >= 1000 {
                return Err("[MACOS_DATA_LIMIT] 数据目录超过安全检查上限；已停止读取。".into());
            }
            let entry = entry.map_err(|error| io_diagnostic("DATA", &error))?;
            if matches!(
                entry.file_name().to_str(),
                Some("all_users" | "Backup" | "backup" | "old_backup")
            ) {
                continue;
            }
            let account_root = entry.path();
            let Some(metadata) = optional_metadata(&account_root)? else {
                continue;
            };
            if !metadata.is_dir() {
                continue;
            }
            let storage = account_root.join("db_storage");
            if optional_metadata(&storage)?.is_none() {
                continue;
            }
            for relative in ["contact/contact.db", "head_image/head_image.db"] {
                let path = storage.join(relative);
                if optional_metadata(&path)?.is_some() {
                    readable_file(&path, "DATA")?;
                }
            }
            let messages = storage.join("message");
            if optional_metadata(&messages)?.is_none() {
                continue;
            }
            let shards = fs::read_dir(messages).map_err(|error| io_diagnostic("DATA", &error))?;
            for (index, shard) in shards.enumerate() {
                if index >= 10000 {
                    return Err("[MACOS_DATA_LIMIT] 消息目录超过安全检查上限；已停止读取。".into());
                }
                let shard = shard.map_err(|error| io_diagnostic("DATA", &error))?;
                let name = shard.file_name();
                let numbered = name
                    .to_str()
                    .and_then(|name| name.strip_prefix("message_"))
                    .and_then(|name| name.strip_suffix(".db"))
                    .is_some_and(|number| {
                        !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
                    });
                if numbered {
                    readable_file(&shard.path(), "DATA")?;
                }
            }
        }
    }
    if !found {
        return Err("[MACOS_DATA_ROOT_MISSING] 没有找到 macOS 微信数据目录；请登录微信，或确认配置的数据目录。".into());
    }
    Ok(())
}

pub fn preflight_account(account: &WechatAccount) -> Result<(), String> {
    if account.message_databases.is_empty() {
        return Err(
            "[MACOS_DATA_MESSAGES_MISSING] 没有消息数据库；请登录微信并进入聊天后重试。".into(),
        );
    }
    let root = account
        .contact_database
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "[MACOS_DATA_LAYOUT] 无法确定账号数据库目录。".to_string())?;
    let canonical_root = fs::canonicalize(root).map_err(|error| io_diagnostic("DATA", &error))?;
    for (_, database) in required_databases(account, root)? {
        let canonical =
            fs::canonicalize(database).map_err(|error| io_diagnostic("DATA", &error))?;
        if !canonical.starts_with(&canonical_root) {
            return Err(
                "[MACOS_DATA_BOUNDARY] 数据库实际路径超出当前账号目录；已停止读取。".into(),
            );
        }
        let file = readable_file(database, "DATA")?;
        if file
            .metadata()
            .map_err(|error| io_diagnostic("DATA", &error))?
            .len()
            < 4096
        {
            return Err(
                "[MACOS_DATA_INCOMPLETE] 数据库首页不完整；请等待微信写入完成后重试。".into(),
            );
        }
    }
    Ok(())
}

pub fn find_wechat_installation() -> Result<WechatInstallation, String> {
    let mut candidates = vec![PathBuf::from("/Applications/WeChat.app")];
    if let Some(home) = env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join("Applications").join("WeChat.app"));
    }

    for app_path in candidates {
        let info_path = app_path.join("Contents").join("Info.plist");
        match fs::metadata(&app_path) {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(io_diagnostic("APP", &error)),
        }
        readable_file(&info_path, "APP")?;
        if plist_string(&info_path, "CFBundleIdentifier")?.as_deref() != Some(WECHAT_BUNDLE_ID) {
            return Err("[MACOS_APP_IDENTITY] 微信应用标识不匹配；请使用官方 WeChat.app。".into());
        }
        let version = plist_string(&info_path, "CFBundleShortVersionString")?
            .ok_or_else(|| "[MACOS_APP_VERSION] 微信应用缺少版本号。".to_string())?;
        validate_version(&version)?;
        let build = plist_string(&info_path, "CFBundleVersion")?;
        if build.as_deref().is_some_and(|value| {
            value.len() > 32
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'.')
        }) {
            return Err("[MACOS_APP_BUILD] 微信构建号格式无效。".into());
        }
        return Ok(WechatInstallation {
            app_path,
            version,
            build,
        });
    }

    Err(
        "[MACOS_APP_MISSING] 没有在系统或用户应用程序目录找到 WeChat.app；请安装官方 macOS 微信。"
            .into(),
    )
}

fn plist_string(path: &Path, key: &str) -> Result<Option<String>, String> {
    let output = Command::new("/usr/bin/plutil")
        .args(["-extract", key, "raw", "-o", "-"])
        .arg(path)
        .output()
        .map_err(|error| io_diagnostic("APP_TOOL", &error))?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8(output.stdout)
        .map_err(|_| "[MACOS_APP_PLIST] 微信应用信息不是有效文本。".to_string())?;
    let value = value.trim();
    Ok((!value.is_empty()).then(|| value.to_owned()))
}

pub fn inspect_key_metadata(account: &WechatAccount) -> Result<KeyMetadataSummary, String> {
    preflight_account(account)?;
    let xwechat_root = account
        .contact_database
        .ancestors()
        .find(|path| path.file_name().and_then(|name| name.to_str()) == Some("xwechat_files"))
        .ok_or_else(|| {
            "[MACOS_DATA_LAYOUT] 无法确定微信数据根目录；当前目录结构不受支持。".to_string()
        })?;
    let login_root = xwechat_root.join("all_users").join("login");
    let canonical_root =
        fs::canonicalize(xwechat_root).map_err(|error| io_diagnostic("METADATA", &error))?;
    let canonical_login =
        fs::canonicalize(&login_root).map_err(|error| io_diagnostic("METADATA", &error))?;
    if !canonical_login.starts_with(&canonical_root) {
        return Err(
            "[MACOS_METADATA_BOUNDARY] 登录元数据实际路径超出微信目录；已停止读取。".into(),
        );
    }
    let entries = fs::read_dir(&login_root).map_err(|error| io_diagnostic("METADATA", &error))?;
    let account_hashes = account_hash_candidates(account);
    let mut database_count = 0usize;
    let mut matching_records = 0usize;

    for (index, entry) in entries.enumerate() {
        if index >= 100 {
            return Err(
                "[MACOS_METADATA_LIMIT] 登录元数据目录超过安全检查上限；未继续读取。".into(),
            );
        }
        let entry = entry.map_err(|error| io_diagnostic("METADATA", &error))?;
        let entry_type = entry
            .file_type()
            .map_err(|error| io_diagnostic("METADATA", &error))?;
        if entry_type.is_symlink() {
            return Err("[MACOS_METADATA_BOUNDARY] 登录元数据包含符号链接；已停止读取。".into());
        }
        if !entry_type.is_dir() {
            continue;
        }
        let database = entry.path().join("key_info.db");
        match fs::symlink_metadata(&database) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(
                    "[MACOS_METADATA_BOUNDARY] 密钥元数据文件是符号链接；已停止读取。".into(),
                );
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(io_diagnostic("METADATA", &error)),
        }
        readable_file(&database, "METADATA")?;
        database_count += 1;
        matching_records += count_matching_records(&database, &account_hashes)?;
    }

    if database_count == 0 {
        return Err("[MACOS_METADATA_MISSING] 没有找到密钥元数据；请保持微信登录后重试。".into());
    }
    Ok(KeyMetadataSummary {
        database_count,
        matching_records,
    })
}

fn manifest_security_error() -> String {
    "[MACOS_MANIFEST_SECURITY] 私有密钥清单必须是当前用户所有、权限为 0600 的普通文件，路径不得包含符号链接；macOS /tmp、/var 等别名请使用显式 canonical 路径（如 /private/tmp）。".into()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn validate_manifest_metadata(metadata: &fs::Metadata, euid: u32) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    if !metadata.is_file() || metadata.uid() != euid || metadata.mode() & 0o7777 != 0o600 {
        return Err(manifest_security_error());
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn open_private_manifest(path: &Path) -> Result<fs::File, String> {
    use std::{
        ffi::CString,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::{ffi::OsStrExt, fs::OpenOptionsExt},
        },
        path::Component,
    };
    extern "C" {
        fn geteuid() -> u32;
        fn openat(fd: i32, path: *const std::os::raw::c_char, flags: i32) -> i32;
    }
    // Darwin and Linux flags are not interchangeable. Never follow even an intermediate
    // symlink: walk from a pinned root FD, then validate the final FD before reading.
    #[cfg(target_os = "macos")]
    const FLAGS: (i32, i32, i32, i32) = (0x100, 0x100000, 0x4, 0x1000000);
    #[cfg(target_os = "linux")]
    const FLAGS: (i32, i32, i32, i32) = (0x20000, 0x10000, 0x800, 0x80000);
    let (nofollow, directory, nonblock, cloexec) = FLAGS;
    // Do not canonicalize here: doing so would silently accept caller-supplied symlinks.
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()
            .map_err(|_| manifest_security_error())?
            .join(path)
    };
    let mut components = absolute.components().peekable();
    if components.next() != Some(Component::RootDir) {
        return Err(manifest_security_error());
    }
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nofollow | directory | cloexec)
        .open("/")
        .map_err(|_| manifest_security_error())?;
    let mut has_file = false;
    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return Err(manifest_security_error());
        };
        let name = CString::new(name.as_bytes()).map_err(|_| manifest_security_error())?;
        let flags = nofollow
            | cloexec
            | if components.peek().is_some() {
                directory
            } else {
                nonblock
            };
        // SAFETY: file owns a live directory FD; name is NUL terminated. No O_CREAT,
        // so openat takes no mode argument. Each successful FD is immediately owned.
        let fd = unsafe { openat(file.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(manifest_security_error());
        }
        file = unsafe { fs::File::from_raw_fd(fd) };
        has_file = true;
    }
    if !has_file {
        return Err(manifest_security_error());
    }
    let metadata = file.metadata().map_err(|_| manifest_security_error())?;
    // SAFETY: geteuid has no arguments or memory-safety preconditions.
    validate_manifest_metadata(&metadata, unsafe { geteuid() })?;
    Ok(file)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn open_private_manifest(_path: &Path) -> Result<fs::File, String> {
    // No unverified platform fallback for private keys.
    Err(manifest_security_error())
}

pub fn load_verified_key_manifest(
    account: &WechatAccount,
    manifest_path: &Path,
) -> Result<super::crypto::KeyMaterial, String> {
    preflight_account(account)?;
    let file = open_private_manifest(manifest_path)?;
    let mut manifest_bytes = Zeroizing::new(Vec::new());
    file.take(1024 * 1024 + 1)
        .read_to_end(&mut manifest_bytes)
        .map_err(|_| manifest_security_error())?;
    if manifest_bytes.len() > 1024 * 1024 {
        return Err("[MACOS_MANIFEST_LIMIT] 私有密钥清单超过 1 MB 安全限制。".into());
    }
    let mut manifest: PrivateKeyManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| {
            "[MACOS_MANIFEST_FORMAT] 私有密钥清单格式无效；需要 keys 对象和 enc_key 十六进制字段。"
                .to_string()
        })?;
    let database_root = account
        .contact_database
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "[MACOS_DATA_LAYOUT] 无法确定账号数据库目录。".to_string())?;
    let required = required_databases(account, database_root)?;
    let mut keyring = super::crypto::KeyMaterial::empty_raw_keyring();

    for (relative, database) in required {
        let entry = manifest
            .keys
            .get_mut(&relative)
            .ok_or_else(|| "[MACOS_MANIFEST_COVERAGE] 私有密钥清单未覆盖全部必需数据库；请重新生成当前账号的完整清单。".to_string())?;
        if entry.enc_key.len() != 64 {
            return Err(
                "[MACOS_MANIFEST_KEY_LENGTH] 每个数据库密钥必须为 64 个十六进制字符。".into(),
            );
        }
        let decoded = Zeroizing::new(hex::decode(&entry.enc_key).map_err(|_| {
            "[MACOS_MANIFEST_KEY_ENCODING] 数据库密钥不是有效十六进制编码。".to_string()
        })?);
        entry.enc_key.zeroize();
        let raw_key: [u8; 32] = decoded
            .as_slice()
            .try_into()
            .map_err(|_| "[MACOS_MANIFEST_KEY_LENGTH] 数据库密钥长度无效。".to_string())?;
        let raw_key = Zeroizing::new(raw_key);
        keyring
            .insert_verified_raw_key(database, &raw_key)
            .map_err(|_| "[MACOS_MANIFEST_AUTH] 数据库密钥未通过逐库 HMAC 认证；清单可能不匹配或数据库已变化。".to_string())?;
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
                .map_err(|_| "[MACOS_DATA_BOUNDARY] 数据库路径超出当前账号目录。".to_string())?;
            if relative
                .components()
                .any(|component| !matches!(component, std::path::Component::Normal(_)))
            {
                return Err("[MACOS_DATA_BOUNDARY] 数据库相对路径无效。".into());
            }
            let relative = relative
                .components()
                .map(|component| {
                    component
                        .as_os_str()
                        .to_str()
                        .ok_or_else(|| "[MACOS_DATA_LAYOUT] 数据库路径不是有效文本。".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?
                .join("/");
            Ok((relative, database))
        })
        .collect()
}

fn account_hash_candidates(account: &WechatAccount) -> Vec<String> {
    let mut hashes = [account.account_name.as_str(), account.account_wxid.as_str()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .map(|value| format!("{:x}", Md5::digest(value.as_bytes())))
        .collect::<Vec<_>>();
    hashes.dedup();
    hashes
}

fn count_matching_records(database: &Path, account_hashes: &[String]) -> Result<usize, String> {
    let connection = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| {
        "[MACOS_METADATA_OPEN] 无法只读打开密钥元数据；请检查权限或等待微信写入完成。".to_string()
    })?;
    connection
        .execute_batch("PRAGMA query_only=ON;")
        .map_err(|_| {
            "[MACOS_METADATA_READ_ONLY] 无法启用元数据只读保护；已停止读取。".to_string()
        })?;

    let mut statement = connection
        .prepare(
            "SELECT COUNT(*) FROM LoginKeyInfoTable \
             WHERE user_name_md5 = ?1 AND length(key_info_data) BETWEEN 64 AND 4096",
        )
        .map_err(|_| {
            "[MACOS_METADATA_SCHEMA] 密钥元数据损坏或结构与当前适配器不兼容。".to_string()
        })?;
    let mut count = 0usize;
    for hash in account_hashes {
        let found: i64 = statement.query_row([hash], |row| row.get(0)).map_err(|_| {
            "[MACOS_METADATA_QUERY] 无法检查密钥元数据；文件可能忙碌或损坏。".to_string()
        })?;
        count = count.saturating_add(found.max(0) as usize);
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_private_manifest(path: &Path, bytes: &[u8]) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(path)
                .unwrap();
            file.set_permissions(fs::Permissions::from_mode(0o600))
                .unwrap();
            std::io::Write::write_all(&mut file, bytes).unwrap();
        }
        #[cfg(not(unix))]
        fs::write(path, bytes).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn manifest_security_rejects_public_permissions_symlinks_and_wrong_uid() {
        use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
        let fixture = Fixture::new();
        let path = fixture.root.join("private.json");
        write_private_manifest(&path, b"not json");
        assert!(open_private_manifest(&path).is_ok());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(
            open_private_manifest(&path).unwrap_err(),
            manifest_security_error()
        );
        let error = load_verified_key_manifest(&fixture.account, &path)
            .err()
            .unwrap();
        assert_eq!(error, manifest_security_error());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        assert!(validate_manifest_metadata(&metadata, metadata.uid()).is_ok());
        // Inject expected uid rather than chown or touching any real account.
        assert_eq!(
            validate_manifest_metadata(&metadata, metadata.uid().wrapping_add(1)).unwrap_err(),
            manifest_security_error()
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o4600)).unwrap();
        assert!(open_private_manifest(&path).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let link = fixture.root.join("link.json");
        symlink(&path, &link).unwrap();
        assert_eq!(
            open_private_manifest(&link).unwrap_err(),
            manifest_security_error()
        );
        let dir_link = fixture.root.join("linked-directory");
        symlink(&fixture.root, &dir_link).unwrap();
        assert_eq!(
            open_private_manifest(&dir_link.join("private.json")).unwrap_err(),
            manifest_security_error()
        );
        assert_eq!(
            open_private_manifest(&fixture.root).unwrap_err(),
            manifest_security_error()
        );
        assert_eq!(
            open_private_manifest(&fixture.root.join("missing")).unwrap_err(),
            manifest_security_error()
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn manifest_read_stays_on_verified_fd_after_path_replacement() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let path = fixture.root.join("private.json");
        write_private_manifest(&path, b"original");
        let mut file = open_private_manifest(&path).unwrap();
        let renamed = fixture.root.join("original.json");
        fs::rename(&path, &renamed).unwrap();
        let replacement = fixture.root.join("replacement.json");
        write_private_manifest(&replacement, b"replacement");
        symlink(&replacement, &path).unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"original");
        assert_eq!(
            open_private_manifest(&path).unwrap_err(),
            manifest_security_error()
        );
    }

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
    fn identical_account_labels_do_not_double_count_metadata() {
        let mut fixture = Fixture::new();
        fixture.account.account_wxid = fixture.account.account_name.clone();
        assert_eq!(account_hash_candidates(&fixture.account).len(), 1);
        fixture.account.account_wxid.clear();
        assert_eq!(account_hash_candidates(&fixture.account).len(), 1);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn rejects_a_manifest_that_does_not_cover_required_databases() {
        let directory = std::env::temp_dir().join(format!(
            "call-footprint-manifest-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let directory = fs::canonicalize(directory).unwrap();
        let contact = directory.join("db_storage/contact/contact.db");
        let message = directory.join("db_storage/message/message_0.db");
        fs::create_dir_all(contact.parent().unwrap()).unwrap();
        fs::create_dir_all(message.parent().unwrap()).unwrap();
        fs::write(&contact, [0u8; 4096]).unwrap();
        fs::write(&message, [0u8; 4096]).unwrap();
        let manifest = directory.join("keys.json");
        write_private_manifest(&manifest, br#"{"keys":{}}"#);
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
        assert!(error.starts_with("[MACOS_MANIFEST_COVERAGE]"));
        assert!(!error.contains("contact/contact.db"));
        let _ = fs::remove_dir_all(directory);
    }

    struct Fixture {
        root: PathBuf,
        account: WechatAccount,
    }

    impl Fixture {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let root = env::temp_dir().join(format!(
                "call-footprint-macos-synthetic-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).unwrap();
            // macOS temp_dir may contain /var -> /private/var. Fixtures explicitly
            // choose the canonical path; the production loader never resolves aliases.
            let root = fs::canonicalize(root).unwrap();
            let storage = root.join("xwechat_files/private-account/db_storage");
            let account = WechatAccount {
                account_name: "synthetic-private-account".into(),
                account_wxid: "synthetic-private-wxid".into(),
                contact_database: storage.join("contact/contact.db"),
                message_databases: vec![storage.join("message/message_0.db")],
                head_image_database: Some(storage.join("head_image/head_image.db")),
            };
            for path in [
                &account.contact_database,
                &account.message_databases[0],
                account.head_image_database.as_ref().unwrap(),
            ] {
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(path, [0u8; 4096]).unwrap();
            }
            Self { root, account }
        }

        fn manifest_error(&self, bytes: &[u8]) -> String {
            let path = self.root.join("synthetic-private-keys.json");
            write_private_manifest(&path, bytes);
            let error = load_verified_key_manifest(&self.account, &path)
                .err()
                .expect("must fail closed");
            assert!(!error.contains("synthetic-private"));
            assert!(!error.contains(&self.root.to_string_lossy().to_string()));
            error
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn version_gate_is_exact_and_does_not_echo_untrusted_values() {
        assert!(validate_version("4.1.13").is_ok());
        for version in ["", "4.1.12", "4.1.13.1", "4.1.13\n", "private-account/key"] {
            let error = validate_version(version).unwrap_err();
            assert!(error.starts_with("[MACOS_VERSION_UNSUPPORTED]"));
            assert!(!error.contains("private-account"));
        }
    }

    #[test]
    fn io_errors_are_classified_without_private_details() {
        for (kind, suffix) in [
            (io::ErrorKind::PermissionDenied, "PERMISSION"),
            (io::ErrorKind::NotFound, "MISSING"),
            (io::ErrorKind::Other, "IO"),
        ] {
            let error = io_diagnostic(
                "DATA",
                &io::Error::new(kind, "/Users/private-account/private-key"),
            );
            assert!(error.starts_with(&format!("[MACOS_DATA_{suffix}]")));
            assert!(!error.contains("private-account"));
            assert!(!error.contains("private-key"));
        }
    }

    #[test]
    fn discovery_preflight_checks_roots_and_files_before_shared_discovery() {
        let fixture = Fixture::new();
        assert!(preflight_data_roots(&[fixture.root.join("missing")])
            .unwrap_err()
            .starts_with("[MACOS_DATA_ROOT_MISSING]"));
        let data_root = fixture.root.join("xwechat_files");
        assert!(preflight_data_roots(&[data_root.clone()]).is_ok());
        assert!(
            preflight_data_roots(&[fixture.account.contact_database.clone()])
                .unwrap_err()
                .starts_with("[MACOS_DATA_TYPE]")
        );
        let avatar = fixture.account.head_image_database.as_ref().unwrap();
        fs::remove_file(avatar).unwrap();
        fs::create_dir(avatar).unwrap();
        assert!(preflight_data_roots(&[data_root.clone()])
            .unwrap_err()
            .starts_with("[MACOS_DATA_TYPE]"));
        fs::remove_dir(avatar).unwrap();
        // An absent optional avatar must not become a permission or account error.
        assert!(preflight_data_roots(&[data_root.clone()]).is_ok());
        fs::remove_file(&fixture.account.message_databases[0]).unwrap();
        fs::create_dir(&fixture.account.message_databases[0]).unwrap();
        assert!(preflight_data_roots(&[data_root])
            .unwrap_err()
            .starts_with("[MACOS_DATA_TYPE]"));
    }

    #[test]
    fn data_preflight_rejects_missing_incomplete_and_outside_databases() {
        let mut fixture = Fixture::new();
        assert!(preflight_account(&fixture.account).is_ok());
        fs::write(&fixture.account.message_databases[0], [0u8; 10]).unwrap();
        assert!(preflight_account(&fixture.account)
            .unwrap_err()
            .starts_with("[MACOS_DATA_INCOMPLETE]"));
        fs::remove_file(&fixture.account.message_databases[0]).unwrap();
        assert!(preflight_account(&fixture.account)
            .unwrap_err()
            .starts_with("[MACOS_DATA_MISSING]"));
        fixture.account.message_databases[0] = fixture.root.join("outside.db");
        assert!(preflight_account(&fixture.account)
            .unwrap_err()
            .starts_with("[MACOS_DATA_BOUNDARY]"));
        fixture.account.message_databases.clear();
        assert!(preflight_account(&fixture.account)
            .unwrap_err()
            .starts_with("[MACOS_DATA_MESSAGES_MISSING]"));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn manifest_rejects_format_size_length_encoding_and_unauthenticated_key() {
        let fixture = Fixture::new();
        for bytes in [
            b"not json".as_slice(),
            br#"{"keys":{},"unexpected":"synthetic-private"}"#,
        ] {
            assert!(fixture
                .manifest_error(bytes)
                .starts_with("[MACOS_MANIFEST_FORMAT]"));
        }
        assert!(fixture
            .manifest_error(&vec![b' '; 1024 * 1024 + 1])
            .starts_with("[MACOS_MANIFEST_LIMIT]"));
        for (key, code) in [
            ("00".to_string(), "KEY_LENGTH"),
            ("zz".repeat(32), "KEY_ENCODING"),
            ("00".repeat(32), "AUTH"),
        ] {
            let bytes = serde_json::to_vec(
                &serde_json::json!({"keys":{"contact/contact.db":{"enc_key":key}}}),
            )
            .unwrap();
            assert!(fixture
                .manifest_error(&bytes)
                .starts_with(&format!("[MACOS_MANIFEST_{code}]")));
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn manifest_io_and_exact_size_boundary_are_diagnostic() {
        let fixture = Fixture::new();
        let missing = fixture.root.join("synthetic-private-missing.json");
        let error = load_verified_key_manifest(&fixture.account, &missing)
            .err()
            .unwrap();
        assert!(error.starts_with("[MACOS_MANIFEST_SECURITY]"));
        assert!(!error.contains("synthetic-private"));
        let error = load_verified_key_manifest(&fixture.account, &fixture.root)
            .err()
            .unwrap();
        assert!(error.starts_with("[MACOS_MANIFEST_SECURITY]"));
        let mut bytes = br#"{"keys":{}}"#.to_vec();
        bytes.resize(1024 * 1024, b' ');
        assert!(fixture
            .manifest_error(&bytes)
            .starts_with("[MACOS_MANIFEST_COVERAGE]"));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn manifest_requires_hmac_for_every_database_including_optional_avatar() {
        use hmac::{Hmac, Mac};
        use sha2::Sha512;
        let fixture = Fixture::new();
        let paths = [
            &fixture.account.contact_database,
            &fixture.account.message_databases[0],
            fixture.account.head_image_database.as_ref().unwrap(),
        ];
        let mut keys = serde_json::Map::new();
        for (index, path) in paths.iter().enumerate() {
            let key = [index as u8 + 1; 32];
            let salt = [index as u8 + 11; 16];
            let mut page = [0u8; 4096];
            page[..16].copy_from_slice(&salt);
            let mac_salt: Vec<u8> = salt.iter().map(|byte| byte ^ 0x3a).collect();
            let mut authentication = [0u8; 32];
            pbkdf2::pbkdf2_hmac::<Sha512>(&key, &mac_salt, 2, &mut authentication);
            let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(&authentication).unwrap();
            mac.update(&page[16..4032]);
            mac.update(&1u32.to_le_bytes());
            page[4032..].copy_from_slice(&mac.finalize().into_bytes());
            fs::write(path, page).unwrap();
            let relative = path
                .strip_prefix(
                    fixture
                        .account
                        .contact_database
                        .parent()
                        .unwrap()
                        .parent()
                        .unwrap(),
                )
                .unwrap();
            keys.insert(
                relative.to_str().unwrap().replace('\\', "/"),
                serde_json::json!({"enc_key": hex::encode(key)}),
            );
        }
        let manifest = serde_json::to_vec(&serde_json::json!({"keys":keys})).unwrap();
        let manifest_path = fixture.root.join("keys.json");
        write_private_manifest(&manifest_path, &manifest);
        let verified = load_verified_key_manifest(&fixture.account, &manifest_path).unwrap();
        assert_eq!(verified.raw_key_count(), 3);
        for path in paths {
            let original = fs::read(path).unwrap();
            let mut corrupt = original.clone();
            corrupt[64] ^= 1;
            fs::write(path, corrupt).unwrap();
            assert!(fixture
                .manifest_error(&manifest)
                .starts_with("[MACOS_MANIFEST_AUTH]"));
            fs::write(path, original).unwrap();
        }
        keys.remove("head_image/head_image.db");
        let missing_avatar = serde_json::to_vec(&serde_json::json!({"keys":keys})).unwrap();
        assert!(fixture
            .manifest_error(&missing_avatar)
            .starts_with("[MACOS_MANIFEST_COVERAGE]"));
    }

    #[test]
    fn metadata_schema_errors_do_not_echo_sqlite_details() {
        let fixture = Fixture::new();
        let database = fixture.root.join("synthetic-private-metadata.db");
        Connection::open(&database)
            .unwrap()
            .execute_batch("CREATE TABLE private_schema(secret TEXT);")
            .unwrap();
        let error = count_matching_records(&database, &["private-account".into()]).unwrap_err();
        assert!(error.starts_with("[MACOS_METADATA_SCHEMA]"));
        assert!(!error.contains("private"));
    }

    #[test]
    fn metadata_preflight_distinguishes_missing_empty_valid_and_over_limit() {
        let fixture = Fixture::new();
        assert!(inspect_key_metadata(&fixture.account)
            .unwrap_err()
            .starts_with("[MACOS_METADATA_MISSING]"));
        let login = fixture.root.join("xwechat_files/all_users/login");
        fs::create_dir_all(&login).unwrap();
        assert!(inspect_key_metadata(&fixture.account)
            .unwrap_err()
            .starts_with("[MACOS_METADATA_MISSING]"));
        let user = login.join("synthetic");
        fs::create_dir(&user).unwrap();
        let connection = Connection::open(user.join("key_info.db")).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE LoginKeyInfoTable(user_name_md5 TEXT, key_info_data BLOB);",
            )
            .unwrap();
        let hash = &account_hash_candidates(&fixture.account)[0];
        connection
            .execute(
                "INSERT INTO LoginKeyInfoTable VALUES (?1, ?2)",
                rusqlite::params![hash, vec![0u8; 64]],
            )
            .unwrap();
        connection.close().unwrap();
        assert_eq!(
            inspect_key_metadata(&fixture.account).unwrap(),
            KeyMetadataSummary {
                database_count: 1,
                matching_records: 1
            }
        );
        for index in 0..100 {
            fs::create_dir(login.join(format!("empty-{index}"))).unwrap();
        }
        assert!(inspect_key_metadata(&fixture.account)
            .unwrap_err()
            .starts_with("[MACOS_METADATA_LIMIT]"));
    }

    #[cfg(unix)]
    #[test]
    fn data_preflight_rejects_symlink_escape() {
        let fixture = Fixture::new();
        let outside = fixture.root.join("outside.db");
        fs::write(&outside, [0u8; 4096]).unwrap();
        fs::remove_file(&fixture.account.message_databases[0]).unwrap();
        std::os::unix::fs::symlink(&outside, &fixture.account.message_databases[0]).unwrap();
        assert!(preflight_account(&fixture.account)
            .unwrap_err()
            .starts_with("[MACOS_DATA_BOUNDARY]"));
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
