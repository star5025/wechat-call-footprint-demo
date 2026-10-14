use super::crypto;
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    ffi::c_void,
    mem,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::{
            Debug::ReadProcessMemory,
            ToolHelp::{
                CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, Process32FirstW,
                Process32NextW, MODULEENTRY32W, PROCESSENTRY32W, TH32CS_SNAPMODULE,
                TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS,
            },
        },
        Memory::{
            VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, MEM_PRIVATE, PAGE_GUARD,
            PAGE_NOACCESS,
        },
        Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
    },
};
use zeroize::{Zeroize, Zeroizing};

const MEMORY_CHUNK: usize = 4 * 1024 * 1024;
const KEY_SIZE: usize = 32;
const MAX_CANDIDATES: usize = 512;
const MAX_SCANNED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_SCAN_TIME: Duration = Duration::from_secs(90);

pub struct WechatInstallation {
    pub pid: u32,
    pub dll_path: PathBuf,
    pub version: String,
}

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(self.0) };
        }
    }
}

pub fn find_wechat_installation() -> Result<WechatInstallation, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("无法枚举微信进程。".into());
    }
    let snapshot = OwnedHandle(snapshot);
    let mut entry: PROCESSENTRY32W = unsafe { mem::zeroed() };
    entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut pids = Vec::new();
    let mut ok = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    while ok != 0 {
        if utf16_string(&entry.szExeFile).eq_ignore_ascii_case("Weixin.exe") {
            pids.push(entry.th32ProcessID);
        }
        ok = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }

    for pid in pids {
        if let Some(dll_path) = find_module(pid, "Weixin.dll") {
            let version = dll_path
                .parent()
                .and_then(|path| path.file_name())
                .and_then(|value| value.to_str())
                .unwrap_or("4.x")
                .to_owned();
            return Ok(WechatInstallation {
                pid,
                dll_path,
                version,
            });
        }
    }
    Err("没有找到已登录的微信主进程。请打开 Windows 桌面微信并保持登录。".into())
}

fn find_module(pid: u32, module_name: &str) -> Option<PathBuf> {
    let snapshot =
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    let snapshot = OwnedHandle(snapshot);
    let mut entry: MODULEENTRY32W = unsafe { mem::zeroed() };
    entry.dwSize = mem::size_of::<MODULEENTRY32W>() as u32;
    let mut ok = unsafe { Module32FirstW(snapshot.0, &mut entry) };
    while ok != 0 {
        if utf16_string(&entry.szModule).eq_ignore_ascii_case(module_name) {
            return Some(PathBuf::from(utf16_string(&entry.szExePath)));
        }
        ok = unsafe { Module32NextW(snapshot.0, &mut entry) };
    }
    None
}

fn utf16_string(value: &[u16]) -> String {
    let length = value
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..length])
}

