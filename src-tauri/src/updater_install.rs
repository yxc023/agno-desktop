// src-tauri/src/updater_install.rs
//
// 自定义 updater install 流程 —— 修复 tauri-plugin-updater@2.10.1 macOS 分支
// 的 EXDEV (os error 18) bug。
//
// 原 plugin 流程：
//   1. tempfile::tempdir() 取默认 TMPDIR（macOS = /var/folders/.../T/）
//   2. 把当前 .app rename 到 backup dir → 跨设备时 EXDEV
//   3. 只在 PermissionDenied 时才用 AppleScript 提权
//   4. EXDEV 直接 return error，不会 fallback
//
// 修复后流程：
//   1. 用 plugin 的 download() 拿 bytes（网络部分沿用）
//   2. 把 bytes 写到 *app 同目录*（install_parent）下的临时文件
//   3. 系统 tar 解压到同目录
//   4. 用 AppleScript "rm -rf old && mv -f new old" with administrator privileges
//      替换——`mv -f` 内部会 cross-device safe（copy + delete），
//      而 admin 权限解决了 /Applications 需要 root 写的问题。
//
//   这一步对用户来说就是"系统弹个密码框"（如果装在 /Applications），
//   或者无感替换（如果装在 ~/Applications）。

use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{ipc::Channel, AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

/// 通过 tauri::ipc::Channel 发到前端的事件 shape。
/// 必须跟 src/lib/updater.ts 的 UpdateProgressEvent 一一对应。
#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum UpdateProgressEvent {
    Started { content_length: Option<u64> },
    Progress { chunk_length: usize },
    Finished,
}

/// 错误归一化：把 std::io::Error / tauri_plugin_updater::Error 转成字符串。
/// 前端的 classifyError() 会基于字符串匹配分类。
fn err_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 从当前 exe 路径往上找 .app bundle 根。
///
/// 当前 exe: /Applications/Agno Desktop.app/Contents/MacOS/agno-desktop
/// 找 .app 后缀：  /Applications/Agno Desktop.app
fn find_app_bundle() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(err_string)?;
    for ancestor in exe.ancestors() {
        if ancestor.extension().and_then(|s| s.to_str()) == Some("app") {
            return Ok(ancestor.to_path_buf());
        }
    }
    Err(format!(
        "无法定位 .app bundle（current_exe = {}）",
        exe.display()
    ))
}

/// 在解压目录里找 .app（plugin 打出来的 .app.tar.gz 解压后是
/// "Agno Desktop.app/" 这种顶层目录）。
fn find_app_in_dir(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir).ok()?.find_map(|entry| {
        let path = entry.ok()?.path();
        if path.extension().and_then(|s| s.to_str()) == Some("app") {
            Some(path)
        } else {
            None
        }
    })
}

