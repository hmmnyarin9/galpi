use crate::store::{self, Settings};
use rusqlite::Connection;
use tauri_plugin_global_shortcut::Shortcut;

pub fn validate(value: &str) -> Result<(), String> {
    let parts: Vec<_> = value.split('+').collect();
    let (key, modifiers) = parts.split_last().ok_or("단축키를 입력해주세요.")?;
    let key_ok = (key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric()) ||
        key.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (1..=24).contains(&n));
    if !key_ok || !modifiers.iter().any(|m| matches!(*m, "Ctrl" | "Alt")) ||
        modifiers.iter().any(|m| !matches!(*m, "Ctrl" | "Alt" | "Shift")) ||
        modifiers.iter().enumerate().any(|(i, m)| modifiers[..i].contains(m)) ||
        value == "Alt+F4" {
        return Err("Ctrl 또는 Alt와 영문·숫자·F키를 조합해주세요. Alt+F4는 사용할 수 없어요.".into());
    }
    value.parse::<Shortcut>().map_err(|_| "사용할 수 없는 단축키예요.".to_string())?;
    Ok(())
}

pub trait Registry {
    fn register(&self, key: &str) -> Result<(), String>;
    fn unregister(&self, key: &str) -> Result<(), String>;
}

// Reserve the replacement before releasing the current binding. A conflict or
// a persistence failure leaves the saved preference and current key unchanged.
pub fn save(db: &Connection, next: &Settings, active: &mut Option<String>, registry: &impl Registry) -> Result<(), String> {
    store::validate_settings(next)?;
    let key = &next.quick_capture_shortcut;
    if active.as_ref() == Some(key) { return store::save_settings(db, next); }
    registry.register(key).map_err(|e| format!("{key}를 등록하지 못했어요. 다른 앱과의 충돌을 확인해주세요. {e}"))?;
    if let Some(previous) = active.as_ref() {
        if let Err(error) = registry.unregister(previous) {
            let rollback = registry.unregister(key);
            return Err(format!("기존 단축키를 해제하지 못했어요. {error} {}", rollback.err().unwrap_or_default()));
        }
    }
    if let Err(error) = store::save_settings(db, next) {
        let cleanup = registry.unregister(key).err();
        let restore = active.as_ref().and_then(|previous| registry.register(previous).err());
        return Err(format!("{error} {} {}", cleanup.unwrap_or_default(), restore.unwrap_or_default()));
    }
    *active = Some(key.clone());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    struct Fake { keys: RefCell<Vec<String>> }
    impl Registry for Fake {
        fn register(&self, key: &str) -> Result<(), String> {
            if self.keys.borrow().iter().any(|item| item == key) { return Err("conflict".into()); }
            self.keys.borrow_mut().push(key.into()); Ok(())
        }
        fn unregister(&self, key: &str) -> Result<(), String> {
            self.keys.borrow_mut().retain(|item| item != key); Ok(())
        }
    }
    #[test]
    fn rejects_unmodified_reserved_and_malformed_keys() {
        for key in ["G", "Shift+G", "Alt+F4", "Ctrl+Ctrl+G", "Ctrl+Enter", "Ctrl+F25", ""] { assert!(validate(key).is_err(), "{key}"); }
        for key in ["Ctrl+Alt+G", "Ctrl+Shift+9", "Alt+F10"] { assert!(validate(key).is_ok(), "{key}"); }
    }
    #[test]
    fn conflict_keeps_old_shortcut_and_settings() {
        let db = Connection::open_in_memory().unwrap(); store::initialize(&db).unwrap();
        let mut next = store::settings(&db).unwrap(); next.quick_capture_shortcut = "Ctrl+Shift+G".into();
        let registry = Fake { keys: RefCell::new(vec!["Ctrl+Alt+G".into(), next.quick_capture_shortcut.clone()]) };
        let mut active = Some("Ctrl+Alt+G".into());
        assert!(save(&db, &next, &mut active, &registry).is_err());
        assert_eq!(store::settings(&db).unwrap().quick_capture_shortcut, "Ctrl+Alt+G");
        assert_eq!(active.as_deref(), Some("Ctrl+Alt+G"));
        assert_eq!(registry.keys.borrow().len(), 2);
    }
    #[test]
    fn successful_change_persists_and_db_failure_restores_binding() {
        let db = Connection::open_in_memory().unwrap(); store::initialize(&db).unwrap();
        let mut next = store::settings(&db).unwrap(); next.quick_capture_shortcut = "Alt+F10".into();
        let registry = Fake { keys: RefCell::new(vec!["Ctrl+Alt+G".into()]) };
        let mut active = Some("Ctrl+Alt+G".into());
        save(&db, &next, &mut active, &registry).unwrap();
        assert_eq!(store::settings(&db).unwrap().quick_capture_shortcut, "Alt+F10");
        assert_eq!(*registry.keys.borrow(), vec!["Alt+F10"]);
        db.execute_batch("PRAGMA query_only=ON;").unwrap();
        next.quick_capture_shortcut = "Ctrl+9".into();
        assert!(save(&db, &next, &mut active, &registry).is_err());
        assert_eq!(active.as_deref(), Some("Alt+F10"));
        assert_eq!(*registry.keys.borrow(), vec!["Alt+F10"]);
        assert_eq!(store::settings(&db).unwrap().quick_capture_shortcut, "Alt+F10");
    }
}
