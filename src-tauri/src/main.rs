#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::StreamExt;
use image::{ImageBuffer, ImageFormat, Rgba};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const GITHUB_REPO: &str = "Malztt/my-tools-app";

struct AppState {
    current_hotkey: Mutex<String>,
    pending_snip_screen: Mutex<Option<String>>,
    was_main_visible: Mutex<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RenameOp {
    old_path: String,
    new_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameItem {
    id: String,
    name: String,
    full_path: String,
    parent_dir: String,
    is_directory: bool,
    ext: String,
    base_name: String,
}

fn restore_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn capture_screen_data_url() -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Monitor error: {}", e))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary())
        .or_else(|| monitors.first())
        .ok_or_else(|| "ไม่พบหน้าจอแสดงผล".to_string())?;

    let captured = monitor
        .capture_image()
        .map_err(|e| format!("Capture error: {}", e))?;

    let w = captured.width();
    let h = captured.height();
    let raw = captured.into_raw();

    let img_buf: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(w, h, raw)
        .ok_or_else(|| "ไม่สามารถแปลงภาพหน้าจอได้".to_string())?;

    let mut png_bytes = Cursor::new(Vec::new());
    img_buf
        .write_to(&mut png_bytes, ImageFormat::Png)
        .map_err(|e| format!("Encode PNG error: {}", e))?;

    Ok(format!(
        "data:image/png;base64,{}",
        BASE64.encode(png_bytes.into_inner())
    ))
}

fn trigger_screen_snip(app: &AppHandle, hide_main_first: bool) {
    if let Some(existing) = app.get_webview_window("snip") {
        let _ = existing.set_focus();
        return;
    }

    let state = app.state::<AppState>();
    let main_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if let Ok(mut vis) = state.was_main_visible.lock() {
        *vis = main_visible;
    }

    if hide_main_first && main_visible {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.hide();
        }
        std::thread::sleep(Duration::from_millis(220));
    }

    match capture_screen_data_url() {
        Ok(data_url) => {
            if let Ok(mut slot) = state.pending_snip_screen.lock() {
                *slot = Some(data_url);
            }

            let builder = WebviewWindowBuilder::new(
                app,
                "snip",
                WebviewUrl::App("snip.html".into()),
            )
            .title("Snipping Overlay")
            .decorations(false)
            .fullscreen(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false);

            match builder.build() {
                Ok(snip_win) => {
                    let _ = snip_win.set_focus();
                }
                Err(e) => {
                    eprintln!("Failed to open snip window: {}", e);
                    restore_main_window(app);
                }
            }
        }
        Err(err) => {
            eprintln!("Screen capture failed: {}", err);
            restore_main_window(app);
        }
    }
}

fn register_global_snip_hotkey(app: &AppHandle, accelerator: &str) -> Result<String, String> {
    let normalized = accelerator
        .trim()
        .replace("CommandOrControl", "CmdOrCtrl");
    let shortcut: Shortcut = normalized
        .parse()
        .map_err(|e| format!("รูปแบบคีย์ลัดไม่ถูกต้อง: {:?}", e))?;

    let _ = app.global_shortcut().unregister_all();

    app.global_shortcut()
        .on_shortcut(shortcut, move |app_handle, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let handle = app_handle.clone();
                std::thread::spawn(move || {
                    trigger_screen_snip(&handle, false);
                });
            }
        })
        .map_err(|e| format!("ไม่สามารถลงทะเบียนคีย์ลัดได้ (อาจซ้ำกับโปรแกรมอื่น): {}", e))?;

    let state = app.state::<AppState>();
    if let Ok(mut hk) = state.current_hotkey.lock() {
        *hk = accelerator.trim().to_string();
    }

    Ok(accelerator.trim().to_string())
}

#[tauri::command]
fn start_snip(app: AppHandle) -> serde_json::Value {
    let handle = app.clone();
    std::thread::spawn(move || {
        trigger_screen_snip(&handle, true);
    });
    serde_json::json!({ "started": true })
}

