mod wechat;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const MAX_IMPORT_BYTES: u64 = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const SETTINGS_FILE: &str = "settings.json";
const DATASET_FILE: &str = "dataset.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    version: String,
    platform: String,
    arch: String,
    data_directory: String,
    is_tauri: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportFileResult {
    file_name: String,
    content: String,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    path: String,
    size_bytes: u64,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn sibling_work_path(path: &Path, suffix: &str) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("call-footprint");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    path.parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(
            ".{name}.{}.{}.{}",
            std::process::id(),
            nonce,
            suffix
        ))
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> Result<(), String> {
    fs::rename(source, target).map_err(|error| error.to_string())
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let temporary = sibling_work_path(path, "tmp");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    if let Err(error) = file.write_all(content).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    drop(file);

    replace_file(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        error
    })
}

fn load_json(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    match serde_json::from_str(&content) {
        Ok(value) => Ok(Some(value)),
        Err(_) => {
            let corrupt = path.with_extension(format!("corrupt.{}.json", std::process::id()));
            let _ = fs::rename(path, corrupt);
            Err("上次保存的内容无法打开，已自动重置。".into())
        }
    }
}

#[tauri::command]
fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    let data_directory = config_dir(&app)?;
    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_directory: data_directory.to_string_lossy().to_string(),
        is_tauri: true,
    })
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<Value>, String> {
    load_json(&config_dir(&app)?.join(SETTINGS_FILE))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    atomic_write(&config_dir(&app)?.join(SETTINGS_FILE), &content)
}

#[tauri::command]
fn load_dataset(app: AppHandle) -> Result<Option<String>, String> {
    let path = config_dir(&app)?.join(DATASET_FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_dataset(app: AppHandle, content: String) -> Result<(), String> {
    if content.len() as u64 > MAX_IMPORT_BYTES {
        return Err("通话记录太多，暂时无法保存。".into());
    }
    serde_json::from_str::<Value>(&content)
        .map_err(|_| "这个文件无法保存，请稍后重试。".to_string())?;
    atomic_write(&config_dir(&app)?.join(DATASET_FILE), content.as_bytes())
}

#[tauri::command]
fn delete_dataset(app: AppHandle) -> Result<(), String> {
    let path = config_dir(&app)?.join(DATASET_FILE);
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn choose_import_file() -> Result<Option<ImportFileResult>, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("通话足迹记录", &["json"])
        .set_title("选择之前保存的通话记录")
        .pick_file()
        .await;
    let Some(file) = file else { return Ok(None) };
    let path = file.path();
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err("这个文件太大，请选择较小的通话记录文件。".into());
    }
    let content =
        fs::read_to_string(path).map_err(|_| "无法打开这个文件，请重新选择。".to_string())?;
    Ok(Some(ImportFileResult {
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("import.json")
            .to_string(),
        content,
        size_bytes: metadata.len(),
    }))
}

#[tauri::command]
async fn export_json(
    suggested_name: String,
    content: String,
) -> Result<Option<ExportResult>, String> {
    if content.len() as u64 > MAX_IMPORT_BYTES {
        return Err("通话记录太多，暂时无法一次保存。".into());
    }
    let safe_name = Path::new(&suggested_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("call-footprint.json");
    let file = rfd::AsyncFileDialog::new()
        .add_filter("通话足迹记录", &["json"])
        .set_file_name(safe_name)
        .set_title("保存通话记录文件")
        .save_file()
        .await;
    let Some(file) = file else { return Ok(None) };
    atomic_write(file.path(), content.as_bytes())?;
    Ok(Some(ExportResult {
        path: file.path().to_string_lossy().to_string(),
        size_bytes: content.len() as u64,
    }))
}

fn is_complete_png(content: &[u8]) -> bool {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    const IEND: &[u8] = b"\x00\x00\x00\x00IEND\xaeB\x60\x82";
    content.len() >= 45
        && content.starts_with(SIGNATURE)
        && content.get(12..16) == Some(b"IHDR")
        && content.ends_with(IEND)
}

fn decode_png(data_base64: &str) -> Result<Vec<u8>, String> {
    if data_base64.len() > MAX_IMAGE_BYTES * 4 / 3 + 8 {
        return Err("生成的图片太大，暂时无法保存。".into());
    }
    let content = BASE64_STANDARD
        .decode(data_base64)
        .map_err(|_| "生成的图片无法保存，请重新生成。".to_string())?;
    if content.len() > MAX_IMAGE_BYTES || !is_complete_png(&content) {
        return Err("生成的图片格式不正确，请重新生成。".into());
    }
    Ok(content)
}

#[tauri::command]
async fn export_png(
    suggested_name: String,
    data_base64: String,
) -> Result<Option<ExportResult>, String> {
    let content = decode_png(&data_base64)?;
    let safe_name = Path::new(&suggested_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("call-summary.png");
    let file = rfd::AsyncFileDialog::new()
        .add_filter("PNG 图片", &["png"])
        .set_file_name(safe_name)
        .set_title("保存通话总结长图")
        .save_file()
        .await;
    let Some(file) = file else { return Ok(None) };
    atomic_write(file.path(), &content)?;
    Ok(Some(ExportResult {
        path: file.path().to_string_lossy().to_string(),
        size_bytes: content.len() as u64,
    }))
}

#[tauri::command]
async fn scan_wechat_calls(app: AppHandle) -> Result<wechat::WechatScanResult, String> {
    let cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    let progress_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        wechat::scan_with_progress(&cache_directory, |progress| {
            let _ = progress_app.emit("wechat-scan-progress", progress);
        })
    })
    .await
    .map_err(|error| format!("微信扫描任务异常结束：{error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Ok(cache_directory) = app.path().app_cache_dir() {
                wechat::cleanup_cache(&cache_directory);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            load_settings,
            save_settings,
            load_dataset,
            save_dataset,
            delete_dataset,
            choose_import_file,
            export_json,
            export_png,
            scan_wechat_calls
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Call Footprint");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_existing_file() {
        let directory =
            std::env::temp_dir().join(format!("call-footprint-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("value.json");
        let unrelated_temporary = directory.join("value.tmp");
        fs::write(&unrelated_temporary, b"keep").unwrap();
        atomic_write(&path, b"{\"value\":1}").unwrap();
        atomic_write(&path, b"{\"value\":2}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"value\":2}");
        assert_eq!(fs::read(&unrelated_temporary).unwrap(), b"keep");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn decode_png_accepts_complete_png_structure() {
        let mut png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
        png.extend_from_slice(&[0; 17]);
        png.extend_from_slice(b"\x00\x00\x00\x00IEND\xaeB\x60\x82");
        let encoded = BASE64_STANDARD.encode(&png);
        assert_eq!(decode_png(&encoded).unwrap(), png);
    }

    #[test]
    fn decode_png_rejects_invalid_or_truncated_content() {
        assert!(decode_png("not-base64").is_err());
        assert!(decode_png(&BASE64_STANDARD.encode(b"not-png")).is_err());
        assert!(decode_png(&BASE64_STANDARD.encode(b"\x89PNG\r\n\x1a\ntruncated")).is_err());
    }
}
