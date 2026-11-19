const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  screen,
  clipboard
} = require('electron');
const path = require('path');

let mainWindow = null;
let snipWindow = null;
let currentHotkey = 'CommandOrControl+Shift+X';
let wasMainWindowVisibleBeforeSnip = false;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    title: 'WorkTools — AI OCR & PDF Suite',
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
    // Wait briefly for Windows window-hide animation to finish before grabbing screen
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