#[tauri::command]
fn get_pending_snip_screen(state: State<AppState>) -> Option<String> {
    state.pending_snip_screen.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
fn complete_snip(app: AppHandle, payload: serde_json::Value) {
    if let Some(snip_win) = app.get_webview_window("snip") {
        let _ = snip_win.close();
    }
    restore_main_window(&app);
    let _ = app.emit("snip-captured", payload);
}

#[tauri::command]
fn cancel_snip(app: AppHandle) {
    if let Some(snip_win) = app.get_webview_window("snip") {
        let _ = snip_win.close();
    }
    let should_restore = app
        .state::<AppState>()
        .was_main_visible
        .lock()
        .map(|v| *v)
        .unwrap_or(false);
    if should_restore {
        restore_main_window(&app);
    }
}

#[tauri::command]
fn get_hotkey(state: State<AppState>) -> String {
    state
        .current_hotkey
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| "CommandOrControl+Shift+X".to_string())
}

#[tauri::command]
fn set_hotkey(app: AppHandle, hotkey: String) -> serde_json::Value {
    match register_global_snip_hotkey(&app, &hotkey) {
        Ok(hk) => serde_json::json!({ "success": true, "hotkey": hk }),
        Err(err) => serde_json::json!({ "success": false, "error": err }),
    }
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> bool {
    match arboard::Clipboard::new() {
        Ok(mut cb) => cb.set_text(text).is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
fn copy_image_to_clipboard(data_url: String) -> bool {
    let base64_part = match data_url.split_once(',') {
        Some((_, b64)) => b64,
        None => return false,
    };
    let bytes = match BASE64.decode(base64_part) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let dyn_img = match image::load_from_memory(&bytes) {
        Ok(img) => img,
        Err(_) => return false,
    };
    let rgba = dyn_img.to_rgba8();
    let img_data = arboard::ImageData {
        width: rgba.width() as usize,
        height: rgba.height() as usize,
        bytes: Cow::Owned(rgba.into_raw()),
    };
    match arboard::Clipboard::new() {
        Ok(mut cb) => cb.set_image(img_data).is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
fn get_app_info(app: AppHandle) -> serde_json::Value {
    let version = app.package_info().version.to_string();
    let exe_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    serde_json::json!({
        "version": version,
        "isPortable": true,
        "portableExePath": exe_path,
        "engine": "tauri-rust"
    })
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse = |s: &str| -> Vec<u64> {
        s.trim()
            .trim_start_matches(['v', 'V'])
            .split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let a = parse(latest);
    let b = parse(current);
    let len = a.len().max(b.len());
    for i in 0..len {
        let va = *a.get(i).unwrap_or(&0);
        let vb = *b.get(i).unwrap_or(&0);
        if va > vb {
            return true;
        }
        if va < vb {
            return false;
        }
    }
    false
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> serde_json::Value {
    let current_version = app.package_info().version.to_string();
    let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);

    let client = match reqwest::Client::builder()
        .user_agent("WorkTools-Tauri-Updater")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "currentVersion": current_version,
                "hasUpdate": false,
                "error": e.to_string()
            });
        }
    };

    match client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("Cache-Control", "no-cache")
        .send()
        .await
    {
        Ok(res) if res.status().is_success() => {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                let latest_version = json["tag_name"]
                    .as_str()
                    .unwrap_or("")
                    .trim_start_matches(['v', 'V'])
                    .to_string();

                let download_url = json["assets"]
                    .as_array()
                    .and_then(|arr| {
                        arr.iter().find(|a| {
                            a["name"]
                                .as_str()
                                .map(|n| n.to_lowercase().ends_with(".exe"))
                                .unwrap_or(false)
                        })
                    })
                    .and_then(|a| a["browser_download_url"].as_str())
                    .map(|s| s.to_string());

                let has_update =
                    is_newer_version(&latest_version, &current_version) && download_url.is_some();

                return serde_json::json!({
                    "success": true,
                    "currentVersion": current_version,
                    "latestVersion": if latest_version.is_empty() { current_version } else { latest_version },
                    "hasUpdate": has_update,
                    "downloadUrl": download_url,
                    "releaseUrl": json["html_url"].as_str().unwrap_or("")
                });
            }
            return serde_json::json!({
                "success": false,
                "currentVersion": current_version,
                "hasUpdate": false,
                "error": "ไม่สามารถอ่านข้อมูล Release จาก GitHub ได้"
            });
        }
        Ok(res) => {
            return serde_json::json!({
                "success": false,
                "currentVersion": current_version,
                "hasUpdate": false,
                "error": format!("เช็กอัปเดตไม่สำเร็จ (HTTP {})", res.status())
            });
        }
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "currentVersion": current_version,
                "hasUpdate": false,
                "error": format!("เชื่อมต่อ GitHub ไม่ได้: {}", e)
            });
        }
    }
}

