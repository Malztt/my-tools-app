// Unified Desktop Bridge: automatically maps Tauri v2 (Rust) APIs onto window.electronAPI
// so the React app runs seamlessly on Tauri (Rust), Electron (backup), and Web Browser.

(function initTauriBridge() {
  if (typeof window === 'undefined') return;
  if (window.electronAPI) return; // Already running inside Electron

  const isTauri = Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
  if (!isTauri) return;

  const invoke = (cmd, args = {}) => {
    if (window.__TAURI__?.core?.invoke) {
      return window.__TAURI__.core.invoke(cmd, args);
    }
    if (window.__TAURI_INTERNALS__?.invoke) {
      return window.__TAURI_INTERNALS__.invoke(cmd, args);
    }
    return Promise.reject(new Error('Tauri invoke unavailable'));
  };

  const listenEvent = (eventName, callback) => {
    let unlistenFn = null;
    let disposed = false;

    if (window.__TAURI__?.event?.listen) {
      window.__TAURI__.event.listen(eventName, (event) => {
        if (!disposed) callback(event.payload);
      }).then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      });
    }

    return () => {
      disposed = true;
      if (typeof unlistenFn === 'function') unlistenFn();
    };
  };

  window.electronAPI = {
    isElectron: true,
    isTauri: true,
    startSnip: () => invoke('start_snip'),
    getHotkey: () => invoke('get_hotkey'),
    setHotkey: (hotkey) => invoke('set_hotkey', { hotkey }),
    copyToClipboard: (text) => invoke('copy_to_clipboard', { text }),
    copyImageToClipboard: (dataUrl) => invoke('copy_image_to_clipboard', { dataUrl }),
    getAppInfo: () => invoke('get_app_info'),
    selectFolderForRename: () => invoke('select_folder_for_rename'),
    selectFilesForRename: () => invoke('select_files_for_rename'),
    executeBulkRename: (operations) => invoke('execute_bulk_rename', { operations }),
    getDownloadDir: () => invoke('get_download_dir'),
    chooseDownloadDir: () => invoke('choose_download_dir'),
    saveDownloadFile: (fileName, dataBase64, customDir) =>
      invoke('save_download_file', { fileName, dataBase64, customDir: customDir || null }),
    openFilePath: (filePath) => invoke('open_file_path', { filePath }),
    showInFolder: (filePath) => invoke('show_in_folder', { filePath }),
    checkFilesExist: (paths) => invoke('check_files_exist', { paths }),
    selectTargetFolder: (title) => invoke('select_target_folder', { title: title || null }),
    createBulkFolders: (baseDir, folderNames) => invoke('create_bulk_folders', { baseDir, folderNames }),
    scanDuplicateFiles: (rootDir, includeSubfolders, minSizeBytes) =>
      invoke('scan_duplicate_files', { rootDir, includeSubfolders, minSizeBytes }),
    deleteFilesBatch: (paths) => invoke('delete_files_batch', { paths }),
    checkForUpdates: () => invoke('check_for_updates'),
    downloadAndInstallUpdate: (downloadUrl) => invoke('download_and_install_update', { downloadUrl }),
    onUpdateProgress: (callback) => listenEvent('update-progress', callback),
    onSnipCaptured: (callback) => listenEvent('snip-captured', callback)
  };
})();
