use crate::{shortcuts, store::{self, Settings}};
use rusqlite::Connection;

pub trait Registration {
    fn is_enabled(&self) -> Result<bool, String>;
    fn set_enabled(&self, enabled: bool) -> Result<(), String>;
}

pub fn save(db: &Connection, next: &Settings, active: &mut Option<String>, keys: &impl shortcuts::Registry, startup: &impl Registration) -> Result<(), String> {
    store::validate_settings(next)?;
    let previous = startup.is_enabled()?;
    let changed = previous != next.launch_at_startup;
    if changed {
        startup.set_enabled(next.launch_at_startup).map_err(|e| format!("Windows 시작 설정을 변경하지 못했어요. {e}"))?;
    }
    if let Err(error) = shortcuts::save(db, next, active, keys) {
        if changed {
            if let Err(rollback) = startup.set_enabled(previous) {
                return Err(format!("{error} Windows 시작 설정 복원에도 실패했어요. {rollback}"));
            }
        }
        return Err(error);
    }
    Ok(())
}

pub fn should_start_hidden(settings: &Settings, from_autostart: bool) -> bool {
    from_autostart && settings.launch_at_startup && settings.start_minimized
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    struct FakeStartup { enabled: Cell<bool>, fail: bool }
    impl Registration for FakeStartup {
        fn is_enabled(&self) -> Result<bool, String> { Ok(self.enabled.get()) }
        fn set_enabled(&self, enabled: bool) -> Result<(), String> {
            if self.fail { return Err("registration failed".into()); }
            self.enabled.set(enabled); Ok(())
        }
    }
    struct Conflict;
    impl shortcuts::Registry for Conflict {
        fn register(&self, _: &str) -> Result<(), String> { Err("conflict".into()) }
        fn unregister(&self, _: &str) -> Result<(), String> { panic!("old shortcut must remain registered"); }
    }
    #[test]
    fn old_settings_default_to_no_autostart_and_minimized_only_applies_at_login() {
        let mut settings: Settings = serde_json::from_str(r#"{"reminderEnabled":false,"reminderTime":"18:00"}"#).unwrap();
        assert!(!settings.launch_at_startup);
        assert!(!settings.start_minimized);
        assert!(!should_start_hidden(&settings, true));
        settings.launch_at_startup = true;
        assert!(!should_start_hidden(&settings, true));
        settings.start_minimized = true;
        assert!(should_start_hidden(&settings, true));
        assert!(!should_start_hidden(&settings, false));
        settings.launch_at_startup = false;
        assert!(!should_start_hidden(&settings, true));
    }
    #[test]
    fn shortcut_conflict_rolls_back_autostart_registration() {
        let db = Connection::open_in_memory().unwrap(); store::initialize(&db).unwrap();
        let mut settings = store::settings(&db).unwrap();
        settings.launch_at_startup = true; settings.quick_capture_shortcut = "Alt+F10".into();
        let startup = FakeStartup { enabled: Cell::new(false), fail: false };
        let mut active = Some(store::default_shortcut());
        assert!(save(&db, &settings, &mut active, &Conflict, &startup).is_err());
        assert!(!startup.enabled.get());
        assert!(!store::settings(&db).unwrap().launch_at_startup);
        assert_eq!(active.as_deref(), Some("Ctrl+Alt+G"));
    }
    #[test]
    fn registration_and_database_errors_do_not_save_partial_preferences() {
        let db = Connection::open_in_memory().unwrap(); store::initialize(&db).unwrap();
        let mut settings = store::settings(&db).unwrap(); settings.launch_at_startup = true; settings.start_minimized = true;
        let mut active = Some(store::default_shortcut());
        let failed = FakeStartup { enabled: Cell::new(false), fail: true };
        assert!(save(&db, &settings, &mut active, &Conflict, &failed).is_err());
        assert!(!store::settings(&db).unwrap().launch_at_startup);
        let startup = FakeStartup { enabled: Cell::new(false), fail: false };
        db.execute_batch("PRAGMA query_only=ON;").unwrap();
        assert!(save(&db, &settings, &mut active, &Conflict, &startup).is_err());
        assert!(!startup.enabled.get());
        assert!(!store::settings(&db).unwrap().launch_at_startup);
        db.execute_batch("PRAGMA query_only=OFF;").unwrap();
        save(&db, &settings, &mut active, &Conflict, &startup).unwrap();
        assert!(startup.enabled.get());
        let saved = store::settings(&db).unwrap();
        assert!(saved.launch_at_startup && saved.start_minimized);
        settings.launch_at_startup = false;
        save(&db, &settings, &mut active, &Conflict, &startup).unwrap();
        assert!(!startup.enabled.get());
    }
}