#[tauri::command]
async fn download_and_install_update(
    app: AppHandle,
    download_url: String,
) -> serde_json::Value {
    if download_url.is_empty() {
        return serde_json::json!({ "success": false, "error": "ไม่พบลิงก์ดาวน์โหลด" });
    }

    let target_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };

    let client = match reqwest::Client::builder()
        .user_agent("WorkTools-Tauri-Updater")
        .build()
    {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };

    let response = match client.get(&download_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            return serde_json::json!({
                "success": false,
                "error": format!("ดาวน์โหลดไม่สำเร็จ (HTTP {})", r.status())
            })
        }
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };

    let total_bytes = response.content_length().unwrap_or(0);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp_dir = std::env::temp_dir();
    let downloaded_tmp_exe = tmp_dir.join(format!("WorkTools-update-{}.exe", ts));
    let updater_bat = tmp_dir.join(format!("worktools-updater-{}.bat", ts));

    let mut file = match fs::File::create(&downloaded_tmp_exe) {
        Ok(f) => f,
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };

    let mut received: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut last_pct: u64 = 0;

    while let Some(chunk_res) = stream.next().await {
        match chunk_res {
            Ok(chunk) => {
                if let Err(e) = file.write_all(&chunk) {
                    return serde_json::json!({ "success": false, "error": e.to_string() });
                }
                received += chunk.len() as u64;
                if total_bytes > 0 {
                    let pct = ((received * 100) / total_bytes).min(99);
                    if pct != last_pct {
                        last_pct = pct;
                        let _ = app.emit(
                            "update-progress",
                            serde_json::json!({ "percent": pct, "status": "downloading" }),
                        );
                    }
                }
            }
            Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
        }
    }
    drop(file);

    let _ = app.emit(
        "update-progress",
        serde_json::json!({ "percent": 100, "status": "restarting" }),
    );

    let bat_content = format!(
        "@echo off\r\nchcp 65001 > nul\r\nset /a tries=0\r\nping 127.0.0.1 -n 3 > nul\r\n:retry\r\nset /a tries+=1\r\ncopy /y \"{}\" \"{}\" > nul 2>&1\r\nif errorlevel 1 (\r\n  if %tries% GEQ 25 goto done\r\n  ping 127.0.0.1 -n 2 > nul\r\n  goto retry\r\n)\r\ndel /f /q \"{}\" > nul 2>&1\r\nstart \"\" \"{}\"\r\n:done\r\ndel \"%~f0\"\r\n",
        downloaded_tmp_exe.display(),
        target_exe.display(),
        downloaded_tmp_exe.display(),
        target_exe.display()
    );

    if let Err(e) = fs::write(&updater_bat, bat_content) {
        return serde_json::json!({ "success": false, "error": e.to_string() });
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        let _ = std::process::Command::new("cmd.exe")
            .args(["/c", &updater_bat.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn();
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        handle.exit(0);
    });

    serde_json::json!({ "success": true })
}

