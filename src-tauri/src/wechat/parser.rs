use super::{
    crypto, Account, AppDataset, CallEvent, Contact, ContactSnapshot, CoverageInterval,
    DatasetSource, EventLineage, SourceRef,
};
use crate::wechat::discovery::{WechatAccount, WechatSnapshot};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{FixedOffset, TimeZone, Utc};
use md5::{Digest as Md5Digest, Md5};
use rusqlite::Connection;
use sha2::Sha256;
use std::{
    collections::{HashMap, HashSet},
    io::Read,
};

#[cfg(windows)]
const ADAPTER_ID: &str = "wechat-windows-4x";
#[cfg(target_os = "macos")]
const ADAPTER_ID: &str = "wechat-macos-4x";
#[cfg(not(any(windows, target_os = "macos")))]
const ADAPTER_ID: &str = "wechat-unsupported";
const ADAPTER_VERSION: &str = "0.2.0";
const PARSER_VERSION: &str = "1.1.0";
const DEDUP_VERSION: &str = "1.0.0";
const TIMEZONE: &str = "Asia/Shanghai";
const UTC_OFFSET_MINUTES: i32 = 480;
const MAX_AVATAR_BYTES: usize = 2 * 1024 * 1024;

pub struct ParsedSnapshot {
    pub dataset: AppDataset,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug)]
struct ContactRecord {
    display_name: String,
    wechat_id: String,
    kind: &'static str,
}

#[derive(Debug)]
struct ParsedCall {
    event: CallEvent,
    username: String,
}

pub fn parse_snapshot(
    snapshot: &WechatSnapshot,
    account: &WechatAccount,
    key_material: &crypto::KeyMaterial,
    wechat_version: &str,
) -> Result<ParsedSnapshot, String> {
    let normalized_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let account_id = opaque_hash("acc", account.account_wxid.as_bytes());
    let source_id = opaque_hash("source", account.account_name.as_bytes());
    let plaintext_dir = snapshot.root.join("plaintext");
    let (contacts, contact_wal_omitted) =
        load_contacts(&snapshot.contact_database, &plaintext_dir, key_material)?;
    let account_display_name = resolve_account_display_name(account, &contacts);
    let mut warnings = Vec::new();
    let mut parsed_calls = Vec::new();
    let mut dedup = HashSet::new();
    let mut failed_shards = 0usize;
    let mut partial_shards = 0usize;

    for database in &snapshot.message_databases {
        match parse_message_database(
            database,
            &plaintext_dir,
            key_material,
            account,
            &contacts,
            &account_id,
            &source_id,
            &normalized_at,
            &mut dedup,
        ) {
            Ok((mut calls, wal_omitted)) => {
                parsed_calls.append(&mut calls);
                if wal_omitted {
                    partial_shards += 1;
                }
            }
            Err(_) => failed_shards += 1,
        }
    }
    if failed_shards > 0 {
        warnings.push("部分较早的通话记录暂时无法读取，统计结果可能不完整。".into());
    }
    if partial_shards > 0 {
        warnings.push("最近的部分通话记录可能还未包含在本次统计中。".into());
    }
    if contact_wal_omitted {
        warnings.push("少量最近联系人名称可能尚未更新。".into());
    }
    if parsed_calls.is_empty() {
        return Err("没有找到可显示的微信通话记录。".into());
    }

    parsed_calls.sort_by(|left, right| right.event.started_at.cmp(&left.event.started_at));
    let used_usernames = parsed_calls
        .iter()
        .map(|call| call.username.as_str())
        .collect::<HashSet<_>>();
    let mut avatar_usernames = used_usernames.clone();
    avatar_usernames.insert(account.account_wxid.as_str());
    let (avatars, avatar_wal_omitted) = match snapshot.head_image_database.as_ref() {
        Some(database) => {
            match load_local_avatars(database, &plaintext_dir, key_material, &avatar_usernames) {
                Ok(result) => result,
                Err(_) => {
                    warnings.push("部分头像暂时无法显示，已使用名称首字代替。".into());
                    (HashMap::new(), false)
                }
            }
        }
        None => (HashMap::new(), false),
    };
    if avatar_wal_omitted {
        warnings.push("部分最近头像可能尚未更新。".into());
    }
    let mut canonical_contacts = Vec::new();
    for username in used_usernames {
        let record = contacts
            .get(username)
            .cloned()
            .unwrap_or_else(|| fallback_contact(username));
        let contact_id = opaque_hash("contact", username.as_bytes());
        let times = parsed_calls
            .iter()
            .filter(|call| call.username == username)
            .filter_map(|call| call.event.started_at.clone())
            .collect::<Vec<_>>();
        canonical_contacts.push(Contact {
            id: contact_id,
            account_id: account_id.clone(),
            kind: record.kind,
            display_name: record.display_name,
            wechat_id: Some(record.wechat_id),
            avatar_ref: avatars.get(username).cloned(),
            aliases: Vec::new(),
            identity_confidence: if contacts.contains_key(username) {
                "confirmed"
            } else {
                "inferred"
            },
            needs_review: !contacts.contains_key(username),
            merged_from_contact_ids: Vec::new(),
            first_call_at: times.iter().min().cloned(),
            last_call_at: times.iter().max().cloned(),
        });
    }
    canonical_contacts.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    let events = parsed_calls
        .into_iter()
        .map(|call| call.event)
        .collect::<Vec<_>>();
    let dates = events
        .iter()
        .filter_map(|event| event.started_at.as_ref()?.get(0..10).map(str::to_owned))
        .collect::<Vec<_>>();
    let coverage = match (dates.iter().min(), dates.iter().max()) {
        (Some(start), Some(end)) => vec![CoverageInterval {
            start_date: start.clone(),
            end_date: end.clone(),
            state: if failed_shards == 0 && partial_shards == 0 {
                "complete"
            } else {
                "partial"
            },
            source_ids: vec![source_id],
            reason_code: if failed_shards > 0 {
                Some("message_shard_parse_failed".into())
            } else if partial_shards > 0 {
                Some("wal_omitted_after_validation".into())
            } else {
                None
            },
        }],
        _ => Vec::new(),
    };

    Ok(ParsedSnapshot {
        dataset: AppDataset {
            format: "call-footprint-export",
            format_version: "1.0",
            contract_version: "1.0",
            exported_at: normalized_at,
            timezone: TIMEZONE.into(),
            source: DatasetSource {
                kind: "normalized_file",
                display_name: "微信通话记录".into(),
                source_version: Some(wechat_version.to_owned()),
            },
            account: Account {
                id: account_id,
                display_name: account_display_name,
                avatar_ref: avatars.get(&account.account_wxid).cloned(),
            },
            contacts: canonical_contacts,
            events,
            coverage,
        },
        warnings,
    })
}