/// 用 AppleScript 替换目录。`admin = true` 时弹密码框。
///
/// 等价于 shell: `rm -rf '<old>' && mv -f '<new>' '<old>'`
/// - `rm -rf` 删旧
/// - `mv -f` 跨设备时 fallback 到 copy + delete，所以 cross-device safe
/// - `with administrator privileges` 让 rm/mv 在需要时拿到 root 权限（写 /Applications）
fn apple_script_replace(old: &Path, new: &Path, admin: bool) -> Result<(), String> {
    let clause = if admin {
        "with administrator privileges"
    } else {
        ""
    };
    let script = format!(
        "do shell script \"rm -rf '{}' && mv -f '{}' '{}'\" {}",
        old.display(),
        new.display(),
        old.display(),
        clause,
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("osascript 启动失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 用户取消密码框时 osascript 退出码是 1 + stderr "User canceled"
        if stderr.contains("User canceled") || stderr.contains("用户取消") {
            return Err("用户取消了授权，无法完成安装".into());
        }
        return Err(format!(
            "osascript 失败 (exit={:?}): {}",
            output.status.code(),
            stderr.trim()
        ));
    }
    Ok(())
}

/// 主命令：检查 + 下载 + 替换。
///
/// 调用方（前端 useUpdater.install）通过 Channel 收 progress 事件。
#[tauri::command]
pub async fn install_update<R: Runtime>(
    app: AppHandle<R>,
    on_progress: Channel<UpdateProgressEvent>,
) -> Result<(), String> {
    // 1. 找当前 .app
    let current_app = find_app_bundle()?;
    let install_parent = current_app
        .parent()
        .ok_or_else(|| format!(".app 没有父目录: {}", current_app.display()))?
        .to_path_buf();

    // 2. 调 plugin 拿 update + 下载 bytes
    let updater = app.updater().map_err(err_string)?;
    let update = updater
        .check()
        .await
        .map_err(err_string)?
        .ok_or_else(|| "没有可用更新".to_string())?;

    // 抓首 chunk 的 contentLength（plugin 只在 chunk 回调里给这个值）
    let content_length_slot: std::sync::Arc<std::sync::Mutex<Option<u64>>> =
        std::sync::Arc::new(std::sync::Mutex::new(None));
    let sent_started = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    let on_progress_for_plugin = on_progress.clone();
    let cl_slot = content_length_slot.clone();
    let started_flag = sent_started.clone();
    let bytes = update
        .download(
            move |chunk_len, content_len| {
                // 第一次 chunk：把 contentLength（如果有）记录下来，发 Started
                if !started_flag.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    if let Some(total) = content_len {
                        *cl_slot.lock().unwrap() = Some(total);
                        let _ = on_progress_for_plugin.send(UpdateProgressEvent::Started {
                            content_length: Some(total),
                        });
                    } else {
                        let _ = on_progress_for_plugin.send(UpdateProgressEvent::Started {
                            content_length: None,
                        });
                    }
                }
                let _ = on_progress_for_plugin.send(UpdateProgressEvent::Progress {
                    chunk_length: chunk_len,
                });
            },
            move || {
                let _ = on_progress.send(UpdateProgressEvent::Finished);
            },
        )
        .await
        .map_err(err_string)?;

    // 3. 在 *app 同目录* 下建临时工作目录
    //    tempfile 默认用 TMPDIR (=/var/folders/.../T/) → 可能跨设备
    //    强制 tempdir_in(install_parent) → 100% 同 volume，rename 不会再 EXDEV
    let work_dir = tempfile::Builder::new()
        .prefix(".agno-update-")
        .tempdir_in(&install_parent)
        .map_err(|e| format!("在 {} 下创建临时目录失败: {e}", install_parent.display()))?;

    let tar_path = work_dir.path().join("update.app.tar.gz");
    std::fs::write(&tar_path, &bytes).map_err(err_string)?;

    // 4. 解压：优先用 plugin 内嵌的 flate2 + tar（已经传入了），
    //    避免 spawn 系统 tar（系统 tar 在 minimal macOS 上不一定有）
    //
    //    由于 tauri-plugin-updater 不 re-export flate2/tar，我们 spawn 系统 tar。
    //    macOS / Linux 自带 tar，Windows 用户不在我们的 release 矩阵。
    let extract_dir = work_dir.path().join("extracted");
    std::fs::create_dir_all(&extract_dir).map_err(err_string)?;

    let tar_status = Command::new("tar")
        .arg("-xzf")
        .arg(&tar_path)
        .arg("-C")
        .arg(&extract_dir)
        .status()
        .map_err(|e| format!("调用 tar 失败: {e}（确认系统 PATH 里有 tar）"))?;
    if !tar_status.success() {
        return Err(format!(
            "tar 解压失败 exit={:?}",
            tar_status.code()
        ));
    }

    // 5. 在解压目录里找 .app
    let new_app = find_app_in_dir(&extract_dir)
        .ok_or_else(|| format!("解压目录里找不到 .app: {}", extract_dir.display()))?;

    // 6. 替换：先试无 admin（user-owned 路径会秒过）；失败再试 admin
    //
    //    注意：这里用 mv -f 而非 mv，跨设备时 macOS 自动 copy+delete fallback。
    //    AppleScript 的 with administrator privileges 负责 /Applications 这种 root-owned 路径。
    match apple_script_replace(&current_app, &new_app, false) {
        Ok(()) => {}
        Err(_) => {
            // 无 admin 失败 → 试 admin
            apple_script_replace(&current_app, &new_app, true)?;
        }
    }

    // 7. 临时工作目录会在 work_dir drop 时自动清理（tempfile RAII）

    Ok(())
}