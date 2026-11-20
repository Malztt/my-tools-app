const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  screen,
  clipboard,
  nativeImage,
  shell
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

const GITHUB_REPO = 'Malztt/my-tools-app';

let mainWindow = null;
let snipWindow = null;
let currentHotkey = 'CommandOrControl+Shift+X';
let wasMainWindowVisibleBeforeSnip = false;

function getWindowIconPath() {
  const distIcon = path.join(__dirname, '../dist/icon.ico');
  if (fs.existsSync(distIcon)) return distIcon;
  const pubIcon = path.join(__dirname, '../public/icon.ico');
  if (fs.existsSync(pubIcon)) return pubIcon;
  return path.join(__dirname, '../public/icon.png');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    title: 'WorkTools',
    icon: getWindowIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startScreenSnip(hideMainFirst = false) {
  if (snipWindow && !snipWindow.isDestroyed()) {
    snipWindow.focus();
    return;
  }

  wasMainWindowVisibleBeforeSnip = Boolean(
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()
  );

  if (hideMainFirst && wasMainWindowVisibleBeforeSnip) {
    mainWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  try {
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay();
    const scaleFactor = activeDisplay.scaleFactor || 1;
    const thumbWidth = Math.round(activeDisplay.bounds.width * scaleFactor);
    const thumbHeight = Math.round(activeDisplay.bounds.height * scaleFactor);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbWidth, height: thumbHeight }
    });

    if (!sources || sources.length === 0) {
      restoreMainWindow();
      return;
    }

    const matchedSource =
      sources.find((s) => String(s.display_id) === String(activeDisplay.id)) || sources[0];
    const dataUrl = matchedSource.thumbnail.toDataURL();

    snipWindow = new BrowserWindow({
      x: activeDisplay.bounds.x,
      y: activeDisplay.bounds.y,
      width: activeDisplay.bounds.width,
      height: activeDisplay.bounds.height,
      frame: false,
      fullscreen: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: path.join(__dirname, 'snip-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    snipWindow.setAlwaysOnTop(true, 'screen-saver');
    snipWindow.loadFile(path.join(__dirname, 'snip.html'));

    snipWindow.webContents.once('did-finish-load', () => {
      if (snipWindow && !snipWindow.isDestroyed()) {
        snipWindow.webContents.send('snip-screen-data', { dataUrl });
        snipWindow.focus();
      }
    });

    snipWindow.on('closed', () => {
      snipWindow = null;
    });
  } catch (err) {
    console.error('Failed to capture screen:', err);
    restoreMainWindow();
  }
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerGlobalSnipHotkey(accelerator) {
  globalShortcut.unregisterAll();
  try {
    const ok = globalShortcut.register(accelerator, () => {
      startScreenSnip(false);
    });
    if (ok) {
      currentHotkey = accelerator;
      return { success: true, hotkey: currentHotkey };
    }
    return { success: false, error: 'ไม่สามารถลงทะเบียนคีย์ลัดนี้ได้ (อาจซ้ำกับโปรแกรมอื่น)' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Compare semver versions (e.g. "1.0.12" > "1.0.5")
function isNewerVersion(latestTag, currentVer) {
  const cleanLatest = String(latestTag || '').replace(/^v/i, '').trim();
  const cleanCurrent = String(currentVer || '').replace(/^v/i, '').trim();
  if (!cleanLatest || cleanLatest === cleanCurrent) return false;
  const latestParts = cleanLatest.split('.').map((n) => parseInt(n, 10) || 0);
  const currentParts = cleanCurrent.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < len; i++) {
    const a = latestParts[i] || 0;
    const b = currentParts[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

// Fetch JSON from HTTPS URL with redirect support
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'WorkTools-AutoUpdater',
            Accept: 'application/vnd.github+json'
          }
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return fetchJson(res.headers.location).then(resolve).catch(reject);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on('error', reject);
  });
}

// Download binary file with redirect & progress reporting
function downloadFileWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl) => {
      https
        .get(
          currentUrl,
          {
            headers: {
              'User-Agent': 'WorkTools-AutoUpdater'
            }
          },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return request(res.headers.location);
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            }
            const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            let receivedBytes = 0;
            const fileStream = fs.createWriteStream(destPath);

            res.on('data', (chunk) => {
              receivedBytes += chunk.length;
              if (totalBytes > 0 && onProgress) {
                const percent = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
                onProgress(percent);
              }
            });

            res.pipe(fileStream);

            fileStream.on('finish', () => {
              fileStream.close(() => {
                if (onProgress) onProgress(100);
                resolve(destPath);
              });
            });

            fileStream.on('error', (err) => {
              fs.unlink(destPath, () => {});
              reject(err);
            });
          }
        )
        .on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
    };
    request(url);
  });
}