fn load_contacts(
    path: &std::path::Path,
    plaintext_dir: &std::path::Path,
    key_material: &crypto::KeyMaterial,
) -> Result<(HashMap<String, ContactRecord>, bool), String> {
    let plaintext = crypto::prepare_plaintext_database(path, plaintext_dir, key_material)?;
    let connection = crypto::open_plaintext_database(&plaintext.path)?;
    let mut statement = connection
        .prepare("SELECT username, alias, nick_name, remark, local_type FROM contact WHERE username IS NOT NULL")
        .map_err(|_| "联系人数据库结构与当前适配器不兼容。".to_string())?;
    let rows = statement
        .query_map([], |row| {
            let username: String = row.get(0)?;
            let alias: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let nickname: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
            let remark: String = row.get::<_, Option<String>>(3)?.unwrap_or_default();
            let local_type: i64 = row.get::<_, Option<i64>>(4)?.unwrap_or_default();
            Ok((username, alias, nickname, remark, local_type))
        })
        .map_err(|error| format!("无法读取联系人索引：{error}"))?;
    let mut result = HashMap::new();
    for row in rows {
        let (username, alias, nickname, remark, _local_type) =
            row.map_err(|_| "联系人记录包含无法解码的字段。".to_string())?;
        let display_name = [&remark, &nickname, &alias, &username]
            .into_iter()
            .find(|value| !value.trim().is_empty())
            .unwrap_or(&username)
            .trim()
            .to_owned();
        let kind = contact_kind(&username);
        result.insert(
            username.clone(),
            ContactRecord {
                display_name,
                wechat_id: username,
                kind,
            },
        );
    }
    Ok((result, plaintext.wal_omitted))
}

