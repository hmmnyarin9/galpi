use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub body: String,
    pub next_action: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub reminder_enabled: bool,
    pub reminder_time: String,
    #[serde(default = "default_shortcut")]
    pub quick_capture_shortcut: String,
    #[serde(default)]
    pub launch_at_startup: bool,
    #[serde(default)]
    pub start_minimized: bool,
}

pub fn default_shortcut() -> String { "Ctrl+Alt+G".into() }

pub fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS entries (
           id TEXT PRIMARY KEY, body TEXT NOT NULL, next_action TEXT NOT NULL,
           created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
}

pub fn entries(db: &Connection) -> rusqlite::Result<Vec<Entry>> {
    let mut stmt = db.prepare("SELECT id,body,next_action,created_at FROM entries ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], |row| {
        Ok(Entry {
            id: row.get(0)?, body: row.get(1)?, next_action: row.get(2)?, created_at: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn insert(db: &Connection, body: String, next_action: String) -> Result<Entry, String> {
    let (body, next_action) = validate_entry(body, next_action)?;
    let entry = Entry {
        id: Uuid::new_v4().to_string(), body, next_action,
        created_at: Local::now().to_rfc3339(),
    };
    db.execute("INSERT INTO entries VALUES (?1,?2,?3,?4)", params![entry.id, entry.body, entry.next_action, entry.created_at])
        .map_err(|e| e.to_string())?;
    Ok(entry)
}

fn validate_entry(body: String, next_action: String) -> Result<(String, String), String> {
    let body = body.trim().to_string();
    let next_action = next_action.trim().to_string();
    if body.is_empty() { return Err("한 줄을 적어주세요.".into()); }
    if body.chars().count() > 20000 || next_action.chars().count() > 2000 {
        return Err("기록은 20,000자, 다음에 할 일은 2,000자까지 저장할 수 있어요.".into());
    }
    Ok((body, next_action))
}

pub fn update(db: &Connection, id: String, body: String, next_action: String) -> Result<Entry, String> {
    let (body, next_action) = validate_entry(body, next_action)?;
    let changed = db.execute(
        "UPDATE entries SET body=?1,next_action=?2 WHERE id=?3",
        params![body, next_action, id],
    ).map_err(|e| e.to_string())?;
    if changed == 0 { return Err("기록을 찾지 못했어요. 목록을 다시 불러와주세요.".into()); }
    db.query_row("SELECT id,body,next_action,created_at FROM entries WHERE id=?1", [id], |row| {
        Ok(Entry { id: row.get(0)?, body: row.get(1)?, next_action: row.get(2)?, created_at: row.get(3)? })
    }).map_err(|e| e.to_string())
}

pub fn settings(db: &Connection) -> Result<Settings, String> {
    use rusqlite::OptionalExtension;
    let value: Option<String> = db.query_row("SELECT value FROM preferences WHERE key='settings'", [], |row| row.get(0))
        .optional().map_err(|e| e.to_string())?;
    match value {
        Some(value) => serde_json::from_str(&value).map_err(|e| e.to_string()),
        None => Ok(Settings { reminder_enabled: false, reminder_time: "18:00".into(), quick_capture_shortcut: default_shortcut(), launch_at_startup: false, start_minimized: false }),
    }
}

pub fn save_settings(db: &Connection, settings: &Settings) -> Result<(), String> {
    validate_settings(settings)?;
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    db.execute("INSERT OR REPLACE INTO preferences VALUES ('settings',?1)", [json]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn validate_settings(settings: &Settings) -> Result<(), String> {
    let time = chrono::NaiveTime::parse_from_str(&settings.reminder_time, "%H:%M")
        .map_err(|_| "올바른 알림 시간을 선택해주세요.".to_string())?;
    if time.format("%H:%M").to_string() != settings.reminder_time {
        return Err("알림 시간은 HH:MM 형식이어야 해요.".into());
    }
    crate::shortcuts::validate(&settings.quick_capture_shortcut)?;
    Ok(())
}

// A persisted claim prevents duplicate reminders even after an app restart.
pub fn claim_reminder(db: &Connection, now: &chrono::DateTime<Local>) -> Result<bool, String> {
    let settings = settings(db)?;
    if !settings.reminder_enabled || now.format("%H:%M").to_string() != settings.reminder_time {
        return Ok(false);
    }
    let date = now.format("%Y-%m-%d").to_string();
    let changed = db.execute(
        "INSERT INTO preferences (key,value) VALUES ('last_reminder',?1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value <> excluded.value", [date],
    ).map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn records_roundtrip_and_empty_input_is_rejected() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        assert!(insert(&db, "  \n".into(), "".into()).is_err());
        let saved = insert(&db, "  한글 기록\n두 번째 줄  ".into(), " 내일 이어가기 ".into()).unwrap();
        let loaded = entries(&db).unwrap();
        assert_eq!(loaded[0].id, saved.id);
        assert_eq!(loaded[0].body, "한글 기록\n두 번째 줄");
        assert_eq!(loaded[0].next_action, "내일 이어가기");
    }

    #[test]
    fn editing_preserves_identity_date_and_other_records() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let first = insert(&db, "처음 기록".into(), "다음 행동".into()).unwrap();
        let second = insert(&db, "다른 기록".into(), "".into()).unwrap();
        let edited = update(&db, first.id.clone(), " 수정한 기록\n두 줄 ".into(), "".into()).unwrap();
        assert_eq!(edited.id, first.id);
        assert_eq!(edited.created_at, first.created_at);
        assert_eq!(edited.body, "수정한 기록\n두 줄");
        assert_eq!(edited.next_action, "");
        let loaded = entries(&db).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded.iter().find(|entry| entry.id == first.id).unwrap().body, edited.body);
        assert_eq!(loaded.iter().find(|entry| entry.id == second.id).unwrap().body, second.body);
    }

    #[test]
    fn invalid_edits_do_not_change_saved_content() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let saved = insert(&db, "남겨둘 기록".into(), "다음".into()).unwrap();
        assert!(update(&db, saved.id.clone(), " \n".into(), "".into()).is_err());
        assert!(update(&db, saved.id.clone(), "가".repeat(20001), "".into()).is_err());
        assert!(update(&db, saved.id.clone(), "수정".into(), "가".repeat(2001)).is_err());
        assert!(update(&db, "missing".into(), "기록".into(), "".into()).is_err());
        let loaded = entries(&db).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].body, saved.body);
        assert_eq!(loaded[0].next_action, saved.next_action);
    }

    #[test]
    fn reminder_is_opt_in_and_only_claimed_once_per_day() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let now = Local.with_ymd_and_hms(2026, 10, 28, 18, 0, 10).unwrap();
        assert!(!claim_reminder(&db, &now).unwrap());
        save_settings(&db, &Settings { reminder_enabled: true, reminder_time: "18:00".into(), quick_capture_shortcut: default_shortcut(), launch_at_startup: false, start_minimized: false }).unwrap();
        assert!(claim_reminder(&db, &now).unwrap());
        assert!(!claim_reminder(&db, &now).unwrap());
        assert!(claim_reminder(&db, &(now + chrono::Duration::days(1))).unwrap());
        assert!(!claim_reminder(&db, &(now + chrono::Duration::minutes(1))).unwrap());
        assert!(save_settings(&db, &Settings { reminder_enabled: true, reminder_time: "25:00".into(), quick_capture_shortcut: default_shortcut(), launch_at_startup: false, start_minimized: false }).is_err());
    }

    #[test]
    fn a_corrupt_setting_is_reported_not_overwritten() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        db.execute("INSERT INTO preferences VALUES ('settings', 'broken')", []).unwrap();
        assert!(settings(&db).is_err());
    }
}
