use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacSetupAccount {
    pub id: String,
    pub label: String,
    pub key_ready: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacSetupStatus {
    pub accounts: Vec<MacSetupAccount>,
    pub wechat_version: Option<String>,
    pub can_initialize: bool,
    pub blocker: Option<String>,
    pub recovery_required: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct MacSetupProgress {
    pub stage: &'static str,
    pub detail: &'static str,
    pub percent: u8,
}

pub const MACOS_ONLY: &str = "[MACOS_ONLY] 此操作仅支持 macOS。";

#[cfg(target_os = "macos")]
pub use native::{
    begin_operation, busy, cancel, cancel_requested, check, initialize, scan, startup,
};

// Only the event discriminator is consumed. Private helper fields (including paths,
// keys, process IDs and diagnostic text) never enter IPC or application logs.
#[cfg(any(test, target_os = "macos"))]
#[derive(Default)]
struct HelperEvidence {
    original_verified: bool,
    manual_restore: bool,
}

#[cfg(any(test, target_os = "macos"))]
impl HelperEvidence {
    fn consume(&mut self, bytes: &[u8]) -> Option<MacSetupProgress> {
        if bytes.len() > 8192 {
            self.manual_restore = true;
            return None;
        }
        let value: serde_json::Value = match serde_json::from_slice(bytes) {
            Ok(value) => value,
            Err(_) => {
                self.manual_restore = true;
                return None;
            }
        };
        let (stage, detail, percent) = match value.get("type").and_then(|v| v.as_str())? {
            "debug_copy_warning" => ("preparing", "正在准备私有调试副本，不修改原应用", 10),
            "copy_prepared" => (
                "waiting",
                "请仅在临时微信窗口登录本人账号，不编辑消息或草稿",
                30,
            ),
            "waiting" | "launched" | "verified_progress" => {
                ("capturing", "正在等待数据库密钥认证", 55)
            }
            "original_signature_unchanged" => {
                self.original_verified = true;
                ("cleanup", "原应用签名已确认，正在验证副本清理", 85)
            }
            "manual_restore_required" => {
                self.manual_restore = true;
                ("recovery", "清理未确认，请正常退出临时副本并重新检查", 85)
            }
            "bootstrap_cancelled" | "capture_cancelled" => {
                ("cancelling", "正在等待安全清理，请勿退出本应用", 75)
            }
            "capture_timeout" => ("cleanup", "初始化超时，正在等待安全清理", 75),
            _ => return None,
        };
        Some(MacSetupProgress {
            stage,
            detail,
            percent,
        })
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use crate::wechat::{discovery, macos, WechatScanProgress, WechatScanResult};
    use serde::{de::DeserializeOwned, Deserialize};
    use sha2::{Digest, Sha256};
    use std::{
        fs::{self, File, OpenOptions},
        io::{BufRead, BufReader, Read, Write},
        os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
        path::{Component, Path, PathBuf},
        process::{Child, Command, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex, OnceLock,
        },
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use zeroize::Zeroizing;

    const SECURITY: &str = "[MACOS_STATE_SECURITY] 私有状态无法安全验证，请检查本应用的数据权限。";
    const RECOVERY: &str = "[MACOS_RECOVERY_REQUIRED] 上次初始化清理未确认；请正常退出临时微信副本，检查原微信签名并清理私有临时副本后重新检查。不要删除未知文件或关闭系统保护。";
    const FAILED: &str = "[MACOS_INITIALIZE_FAILED] 初始化未完成，请确认已登录所选本人账号后重试。";
    static BUSY: OnceLock<Mutex<()>> = OnceLock::new();
    static CANCEL: AtomicBool = AtomicBool::new(false);

    pub struct Operation(std::sync::MutexGuard<'static, ()>);
    pub fn begin_operation() -> Result<Operation, String> {
        let guard = BUSY
            .get_or_init(|| Mutex::new(()))
            .try_lock()
            .map_err(|_| "[MACOS_SETUP_BUSY] 正在初始化或读取，请等待安全结束。".to_string())?;
        // A cancel may arrive while spawn_blocking is queued, before this lease.
        // Consume that pending request once instead of silently launching anyway.
        if CANCEL.swap(false, Ordering::SeqCst) {
            return Err("[MACOS_CANCELLED] 操作已取消，未启动新任务。".into());
        }
        Ok(Operation(guard))
    }
    pub fn busy() -> bool {
        BUSY.get_or_init(|| Mutex::new(())).try_lock().is_err()
    }
    pub fn cancel() {
        CANCEL.store(true, Ordering::SeqCst);
    }
    pub fn cancel_requested() -> bool {
        CANCEL.load(Ordering::SeqCst)
    }
    fn euid() -> u32 {
        extern "C" {
            fn geteuid() -> u32;
        }
        unsafe { geteuid() }
    }
    fn nonce() -> String {
        format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        )
    }
    fn absent(path: &Path) -> bool {
        matches!(fs::symlink_metadata(path), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
    }
    fn trusted_chain(path: &Path) -> Result<(), String> {
        if !path.is_absolute() {
            return Err(SECURITY.into());
        }
        let mut current = PathBuf::from("/");
        for part in path.components() {
            match part {
                Component::RootDir => continue,
                Component::Normal(part) => current.push(part),
                _ => return Err(SECURITY.into()),
            }
            let meta = fs::symlink_metadata(&current).map_err(|_| SECURITY)?;
            if meta.file_type().is_symlink()
                || ![0, euid()].contains(&meta.uid())
                || meta.mode() & 0o022 != 0
            {
                return Err(SECURITY.into());
            }
        }
        Ok(())
    }
    fn private_dir(path: &Path) -> Result<(), String> {
        trusted_chain(path)?;
        let meta = fs::symlink_metadata(path).map_err(|_| SECURITY)?;
        if !meta.is_dir() || meta.uid() != euid() || meta.mode() & 0o7777 != 0o700 {
            return Err(SECURITY.into());
        }
        Ok(())
    }
    fn create_private(path: &Path) -> Result<(), String> {
        if absent(path) {
            trusted_chain(path.parent().ok_or(SECURITY)?)?;
            fs::DirBuilder::new()
                .mode(0o700)
                .create(path)
                .map_err(|_| SECURITY)?;
        }
        private_dir(path)
    }
    fn root(config: &Path) -> Result<PathBuf, String> {
        if euid() == 0 {
            return Err(SECURITY.into());
        }
        // Tauri's config directory may not exist on first launch. Only create missing
        // components beneath a trusted, non-symlink ancestor; never chmod old state.
        let mut missing = Vec::new();
        let mut parent = config;
        while absent(parent) {
            missing.push(parent.to_path_buf());
            parent = parent.parent().ok_or(SECURITY)?;
        }
        trusted_chain(parent)?;
        for directory in missing.into_iter().rev() {
            create_private(&directory)?;
        }
        trusted_chain(config)?;
        let root = config.join("mac-wechat");
        create_private(&root)?;
        Ok(root)
    }
    fn read_private<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
        let file = macos::open_private_manifest(path)?;
        let mut data = Zeroizing::new(Vec::new());
        file.take(65537)
            .read_to_end(&mut data)
            .map_err(|_| SECURITY)?;
        if data.len() > 65536 {
            return Err(SECURITY.into());
        }
        serde_json::from_slice(&data).map_err(|_| SECURITY.into())
    }
    fn atomic_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
        let parent = path.parent().ok_or(SECURITY)?;
        private_dir(parent)?;
        if !absent(path) {
            let _ = macos::open_private_manifest(path)?;
        }
        let temp = parent.join(format!(".write-{}", nonce()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|_| SECURITY)?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| SECURITY)?;
        fs::rename(&temp, path).map_err(|_| SECURITY)?;
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| SECURITY.into())
    }
    fn clean_command(program: &str) -> Command {
        let mut cmd = Command::new(program);
        for (key, _) in std::env::vars_os() {
            let name = key.to_string_lossy();
            if name.starts_with("PYTHON")
                || name.starts_with("DYLD")
                || name.starts_with("LD_")
                || name.contains("LIBRARY")
                || matches!(
                    name.as_ref(),
                    "DEVELOPER_DIR"
                        | "SDKROOT"
                        | "TOOLCHAINS"
                        | "CPATH"
                        | "VIRTUAL_ENV"
                        | "__PYVENV_LAUNCHER__"
                )
            {
                cmd.env_remove(key);
            }
        }
        cmd.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .current_dir("/")
            .stdin(Stdio::null());
        cmd
    }
    fn signal(child: &mut Child, name: &str) -> Result<(), String> {
        if child.try_wait().map_err(|_| RECOVERY)?.is_some() {
            return Ok(());
        }
        // The unreaped Child pins this PID. Never signal a discovered WeChat PID.
        let status = Command::new("/bin/kill")
            .args([name, &child.id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|_| RECOVERY)?;
        if status.success() {
            Ok(())
        } else {
            Err(RECOVERY.into())
        }
    }
    fn tool(mut command: Command) -> Result<(bool, Vec<u8>), String> {
        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| FAILED)?;
        let out = child.stdout.take().ok_or(FAILED)?;
        let err = child.stderr.take().ok_or(FAILED)?;
        let (sender, receiver) = std::sync::mpsc::sync_channel(2);
        let reader = |pipe: Box<dyn Read + Send>| {
            let sender = sender.clone();
            thread::spawn(move || {
                let mut pipe = pipe;
                let mut data = Vec::new();
                let _ = (&mut pipe).take(1024 * 1024 + 1).read_to_end(&mut data);
                // Keep consuming without retaining excess private output. Never close
                // the pipe early and accidentally SIGPIPE a cleanup subprocess.
                let _ = std::io::copy(&mut pipe, &mut std::io::sink());
                let _ = sender.send(data);
            });
        };
        reader(Box::new(out));
        reader(Box::new(err));
        drop(sender);
        let start = Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait().map_err(|_| FAILED)? {
                break status;
            }
            if start.elapsed() > Duration::from_secs(30) {
                let _ = signal(&mut child, "-KILL");
                for _ in 0..50 {
                    if child.try_wait().map_err(|_| FAILED)?.is_some() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                return Err(FAILED.into());
            }
            thread::sleep(Duration::from_millis(30));
        };
        // Descendants can inherit pipe FDs. A reader must never make this tool
        // exceed its finite deadline after its direct child has exited.
        let mut output = receiver
            .recv_timeout(Duration::from_secs(1))
            .map_err(|_| FAILED)?;
        output.extend(
            receiver
                .recv_timeout(Duration::from_secs(1))
                .map_err(|_| FAILED)?,
        );
        if output.len() > 1024 * 1024 {
            return Err(FAILED.into());
        }
        Ok((status.success(), output))
    }
    fn command(program: &str, args: &[&str]) -> Command {
        let mut cmd = clean_command(program);
        cmd.args(args);
        cmd
    }
    fn signature(app: &Path) -> Result<String, String> {
        let mut verify = command("/usr/bin/codesign", &["--verify", "--deep", "--strict"]);
        verify.arg(app);
        if !tool(verify)?.0 {
            return Err(RECOVERY.into());
        }
        let mut info = command("/usr/bin/codesign", &["-dvv"]);
        info.arg(app);
        let (ok, bytes) = tool(info)?;
        if !ok {
            return Err(RECOVERY.into());
        }
        Ok(hex::encode(Sha256::digest(bytes)))
    }
    fn no_owned_process(run: &Path) -> Result<(), String> {
        let (ok, bytes) = tool(command("/bin/ps", &["-axo", "comm="]))?;
        let text = std::str::from_utf8(&bytes).map_err(|_| RECOVERY)?;
        let prefix = run.to_str().ok_or(RECOVERY)?;
        if !ok || text.lines().any(|line| line.trim().starts_with(prefix)) {
            return Err(RECOVERY.into());
        }
        Ok(())
    }
    fn resource(resources: &Path) -> Result<PathBuf, String> {
        trusted_chain(resources)?;
        let path = resources.join("macos/bootstrap_keys.py");
        for file in [&path, &resources.join("macos/capture_keys.py")] {
            trusted_chain(file)?;
            let metadata = fs::symlink_metadata(file)
                .map_err(|_| "[MACOS_HELPER_MISSING] 安装包缺少初始化组件。")?;
            if !metadata.is_file() || metadata.len() > 1024 * 1024 {
                return Err(SECURITY.into());
            }
            if !fs::canonicalize(file)
                .map_err(|_| SECURITY)?
                .starts_with(resources)
            {
                return Err(SECURITY.into());
            }
        }
        Ok(path)
    }
    fn native_home() -> Result<PathBuf, String> {
        // Read native Directory Services, not HOME or the CLI data-root override.
        // This avoids coupling to Darwin's private passwd structure ABI.
        let uid = euid().to_string();
        let (ok, bytes) = tool(command(
            "/usr/bin/dscacheutil",
            &["-q", "user", "-a", "uid", &uid],
        ))?;
        let text = std::str::from_utf8(&bytes).map_err(|_| SECURITY)?;
        let homes = text
            .lines()
            .filter_map(|line| line.strip_prefix("dir: "))
            .collect::<Vec<_>>();
        let ids = text
            .lines()
            .filter_map(|line| line.strip_prefix("uid: "))
            .collect::<Vec<_>>();
        if !ok || homes.len() != 1 || ids != [uid.as_str()] {
            return Err(SECURITY.into());
        }
        let home = PathBuf::from(homes[0]);
        trusted_chain(&home)?;
        Ok(home)
    }
    struct AccountState {
        id: String,
        label: String,
        account: discovery::WechatAccount,
        directory: PathBuf,
    }
    fn accounts(root: &Path) -> Result<Vec<AccountState>, String> {
        let seed_path = root.join("identity.json");
        if absent(&seed_path) {
            let mut seed = [0u8; 32];
            File::open("/dev/urandom")
                .and_then(|mut f| f.read_exact(&mut seed))
                .map_err(|_| SECURITY)?;
            atomic_private(
                &seed_path,
                &serde_json::to_vec(&hex::encode(seed)).map_err(|_| SECURITY)?,
            )?;
        }
        let seed: String = read_private(&seed_path)?;
        if seed.len() != 64 || hex::decode(&seed).is_err() {
            return Err(SECURITY.into());
        }
        let data = native_home()?
            .join("Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files");
        let accounts = discovery::enumerate_managed_accounts(&data)?;
        if !absent(&root.join("selected.json")) {
            let selected: String = read_private(&root.join("selected.json"))?;
            if selected.len() != 64 || !selected.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(SECURITY.into());
            }
            // The selection is native-only; every discovered manifest, including
            // this persisted selection, is reauthenticated by status at startup.
        }
        Ok(accounts
            .into_iter()
            .enumerate()
            .map(|(index, account)| {
                use std::os::unix::ffi::OsStrExt;
                let mut hash = Sha256::new();
                hash.update(seed.as_bytes());
                hash.update(account.contact_database.as_os_str().as_bytes());
                let id = hex::encode(hash.finalize());
                let directory = root.join(hex::encode(Sha256::digest(id.as_bytes())));
                AccountState {
                    id,
                    label: format!("账号 {}", index + 1),
                    account,
                    directory,
                }
            })
            .collect())
    }
    fn ready(account: &AccountState) -> bool {
        private_dir(&account.directory).is_ok()
            && macos::load_verified_key_manifest(
                &account.account,
                &account.directory.join("manifest.json"),
            )
            .is_ok()
    }
    fn preflight(resources: &Path) -> Result<PathBuf, String> {
        if std::env::consts::ARCH != "aarch64" || euid() == 0 {
            return Err(
                "[MACOS_NATIVE_ARM64_REQUIRED] 初始化需要原生 Apple Silicon 普通用户会话。".into(),
            );
        }
        let translated = tool(command(
            "/usr/sbin/sysctl",
            &["-in", "sysctl.proc_translated"],
        ))?;
        if translated.0 && translated.1.starts_with(b"1") {
            return Err("[MACOS_NATIVE_ARM64_REQUIRED] 请使用原生 Apple Silicon 应用。".into());
        }
        let helper = resource(resources)?;
        let (ok, text) = tool(command("/usr/sbin/DevToolsSecurity", &["-status"]))?;
        let text = String::from_utf8_lossy(&text).to_lowercase();
        if !ok || !text.contains("enabled") || text.contains("disabled") {
            return Err("[MACOS_DEVELOPER_MODE_REQUIRED] 请先在系统中确认开发者模式；本应用不会启用或更改系统保护。".into());
        }
        let (ok, module) = tool(command("/usr/bin/xcrun", &["lldb", "-P"]))?;
        let module = std::str::from_utf8(&module).map_err(|_| FAILED)?.trim();
        if !ok
            || module.contains('\n')
            || !Path::new(module).is_absolute()
            || !Path::new(module).is_dir()
        {
            return Err(
                "[MACOS_LLDB_REQUIRED] 请安装可用的 Xcode 命令行工具及 LLDB Python 模块。".into(),
            );
        }
        let canonical_module = fs::canonicalize(module).map_err(|_| SECURITY)?;
        trusted_chain(&canonical_module)?;
        let mut python = command("/usr/bin/python3", &["-s", "-c", "import platform,lldb; assert platform.machine() == 'arm64'; assert hasattr(lldb,'SBDebugger')"]);
        python
            .env("PYTHONPATH", &canonical_module)
            .env("PYTHONNOUSERSITE", "1")
            .env("PYTHONDONTWRITEBYTECODE", "1");
        if !tool(python)?.0 {
            return Err("[MACOS_PYTHON_LLDB_REQUIRED] 系统 Python 3 无法使用 LLDB 模块。".into());
        }
        let mut lookup = command("/usr/bin/pgrep", &["-x", "WeChat"]);
        let status = lookup
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|_| FAILED)?;
        match status.code() {
            Some(1) => Ok(helper),
            Some(0) => Err("[MACOS_WECHAT_MUST_QUIT] 请先正常退出官方微信，再开始初始化；本应用不会关闭现有微信。".into()),
            _ => Err("[MACOS_PROCESS_CHECK_FAILED] 无法确认微信已退出，请稍后重新检查。".into()),
        }
    }
    #[derive(Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Pending {
        account_id: String,
        run: String,
        signature: String,
        escalated: bool,
    }
    fn run_path(root: &Path, pending: &Pending) -> Result<PathBuf, String> {
        if pending.account_id.len() != 64
            || !pending.account_id.bytes().all(|b| b.is_ascii_hexdigit())
            || !pending.run.starts_with("run-")
            || pending.run.len() > 100
            || !pending
                .run
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || pending.signature.len() != 64
        {
            return Err(RECOVERY.into());
        }
        let parent = root.join(hex::encode(Sha256::digest(pending.account_id.as_bytes())));
        private_dir(&parent)?;
        let run = parent.join(&pending.run);
        private_dir(&run)?;
        Ok(run)
    }
    fn clear_pending(root: &Path) -> Result<(), String> {
        fs::remove_file(root.join("pending.json")).map_err(|_| RECOVERY)?;
        File::open(root)
            .and_then(|f| f.sync_all())
            .map_err(|_| RECOVERY.into())
    }
    fn remove_run_keys(run: &Path) -> Result<(), String> {
        let keys = run.join("keys.json");
        if !absent(&keys) {
            // Pin and verify the exact known private file before unlinking it.
            let _file = macos::open_private_manifest(&keys)?;
            fs::remove_file(&keys).map_err(|_| RECOVERY)?;
            File::open(run)
                .and_then(|f| f.sync_all())
                .map_err(|_| RECOVERY)?;
        }
        Ok(())
    }
    fn verify_cleanup(root: &Path, pending: &Pending, app: &Path) -> Result<(), String> {
        if pending.escalated {
            return Err(RECOVERY.into());
        }
        let run = run_path(root, pending)?;
        if signature(app)? != pending.signature || !absent(&run.join("WeChat-trial.app")) {
            return Err(RECOVERY.into());
        }
        no_owned_process(&run)?;
        // Only the exact app-created copy in this nonce directory is eligible. Never
        // delete unknown siblings or a .app left behind by an interrupted helper.
        let disabled = run.join("WeChat-trial.disabled");
        if !absent(&disabled) {
            let meta = fs::symlink_metadata(&disabled).map_err(|_| RECOVERY)?;
            if !meta.is_dir() || meta.file_type().is_symlink() || meta.uid() != euid() {
                return Err(RECOVERY.into());
            }
            fs::remove_dir_all(&disabled).map_err(|_| RECOVERY)?;
        }
        no_owned_process(&run)?;
        Ok(())
    }
    fn status(root: &Path, resources: &Path, _recheck: bool) -> Result<MacSetupStatus, String> {
        let mut result = MacSetupStatus {
            accounts: Vec::new(),
            wechat_version: None,
            can_initialize: false,
            blocker: None,
            recovery_required: false,
        };
        let installation = match macos::find_wechat_installation() {
            Ok(app) => {
                result.wechat_version = Some(app.version.clone());
                Some(app)
            }
            Err(error) => {
                result.blocker = Some(error);
                None
            }
        };
        if !absent(&root.join("pending.json")) {
            // An orphan Python/LLDB supervisor need not have the copy's path in
            // ps comm. After restart/escalation we cannot prove its ownership or
            // cleanup, even if the .app disappeared. Recheck deliberately remains
            // blocked; never erase the durable marker based on process heuristics.
            result.recovery_required = true;
            result.blocker = Some(RECOVERY.into());
        }
        match accounts(root) {
            Ok(accounts) => {
                result.accounts = accounts
                    .iter()
                    .map(|account| MacSetupAccount {
                        id: account.id.clone(),
                        label: account.label.clone(),
                        key_ready: !result.recovery_required && ready(account),
                    })
                    .collect();
                if accounts.is_empty() && result.blocker.is_none() {
                    result.blocker = Some("[MACOS_ACCOUNT_NOT_FOUND] 没有可读取的账号，请先在官方微信中登录并打开聊天。".into());
                }
            }
            Err(error) => {
                if result.blocker.is_none() {
                    result.blocker = Some(error);
                }
            }
        }
        if result.blocker.is_none() {
            match preflight(resources) {
                Ok(_) => result.can_initialize = true,
                Err(error) => result.blocker = Some(error),
            }
        }
        Ok(result)
    }
    pub fn check(config: &Path, resources: &Path) -> Result<MacSetupStatus, String> {
        let _operation = begin_operation()?;
        status(&root(config)?, resources, true)
    }
    pub fn startup(config: &Path, _resources: &Path) {
        // Startup only authenticates an existing native selection. No Python,
        // debugger/developer preflight, application launch, or state creation.
        let root = config.join("mac-wechat");
        if private_dir(&root).is_err()
            || absent(&root.join("selected.json"))
            || !absent(&root.join("pending.json"))
        {
            return;
        }
        if let Ok(_guard) = BUSY.get_or_init(|| Mutex::new(())).try_lock() {
            if let (Ok(selected), Ok(accounts)) = (
                read_private::<String>(&root.join("selected.json")),
                accounts(&root),
            ) {
                if let Some(account) = accounts.iter().find(|a| a.id == selected) {
                    let _ = ready(account);
                }
            }
        }
    }
    fn persist_selection(root: &Path, id: &str) -> Result<(), String> {
        atomic_private(
            &root.join("selected.json"),
            &serde_json::to_vec(id).map_err(|_| SECURITY)?,
        )
    }
    pub fn scan<F>(
        config: &Path,
        cache: &Path,
        account_id: &str,
        report: F,
    ) -> Result<WechatScanResult, String>
    where
        F: FnMut(WechatScanProgress),
    {
        let _operation = begin_operation()?;
        let root = root(config)?;
        if !absent(&root.join("pending.json")) {
            return Err(RECOVERY.into());
        }
        let installation = macos::find_wechat_installation()?;
        let account = accounts(&root)?
            .into_iter()
            .find(|a| a.id == account_id)
            .ok_or("[MACOS_ACCOUNT_INVALID] 请选择重新检查后列出的账号。")?;
        private_dir(&account.directory)?;
        persist_selection(&root, &account.id)?;
        macos::scan_account(
            &account.account,
            &account.directory.join("manifest.json"),
            cache,
            &installation.version,
            &account.label,
            report,
            cancel_requested,
        )
    }
    pub fn initialize<F>(
        config: &Path,
        resources: &Path,
        account_id: &str,
        acknowledged: bool,
        mut report: F,
    ) -> Result<MacSetupStatus, String>
    where
        F: FnMut(MacSetupProgress),
    {
        if !acknowledged {
            return Err("[MACOS_ACK_REQUIRED] 请先确认私有调试副本的登录与清理风险。".into());
        }
        let _operation = begin_operation()?;
        let root = root(config)?;
        if !absent(&root.join("pending.json")) {
            return Err(RECOVERY.into());
        }
        let account = accounts(&root)?
            .into_iter()
            .find(|a| a.id == account_id)
            .ok_or("[MACOS_ACCOUNT_INVALID] 请选择重新检查后列出的账号。")?;
        let installation = macos::find_wechat_installation()?;
        let helper = preflight(resources)?;
        create_private(&account.directory)?;
        let run_name = format!("run-{}", nonce());
        let run = account.directory.join(&run_name);
        create_private(&run)?;
        let mut pending = Pending {
            account_id: account.id.clone(),
            run: run_name,
            signature: signature(&installation.app_path)?,
            escalated: false,
        };
        if cancel_requested() {
            return Err("[MACOS_CANCELLED] 已取消，未启动初始化助手。".into());
        }
        // Durably mark before any debugger/copy subprocess can run.
        atomic_private(
            &root.join("pending.json"),
            &serde_json::to_vec(&pending).map_err(|_| SECURITY)?,
        )?;
        let database_root = account
            .account
            .contact_database
            .parent()
            .and_then(Path::parent)
            .ok_or(SECURITY)?;
        let mut cmd = command("/usr/bin/python3", &["-s"]);
        cmd.arg(helper)
            .arg("--db-root")
            .arg(database_root)
            .arg("--state-dir")
            .arg(&run)
            .arg("--app")
            .arg(&installation.app_path)
            .args(["--timeout", "180", "--acknowledge-debug-copy"])
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .current_dir(&run)
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if cancel_requested() {
            clear_pending(&root)?;
            return Err("[MACOS_CANCELLED] 已取消，未启动初始化助手。".into());
        }
        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(_) => {
                if verify_cleanup(&root, &pending, &installation.app_path).is_ok() {
                    clear_pending(&root)?;
                }
                let mut result = status(&root, resources, false)?;
                if !result.recovery_required {
                    result.blocker = Some(FAILED.into());
                }
                return Ok(result);
            }
        };
        let stdout = child.stdout.take().ok_or(RECOVERY)?;
        let (sender, receiver) = std::sync::mpsc::sync_channel::<Vec<u8>>(256);
        let protocol_failed = std::sync::Arc::new(AtomicBool::new(false));
        let reader_failed = protocol_failed.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut total = 0;
            loop {
                let mut line = Vec::new();
                let count = match (&mut reader).take(8193).read_until(b'\n', &mut line) {
                    Ok(0) => break,
                    Err(_) => {
                        reader_failed.store(true, Ordering::SeqCst);
                        break;
                    }
                    Ok(count) => count,
                };
                total += count;
                if count > 8192 || total > 2 * 1024 * 1024 || sender.try_send(line).is_err() {
                    reader_failed.store(true, Ordering::SeqCst);
                    // Discard, rather than close, stdout while owned cleanup runs.
                    let _ = std::io::copy(&mut reader, &mut std::io::sink());
                    break;
                }
            }
        });
        let mut evidence = HelperEvidence::default();
        let start = Instant::now();
        let mut interrupted = None;
        let exit = loop {
            while let Ok(line) = receiver.try_recv() {
                if let Some(event) = evidence.consume(&line) {
                    report(event);
                }
            }
            if let Some(status) = child.try_wait().map_err(|_| RECOVERY)? {
                break status;
            }
            if interrupted.is_none()
                && (cancel_requested() || start.elapsed() > Duration::from_secs(660))
            {
                interrupted = Some(Instant::now());
                let _ = signal(&mut child, "-INT");
                report(MacSetupProgress {
                    stage: "cancelling",
                    detail: "正在等待助手清理；请勿退出应用",
                    percent: 75,
                });
            }
            if interrupted.is_some_and(|time| time.elapsed() > Duration::from_secs(45)) {
                pending.escalated = true;
                atomic_private(
                    &root.join("pending.json"),
                    &serde_json::to_vec(&pending).map_err(|_| SECURITY)?,
                )?;
                let _ = signal(&mut child, "-KILL");
                // Do not wait indefinitely or target the debugger's descendants.
                for _ in 0..50 {
                    if child.try_wait().map_err(|_| RECOVERY)?.is_some() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                return status(&root, resources, false);
            }
            thread::sleep(Duration::from_millis(50));
        };
        // Pipe reader may lag the exit notification. Bounded draining never waits
        // for a detached descendant that might still hold the inherited stdout FD.
        for _ in 0..20 {
            match receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(line) => {
                    if let Some(event) = evidence.consume(&line) {
                        report(event);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                Err(_) => continue,
            }
        }
        if protocol_failed.load(Ordering::SeqCst)
            || !evidence.original_verified
            || evidence.manual_restore
            || verify_cleanup(&root, &pending, &installation.app_path).is_err()
        {
            return status(&root, resources, false);
        }
        let mut completed = false;
        if exit.success() && interrupted.is_none() && !cancel_requested() {
            let keys = run.join("keys.json");
            if macos::load_verified_key_manifest(&account.account, &keys).is_ok() {
                // Validate descriptor permissions and HMAC before atomic promotion.
                let mut bytes = Zeroizing::new(Vec::new());
                macos::open_private_manifest(&keys)?
                    .take(1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| SECURITY)?;
                if bytes.len() <= 1024 * 1024 {
                    atomic_private(&account.directory.join("manifest.json"), &bytes)?;
                    if ready(&account) {
                        persist_selection(&root, &account.id)?;
                        completed = true;
                    }
                }
            }
        }
        if remove_run_keys(&run).is_err() {
            return status(&root, resources, false);
        }
        clear_pending(&root)?;
        let mut result = status(&root, resources, false)?;
        if completed {
            report(MacSetupProgress {
                stage: "complete",
                detail: "本机密钥已认证，临时副本已清理",
                percent: 100,
            });
        } else {
            result.blocker = Some(if interrupted.is_some() || cancel_requested() {
                "[MACOS_CANCELLED] 初始化未完成；原应用与临时副本清理已验证。".into()
            } else {
                FAILED.into()
            });
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_status_has_only_agreed_opaque_fields() {
        let value = serde_json::to_value(MacSetupStatus {
            accounts: vec![MacSetupAccount {
                id: "opaque-native-id".into(),
                label: "账号 1".into(),
                key_ready: true,
            }],
            wechat_version: Some("4.1.13".into()),
            can_initialize: false,
            blocker: None,
            recovery_required: false,
        })
        .unwrap();
        assert_eq!(value.as_object().unwrap().len(), 5);
        assert_eq!(
            value["accounts"][0],
            serde_json::json!({"id":"opaque-native-id","label":"账号 1","keyReady":true})
        );
        assert!(value.get("wechatVersion").is_some());
        assert!(value.get("canInitialize").is_some());
        assert!(value.get("recoveryRequired").is_some());
    }

    #[test]
    fn private_helper_fields_never_enter_progress() {
        let mut state = HelperEvidence::default();
        let progress = state.consume(br#"{"type":"verified_progress","enc_key":"PRIVATE-KEY","path":"PRIVATE-PATH","pid":123}"#).unwrap();
        let serialized = serde_json::to_string(&progress).unwrap();
        assert!(!serialized.contains("PRIVATE"));
        assert!(!serialized.contains("123"));
        assert_eq!(progress.stage, "capturing");
        assert_eq!(
            serde_json::to_value(progress)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            3
        );
        assert!(!state.original_verified);
    }

    #[test]
    fn return_zero_or_key_event_cannot_replace_original_verification() {
        let mut state = HelperEvidence::default();
        assert!(state
            .consume(br#"{"type":"keys_saved_privately","complete":true}"#)
            .is_none());
        assert!(!state.original_verified);
        state.consume(br#"{"type":"original_signature_unchanged"}"#);
        assert!(state.original_verified);
        state.consume(br#"{"type":"manual_restore_required"}"#);
        state.consume(br#"{"type":"original_signature_unchanged"}"#);
        assert!(
            state.manual_restore,
            "later success must not erase a cleanup failure"
        );
    }

    #[test]
    fn invalid_or_oversize_protocol_latches_recovery() {
        let mut state = HelperEvidence::default();
        assert!(state.consume(b"not json").is_none());
        assert!(state.manual_restore);
        let mut state = HelperEvidence::default();
        assert!(state.consume(&vec![b'x'; 8193]).is_none());
        assert!(state.manual_restore);
    }
}
