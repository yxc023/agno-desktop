mod updater_install;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![updater_install::install_update])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Create main window from Rust so we can set the macOS Overlay titlebar
      // reliably. tauri.conf.json's `titleBarStyle` / `hiddenTitle` fields are
      // not consistently honored by Tauri 2.11.5's `WindowBuilder::with_config`
      // path, so we set them here via the Rust API instead.
      //
      // Reference: https://v2.tauri.app/learn/window-customization/
      let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("index.html".into()),
      )
      .title("Agno Desktop")
      .inner_size(1280.0, 820.0)
      .min_inner_size(900.0, 600.0)
      .resizable(true)
      .decorations(true)
      .visible(true)
      .focused(true);

      #[cfg(target_os = "macos")]
      {
        use tauri::{LogicalPosition, TitleBarStyle};
        builder = builder
          .title_bar_style(TitleBarStyle::Overlay)
          .hidden_title(true)
          .traffic_light_position(LogicalPosition::new(12.0, 18.0));
      }

      builder.build()?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}