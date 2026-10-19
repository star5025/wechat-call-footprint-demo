use aes::{
    cipher::{BlockDecrypt, KeyInit},
    Aes256,
};
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2_hmac;
use rusqlite::{Connection, OpenFlags};
use sha2::Sha512;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

const PAGE_SIZE: usize = 4096;
const SALT_SIZE: usize = 16;
const KEY_SIZE: usize = 32;
const RESERVE_SIZE: usize = 80;
const PBKDF2_ROUNDS: u32 = 256_000;

type HmacSha512 = Hmac<Sha512>;

struct DatabaseKeys {
    encryption: Zeroizing<[u8; KEY_SIZE]>,
    authentication: Zeroizing<[u8; KEY_SIZE]>,
}

pub enum KeyMaterial {
    AccountPassphrase(Zeroizing<Vec<u8>>),
    RawKeysBySalt(HashMap<[u8; SALT_SIZE], Zeroizing<[u8; KEY_SIZE]>>),
}

impl KeyMaterial {
    pub fn account_passphrase(passphrase: Vec<u8>) -> Self {
        Self::AccountPassphrase(Zeroizing::new(passphrase))
    }

    pub fn empty_raw_keyring() -> Self {
        Self::RawKeysBySalt(HashMap::new())
    }

    pub fn insert_verified_raw_key(
        &mut self,
        database: &Path,
        raw_key: &[u8; KEY_SIZE],
    ) -> Result<(), String> {
        let page = read_first_page(database)?;
        let salt: [u8; SALT_SIZE] = page[..SALT_SIZE].try_into().unwrap();
        let keys = derive_database_keys_from_raw(&raw_key, &salt);
        if !verify_page_hmac(&keys.authentication, &page, 1) {
            return Err("候选数据库密钥未通过首页认证。".into());
        }
        match self {
            Self::RawKeysBySalt(keys) => {
                keys.insert(salt, Zeroizing::new(*raw_key));
                Ok(())
            }
            Self::AccountPassphrase(_) => Err("账号口令模式不能加入逐库原始密钥。".into()),
        }
    }

    pub fn raw_key_count(&self) -> usize {
        match self {
            Self::RawKeysBySalt(keys) => keys.len(),
            Self::AccountPassphrase(_) => 0,
        }
    }

    fn resolve(&self, salt: &[u8]) -> Result<DatabaseKeys, String> {
        match self {
            Self::AccountPassphrase(passphrase) => Ok(derive_database_keys(passphrase, salt)),
            Self::RawKeysBySalt(keys) => {
                let salt: [u8; SALT_SIZE] = salt
                    .try_into()
                    .map_err(|_| "数据库盐值长度无效。".to_string())?;
                let raw_key = keys
                    .get(&salt)
                    .ok_or_else(|| "当前数据库没有经过验证的 macOS 密钥。".to_string())?;
                Ok(derive_database_keys_from_raw(raw_key, &salt))
            }
        }
    }
}

pub struct PreparedDatabase {
    pub path: PathBuf,
    pub wal_omitted: bool,
}