fn load_local_avatars(
    path: &std::path::Path,
    plaintext_dir: &std::path::Path,
    key_material: &crypto::KeyMaterial,
    usernames: &HashSet<&str>,
) -> Result<(HashMap<String, String>, bool), String> {
    let plaintext = crypto::prepare_plaintext_database(path, plaintext_dir, key_material)?;
    let connection = crypto::open_plaintext_database(&plaintext.path)?;
    let mut statement = connection
        .prepare("SELECT username, image_buffer FROM head_image WHERE username IS NOT NULL AND image_buffer IS NOT NULL")
        .map_err(|_| "头像数据库结构与当前适配器不兼容。".to_string())?;
    let rows = statement
        .query_map([], |row| {
            let username: String = row.get(0)?;
            let image: Vec<u8> = row.get(1)?;
            Ok((username, image))
        })
        .map_err(|error| format!("无法读取本机头像索引：{error}"))?;
    let mut avatars = HashMap::new();
    for row in rows {
        let (username, image) = row.map_err(|_| "头像记录包含无法解码的字段。".to_string())?;
        if !usernames.contains(username.as_str()) {
            continue;
        }
        if let Some(data_url) = avatar_data_url(&image) {
            avatars.insert(username, data_url);
        }
    }
    Ok((avatars, plaintext.wal_omitted))
}

fn avatar_data_url(image: &[u8]) -> Option<String> {
    if image.is_empty() || image.len() > MAX_AVATAR_BYTES {
        return None;
    }
    let mime = if image.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if image.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if image.starts_with(b"GIF87a") || image.starts_with(b"GIF89a") {
        "image/gif"
    } else if image.len() >= 12 && image.starts_with(b"RIFF") && &image[8..12] == b"WEBP" {
        "image/webp"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", BASE64.encode(image)))
}

fn parse_message_database(
    path: &std::path::Path,
    plaintext_dir: &std::path::Path,
    key_material: &crypto::KeyMaterial,
    account: &WechatAccount,
    contacts: &HashMap<String, ContactRecord>,
    account_id: &str,
    source_id: &str,
    normalized_at: &str,
    dedup: &mut HashSet<String>,
) -> Result<(Vec<ParsedCall>, bool), String> {
    let plaintext = crypto::prepare_plaintext_database(path, plaintext_dir, key_material)?;
    let connection = crypto::open_plaintext_database(&plaintext.path)?;
    let sender_names = load_name2id(&connection)?;
    let self_identity_confirmed = sender_names
        .values()
        .any(|value| value == &account.account_wxid);
    let partition = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("message")
        .to_owned();
    let mut result = Vec::new();
    for username in sender_names.values().collect::<HashSet<_>>() {
        let table = message_table(username);
        if !table_exists(&connection, &table)? {
            continue;
        }
        let columns = table_columns(&connection, &table)?;
        if !columns.contains("local_type")
            || !columns.contains("create_time")
            || !columns.contains("message_content")
        {
            continue;
        }
        let server_expression = if columns.contains("server_id") {
            "server_id"
        } else {
            "0"
        };
        let sender_expression = if columns.contains("real_sender_id") {
            "real_sender_id"
        } else {
            "0"
        };
        let compression_expression = if columns.contains("WCDB_CT_message_content") {
            "COALESCE(WCDB_CT_message_content, 0)"
        } else {
            "0"
        };
        let compressed_expression = if columns.contains("compress_content") {
            "CAST(compress_content AS BLOB)"
        } else {
            "NULL"
        };
        let sql = format!(
            "SELECT local_id, {server_expression}, local_type, create_time, {sender_expression}, CAST(message_content AS BLOB), {compression_expression}, {compressed_expression} FROM [{table}] WHERE (local_type & 4294967295) = 50 ORDER BY create_time"
        );
        let mut statement = connection
            .prepare(&sql)
            .map_err(|_| "无法读取通话消息表。".to_string())?;
        let mut rows = statement
            .query([])
            .map_err(|_| "无法遍历通话消息。".to_string())?;
        while let Some(row) = rows.next().map_err(|_| "读取通话消息失败。".to_string())? {
            let field_error = |_| "通话记录包含无法解码的字段。".to_string();
            let local_id = row.get::<_, i64>(0).map_err(field_error)?;
            let server_id = row.get::<_, i64>(1).map_err(field_error)?;
            let create_time = row.get::<_, i64>(3).map_err(field_error)?;
            let real_sender_id = row.get::<_, i64>(4).map_err(field_error)?;
            let content = row
                .get::<_, Option<Vec<u8>>>(5)
                .map_err(field_error)?
                .unwrap_or_default();
            let compression = row.get::<_, i64>(6).map_err(field_error)?;
            let compressed = row
                .get::<_, Option<Vec<u8>>>(7)
                .map_err(field_error)?
                .unwrap_or_default();
            let decoded = if content.is_empty() && !compressed.is_empty() {
                decode_content(&compressed, 4)
            } else {
                decode_content(&content, compression)
            };
            let dedup_confirmed = server_id != 0;
            let fingerprint = if dedup_confirmed {
                format!("server:{account_id}:{username}:{server_id}")
            } else {
                opaque_hash(
                    "record",
                    format!(
                        "{account_id}:{username}:{create_time}:{partition}:{local_id}:{decoded}"
                    )
                    .as_bytes(),
                )
            };
            if !dedup.insert(fingerprint.clone()) {
                continue;
            }
            let sender_username = sender_names.get(&real_sender_id).map(String::as_str);
            result.push(build_call(
                account,
                contacts,
                username,
                sender_username,
                self_identity_confirmed,
                dedup_confirmed,
                create_time,
                &decoded,
                account_id,
                source_id,
                &partition,
                &fingerprint,
                normalized_at,
            ));
        }
    }
    Ok((result, plaintext.wal_omitted))
}

fn load_name2id(connection: &Connection) -> Result<HashMap<i64, String>, String> {
    let mut statement = connection
        .prepare("SELECT rowid, user_name FROM Name2Id WHERE user_name IS NOT NULL")
        .map_err(|_| "消息数据库缺少 Name2Id 映射。".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "无法读取消息发送者映射。".to_string())?;
    rows.map(|row| row.map_err(|_| "Name2Id 包含无法解码的记录。".to_string()))
        .collect()
}

fn message_table(username: &str) -> String {
    let mut hasher = Md5::new();
    Md5Digest::update(&mut hasher, username.as_bytes());
    format!("Msg_{:x}", hasher.finalize())
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| "无法检查消息表结构。".to_string())
}