#[tauri::command]
fn select_folder_for_rename() -> serde_json::Value {
    let Some(folder) = rfd::FileDialog::new()
        .set_title("เลือกโฟลเดอร์ที่ต้องการเปลี่ยนชื่อไฟล์/โฟลเดอร์ย่อย")
        .pick_folder()
    else {
        return serde_json::json!({ "canceled": true });
    };

    let folder_str = folder.to_string_lossy().to_string();
    let entries = match fs::read_dir(&folder) {
        Ok(rd) => rd,
        Err(e) => return serde_json::json!({ "canceled": false, "error": e.to_string(), "items": [] }),
    };

    let mut items: Vec<RenameItem> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = path.is_dir();
        let ext = if is_dir {
            String::new()
        } else {
            path.extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
        };
        let base_name = if is_dir {
            name.clone()
        } else {
            name.strip_suffix(&ext).unwrap_or(&name).to_string()
        };
        let full_path = path.to_string_lossy().to_string();
        items.push(RenameItem {
            id: full_path.clone(),
            name,
            full_path,
            parent_dir: folder_str.clone(),
            is_directory: is_dir,
            ext,
            base_name,
        });
    }

    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    serde_json::json!({ "canceled": false, "folderPath": folder_str, "items": items })
}

#[tauri::command]
fn select_files_for_rename() -> serde_json::Value {
    let Some(paths) = rfd::FileDialog::new()
        .set_title("เลือกไฟล์ที่ต้องการเปลี่ยนชื่อ")
        .pick_files()
    else {
        return serde_json::json!({ "canceled": true });
    };

    if paths.is_empty() {
        return serde_json::json!({ "canceled": true });
    }

    let first_parent = paths[0]
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut items: Vec<RenameItem> = paths
        .into_iter()
        .map(|path| {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            let base_name = name.strip_suffix(&ext).unwrap_or(&name).to_string();
            let full_path = path.to_string_lossy().to_string();
            let parent_dir = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            RenameItem {
                id: full_path.clone(),
                name,
                full_path,
                parent_dir,
                is_directory: false,
                ext,
                base_name,
            }
        })
        .collect();

    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    serde_json::json!({ "canceled": false, "folderPath": first_parent, "items": items })
}