pub fn extract_static_xor_keys(dll_path: &Path) -> Result<Vec<[u8; KEY_SIZE]>, String> {
    let data = fs::read(dll_path).map_err(|error| format!("无法读取微信版本组件：{error}"))?;
    let mut keys = Vec::new();
    for start in 0..data.len().saturating_sub(64) {
        if data.get(start..start + 2) != Some(&[0x48, 0xBA]) {
            continue;
        }
        if let Some((key, _)) = match_xor_sequence(&data, start) {
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
    }
    if keys.is_empty() {
        return Err("当前微信版本的数据库保护特征尚未支持。请更新通话足迹后重试。".into());
    }
    Ok(keys)
}

fn match_xor_sequence(data: &[u8], start: usize) -> Option<([u8; KEY_SIZE], usize)> {
    let mut cursor = start;
    let mut key = [0u8; KEY_SIZE];
    for index in 0..4 {
        if data.get(cursor..cursor + 2)? != [0x48, 0xBA] {
            return None;
        }
        key[index * 8..(index + 1) * 8].copy_from_slice(data.get(cursor + 2..cursor + 10)?);
        cursor += 10;
        if index < 3 {
            cursor = find_after_gap(data, cursor, &[0x48, 0xBA])?;
        }
    }
    cursor = find_after_gap(data, cursor, &[0x48, 0x85, 0xC0])?;
    Some((key, cursor + 3))
}

fn find_after_gap(data: &[u8], cursor: usize, needle: &[u8]) -> Option<usize> {
    (3..=8)
        .map(|gap| cursor + gap)
        .find(|offset| data.get(*offset..*offset + needle.len()) == Some(needle))
}

pub fn verify_memory_candidate(
    candidate: &[u8; KEY_SIZE],
    xor_keys: &[[u8; KEY_SIZE]],
    database: &Path,
) -> Result<Option<Vec<u8>>, String> {
    let page = read_first_page(database)?;
    for xor_key in xor_keys {
        let mut passphrase = Zeroizing::new(vec![0u8; KEY_SIZE]);
        for index in 0..KEY_SIZE {
            passphrase[index] = candidate[index] ^ xor_key[index];
        }
        if verify_passphrase(&passphrase, &page) {
            return Ok(Some(passphrase.to_vec()));
        }
    }
    Ok(None)
}

fn read_first_page(database: &Path) -> Result<[u8; PAGE_SIZE], String> {
    let mut file =
        fs::File::open(database).map_err(|error| format!("无法读取数据库快照：{error}"))?;
    let mut page = [0u8; PAGE_SIZE];
    file.read_exact(&mut page)
        .map_err(|_| "数据库首页不完整。".to_string())?;
    Ok(page)
}

fn verify_passphrase(passphrase: &[u8], page: &[u8; PAGE_SIZE]) -> bool {
    let keys = derive_database_keys(passphrase, &page[..SALT_SIZE]);
    verify_page_hmac(&keys.authentication, page, 1)
}

fn verify_page_hmac(
    authentication_key: &[u8; KEY_SIZE],
    page: &[u8; PAGE_SIZE],
    page_number: u32,
) -> bool {
    let Ok(mut mac) = <HmacSha512 as Mac>::new_from_slice(authentication_key) else {
        return false;
    };
    let start = if page_number == 1 { SALT_SIZE } else { 0 };
    let mac_end = PAGE_SIZE - RESERVE_SIZE + 16;
    mac.update(&page[start..mac_end]);
    mac.update(&page_number.to_le_bytes());
    mac.verify_slice(&page[mac_end..PAGE_SIZE]).is_ok()
}

pub fn prepare_plaintext_database(
    source: &Path,
    destination_dir: &Path,
    key_material: &KeyMaterial,
) -> Result<PreparedDatabase, String> {
    fs::create_dir_all(destination_dir)
        .map_err(|error| format!("无法创建临时解密目录：{error}"))?;
    let file_name = source
        .file_name()
        .ok_or_else(|| "数据库文件名无效。".to_string())?;
    let destination = destination_dir.join(file_name);
    let building = destination.with_extension("db.building");
    let _ = fs::remove_file(&building);

    decrypt_main_database(source, &building, key_material)?;
    if !quick_check(&building) {
        let _ = fs::remove_file(&building);
        return Err("数据库主文件解密后未通过完整性校验。".into());
    }
    let wal = PathBuf::from(format!("{}-wal", source.display()));
    let mut wal_omitted = false;
    if wal.is_file()
        && fs::metadata(&wal)
            .map(|item| item.len() > 32)
            .unwrap_or(false)
    {
        if merge_wal(&building, &wal, source, key_material).is_err() || !quick_check(&building) {
            decrypt_main_database(source, &building, key_material)?;
            wal_omitted = true;
        }
    }
    if destination.exists() {
        let _ = fs::remove_file(&destination);
    }
    fs::rename(&building, &destination)
        .map_err(|error| format!("无法完成临时数据库解密：{error}"))?;
    Ok(PreparedDatabase {
        path: destination,
        wal_omitted,
    })
}

pub fn open_plaintext_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("无法只读打开临时数据库：{error}"))?;
    connection
        .execute_batch("PRAGMA query_only=ON;")
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn decrypt_main_database(
    source: &Path,
    destination: &Path,
    key_material: &KeyMaterial,
) -> Result<(), String> {
    let mut input =
        fs::File::open(source).map_err(|error| format!("无法读取数据库快照：{error}"))?;
    let mut first_page = [0u8; PAGE_SIZE];
    input
        .read_exact(&mut first_page)
        .map_err(|_| "数据库首页不完整。".to_string())?;
    let keys = key_material.resolve(&first_page[..SALT_SIZE])?;
    if !verify_page_hmac(&keys.authentication, &first_page, 1) {
        return Err("数据库首页认证失败。".into());
    }
    let mut output =
        fs::File::create(destination).map_err(|error| format!("无法创建临时数据库：{error}"))?;
    output
        .write_all(&decrypt_page(&keys.encryption, &first_page, 1)?)
        .map_err(|error| format!("无法写入临时数据库：{error}"))?;

    let mut page_number = 2u32;
    loop {
        let mut page = [0u8; PAGE_SIZE];
        let mut filled = 0usize;
        while filled < PAGE_SIZE {
            let count = input
                .read(&mut page[filled..])
                .map_err(|error| format!("无法读取数据库页：{error}"))?;
            if count == 0 {
                break;
            }
            filled += count;
        }
        if filled == 0 {
            break;
        }
        if filled != PAGE_SIZE {
            return Err("数据库尾页不完整。".into());
        }
        if !verify_page_hmac(&keys.authentication, &page, page_number) {
            return Err(format!("数据库第 {page_number} 页认证失败。"));
        }
        output
            .write_all(&decrypt_page(&keys.encryption, &page, page_number)?)
            .map_err(|error| format!("无法写入临时数据库页：{error}"))?;
        page_number += 1;
    }
    output
        .sync_all()
        .map_err(|error| format!("无法刷新临时数据库：{error}"))
}

