use rusqlite::{Connection, OpenFlags};
use std::path::Path;

// Copy through SQLite so committed records in a WAL are included. Publish only
// after validation; the original database is kept as a recovery copy.
pub fn migrate(legacy: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() || !legacy.exists() { return Ok(()); }
    let parent = destination.parent().ok_or("저장 경로를 확인해주세요.")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let staging = parent.join(format!(".migration-{}.sqlite3", uuid::Uuid::new_v4()));
    let result = (|| {
        let source = Connection::open_with_flags(legacy, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
        source.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        source.backup("main", &staging, None).map_err(|e| e.to_string())?;
        {
            let copied = Connection::open(&staging).map_err(|e| e.to_string())?;
            let check: String = copied.query_row("PRAGMA quick_check", [], |row| row.get(0)).map_err(|e| e.to_string())?;
            if check != "ok" { return Err("기존 기록의 무결성을 확인하지 못했어요.".into()); }
            crate::store::entries(&copied).map_err(|e| e.to_string())?;
            crate::store::settings(&copied)?;
        }
        std::fs::rename(&staging, destination).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = std::fs::remove_file(&staging); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("galpi-migration-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap(); Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn migration_includes_live_wal_and_preferences_without_changing_source() {
        let dir = TempDir::new();
        let legacy = dir.0.join("old.sqlite3");
        let target = dir.0.join("galpi/galpi.sqlite3");
        let source = Connection::open(&legacy).unwrap();
        crate::store::initialize(&source).unwrap();
        source.execute_batch("PRAGMA wal_autocheckpoint=0;").unwrap();
        let record = crate::store::insert(&source, "WAL 안의 기록".into(), "다음".into()).unwrap();
        source.execute("INSERT INTO preferences VALUES ('settings', ?1)", [r#"{"reminderEnabled":true,"reminderTime":"09:30"}"#]).unwrap();
        migrate(&legacy, &target).unwrap();
        let copied = Connection::open(&target).unwrap();
        assert_eq!(crate::store::entries(&copied).unwrap()[0].id, record.id);
        assert_eq!(crate::store::settings(&copied).unwrap().reminder_time, "09:30");
        assert_eq!(crate::store::settings(&copied).unwrap().quick_capture_shortcut, "Ctrl+Alt+G");
        assert_eq!(crate::store::entries(&source).unwrap().len(), 1);
        crate::store::insert(&source, "이전 앱에 추가된 기록".into(), "".into()).unwrap();
        migrate(&legacy, &target).unwrap();
        assert_eq!(crate::store::entries(&copied).unwrap().len(), 1);
    }

    #[test]
    fn failed_migration_never_publishes_an_empty_database() {
        let dir = TempDir::new();
        let legacy = dir.0.join("broken.sqlite3");
        let target = dir.0.join("galpi/galpi.sqlite3");
        std::fs::write(&legacy, b"not a database").unwrap();
        assert!(migrate(&legacy, &target).is_err());
        assert!(!target.exists());
        assert_eq!(std::fs::read(&legacy).unwrap(), b"not a database");
    }
}