#[tauri::command]
fn execute_bulk_rename(operations: Vec<RenameOp>) -> serde_json::Value {
    let changed: Vec<RenameOp> = operations
        .into_iter()
        .filter(|op| !op.old_path.is_empty() && !op.new_path.is_empty() && op.old_path != op.new_path)
        .collect();

    if changed.is_empty() {
        return serde_json::json!({ "success": false, "error": "ไม่มีรายการที่จะเปลี่ยนชื่อ" });
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let mut temp_steps: Vec<(RenameOp, PathBuf)> = Vec::new();
    let mut completed: Vec<RenameOp> = Vec::new();

    // Phase 1: old_path -> unique temp path
    for (i, op) in changed.iter().enumerate() {
        let old_p = Path::new(&op.old_path);
        let dir = old_p.parent().unwrap_or_else(|| Path::new("."));
        let fname = old_p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let tmp_path = dir.join(format!(".__wt_tmp_{}_{}_{}", stamp, i, fname));
        if let Err(e) = fs::rename(old_p, &tmp_path) {
            for (prev_op, prev_tmp) in &temp_steps {
                let _ = fs::rename(prev_tmp, &prev_op.old_path);
            }
            return serde_json::json!({
                "success": false,
                "error": format!("เปลี่ยนชื่อไม่สำเร็จ (ไฟล์อาจถูกเปิดใช้งานอยู่): {}", e)
            });
        }
        temp_steps.push((op.clone(), tmp_path));
    }

    // Phase 2: temp path -> new_path
    for (op, tmp_path) in &temp_steps {
        if let Err(e) = fs::rename(tmp_path, &op.new_path) {
            for (prev_op, prev_tmp) in &temp_steps {
                if prev_tmp.exists() && !Path::new(&prev_op.old_path).exists() {
                    let _ = fs::rename(prev_tmp, &prev_op.old_path);
                }
            }
            return serde_json::json!({
                "success": false,
                "error": format!("เปลี่ยนชื่อไม่สำเร็จ: {}", e)
            });
        }
        completed.push(op.clone());
    }

    let undo_ops: Vec<RenameOp> = completed
        .iter()
        .map(|c| RenameOp {
            old_path: c.new_path.clone(),
            new_path: c.old_path.clone(),
        })
        .collect();

    serde_json::json!({
        "success": true,
        "renamedCount": completed.len(),
        "undoOperations": undo_ops
    })
}

fn resolve_default_download_dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().download_dir() {
        return dir;
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(profile).join("Downloads");
        if p.exists() {
            return p;
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home).join("Downloads");
        if p.exists() {
            return p;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn sanitize_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_target_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.to_string());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    for i in 1..10000 {
        let next = dir.join(format!("{} ({}){}", stem, i, ext));
        if !next.exists() {
            return next;
        }
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    dir.join(format!("{}-{}{}", stem, stamp, ext))
}

#[tauri::command]
fn get_download_dir(app: AppHandle) -> String {
    resolve_default_download_dir(&app)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn choose_download_dir() -> serde_json::Value {
    match rfd::FileDialog::new()
        .set_title("เลือกโฟลเดอร์สำหรับบันทึกไฟล์ดาวน์โหลด")
        .pick_folder()
    {
        Some(dir) => serde_json::json!({
            "canceled": false,
            "dirPath": dir.to_string_lossy().to_string()
        }),
        None => serde_json::json!({ "canceled": true }),
    }
}

#[tauri::command]
fn save_download_file(
    app: AppHandle,
    file_name: String,
    data_base64: String,
    custom_dir: Option<String>,
) -> serde_json::Value {
    let target_dir = custom_dir
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .filter(|p| p.exists() && p.is_dir())
        .unwrap_or_else(|| resolve_default_download_dir(&app));

    if !target_dir.exists() {
        if let Err(e) = fs::create_dir_all(&target_dir) {
            return serde_json::json!({
                "success": false,
                "error": format!("ไม่สามารถสร้างโฟลเดอร์ปลายทางได้: {}", e)
            });
        }
    }

    let safe_name = sanitize_filename(&file_name);
    let final_path = unique_target_path(&target_dir, &safe_name);
    let final_name = final_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or(safe_name);

    let b64_payload = match data_base64.split_once(',') {
        Some((_, b64)) => b64,
        None => data_base64.as_str(),
    };

    let bytes = match BASE64.decode(b64_payload.trim()) {
        Ok(b) => b,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("แปลงข้อมูลไฟล์ไม่สำเร็จ: {}", e)
            });
        }
    };

    let size = bytes.len();
    match fs::File::create(&final_path).and_then(|mut f| f.write_all(&bytes)) {
        Ok(_) => serde_json::json!({
            "success": true,
            "filePath": final_path.to_string_lossy().to_string(),
            "fileName": final_name,
            "dirPath": target_dir.to_string_lossy().to_string(),
            "size": size
        }),
        Err(e) => serde_json::json!({
            "success": false,
            "error": format!("บันทึกไฟล์ไม่สำเร็จ: {}", e)
        }),
    }
}

#[tauri::command]
fn open_file_path(file_path: String) -> serde_json::Value {
    let p = Path::new(&file_path);
    if !p.exists() {
        return serde_json::json!({
            "success": false,
            "error": "ไม่พบไฟล์ในตำแหน่งเดิม (อาจถูกย้ายหรือลบไปแล้ว)"
        });
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let res = std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
        return match res {
            Ok(_) => serde_json::json!({ "success": true }),
            Err(e) => serde_json::json!({ "success": false, "error": format!("เปิดไฟล์ไม่สำเร็จ: {}", e) }),
        };
    }

    #[cfg(target_os = "macos")]
    {
        let res = std::process::Command::new("open").arg(&file_path).spawn();
        return match res {
            Ok(_) => serde_json::json!({ "success": true }),
            Err(e) => serde_json::json!({ "success": false, "error": format!("เปิดไฟล์ไม่สำเร็จ: {}", e) }),
        };
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let res = std::process::Command::new("xdg-open").arg(&file_path).spawn();
        match res {
            Ok(_) => serde_json::json!({ "success": true }),
            Err(e) => serde_json::json!({ "success": false, "error": format!("เปิดไฟล์ไม่สำเร็จ: {}", e) }),
        }
    }
}