app.whenReady().then(() => {
  createMainWindow();
  registerGlobalSnipHotkey(currentHotkey);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

ipcMain.handle('start-snip', async () => {
  await startScreenSnip(true);
  return { started: true };
});

ipcMain.handle('get-hotkey', () => {
  return currentHotkey;
});

ipcMain.handle('set-hotkey', (_event, newHotkey) => {
  if (!newHotkey || typeof newHotkey !== 'string') {
    return { success: false, error: 'คีย์ลัดไม่ถูกต้อง' };
  }
  return registerGlobalSnipHotkey(newHotkey.trim());
});

ipcMain.handle('copy-to-clipboard', (_event, text) => {
  if (typeof text === 'string') {
    clipboard.writeText(text);
  }
  return true;
});

ipcMain.handle('copy-image-to-clipboard', (_event, dataUrl) => {
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
    const img = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(img);
    return true;
  }
  return false;
});

ipcMain.handle('get-app-info', () => {
  return {
    version: app.getVersion(),
    isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    portableExePath: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
  };
});

ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  try {
    const release = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    const exeAsset = (release.assets || []).find(
      (a) => a.name && a.name.toLowerCase().endsWith('.exe')
    );

    const hasUpdate = isNewerVersion(latestVersion, currentVersion) && Boolean(exeAsset);
    return {
      success: true,
      currentVersion,
      latestVersion: latestVersion || currentVersion,
      hasUpdate,
      downloadUrl: exeAsset ? exeAsset.browser_download_url : null,
      releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases`,
      publishedAt: release.published_at || null
    };
  } catch (err) {
    return {
      success: false,
      currentVersion,
      hasUpdate: false,
      error: 'ยังไม่มี Release ใหม่บน GitHub หรือไม่สามารถเชื่อมต่อได้'
    };
  }
});

ipcMain.handle('download-and-install-update', async (_event, downloadUrl) => {
  if (!downloadUrl) {
    return { success: false, error: 'ไม่พบลิงก์ดาวน์โหลดไฟล์อัปเดต' };
  }

  // Determine the actual Portable .exe file location on disk
  const targetExePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

  // If running in dev mode (electron.exe), open browser instead of overwriting electron binary
  if (!app.isPackaged) {
    await shell.openExternal(downloadUrl);
    return { success: true, openedInBrowser: true };
  }

  try {
    const tempDir = os.tmpdir();
    const downloadedTmpExe = path.join(tempDir, `WorkTools-update-${Date.now()}.exe`);
    const updaterBatPath = path.join(tempDir, `worktools-updater-${Date.now()}.bat`);

    await downloadFileWithProgress(downloadUrl, downloadedTmpExe, (percent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-progress', { percent, status: 'downloading' });
      }
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-progress', { percent: 100, status: 'restarting' });
    }

    // Create a self-cleaning Windows batch script that waits for the portable app to close,
    // replaces the old Portable .exe with the newly downloaded .exe (even across drives), and launches it!
    const batContent = [
      '@echo off',
      'chcp 65001 > nul',
      'ping 127.0.0.1 -n 4 > nul',
      ':retry',
      `copy /y "${downloadedTmpExe}" "${targetExePath}" > nul 2>&1`,
      'if errorlevel 1 (',
      '  ping 127.0.0.1 -n 2 > nul',
      '  goto retry',
      ')',
      `del /f /q "${downloadedTmpExe}" > nul 2>&1`,
      `start "" "${targetExePath}"`,
      'del "%~f0"'
    ].join('\r\n');

    fs.writeFileSync(updaterBatPath, batContent, 'utf8');

    const child = spawn('cmd.exe', ['/c', updaterBatPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

    setTimeout(() => {
      app.quit();
    }, 300);

    return { success: true };
  } catch (err) {
    return { success: false, error: 'อัปเดตไม่สำเร็จ: ' + err.message };
  }
});

ipcMain.on('snip-cancel', () => {
  if (snipWindow && !snipWindow.isDestroyed()) {
    snipWindow.close();
  }
  if (wasMainWindowVisibleBeforeSnip) {
    restoreMainWindow();
  }
});

ipcMain.on('snip-complete', (_event, payload) => {
  if (snipWindow && !snipWindow.isDestroyed()) {
    snipWindow.close();
  }
  restoreMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('snip-captured', payload);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