fn derive_database_keys(passphrase: &[u8], salt: &[u8]) -> DatabaseKeys {
    let mut encryption = Zeroizing::new([0u8; KEY_SIZE]);
    pbkdf2_hmac::<Sha512>(passphrase, salt, PBKDF2_ROUNDS, encryption.as_mut());
    derive_database_keys_from_raw(&encryption, salt)
}

fn derive_database_keys_from_raw(raw_key: &[u8; KEY_SIZE], salt: &[u8]) -> DatabaseKeys {
    let encryption = Zeroizing::new(*raw_key);
    let mac_salt = salt.iter().map(|byte| byte ^ 0x3a).collect::<Vec<_>>();
    let mut authentication = Zeroizing::new([0u8; KEY_SIZE]);
    pbkdf2_hmac::<Sha512>(&encryption[..], &mac_salt, 2, authentication.as_mut());
    DatabaseKeys {
        encryption,
        authentication,
    }
}

fn decrypt_page(
    key: &[u8; KEY_SIZE],
    page: &[u8; PAGE_SIZE],
    page_number: u32,
) -> Result<[u8; PAGE_SIZE], String> {
    let encrypted_end = PAGE_SIZE - RESERVE_SIZE;
    let start = if page_number == 1 { SALT_SIZE } else { 0 };
    let iv: [u8; 16] = page[encrypted_end..encrypted_end + 16].try_into().unwrap();
    let decrypted = aes_cbc_decrypt(key, &iv, &page[start..encrypted_end])?;
    let mut output = [0u8; PAGE_SIZE];
    if page_number == 1 {
        output[..SALT_SIZE].copy_from_slice(b"SQLite format 3\0");
        output[SALT_SIZE..encrypted_end].copy_from_slice(&decrypted);
    } else {
        output[..encrypted_end].copy_from_slice(&decrypted);
    }
    Ok(output)
}