fn table_columns(connection: &Connection, table: &str) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info([{table}])"))
        .map_err(|_| "无法检查消息字段。".to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|_| "无法读取消息字段。".to_string())?;
    rows.map(|row| row.map_err(|_| "消息表字段名无法解码。".to_string()))
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn build_call(
    account: &WechatAccount,
    contacts: &HashMap<String, ContactRecord>,
    username: &str,
    sender_username: Option<&str>,
    self_identity_confirmed: bool,
    dedup_confirmed: bool,
    create_time: i64,
    content: &str,
    account_id: &str,
    source_id: &str,
    partition: &str,
    fingerprint: &str,
    normalized_at: &str,
) -> ParsedCall {
    let contact = contacts
        .get(username)
        .cloned()
        .unwrap_or_else(|| fallback_contact(username));
    let contact_id = opaque_hash("contact", username.as_bytes());
    let direction = match sender_username {
        Some(sender) if self_identity_confirmed && sender == account.account_wxid => "outgoing",
        Some(_) if self_identity_confirmed => "incoming",
        _ => "unknown",
    };
    let call = parse_call_payload(content, direction);
    let (started_at, answered_at, ended_at) = derive_call_times(create_time, call.duration);
    let mut quality_flags = Vec::new();
    if started_at.is_none() {
        quality_flags.push("missing_start_time");
    }
    if call.duration.is_none() {
        quality_flags.push("missing_duration");
    }
    if call.media_type == "unknown" {
        quality_flags.push("unknown_media_type");
    }
    if direction == "unknown" {
        quality_flags.push("unknown_direction");
    }
    if call.outcome == "unknown" {
        quality_flags.push("unknown_outcome");
    }
    if !contacts.contains_key(username) {
        quality_flags.push("unknown_contact");
    }
    if !dedup_confirmed {
        quality_flags.push("possible_duplicate");
    }
    let event_seed = fingerprint.to_owned();
    ParsedCall {
        username: username.to_owned(),
        event: CallEvent {
            id: opaque_hash("evt", event_seed.as_bytes()),
            account_id: account_id.to_owned(),
            contact_id: Some(contact_id),
            contact_snapshot: ContactSnapshot {
                display_name: Some(contact.display_name),
                kind: contact.kind,
            },
            conversation_id: Some(opaque_hash("conversation", username.as_bytes())),
            started_at,
            answered_at,
            ended_at,
            timezone: Some(TIMEZONE.into()),
            utc_offset_minutes: Some(UTC_OFFSET_MINUTES),
            connected_duration_seconds: call.duration,
            media_type: call.media_type,
            direction,
            outcome: call.outcome,
            parse_confidence: if call.duration.unwrap_or(0) > 0 {
                "inferred"
            } else {
                call.confidence
            },
            identity_confidence: if contacts.contains_key(username) {
                "confirmed"
            } else {
                "inferred"
            },
            dedup_confidence: if dedup_confirmed {
                "confirmed"
            } else {
                "inferred"
            },
            quality_flags,
            excluded: false,
            lineage: EventLineage {
                source_refs: vec![SourceRef {
                    source_id: source_id.to_owned(),
                    source_record_id_hash: format!(
                        "sha256:{}",
                        digest_hex(fingerprint.as_bytes(), 24)
                    ),
                    source_database_kind: "wechat_4_message",
                    source_partition: Some(partition.to_owned()),
                }],
                adapter_id: ADAPTER_ID,
                adapter_version: ADAPTER_VERSION,
                parser_version: PARSER_VERSION,
                dedup_version: DEDUP_VERSION,
                normalized_at: normalized_at.to_owned(),
            },
        },
    }
}