pub fn recover_account_key(
    installation: &WechatInstallation,
    validation_database: &Path,
    xor_keys: &[[u8; KEY_SIZE]],
) -> Result<Vec<u8>, String> {
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
            0,
            installation.pid,
        )
    };
    if handle.is_null() {
        return Err("无法以只读方式访问微信进程。请确认应用与微信由同一 Windows 用户运行。".into());
    }
    let handle = OwnedHandle(handle);
    let mut seen_addresses = HashSet::new();
    let mut seen_candidate_hashes = HashSet::new();
    let mut candidates = Zeroizing::new(Vec::<[u8; KEY_SIZE]>::new());
    let started = Instant::now();
    let mut scanned_bytes = 0u64;
    let mut budget_exhausted = false;
    let mut address = 0usize;
    let mut region: MEMORY_BASIC_INFORMATION = unsafe { mem::zeroed() };

    loop {
        if started.elapsed() >= MAX_SCAN_TIME
            || scanned_bytes >= MAX_SCANNED_BYTES
            || candidates.len() >= MAX_CANDIDATES
        {
            budget_exhausted = true;
            break;
        }
        let queried = unsafe {
            VirtualQueryEx(
                handle.0,
                address as *const c_void,
                &mut region,
                mem::size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };
        if queried == 0 {
            break;
        }
        let base = region.BaseAddress as usize;
        let size = region.RegionSize;
        let next = base.saturating_add(size);
        if next <= address {
            break;
        }
        address = next;

        let unreadable = region.State != MEM_COMMIT
            || region.Type != MEM_PRIVATE
            || (region.Protect & PAGE_NOACCESS) != 0
            || (region.Protect & PAGE_GUARD) != 0;
        if unreadable || size < KEY_SIZE {
            continue;
        }

        let mut offset = 0usize;
        let mut tail = Zeroizing::new(Vec::new());
        while offset < size {
            if started.elapsed() >= MAX_SCAN_TIME
                || scanned_bytes >= MAX_SCANNED_BYTES
                || candidates.len() >= MAX_CANDIDATES
            {
                budget_exhausted = true;
                break;
            }
            let request = MEMORY_CHUNK.min(size - offset);
            let mut bytes = Zeroizing::new(vec![0u8; request]);
            let mut bytes_read = 0usize;
            let success = unsafe {
                ReadProcessMemory(
                    handle.0,
                    (base + offset) as *const c_void,
                    bytes.as_mut_ptr() as *mut c_void,
                    request,
                    &mut bytes_read,
                )
            };
            if success == 0 || bytes_read == 0 {
                offset = offset.saturating_add(request);
                tail.zeroize();
                tail.clear();
                continue;
            }
            bytes.truncate(bytes_read);
            scanned_bytes = scanned_bytes.saturating_add(bytes_read as u64);
            if !tail.is_empty() {
                let mut combined = Zeroizing::new(Vec::with_capacity(tail.len() + bytes.len()));
                combined.extend_from_slice(&tail);
                combined.extend_from_slice(&bytes);
                bytes = combined;
            }
            for pointer in key_pointer_candidates(&bytes) {
                if !seen_addresses.insert(pointer) {
                    continue;
                }
                let Some(mut candidate) = read_fixed::<KEY_SIZE>(handle.0, pointer) else {
                    continue;
                };
                if !is_potential_key(&candidate) {
                    candidate.zeroize();
                    continue;
                }
                let fingerprint: [u8; 32] = Sha256::digest(candidate).into();
                if seen_candidate_hashes.insert(fingerprint) {
                    candidates.push(candidate);
                }
                candidate.zeroize();
            }
            tail.zeroize();
            tail.clear();
            tail.extend_from_slice(&bytes[bytes.len().saturating_sub(KEY_SIZE - 1)..]);
            offset = offset.saturating_add(request);
        }
    }
    if let Some(passphrase) = candidates.par_iter().find_map_any(|candidate| {
        crypto::verify_memory_candidate(candidate, xor_keys, validation_database)
            .ok()
            .flatten()
    }) {
        return Ok(passphrase);
    }
    if budget_exhausted {
        return Err(
            "微信只读内存扫描达到安全预算，未找到可验证密钥。请关闭其他微信实例后重试。".into(),
        );
    }
    Err(
        "没有在当前登录的微信进程中找到可验证的数据库密钥。请让微信保持登录并打开一次聊天后重试。"
            .into(),
    )
}

fn key_pointer_candidates(bytes: &[u8]) -> Vec<usize> {
    let mut addresses = Vec::new();
    for chunk in bytes.windows(KEY_SIZE) {
        if chunk[8..16].iter().all(|byte| *byte == 0)
            && u64::from_le_bytes(chunk[16..24].try_into().unwrap()) == 32
            && u64::from_le_bytes(chunk[24..32].try_into().unwrap()) == 47
        {
            let pointer = u64::from_le_bytes(chunk[0..8].try_into().unwrap()) as usize;
            if pointer > 0x10000 {
                addresses.push(pointer);
            }
        }
    }
    addresses
}

fn read_fixed<const N: usize>(handle: HANDLE, address: usize) -> Option<[u8; N]> {
    let mut bytes = [0u8; N];
    let mut bytes_read = 0usize;
    let success = unsafe {
        ReadProcessMemory(
            handle,
            address as *const c_void,
            bytes.as_mut_ptr() as *mut c_void,
            N,
            &mut bytes_read,
        )
    };
    (success != 0 && bytes_read == N).then_some(bytes)
}

fn is_potential_key(key: &[u8; KEY_SIZE]) -> bool {
    let distinct = key.iter().copied().collect::<HashSet<_>>().len();
    let printable = key
        .iter()
        .filter(|byte| (32u8..=126).contains(*byte))
        .count();
    distinct >= 15 && printable <= 24
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_wcdb_key_pointer_stub() {
        let pointer = 0x1234_5678u64;
        let mut bytes = Vec::new();
        bytes.extend(pointer.to_le_bytes());
        bytes.extend([0; 8]);
        bytes.extend(32u64.to_le_bytes());
        bytes.extend(47u64.to_le_bytes());
        assert_eq!(key_pointer_candidates(&bytes), vec![pointer as usize]);
    }
}