fn aes_cbc_decrypt(
    key: &[u8; KEY_SIZE],
    iv: &[u8; 16],
    ciphertext: &[u8],
) -> Result<Vec<u8>, String> {
    if ciphertext.len() % 16 != 0 {
        return Err("加密页长度无效。".into());
    }
    let cipher = Aes256::new_from_slice(key).map_err(|_| "数据库密钥长度无效。".to_string())?;
    let mut previous = *iv;
    let mut output = Vec::with_capacity(ciphertext.len());
    for chunk in ciphertext.chunks_exact(16) {
        let current: [u8; 16] = chunk.try_into().unwrap();
        let mut block = aes::Block::clone_from_slice(chunk);
        cipher.decrypt_block(&mut block);
        for index in 0..16 {
            block[index] ^= previous[index];
        }
        output.extend_from_slice(&block);
        previous = current;
    }
    Ok(output)
}

fn merge_wal(
    database: &Path,
    wal_path: &Path,
    encrypted_source: &Path,
    key_material: &KeyMaterial,
) -> Result<(), String> {
    let source_page = read_first_page(encrypted_source)?;
    let keys = key_material.resolve(&source_page[..SALT_SIZE])?;
    let mut wal =
        fs::File::open(wal_path).map_err(|error| format!("无法读取 WAL 快照：{error}"))?;
    let mut header = [0u8; 32];
    wal.read_exact(&mut header)
        .map_err(|_| "WAL 文件头不完整。".to_string())?;
    let magic = u32::from_be_bytes(header[0..4].try_into().unwrap());
    let checksum_little_endian = match magic {
        0x377f_0682 => true,
        0x377f_0683 => false,
        _ => return Err("WAL 文件头 magic 无效。".into()),
    };
    let version = u32::from_be_bytes(header[4..8].try_into().unwrap());
    let page_size = u32::from_be_bytes(header[8..12].try_into().unwrap());
    if version != 3_007_000 || page_size != PAGE_SIZE as u32 {
        return Err("WAL 版本或页大小不受支持。".into());
    }
    let mut checksum = wal_checksum(&header[..24], checksum_little_endian, (0, 0));
    let stored_header_checksum = (
        u32::from_be_bytes(header[24..28].try_into().unwrap()),
        u32::from_be_bytes(header[28..32].try_into().unwrap()),
    );
    if checksum != stored_header_checksum {
        return Err("WAL 文件头校验失败。".into());
    }
    let wal_salt = header[16..24].to_vec();
    let mut frames = Vec::new();
    let mut encountered_invalid_frame = false;
    loop {
        let mut frame_header = [0u8; 24];
        if wal
            .read(&mut frame_header[..1])
            .map_err(|error| error.to_string())?
            == 0
        {
            break;
        }
        if wal.read_exact(&mut frame_header[1..]).is_err() {
            encountered_invalid_frame = true;
            break;
        }
        let mut page = [0u8; PAGE_SIZE];
        if wal.read_exact(&mut page).is_err() {
            encountered_invalid_frame = true;
            break;
        }
        if frame_header[8..16] != wal_salt {
            break;
        }
        let next = wal_checksum(&frame_header[..8], checksum_little_endian, checksum);
        let next = wal_checksum(&page, checksum_little_endian, next);
        let stored = (
            u32::from_be_bytes(frame_header[16..20].try_into().unwrap()),
            u32::from_be_bytes(frame_header[20..24].try_into().unwrap()),
        );
        if next != stored {
            encountered_invalid_frame = true;
            break;
        }
        let page_number = u32::from_be_bytes(frame_header[0..4].try_into().unwrap());
        let commit_pages = u32::from_be_bytes(frame_header[4..8].try_into().unwrap());
        if page_number == 0 || !verify_page_hmac(&keys.authentication, &page, page_number) {
            encountered_invalid_frame = true;
            break;
        }
        checksum = next;
        frames.push((page_number, commit_pages, page));
    }
    let Some(last_commit) = frames
        .iter()
        .rposition(|(_, commit_pages, _)| *commit_pages > 0)
    else {
        return if encountered_invalid_frame {
            Err("WAL 在首个完整提交前校验失败。".into())
        } else {
            Ok(())
        };
    };
    let committed_pages = frames[last_commit].1;
    let mut output = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(database)
        .map_err(|error| format!("无法合并 WAL：{error}"))?;
    for (page_number, _, page) in frames.into_iter().take(last_commit + 1) {
        let plaintext = decrypt_page(&keys.encryption, &page, page_number)?;
        output
            .seek(SeekFrom::Start((page_number as u64 - 1) * PAGE_SIZE as u64))
            .map_err(|error| error.to_string())?;
        output
            .write_all(&plaintext)
            .map_err(|error| error.to_string())?;
    }
    output
        .set_len(committed_pages as u64 * PAGE_SIZE as u64)
        .map_err(|error| error.to_string())?;
    output
        .seek(SeekFrom::Start(28))
        .map_err(|error| error.to_string())?;
    output
        .write_all(&committed_pages.to_be_bytes())
        .map_err(|error| error.to_string())?;
    output.sync_all().map_err(|error| error.to_string())?;
    Ok(())
}