struct CallPayload {
    duration: Option<u64>,
    media_type: &'static str,
    outcome: &'static str,
    confidence: &'static str,
}

fn parse_call_payload(content: &str, direction: &str) -> CallPayload {
    let message = xml_value(content, "msg").unwrap_or_else(|| collapse_text(content));
    let normalized = message.to_ascii_lowercase();
    let duration = parse_duration(&message)
        .or_else(|| xml_value(content, "duration").and_then(|value| parse_duration(&value)));
    let room_type =
        xml_value(content, "room_type").and_then(|value| value.trim().parse::<i64>().ok());
    let media_type =
        if normalized.contains("video") || content.to_ascii_lowercase().contains("video") {
            "video"
        } else if normalized.contains("voice") || normalized.contains("audio") {
            "voice"
        } else {
            match room_type {
                Some(0) => "video",
                Some(1) => "voice",
                _ => "unknown",
            }
        };
    let outcome = if normalized.contains("line busy")
        || normalized.contains("busy")
        || normalized.contains("忙线")
    {
        "busy"
    } else if normalized.contains("reject") || normalized.contains("拒绝") {
        "rejected"
    } else if normalized.contains("not answered")
        || normalized.contains("wasn't answered")
        || normalized.contains("未接听")
        || normalized.contains("无应答")
    {
        if direction == "incoming" {
            "missed"
        } else {
            "unknown"
        }
    } else if normalized.contains("cancel") || normalized.contains("取消") {
        if direction == "outgoing" {
            "cancelled_by_self"
        } else if direction == "incoming" {
            "cancelled_by_peer"
        } else {
            "unknown"
        }
    } else if normalized.contains("interrupt")
        || normalized.contains("disconnected")
        || normalized.contains("中断")
    {
        "interrupted"
    } else if normalized.contains("fail") || normalized.contains("失败") {
        "failed"
    } else if duration.is_some()
        || normalized.starts_with("duration:")
        || normalized.contains("通话时长")
    {
        "completed"
    } else {
        "unknown"
    };
    let definitely_not_connected = matches!(
        outcome,
        "missed" | "cancelled_by_self" | "cancelled_by_peer" | "rejected" | "busy" | "failed"
    );
    CallPayload {
        duration: duration.or_else(|| definitely_not_connected.then_some(0)),
        media_type,
        outcome,
        confidence: if outcome != "unknown" {
            "confirmed"
        } else {
            "inferred"
        },
    }
}

