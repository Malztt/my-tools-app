import { saveAs } from 'file-saver';

const HISTORY_STORAGE_KEY = 'worktools_download_history';
const CUSTOM_DIR_STORAGE_KEY = 'worktools_download_dir';
const MAX_HISTORY_ITEMS = 200;

let currentSourceTool = 'WorkTools';
const listeners = new Set();
const sessionBlobUrls = new Map(); // id -> objectURL (for re-download on Web during current session)
let interceptorInitialized = false;

export const setCurrentDownloadSource = (toolLabel) => {
  if (toolLabel) currentSourceTool = toolLabel;
};

export const getCustomDownloadDir = () => {
  try {
    return localStorage.getItem(CUSTOM_DIR_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

export const setCustomDownloadDir = (dirPath) => {
  try {
    if (dirPath && dirPath.trim()) {
      localStorage.setItem(CUSTOM_DIR_STORAGE_KEY, dirPath.trim());
    } else {
      localStorage.removeItem(CUSTOM_DIR_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
};

export const getDownloadHistory = () => {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveDownloadHistory = (items) => {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
  } catch {
    // ignore quota errors
  }
};

const notifyListeners = (event) => {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // ignore subscriber errors
    }
  });
};

export const subscribeDownloads = (callback) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};

export const removeDownloadHistoryItem = (id) => {
  const next = getDownloadHistory().filter((item) => item.id !== id);
  saveDownloadHistory(next);
  if (sessionBlobUrls.has(id)) {
    try {
      URL.revokeObjectURL(sessionBlobUrls.get(id));
    } catch {
      // ignore
    }
    sessionBlobUrls.delete(id);
  }
  notifyListeners({ type: 'updated', history: next });
  return next;
};

export const clearDownloadHistory = () => {
  sessionBlobUrls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  });
  sessionBlobUrls.clear();
  saveDownloadHistory([]);
  notifyListeners({ type: 'updated', history: [] });
  return [];
};

export const getSessionBlobUrl = (id) => sessionBlobUrls.get(id) || null;

export const redownloadSessionItem = (item) => {
  const url = sessionBlobUrls.get(item.id);
  if (!url) return false;
  const a = document.createElement('a');
  a.href = url;
  a.download = item.fileName || 'download';
  a.setAttribute('data-bypass-download', 'true');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
};

const getExtension = (fileName = '') => {
  const clean = String(fileName).split('?')[0];
  const idx = clean.lastIndexOf('.');
  if (idx <= 0 || idx === clean.length - 1) return '';
  return clean.slice(idx + 1).toLowerCase();
};

const getFileCategory = (ext, mimeType = '') => {
  if (ext === 'pdf' || mimeType.includes('pdf')) return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'].includes(ext) || mimeType.startsWith('image/')) return 'image';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || mimeType.includes('zip')) return 'zip';
  if (['txt', 'csv', 'xlsx', 'xls', 'json', 'md'].includes(ext) || mimeType.startsWith('text/')) return 'doc';
  return 'other';
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });

const recordHistoryEntry = (entry) => {
  const prev = getDownloadHistory();
  const next = [entry, ...prev].slice(0, MAX_HISTORY_ITEMS);
  saveDownloadHistory(next);
  notifyListeners({ type: 'downloaded', item: entry, history: next });
  return entry;
};

export const downloadBlob = async (blob, fileName = 'download', sourceTool) => {
  if (!blob) return null;

  const finalTool = sourceTool || currentSourceTool || 'WorkTools';
  const safeFileName = String(fileName || 'download').trim() || 'download';
  const ext = getExtension(safeFileName);
  const mimeType = blob.type || '';
  const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Native Tauri (Rust) save: gives exact file path, prevents silent overwrite, supports Open File & Show in Folder
  if (typeof window !== 'undefined' && window.electronAPI?.saveDownloadFile) {
    try {
      const dataUrl = await blobToDataUrl(blob);
      const customDir = getCustomDownloadDir();
      const res = await window.electronAPI.saveDownloadFile(safeFileName, dataUrl, customDir);
      if (res?.success) {
        return recordHistoryEntry({
          id,
          fileName: res.fileName || safeFileName,
          originalName: safeFileName,
          filePath: res.filePath || '',
          dirPath: res.dirPath || '',
          size: typeof res.size === 'number' ? res.size : blob.size || 0,
          ext: getExtension(res.fileName || safeFileName) || ext,
          category: getFileCategory(getExtension(res.fileName || safeFileName) || ext, mimeType),
          mimeType,
          sourceTool: finalTool,
          timestamp: Date.now(),
          isDesktop: true,
        });
      }
    } catch (err) {
      console.error('Native saveDownloadFile failed, falling back to browser download:', err);
    }
  }

  // Web Browser / Electron fallback
  saveAs(blob, safeFileName);
  try {
    const objUrl = URL.createObjectURL(blob);
    sessionBlobUrls.set(id, objUrl);
  } catch {
    // ignore
  }

  return recordHistoryEntry({
    id,
    fileName: safeFileName,
    originalName: safeFileName,
    filePath: '',
    dirPath: '',
    size: blob.size || 0,
    ext,
    category: getFileCategory(ext, mimeType),
    mimeType,
    sourceTool: finalTool,
    timestamp: Date.now(),
    isDesktop: false,
  });
};

export const initGlobalDownloadInterceptor = () => {
  if (typeof document === 'undefined' || interceptorInitialized) return;
  interceptorInitialized = true;

  document.addEventListener(
    'click',
    (e) => {
      const anchor = e.target?.closest?.('a[download]');
      if (!anchor) return;
      if (anchor.getAttribute('data-bypass-download') === 'true') return;

      const href = anchor.getAttribute('href');
      if (!href || (!href.startsWith('blob:') && !href.startsWith('data:'))) return;

      e.preventDefault();
      e.stopPropagation();

      const downloadName = anchor.getAttribute('download') || 'download';

      (async () => {
        try {
          const response = await fetch(href);
          const blob = await response.blob();
          await downloadBlob(blob, downloadName);
        } catch (err) {
          console.error('Intercepted download failed, falling back:', err);
          anchor.setAttribute('data-bypass-download', 'true');
          anchor.click();
          setTimeout(() => anchor.removeAttribute('data-bypass-download'), 100);
        }
      })();
    },
    true
  );
};
