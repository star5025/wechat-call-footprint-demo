mod wechat;

use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const MAX_IMPORT_BYTES: u64 = 50 * 1024 * 1024;
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

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn load_json(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    match serde_json::from_str(&content) {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            let corrupt = path.with_extension(format!("corrupt.{}.json", std::process::id()));
            let _ = fs::rename(path, corrupt);
            Err(format!("本地设置文件已损坏并被隔离：{error}"))
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
        return Err("数据超过 50 MB 限制。".into());
    }
    serde_json::from_str::<Value>(&content).map_err(|_| "数据不是有效 JSON。".to_string())?;
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
        .add_filter("通话足迹 JSON", &["json"])
        .set_title("选择要导入的通话数据")
        .pick_file()
        .await;
    let Some(file) = file else { return Ok(None) };
    let path = file.path();
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_IMPORT_BYTES {
        return Err("首版最多导入 50 MB 的 JSON 文件。".into());
    }
    let content = fs::read_to_string(path).map_err(|_| "文件必须是 UTF-8 JSON。".to_string())?;
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
        return Err("导出内容超过 50 MB 限制。".into());
    }
    let safe_name = Path::new(&suggested_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("call-footprint.json");
    let file = rfd::AsyncFileDialog::new()
        .add_filter("JSON", &["json"])
        .set_file_name(safe_name)
        .set_title("导出通话足迹数据")
        .save_file()
        .await;
    let Some(file) = file else { return Ok(None) };
    atomic_write(file.path(), content.as_bytes())?;
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
    tauri::async_runtime::spawn_blocking(move || wechat::scan(&cache_directory))
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
        atomic_write(&path, b"{\"value\":1}").unwrap();
        atomic_write(&path, b"{\"value\":2}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"value\":2}");
        let _ = fs::remove_dir_all(directory);
    }
}