fn decode_content(content: &[u8], compression: i64) -> String {
    if content.is_empty() {
        return String::new();
    }
    if compression == 4 || content.starts_with(&[0x28, 0xB5, 0x2F, 0xFD]) {
        if let Ok(decoder) = zstd::stream::read::Decoder::new(content) {
            let mut decoded = Vec::with_capacity(4096);
            if decoder
                .take(256 * 1024 + 1)
                .read_to_end(&mut decoded)
                .is_ok()
                && decoded.len() <= 256 * 1024
            {
                return String::from_utf8_lossy(&decoded).into_owned();
            }
        }
        return String::new();
    }
    String::from_utf8_lossy(content).into_owned()
}

fn parse_duration(value: &str) -> Option<u64> {
    let value = value
        .split_once(':')
        .filter(|(prefix, _)| prefix.trim().eq_ignore_ascii_case("duration"))
        .map(|(_, rest)| rest)
        .unwrap_or(value)
        .trim();
    let clean = value
        .split(|character: char| !character.is_ascii_digit() && character != ':')
        .find(|part| {
            part.contains(':')
                || (!part.is_empty() && part.chars().all(|character| character.is_ascii_digit()))
        })?;
    let parts = clean
        .split(':')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    match parts.as_slice() {
        [seconds] => Some(if *seconds > 86_400 {
            seconds / 1000
        } else {
            *seconds
        }),
        [minutes, seconds] if *seconds < 60 => Some(minutes * 60 + seconds),
        [hours, minutes, seconds] if *minutes < 60 && *seconds < 60 => {
            Some(hours * 3600 + minutes * 60 + seconds)
        }
        _ => None,
    }
}

fn xml_value(content: &str, tag: &str) -> Option<String> {
    let lower = content.to_ascii_lowercase();
    if content.len() > 256 * 1024 || lower.contains("<!doctype") || lower.contains("<!entity") {
        return None;
    }
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = content.rfind(&open)? + open.len();
    let end = content[start..].find(&close)? + start;
    Some(
        content[start..end]
            .trim()
            .trim_start_matches("<![CDATA[")
            .trim_end_matches("]]>")
            .trim()
            .to_owned(),
    )
}

fn collapse_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn derive_call_times(
    bubble_time: i64,
    connected_duration: Option<u64>,
) -> (Option<String>, Option<String>, Option<String>) {
    let ended_at = format_timestamp(bubble_time);
    let answered_at = connected_duration
        .filter(|duration| *duration > 0)
        .and_then(|duration| i64::try_from(duration).ok())
        .and_then(|duration| bubble_time.checked_sub(duration))
        .and_then(format_timestamp);
    let started_at = answered_at.clone().or_else(|| ended_at.clone());
    (started_at, answered_at, ended_at)
}

fn format_timestamp(timestamp: i64) -> Option<String> {
    let offset = FixedOffset::east_opt(UTC_OFFSET_MINUTES * 60)?;
    offset
        .timestamp_opt(timestamp, 0)
        .single()
        .map(|value| value.to_rfc3339())
}

fn resolve_account_display_name(
    account: &WechatAccount,
    contacts: &HashMap<String, ContactRecord>,
) -> String {
    contacts
        .get(&account.account_wxid)
        .map(|record| record.display_name.trim())
        .filter(|name| {
            !name.is_empty()
                && *name != account.account_wxid
                && *name != account.account_name
                && *name != "未知联系人"
        })
        .map(str::to_owned)
        .unwrap_or_else(|| "微信用户".into())
}

fn fallback_contact(username: &str) -> ContactRecord {
    ContactRecord {
        display_name: "未知联系人".into(),
        wechat_id: username.to_owned(),
        kind: contact_kind(username),
    }
}

fn contact_kind(username: &str) -> &'static str {
    if username.ends_with("@chatroom") {
        "group"
    } else if username.starts_with("gh_") {
        "official"
    } else {
        "person"
    }
}

fn opaque_hash(prefix: &str, value: &[u8]) -> String {
    format!("{prefix}_{}", digest_hex(value, 24))
}

