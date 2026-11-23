import React, { useState, useMemo, useRef } from 'react';
import {
  FolderOpen,
  Search,
  Trash2,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Copy,
  HardDrive,
  FileText,
} from 'lucide-react';

const formatBytes = (bytes = 0) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export default function DuplicateFinder() {
  const isNativeDesktop =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.scanDuplicateFiles);

  const [rootDir, setRootDir] = useState('');
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [skipEmptyFiles, setSkipEmptyFiles] = useState(true);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [selectedPaths, setSelectedPaths] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  const webDirInputRef = useRef(null);

  const handleSelectFolder = async () => {
    if (isNativeDesktop) {
      const res = await window.electronAPI.selectTargetFolder('เลือกโฟลเดอร์ที่ต้องการสแกนหาไฟล์ซ้ำ');
      if (!res?.canceled && res?.dirPath) {
        setRootDir(res.dirPath);
        setScanResult(null);
        setSelectedPaths(new Set());
        setStatusMsg(null);
      }
    } else {
      webDirInputRef.current?.click();
    }
  };

  const handleNativeScan = async (dirOverride) => {
    const dir = dirOverride || rootDir;
    if (!dir) return;
    setScanning(true);
    setStatusMsg(null);
    setSelectedPaths(new Set());
    setConfirmDelete(false);

    try {
      const res = await window.electronAPI.scanDuplicateFiles(
        dir,
        includeSubfolders,
        skipEmptyFiles ? 1 : 0
      );
      if (res?.success) {
        setScanResult(res);
      } else {
        setStatusMsg({ type: 'error', text: res?.error || 'สแกนโฟลเดอร์ไม่สำเร็จ' });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message || 'เกิดข้อผิดพลาดขณะสแกน' });
    } finally {
      setScanning(false);
    }
  };

  // Web fallback scanner using SubtleCrypto SHA-256
  const handleWebFolderSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setScanning(true);
    setStatusMsg(null);
    setSelectedPaths(new Set());
    const t0 = performance.now();

    try {
      const filtered = files.filter((f) => (skipEmptyFiles ? f.size > 0 : true));
      const bySize = new Map();
      let totalBytes = 0;

      filtered.forEach((f) => {
        totalBytes += f.size;
        const arr = bySize.get(f.size) || [];
        arr.push(f);
        bySize.set(f.size, arr);
      });

      const byHash = new Map();
      for (const [, group] of bySize.entries()) {
        if (group.length < 2) continue;
        for (const f of group) {
          const buf = await f.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', buf);
          const hex = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          const list = byHash.get(hex) || [];
          list.push(f);
          byHash.set(hex, list);
        }
      }

      const duplicateGroups = [];
      let totalWastedBytes = 0;

      for (const [hash, group] of byHash.entries()) {
        if (group.length < 2) continue;
        group.sort((a, b) => a.lastModified - b.lastModified);
        const size = group[0].size;
        const wastedBytes = size * (group.length - 1);
        totalWastedBytes += wastedBytes;
        duplicateGroups.push({
          hash,
          size,
          wastedBytes,
          files: group.map((f) => ({
            name: f.name,
            fullPath: f.webkitRelativePath || f.name,
            dirPath: (f.webkitRelativePath || '').split('/').slice(0, -1).join('/'),
            size: f.size,
            modifiedMs: f.lastModified,
          })),
        });
      }

      duplicateGroups.sort((a, b) => b.wastedBytes - a.wastedBytes);
      setRootDir(files[0].webkitRelativePath?.split('/')?.[0] || 'โฟลเดอร์ที่เลือก');
      setScanResult({
        success: true,
        scannedFiles: files.length,
        totalBytesScanned: totalBytes,
        duplicateGroups,
        totalWastedBytes,
        elapsedMs: Math.round(performance.now() - t0),
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message || 'ไม่สามารถสแกนไฟล์ได้' });
    } finally {
      setScanning(false);
      e.target.value = '';
    }
  };

  const toggleSelect = (fullPath) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
    setConfirmDelete(false);
  };

  const autoSelect = (strategy) => {
    if (!scanResult?.duplicateGroups) return;
    const next = new Set();
    if (strategy === 'none') {
      setSelectedPaths(next);
      setConfirmDelete(false);
      return;
    }
    scanResult.duplicateGroups.forEach((group) => {
      const sorted = [...group.files].sort((a, b) => a.modifiedMs - b.modifiedMs);
      if (strategy === 'keep_oldest') {
        sorted.slice(1).forEach((f) => next.add(f.fullPath));
      } else if (strategy === 'keep_newest') {
        sorted.slice(0, -1).forEach((f) => next.add(f.fullPath));
      }
    });
    setSelectedPaths(next);
    setConfirmDelete(false);
  };

  const selectedBytes = useMemo(() => {
    if (!scanResult?.duplicateGroups) return 0;
    let total = 0;
    scanResult.duplicateGroups.forEach((g) => {
      g.files.forEach((f) => {
        if (selectedPaths.has(f.fullPath)) total += f.size;
      });
    });
    return total;
  }, [scanResult, selectedPaths]);

  const handleDeleteSelected = async () => {
    if (!isNativeDesktop || selectedPaths.size === 0) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 5000);
      return;
    }

    setDeleting(true);
    setStatusMsg(null);
    try {
      const paths = Array.from(selectedPaths);
      const res = await window.electronAPI.deleteFilesBatch(paths);
      if (res?.success) {
        setStatusMsg({
          type: 'success',
          text: `ลบไฟล์ซ้ำแล้ว ${res.deletedCount} ไฟล์ คืนพื้นที่ได้ ${formatBytes(res.freedBytes)}`,
        });
        setConfirmDelete(false);
        await handleNativeScan(rootDir);
      } else {
        setStatusMsg({ type: 'error', text: res?.error || 'ลบไฟล์ไม่สำเร็จ' });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message || 'เกิดข้อผิดพลาดขณะลบไฟล์' });
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (ms) => {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
          <Copy className="text-indigo-600" size={26} />
          <span>ค้นหาไฟล์ซ้ำในโฟลเดอร์ (Duplicate Finder)</span>
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          สแกนเทียบเนื้อหาไฟล์จริงด้วย SHA-256 (เร็วมากด้วย Rust) หาไฟล์ที่ซ้ำกัน 100% แม้ตั้งชื่อต่างกัน เพื่อลบคืนพื้นที่ดิสก์
        </p>
      </div>

      {/* Hidden Web Directory Input */}
      <input
        ref={webDirInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        onChange={handleWebFolderSelected}
        className="hidden"
      />

      {/* Folder Picker & Scan Controls */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <HardDrive size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-gray-500">โฟลเดอร์ที่ต้องการสแกน</div>
              <div className="text-sm font-mono text-gray-800 truncate mt-0.5" title={rootDir}>
                {rootDir || 'ยังไม่ได้เลือกโฟลเดอร์'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSelectFolder}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1.5"
            >
              <FolderOpen size={15} />
              <span>{rootDir ? 'เปลี่ยนโฟลเดอร์' : 'เลือกโฟลเดอร์'}</span>
            </button>

            {isNativeDesktop && (
              <button
                type="button"
                onClick={() => handleNativeScan()}
                disabled={!rootDir || scanning}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                {scanning ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />}
                <span>{scanning ? 'กำลังสแกน...' : 'เริ่มสแกนหาไฟล์ซ้ำ'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-gray-100 text-xs text-gray-600">
          {isNativeDesktop && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSubfolders}
                onChange={(e) => setIncludeSubfolders(e.target.checked)}
                className="rounded accent-indigo-600"
              />
              <span>สแกนรวมโฟลเดอร์ย่อยทั้งหมด</span>
            </label>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={skipEmptyFiles}
              onChange={(e) => setSkipEmptyFiles(e.target.checked)}
              className="rounded accent-indigo-600"
            />
            <span>ข้ามไฟล์ว่างขนาด 0 ไบต์</span>
          </label>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`p-3.5 rounded-xl text-xs font-medium flex items-center gap-2 border ${
            statusMsg.type === 'error'
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}
        >
          {statusMsg.type === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {scanning && (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center space-y-3">
          <RefreshCw size={28} className="animate-spin text-indigo-600 mx-auto" />
          <p className="text-sm font-semibold text-gray-800">กำลังสแกนและตรวจสอบ SHA-256 Hash ของไฟล์...</p>
          <p className="text-xs text-gray-400">ความเร็วระดับ Native Rust — โฟลเดอร์ขนาดใหญ่อาจใช้เวลาสักครู่</p>
        </div>
      )}

      {/* Results Summary & Actions */}
      {!scanning && scanResult && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="text-[11px] text-gray-500">ไฟล์ที่สแกนทั้งหมด</div>
              <div className="text-xl font-bold text-gray-900 mt-1">
                {scanResult.scannedFiles.toLocaleString()}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">
                ใช้เวลา {(scanResult.elapsedMs / 1000).toFixed(2)} วินาที
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="text-[11px] text-gray-500">กลุ่มไฟล์ซ้ำที่พบ</div>
              <div className="text-xl font-bold text-indigo-600 mt-1">
                {scanResult.duplicateGroups.length.toLocaleString()} กลุ่ม
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="text-[11px] text-gray-500">พื้นที่ซ้ำซ้อนทั้งหมด</div>
              <div className="text-xl font-bold text-amber-600 mt-1">
                {formatBytes(scanResult.totalWastedBytes)}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="text-[11px] text-gray-500">เลือกไว้เพื่อลบ</div>
              <div className="text-xl font-bold text-red-600 mt-1">
                {selectedPaths.size} ไฟล์
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">
                คืนพื้นที่ {formatBytes(selectedBytes)}
              </div>
            </div>
          </div>

          {scanResult.duplicateGroups.length === 0 ? (
            <div className="bg-white rounded-2xl border border-emerald-200 p-10 text-center space-y-2">
              <CheckCircle2 size={36} className="text-emerald-500 mx-auto" />
              <h3 className="font-bold text-gray-800">เยี่ยมมาก! ไม่พบไฟล์ซ้ำเลย</h3>
              <p className="text-xs text-gray-500">ทุกไฟล์ในโฟลเดอร์นี้มีเนื้อหาไม่ซ้ำกันครับ</p>
            </div>
          ) : (
            <>
              {/* Bulk Selection & Delete Bar */}
              <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">เลือกอัตโนมัติ:</span>
                  <button
                    type="button"
                    onClick={() => autoSelect('keep_oldest')}
                    className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold"
                  >
                    เก็บไฟล์เก่าสุด (ลบตัวใหม่)
                  </button>
                  <button
                    type="button"
                    onClick={() => autoSelect('keep_newest')}
                    className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold"
                  >
                    เก็บไฟล์ใหม่สุด (ลบตัวเก่า)
                  </button>
                  <button
                    type="button"
                    onClick={() => autoSelect('none')}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs font-medium"
                  >
                    ยกเลิกทั้งหมด
                  </button>
                </div>

                {isNativeDesktop ? (
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    disabled={deleting || selectedPaths.size === 0}
                    className={`px-4 py-2 rounded-xl text-white text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-all disabled:opacity-40 ${
                      confirmDelete ? 'bg-red-700 hover:bg-red-800 ring-2 ring-red-300' : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {deleting ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    <span>
                      {confirmDelete
                        ? `คลิกอีกครั้งเพื่อยืนยันลบ ${selectedPaths.size} ไฟล์ถาวร`
                        : `ลบไฟล์ที่เลือก (${selectedPaths.size})`}
                    </span>
                  </button>
                ) : (
                  <span className="text-[11px] text-amber-600 font-medium">
                    บนเบราว์เซอร์ดูรายการซ้ำได้เท่านั้น (ใช้ตัว Desktop .exe เพื่อกดลบไฟล์ในเครื่องโดยตรง)
                  </span>
                )}
              </div>

              {/* Duplicate Groups List */}
              <div className="space-y-3">
                {scanResult.duplicateGroups.map((group, gIdx) => (
                  <div key={group.hash} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-gray-700">
                        กลุ่ม #{gIdx + 1} • ซ้ำ {group.files.length} ไฟล์ ({formatBytes(group.size)} / ไฟล์)
                      </span>
                      <span className="text-amber-700 font-semibold">
                        ประหยัดได้สูงสุด {formatBytes(group.wastedBytes)}
                      </span>
                    </div>

                    <div className="divide-y divide-gray-100">
                      {group.files.map((f, fIdx) => {
                        const checked = selectedPaths.has(f.fullPath);
                        return (
                          <div
                            key={f.fullPath}
                            className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-colors ${
                              checked ? 'bg-red-50/50' : 'hover:bg-gray-50/60'
                            }`}
                          >
                            <label className="flex items-start gap-3 min-w-0 flex-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSelect(f.fullPath)}
                                className="mt-1 rounded accent-red-600 shrink-0"
                              />
                              <FileText size={16} className="text-gray-400 mt-0.5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold text-gray-900 truncate">
                                    {f.name}
                                  </span>
                                  {fIdx === 0 && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                                      เก่าสุด
                                    </span>
                                  )}
                                  {f.modifiedMs > 0 && (
                                    <span className="text-[11px] text-gray-400">{formatDate(f.modifiedMs)}</span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono text-gray-400 truncate mt-0.5" title={f.fullPath}>
                                  {f.fullPath}
                                </div>
                              </div>
                            </label>

                            {isNativeDesktop && (
                              <div className="flex items-center gap-1.5 shrink-0 pl-7 sm:pl-0">
                                <button
                                  type="button"
                                  onClick={() => window.electronAPI?.openFilePath?.(f.fullPath)}
                                  title="เปิดดูไฟล์"
                                  className="px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium flex items-center gap-1"
                                >
                                  <ExternalLink size={12} />
                                  <span>เปิด</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => window.electronAPI?.showInFolder?.(f.fullPath)}
                                  title="แสดงในโฟลเดอร์"
                                  className="px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium flex items-center gap-1"
                                >
                                  <FolderOpen size={12} />
                                  <span>โฟลเดอร์</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
