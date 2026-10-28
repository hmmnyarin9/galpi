mod store;
mod storage;
mod shortcuts;
mod startup;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_autostart::ManagerExt as AutostartExt;

struct AppState {
    db: Mutex<Connection>,
    shortcut_error: Mutex<Option<String>>,
    active_shortcut: Mutex<Option<String>>,
    data_dir: std::path::PathBuf,
}

struct NativeRegistry<'a>(&'a tauri::AppHandle);
struct NativeStartup<'a>(&'a tauri::AppHandle);
impl startup::Registration for NativeStartup<'_> {
    fn is_enabled(&self) -> Result<bool, String> { self.0.autolaunch().is_enabled().map_err(|e| e.to_string()) }
    fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let manager = self.0.autolaunch();
        if enabled { manager.enable() } else { manager.disable() }.map_err(|e| e.to_string())
    }
}
impl shortcuts::Registry for NativeRegistry<'_> {
    fn register(&self, key: &str) -> Result<(), String> { self.0.global_shortcut().register(key).map_err(|e| e.to_string()) }
    fn unregister(&self, key: &str) -> Result<(), String> { self.0.global_shortcut().unregister(key).map_err(|e| e.to_string()) }
}

fn with_db<T>(state: &AppState, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let db = state.db.lock().map_err(|_| "저장소에 접근하지 못했어요. 앱을 다시 실행해주세요.".to_string())?;
    f(&db)
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_window(app: &tauri::AppHandle) {
    show_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("quick-capture", ());
    }
}

fn open_settings(app: &tauri::AppHandle) {
    show_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("open-settings", ());
    }
}

#[tauri::command]
fn list_entries(state: State<AppState>) -> Result<Vec<store::Entry>, String> {
    with_db(&state, |db| store::entries(db).map_err(|e| e.to_string()))
}

#[tauri::command]
fn save_entry(state: State<AppState>, body: String, next_action: String) -> Result<store::Entry, String> {
    with_db(&state, |db| store::insert(db, body, next_action))
}

#[tauri::command]
fn update_entry(state: State<AppState>, id: String, body: String, next_action: String) -> Result<store::Entry, String> {
    with_db(&state, |db| store::update(db, id, body, next_action))
}

#[tauri::command]
fn delete_entry(state: State<AppState>, id: String) -> Result<(), String> {
    with_db(&state, |db| {
        db.execute("DELETE FROM entries WHERE id=?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle, state: State<AppState>) -> Result<store::Settings, String> {
    let mut settings = with_db(&state, store::settings)?;
    settings.launch_at_startup = app.autolaunch().is_enabled().map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
async fn set_settings(app: tauri::AppHandle, settings: store::Settings) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_db(&state, |db| {
            let mut active = state.active_shortcut.lock().map_err(|e| e.to_string())?;
            startup::save(db, &settings, &mut active, &NativeRegistry(&app), &NativeStartup(&app))?;
            *state.shortcut_error.lock().map_err(|e| e.to_string())? = None;
            Ok(())
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn runtime_info(state: State<AppState>) -> Result<serde_json::Value, String> {
    let error = state.shortcut_error.lock().map_err(|e| e.to_string())?.clone();
    Ok(serde_json::json!({ "shortcutError": error, "dataPath": state.data_dir.display().to_string() }))
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_entries(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let entries = with_db(&state, |db| store::entries(db).map_err(|e| e.to_string()))?;
        let content = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
        let path = app.dialog().file().set_file_name("galpi-backup.json")
            .add_filter("갈피 JSON 백업", &["json"]).blocking_save_file();
        let Some(path) = path else { return Ok(false); };
        let path = path.into_path().map_err(|e| e.to_string())?;
        // Never allow exporting on top of the live database or its WAL/SHM files.
        let parent = path.parent().and_then(|p| p.canonicalize().ok());
        let protected_dirs = [Some(state.data_dir.clone()), app.path().app_data_dir().ok()];
        if protected_dirs.into_iter().flatten().any(|dir| parent.is_some() && parent == dir.canonicalize().ok()) {
            return Err("백업은 갈피 데이터 폴더 밖에 저장해주세요.".into());
        }
        std::fs::write(path, content).map_err(|e| e.to_string())?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if !args.iter().any(|arg| arg == "--autostart") { open_window(app); }
        }))
        .plugin(tauri_plugin_autostart::Builder::new().arg("--autostart").build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| {
            if event.state() == ShortcutState::Pressed { open_window(app); }
        }).build())
        .setup(|app| {
            let data_dir = app.path().local_data_dir()?.join("galpi");
            std::fs::create_dir_all(&data_dir)?;
            storage::migrate(&app.path().app_data_dir()?.join("galpi.sqlite3"), &data_dir.join("galpi.sqlite3"))
                .map_err(std::io::Error::other)?;
            let db = Connection::open(data_dir.join("galpi.sqlite3"))?;
            db.busy_timeout(std::time::Duration::from_secs(5))?;
            store::initialize(&db)?;
            let settings = store::settings(&db).map_err(std::io::Error::other)?;
            let start_hidden = startup::should_start_hidden(&settings, std::env::args().any(|arg| arg == "--autostart"));
            let shortcut_error = app.global_shortcut().register(settings.quick_capture_shortcut.as_str()).err().map(|e| e.to_string());
            let active_shortcut = if shortcut_error.is_none() { Some(settings.quick_capture_shortcut) } else { None };
            app.manage(AppState { db: Mutex::new(db), shortcut_error: Mutex::new(shortcut_error), active_shortcut: Mutex::new(active_shortcut), data_dir });

            use tauri::{menu::{Menu, MenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}};
            let open = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "설정", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &settings, &quit])?;
            let mut rgba = vec![0u8; 32 * 32 * 4];
            for y in 3..29 { for x in 9..23 {
                if y < 23 || (x as i32 - 16).abs() > (y - 23) as i32 {
                    let i = (y * 32 + x) * 4;
                    rgba[i..i+4].copy_from_slice(&[181, 77, 49, 255]);
                }
            }}
            TrayIconBuilder::new().icon(tauri::image::Image::new_owned(rgba, 32, 32))
                .tooltip("갈피 · 잠깐 적고, 이어가세요.").menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => open_window(app), "settings" => open_settings(app), "quit" => app.exit(0), _ => (),
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                        open_window(tray.app_handle());
                    }
                }).build(app)?;

            if !start_hidden { show_window(app.handle()); }

            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                let state = handle.state::<AppState>();
                let now = chrono::Local::now();
                match with_db(&state, |db| store::claim_reminder(db, &now)) {
                    Ok(true) => {
                        if let Err(error) = handle.notification().builder().title("오늘의 갈피를 남겨볼까요?")
                            .body("한 줄이면 충분해요. 트레이나 설정한 단축키로 갈피를 열어보세요.").show() {
                            eprintln!("Reminder notification failed: {error}");
                            let _ = handle.emit("reminder-error", error.to_string());
                        }
                        let _ = handle.emit("reminder", ());
                    },
                    Ok(false) => (),
                    Err(error) => eprintln!("Reminder check failed: {error}"),
                }
                std::thread::sleep(std::time::Duration::from_secs(20));
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![list_entries, save_entry, update_entry, delete_entry, get_settings, set_settings, runtime_info, hide_window, export_entries])
        .run(tauri::generate_context!())
        .expect("갈피를 시작하지 못했습니다.");
}