fn wal_checksum(bytes: &[u8], little_endian: bool, mut state: (u32, u32)) -> (u32, u32) {
    for pair in bytes.chunks_exact(8) {
        let first = if little_endian {
            u32::from_le_bytes(pair[0..4].try_into().unwrap())
        } else {
            u32::from_be_bytes(pair[0..4].try_into().unwrap())
        };
        let second = if little_endian {
            u32::from_le_bytes(pair[4..8].try_into().unwrap())
        } else {
            u32::from_be_bytes(pair[4..8].try_into().unwrap())
        };
        state.0 = state.0.wrapping_add(first).wrapping_add(state.1);
        state.1 = state.1.wrapping_add(second).wrapping_add(state.0);
    }
    state
}

fn quick_check(path: &Path) -> bool {
    let Ok(connection) = open_plaintext_database(path) else {
        return false;
    };
    let Ok(mut statement) = connection.prepare("PRAGMA quick_check") else {
        return false;
    };
    let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(0)) else {
        return false;
    };
    let values = rows.flatten().collect::<Vec<_>>();
    !values.is_empty() && values.iter().all(|value| value == "ok")
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use aes::cipher::BlockEncrypt;
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub(in crate::wechat) struct SyntheticDirectory(pub PathBuf);

    impl SyntheticDirectory {
        pub(in crate::wechat) fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "call-footprint-synthetic-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for SyntheticDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn authenticate_page(
        page: &mut [u8; PAGE_SIZE],
        raw_key: &[u8; KEY_SIZE],
        salt: &[u8],
        number: u32,
    ) {
        let keys = derive_database_keys_from_raw(raw_key, salt);
        let mut mac = <HmacSha512 as Mac>::new_from_slice(&*keys.authentication).unwrap();
        let start = if number == 1 { SALT_SIZE } else { 0 };
        let mac_end = PAGE_SIZE - RESERVE_SIZE + 16;
        mac.update(&page[start..mac_end]);
        mac.update(&number.to_le_bytes());
        page[mac_end..].copy_from_slice(&mac.finalize().into_bytes());
    }

    // Every fixture and key is generated locally; no WeChat installation is consulted.
    pub(in crate::wechat) fn synthetic_database(
        path: &Path,
        sql: &str,
        salt: [u8; SALT_SIZE],
        raw_key: [u8; KEY_SIZE],
    ) {
        let plaintext = path.with_extension("fixture-plain");
        let connection = Connection::open(&plaintext).unwrap();
        connection.execute_batch("PRAGMA page_size=4096;").unwrap();
        let mut reserve = RESERVE_SIZE as i32;
        // SQLite allocates the SQLCipher-style reserve before creating any tables.
        let result = unsafe {
            rusqlite::ffi::sqlite3_file_control(
                connection.handle(),
                std::ptr::null(),
                rusqlite::ffi::SQLITE_FCNTL_RESERVE_BYTES,
                (&mut reserve as *mut i32).cast(),
            )
        };
        assert_eq!(result, rusqlite::ffi::SQLITE_OK);
        connection.execute_batch(sql).unwrap();
        connection.close().unwrap();
        let bytes = fs::read(&plaintext).unwrap();
        assert_eq!(bytes[20], RESERVE_SIZE as u8);
        let cipher = Aes256::new_from_slice(&raw_key).unwrap();
        let mut encrypted = Vec::new();
        for (index, source) in bytes.chunks_exact(PAGE_SIZE).enumerate() {
            let number = index as u32 + 1;
            let start = if number == 1 { SALT_SIZE } else { 0 };
            let end = PAGE_SIZE - RESERVE_SIZE;
            let mut page = [0u8; PAGE_SIZE];
            if number == 1 {
                page[..SALT_SIZE].copy_from_slice(&salt);
            }
            let iv = [number as u8; 16];
            page[end..end + 16].copy_from_slice(&iv);
            let mut previous = iv;
            for (input, output) in source[start..end]
                .chunks_exact(16)
                .zip(page[start..end].chunks_exact_mut(16))
            {
                let mut block = aes::Block::clone_from_slice(input);
                for i in 0..16 {
                    block[i] ^= previous[i];
                }
                cipher.encrypt_block(&mut block);
                output.copy_from_slice(&block);
                previous.copy_from_slice(&block);
            }
            authenticate_page(&mut page, &raw_key, &salt, number);
            encrypted.extend_from_slice(&page);
        }
        fs::write(path, encrypted).unwrap();
        fs::remove_file(plaintext).unwrap();
    }

    #[test]
    fn rejects_a_key_verified_for_another_database_salt() {
        let directory = SyntheticDirectory::new();
        let first = directory.0.join("first.db");
        let second = directory.0.join("second.db");
        synthetic_database(
            &first,
            "CREATE TABLE fixture(value);",
            [0x11; 16],
            [0x21; 32],
        );
        synthetic_database(
            &second,
            "CREATE TABLE fixture(value);",
            [0x12; 16],
            [0x22; 32],
        );
        let mut material = KeyMaterial::empty_raw_keyring();
        material
            .insert_verified_raw_key(&first, &[0x21; 32])
            .unwrap();
        assert_eq!(
            material
                .insert_verified_raw_key(&second, &[0x21; 32])
                .unwrap_err(),
            "候选数据库密钥未通过首页认证。"
        );
        assert_eq!(material.raw_key_count(), 1);
        let output = directory.0.join("out.db");
        assert_eq!(
            decrypt_main_database(&second, &output, &material).unwrap_err(),
            "当前数据库没有经过验证的 macOS 密钥。"
        );
        assert!(!output.exists());
        material
            .insert_verified_raw_key(&second, &[0x22; 32])
            .unwrap();
        decrypt_main_database(&second, &output, &material).unwrap();
        assert!(quick_check(&output));
    }

    #[test]
    fn rejects_wrong_resolved_key_and_corrupted_or_truncated_pages() {
        let directory = SyntheticDirectory::new();
        let source = directory.0.join("source.db");
        let output = directory.0.join("out.db");
        let salt = [0x41; 16];
        let key = [0x51; 32];
        synthetic_database(&source, "CREATE TABLE fixture(value);", salt, key);
        let original = fs::read(&source).unwrap();
        assert!(original.len() >= PAGE_SIZE * 2);
        let wrong = KeyMaterial::RawKeysBySalt(HashMap::from([(salt, Zeroizing::new([0x52; 32]))]));
        assert_eq!(
            decrypt_main_database(&source, &output, &wrong).unwrap_err(),
            "数据库首页认证失败。"
        );
        assert!(!output.exists());
        let mut material = KeyMaterial::empty_raw_keyring();
        material.insert_verified_raw_key(&source, &key).unwrap();
        for (length, corrupt, expected) in [
            (PAGE_SIZE - 1, false, "数据库首页不完整。"),
            (PAGE_SIZE + 17, false, "数据库尾页不完整。"),
            (original.len(), true, "数据库第 2 页认证失败。"),
        ] {
            let mut bytes = original[..length].to_vec();
            if corrupt {
                bytes[PAGE_SIZE + 100] ^= 1;
            }
            fs::write(&source, bytes).unwrap();
            assert_eq!(
                decrypt_main_database(&source, &output, &material).unwrap_err(),
                expected
            );
        }
    }

    #[test]
    fn malformed_wal_falls_back_to_an_intact_main_database() {
        let directory = SyntheticDirectory::new();
        let source = directory.0.join("source.db");
        synthetic_database(
            &source,
            "CREATE TABLE fixture(value); INSERT INTO fixture VALUES (42);",
            [0x61; 16],
            [0x71; 32],
        );
        let mut material = KeyMaterial::empty_raw_keyring();
        material
            .insert_verified_raw_key(&source, &[0x71; 32])
            .unwrap();
        fs::write(directory.0.join("source.db-wal"), [0u8; 33]).unwrap();
        let prepared =
            prepare_plaintext_database(&source, &directory.0.join("plain"), &material).unwrap();
        assert!(prepared.wal_omitted);
        let connection = open_plaintext_database(&prepared.path).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT value FROM fixture", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            42
        );
    }

    #[test]
    fn extracts_four_immediates_from_signature() {
        let mut bytes = vec![0x90; 5];
        for value in 0u8..4 {
            bytes.extend([0x48, 0xBA]);
            bytes.extend([value; 8]);
            bytes.extend([0x90; 3]);
        }
        bytes.extend([0x48, 0x85, 0xC0]);
        let (key, _) = match_xor_sequence(&bytes, 5).unwrap();
        assert_eq!(&key[0..8], &[0; 8]);
        assert_eq!(&key[24..32], &[3; 8]);
    }

    #[test]
    fn rejects_incomplete_signature() {
        assert!(match_xor_sequence(&[0x48, 0xBA, 1, 2], 0).is_none());
    }

    #[test]
    fn computes_wal_checksum_in_declared_byte_order() {
        let bytes = [1, 2, 3, 4, 5, 6, 7, 8];
        assert_eq!(
            wal_checksum(&bytes, true, (0, 0)),
            (0x0403_0201, 0x0c0a_0806)
        );
        assert_eq!(
            wal_checksum(&bytes, false, (0, 0)),
            (0x0102_0304, 0x0608_0a0c)
        );
    }

    #[test]
    fn raw_keyring_derives_the_same_page_keys_as_a_passphrase() {
        let salt = [0x31; SALT_SIZE];
        let expected = derive_database_keys(b"test-passphrase", &salt);
        let mut raw_keys = HashMap::new();
        raw_keys.insert(salt, Zeroizing::new(*expected.encryption));
        let material = KeyMaterial::RawKeysBySalt(raw_keys);
        let actual = material.resolve(&salt).unwrap();
        assert_eq!(&*actual.encryption, &*expected.encryption);
        assert_eq!(&*actual.authentication, &*expected.authentication);
    }

    #[test]
    fn raw_keyring_accepts_only_a_key_authenticated_by_the_database() {
        let salt = [0x52; SALT_SIZE];
        let raw_key = [0x27; KEY_SIZE];
        let keys = derive_database_keys_from_raw(&raw_key, &salt);
        let mut page = [0u8; PAGE_SIZE];
        page[..SALT_SIZE].copy_from_slice(&salt);
        let mut mac = <HmacSha512 as Mac>::new_from_slice(&*keys.authentication).unwrap();
        let mac_end = PAGE_SIZE - RESERVE_SIZE + 16;
        mac.update(&page[SALT_SIZE..mac_end]);
        mac.update(&1u32.to_le_bytes());
        page[mac_end..].copy_from_slice(&mac.finalize().into_bytes());

        let directory = std::env::temp_dir().join(format!(
            "call-footprint-keyring-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let database = directory.join("fixture.db");
        fs::write(&database, page).unwrap();

        let mut material = KeyMaterial::empty_raw_keyring();
        assert!(material
            .insert_verified_raw_key(&database, &[0x99; KEY_SIZE])
            .is_err());
        material
            .insert_verified_raw_key(&database, &raw_key)
            .unwrap();
        assert_eq!(material.raw_key_count(), 1);
        let _ = fs::remove_dir_all(directory);
    }
}