#[tauri::command]
fn show_in_folder(file_path: String) -> serde_json::Value {
    let p = Path::new(&file_path);

    #[cfg(target_os = "windows")]
    {
        if p.exists() && p.is_file() {
            let arg = format!("/select,{}", file_path);
            let res = std::process::Command::new("explorer").arg(arg).spawn();
            return match res {
                Ok(_) => serde_json::json!({ "success": true }),
                Err(e) => serde_json::json!({ "success": false, "error": format!("เปิดโฟลเดอร์ไม่สำเร็จ: {}", e) }),
            };
        } else if p.exists() && p.is_dir() {
            let res = std::process::Command::new("explorer").arg(&file_path).spawn();
            return match res {
                Ok(_) => serde_json::json!({ "success": true }),
                Err(e) => serde_json::json!({ "success": false, "error": format!("เปิดโฟลเดอร์ไม่สำเร็จ: {}", e) }),
            };
        } else if let Some(parent) = p.parent() {
            if parent.exists() {
                let res = std::process::Command::new("explorer").arg(parent).spawn();
                return match res {
                    Ok(_) => serde_json::json!({ "success": true, "parentOnly": true }),
                    Err(e) => serde_json::json!({ "success": false, "error": format!("เปิดโฟลเดอร์ไม่สำเร็จ: {}", e) }),
                };
            }
        }
        return serde_json::json!({
            "success": false,
            "error": "ไม่พบไฟล์หรือโฟลเดอร์ดังกล่าวแล้ว"
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let target = if p.is_dir() {
            p
        } else {
            p.parent().unwrap_or(p)
        };
        if !target.exists() {
            return serde_json::json!({
                "success": false,
                "error": "ไม่พบไฟล์หรือโฟลเดอร์ดังกล่าวแล้ว"
            });
        }
        let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        match std::process::Command::new(cmd).arg(target).spawn() {
            Ok(_) => serde_json::json!({ "success": true }),
            Err(e) => serde_json::json!({ "success": false, "error": format!("เปิดโฟลเดอร์ไม่สำเร็จ: {}", e) }),
        }
    }
}

#[tauri::command]
fn check_files_exist(paths: Vec<String>) -> std::collections::HashMap<String, bool> {
    let mut result = std::collections::HashMap::new();
    for p in paths {
        let exists = Path::new(&p).exists();
        result.insert(p, exists);
    }
    result
}

#[tauri::command]
fn select_target_folder(title: Option<String>) -> serde_json::Value {
    let dialog_title = title.unwrap_or_else(|| "เลือกโฟลเดอร์ปลายทาง".to_string());
    match rfd::FileDialog::new().set_title(&dialog_title).pick_folder() {
        Some(dir) => serde_json::json!({
            "canceled": false,
            "dirPath": dir.to_string_lossy().to_string()
        }),
        None => serde_json::json!({ "canceled": true }),
    }
}

fn sanitize_folder_segment(seg: &str) -> String {
    let cleaned: String = seg
        .chars()
        .map(|c| match c {
            ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect();
    cleaned.trim().trim_end_matches('.').to_string()
}

#[tauri::command]
fn create_bulk_folders(base_dir: String, folder_names: Vec<String>) -> serde_json::Value {
    let base = PathBuf::from(&base_dir);
    if !base.exists() || !base.is_dir() {
        return serde_json::json!({
            "success": false,
            "error": "ไม่พบโฟลเดอร์ปลายทางที่เลือก"
        });
    }

    let mut created_count: usize = 0;
    let mut existing_count: usize = 0;
    let mut failed_count: usize = 0;
    let mut errors: Vec<String> = Vec::new();
    let mut created_paths: Vec<String> = Vec::new();

    for raw in folder_names {
        let parts: Vec<String> = raw
            .replace('\\', "/")
            .split('/')
            .map(sanitize_folder_segment)
            .filter(|s| !s.is_empty() && s != "." && s != "..")
            .collect();

        if parts.is_empty() {
            continue;
        }

        let mut target = base.clone();
        for part in &parts {
            target.push(part);
        }

        if target.exists() {
            existing_count += 1;
            continue;
        }

        match fs::create_dir_all(&target) {
            Ok(_) => {
                created_count += 1;
                created_paths.push(target.to_string_lossy().to_string());
            }
            Err(e) => {
                failed_count += 1;
                if errors.len() < 10 {
                    errors.push(format!("{}: {}", parts.join("/"), e));
                }
            }
        }
    }

    serde_json::json!({
        "success": true,
        "createdCount": created_count,
        "existingCount": existing_count,
        "failedCount": failed_count,
        "createdPaths": created_paths,
        "errors": errors
    })
}

fn collect_files_recursive(dir: &Path, include_subfolders: bool, out: &mut Vec<(PathBuf, u64, u64)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if include_subfolders {
                collect_files_recursive(&path, true, out);
            }
        } else if meta.is_file() {
            let size = meta.len();
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push((path, size, modified_ms));
        }
    }
}

fn hash_file_partial(path: &Path, size: u64) -> Option<String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Seek, SeekFrom};

    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 16384];

    let n = file.read(&mut buf).ok()?;
    hasher.update(&buf[..n]);

    if size > 32768 {
        if file.seek(SeekFrom::End(-16384)).is_ok() {
            if let Ok(n2) = file.read(&mut buf) {
                hasher.update(&buf[..n2]);
            }
        }
    }

    let digest = hasher.finalize();
    Some(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

fn hash_file_full(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Some(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

#[tauri::command]
async fn scan_duplicate_files(
    root_dir: String,
    include_subfolders: bool,
    min_size_bytes: u64,
) -> serde_json::Value {
    let task_res = tokio::task::spawn_blocking(move || {
        use std::collections::HashMap;
        use std::time::Instant;

        let start = Instant::now();
        let root = PathBuf::from(&root_dir);
        if !root.exists() || !root.is_dir() {
            return serde_json::json!({
                "success": false,
                "error": "ไม่พบโฟลเดอร์ที่ต้องการสแกน"
            });
        }

        let mut all_files: Vec<(PathBuf, u64, u64)> = Vec::new();
        collect_files_recursive(&root, include_subfolders, &mut all_files);

        let scanned_files = all_files.len();
        let total_bytes_scanned: u64 = all_files.iter().map(|(_, s, _)| *s).sum();

        // Stage 1: Group by exact file size
        let mut by_size: HashMap<u64, Vec<(PathBuf, u64, u64)>> = HashMap::new();
        for item in all_files {
            if item.1 >= min_size_bytes {
                by_size.entry(item.1).or_default().push(item);
            }
        }

        // Stage 2: Partial hash (first 16KB + last 16KB)
        let mut by_partial: HashMap<(u64, String), Vec<(PathBuf, u64, u64)>> = HashMap::new();
        for (size, group) in by_size {
            if group.len() < 2 {
                continue;
            }
            for (path, s, mtime) in group {
                if let Some(ph) = hash_file_partial(&path, s) {
                    by_partial.entry((size, ph)).or_default().push((path, s, mtime));
                }
            }
        }

        // Stage 3: Full SHA-256 hash
        let mut by_full: HashMap<String, Vec<(PathBuf, u64, u64)>> = HashMap::new();
        for ((size, partial_hash), group) in by_partial {
            if group.len() < 2 {
                continue;
            }
            if size <= 32768 {
                // Partial hash already hashed the entire file
                by_full.entry(partial_hash).or_default().extend(group);
            } else {
                for (path, s, mtime) in group {
                    if let Some(fh) = hash_file_full(&path) {
                        by_full.entry(fh).or_default().push((path, s, mtime));
                    }
                }
            }
        }

        let mut duplicate_groups: Vec<serde_json::Value> = Vec::new();
        let mut total_wasted_bytes: u64 = 0;

        for (hash, mut group) in by_full {
            if group.len() < 2 {
                continue;
            }
            group.sort_by_key(|(_, _, mtime)| *mtime);
            let file_size = group[0].1;
            let wasted = file_size.saturating_mul((group.len() as u64).saturating_sub(1));
            total_wasted_bytes = total_wasted_bytes.saturating_add(wasted);

            let files_json: Vec<serde_json::Value> = group
                .into_iter()
                .map(|(p, s, mtime)| {
                    let name = p
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let dir_path = p
                        .parent()
                        .map(|d| d.to_string_lossy().to_string())
                        .unwrap_or_default();
                    serde_json::json!({
                        "name": name,
                        "fullPath": p.to_string_lossy().to_string(),
                        "dirPath": dir_path,
                        "size": s,
                        "modifiedMs": mtime
                    })
                })
                .collect();

            duplicate_groups.push(serde_json::json!({
                "hash": hash,
                "size": file_size,
                "wastedBytes": wasted,
                "files": files_json
            }));
        }

        duplicate_groups.sort_by(|a, b| {
            let wa = a["wastedBytes"].as_u64().unwrap_or(0);
            let wb = b["wastedBytes"].as_u64().unwrap_or(0);
            wb.cmp(&wa)
        });

        serde_json::json!({
            "success": true,
            "scannedFiles": scanned_files,
            "totalBytesScanned": total_bytes_scanned,
            "duplicateGroups": duplicate_groups,
            "totalWastedBytes": total_wasted_bytes,
            "elapsedMs": start.elapsed().as_millis() as u64
        })
    })
    .await;

    match task_res {
        Ok(val) => val,
        Err(e) => serde_json::json!({
            "success": false,
            "error": format!("เกิดข้อผิดพลาดขณะสแกนไฟล์: {}", e)
        }),
    }
}

#[tauri::command]
fn delete_files_batch(paths: Vec<String>) -> serde_json::Value {
    let mut deleted_count: usize = 0;
    let mut freed_bytes: u64 = 0;
    let mut failed: Vec<serde_json::Value> = Vec::new();

    for p_str in paths {
        let p = Path::new(&p_str);
        if !p.exists() || !p.is_file() {
            failed.push(serde_json::json!({
                "path": p_str,
                "error": "ไม่พบไฟล์หรือไม่ใช่ไฟล์"
            }));
            continue;
        }
        let size = fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        match fs::remove_file(p) {
            Ok(_) => {
                deleted_count += 1;
                freed_bytes = freed_bytes.saturating_add(size);
            }
            Err(e) => {
                failed.push(serde_json::json!({
                    "path": p_str,
                    "error": e.to_string()
                }));
            }
        }
    }

    serde_json::json!({
        "success": true,
        "deletedCount": deleted_count,
        "freedBytes": freed_bytes,
        "failed": failed
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            current_hotkey: Mutex::new("CommandOrControl+Shift+X".to_string()),
            pending_snip_screen: Mutex::new(None),
            was_main_visible: Mutex::new(true),
        })
        .setup(|app| {
            let _ = register_global_snip_hotkey(app.handle(), "CommandOrControl+Shift+X");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_snip,
            get_pending_snip_screen,
            complete_snip,
            cancel_snip,
            get_hotkey,
            set_hotkey,
            copy_to_clipboard,
            copy_image_to_clipboard,
            get_app_info,
            check_for_updates,
            download_and_install_update,
            select_folder_for_rename,
            select_files_for_rename,
            execute_bulk_rename,
            get_download_dir,
            choose_download_dir,
            save_download_file,
            open_file_path,
            show_in_folder,
            check_files_exist,
            select_target_folder,
            create_bulk_folders,
            scan_duplicate_files,
            delete_files_batch
        ])
        .run(tauri::generate_context!())
        .expect("error while running WorkTools Tauri application");
}