fn digest_hex(value: &[u8], length: usize) -> String {
    let digest = Sha256::digest(value);
    hex::encode(digest).chars().take(length).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_account_name_from_self_contact() {
        let account = WechatAccount {
            account_name: "wxid_owner_1234".into(),
            account_wxid: "wxid_owner".into(),
            message_databases: Vec::new(),
            contact_database: std::path::PathBuf::new(),
            head_image_database: None,
        };
        let contacts = HashMap::from([(
            "wxid_owner".into(),
            ContactRecord {
                display_name: "微信昵称".into(),
                wechat_id: "wxid_owner".into(),
                kind: "person",
            },
        )]);
        assert_eq!(
            resolve_account_display_name(&account, &contacts),
            "微信昵称"
        );
    }

    #[test]
    fn uses_neutral_account_name_when_self_contact_is_missing() {
        let account = WechatAccount {
            account_name: "wxid_owner_1234".into(),
            account_wxid: "wxid_owner".into(),
            message_databases: Vec::new(),
            contact_database: std::path::PathBuf::new(),
            head_image_database: None,
        };
        assert_eq!(
            resolve_account_display_name(&account, &HashMap::new()),
            "微信用户"
        );
    }

    #[test]
    fn parses_completed_duration() {
        let payload = parse_call_payload(
            "<voiplocalinfo><room_type>1</room_type><msg>Duration: 01:23</msg></voiplocalinfo>",
            "outgoing",
        );
        assert_eq!(payload.duration, Some(83));
        assert_eq!(payload.media_type, "voice");
        assert_eq!(payload.outcome, "completed");
    }

    #[test]
    fn maps_cancel_direction() {
        assert_eq!(
            parse_call_payload("<voip><msg>Canceled</msg></voip>", "outgoing").outcome,
            "cancelled_by_self"
        );
        assert_eq!(
            parse_call_payload("<voip><msg>Canceled</msg></voip>", "incoming").outcome,
            "cancelled_by_peer"
        );
    }

    #[test]
    fn parses_wrapped_chinese_call_payloads() {
        let voice = parse_call_payload(
            "<msg><voipmsg type=\"VoIPBubbleMsg\"><VoIPBubbleMsg><msg><![CDATA[通话时长 00:19]]></msg><room_type>1</room_type></VoIPBubbleMsg></voipmsg></msg>",
            "incoming",
        );
        assert_eq!(voice.duration, Some(19));
        assert_eq!(voice.media_type, "voice");
        assert_eq!(voice.outcome, "completed");
        assert_eq!(
            parse_call_payload(
                "<msg><msg>对方无应答</msg><room_type>0</room_type></msg>",
                "incoming"
            )
            .outcome,
            "missed"
        );
        assert_eq!(
            parse_call_payload(
                "<msg><msg>对方已拒绝</msg><room_type>0</room_type></msg>",
                "outgoing"
            )
            .outcome,
            "rejected"
        );
    }

    #[test]
    fn derives_connected_start_from_bubble_end_time() {
        let offset = FixedOffset::east_opt(UTC_OFFSET_MINUTES * 60).unwrap();
        let bubble = offset
            .with_ymd_and_hms(2026, 10, 13, 23, 5, 57)
            .unwrap()
            .timestamp();
        let (started, answered, ended) = derive_call_times(bubble, Some(7_455));
        assert_eq!(started.as_deref(), Some("2026-10-13T21:01:42+08:00"));
        assert_eq!(answered, started);
        assert_eq!(ended.as_deref(), Some("2026-10-13T23:05:57+08:00"));
    }

    #[test]
    fn assigns_cross_midnight_calls_to_their_actual_start_date() {
        let offset = FixedOffset::east_opt(UTC_OFFSET_MINUTES * 60).unwrap();
        let bubble = offset
            .with_ymd_and_hms(2026, 10, 7, 0, 43, 31)
            .unwrap()
            .timestamp();
        let (started, _, ended) = derive_call_times(bubble, Some(8_249));
        assert_eq!(started.as_deref(), Some("2026-10-06T22:26:02+08:00"));
        assert_eq!(ended.as_deref(), Some("2026-10-07T00:43:31+08:00"));
    }

    #[test]
    fn accepts_supported_avatar_images_only() {
        assert_eq!(
            avatar_data_url(&[0xff, 0xd8, 0xff, 0x01]),
            Some("data:image/jpeg;base64,/9j/AQ==".into())
        );
        assert!(avatar_data_url(b"not-an-image").is_none());
        assert!(avatar_data_url(&vec![0; MAX_AVATAR_BYTES + 1]).is_none());
    }

    #[test]
    fn hashes_table_name_like_wechat() {
        assert_eq!(
            message_table("wxid_demo"),
            "Msg_91c643c0df23090fde26ef5e9c7309ac"
        );
    }
}
