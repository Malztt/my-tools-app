import React, { useState, useMemo } from 'react';
import JSZip from 'jszip';
import {
  FolderPlus,
  FolderOpen,
  Folder,
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { downloadBlob } from '../downloadManager';

const THAI_MONTHS = [
  '01_มกราคม',
  '02_กุมภาพันธ์',
  '03_มีนาคม',
  '04_เมษายน',
  '05_พฤษภาคม',
  '06_มิถุนายน',
  '07_กรกฎาคม',
  '08_สิงหาคม',
  '09_กันยายน',
  '10_ตุลาคม',
  '11_พฤศจิกายน',
  '12_ธันวาคม',
];

export default function BulkFolderCreator() {
  const isNativeDesktop =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.createBulkFolders);

  const [targetDir, setTargetDir] = useState('');
  const [rawInput, setRawInput] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [addNumbering, setAddNumbering] = useState(false);
  const [startNum, setStartNum] = useState(1);
  const [padDigits, setPadDigits] = useState(2);
  const [numSep, setNumSep] = useState('_');
  const [subfoldersTemplate, setSubfoldersTemplate] = useState(''); // e.g. "เอกสาร, รูปภาพ, สรุปผล"

  const [creating, setCreating] = useState(false);
  const [resultMsg, setResultMsg] = useState(null);

  const parsedFolders = useMemo(() => {
    const lines = rawInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const subs = subfoldersTemplate
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const out = [];
    const seen = new Set();

    lines.forEach((line, idx) => {
      // Support pasting multiple columns from Excel (replace tab with space or /)
      const normalized = line.replace(/\t+/g, ' - ').replace(/[<>:"|?*]/g, '_');
      const numStr = addNumbering
        ? `${String(startNum + idx).padStart(padDigits, '0')}${numSep}`
        : '';

      // Apply prefix/suffix to last segment if nested path
      const segs = normalized
        .replace(/\\/g, '/')
        .split('/')
        .map((s) => s.trim())
        .filter((s) => s && s !== '.' && s !== '..');

      if (segs.length === 0) return;

      const lastIdx = segs.length - 1;
      segs[lastIdx] = `${numStr}${prefix}${segs[lastIdx]}${suffix}`;
      const basePath = segs.join('/');

      if (subs.length > 0) {
        subs.forEach((sub) => {
          const full = `${basePath}/${sub}`;
          if (!seen.has(full)) {
            seen.add(full);
            out.push(full);
          }
        });
      } else if (!seen.has(basePath)) {
        seen.add(basePath);
        out.push(basePath);
      }
    });

    return out;
  }, [rawInput, prefix, suffix, addNumbering, startNum, padDigits, numSep, subfoldersTemplate]);

  const handleSelectTargetDir = async () => {
    if (!window.electronAPI?.selectTargetFolder) return;
    const res = await window.electronAPI.selectTargetFolder('เลือกโฟลเดอร์ปลายทางสำหรับสร้างโฟลเดอร์ย่อย');
    if (!res?.canceled && res?.dirPath) {
      setTargetDir(res.dirPath);
      setResultMsg(null);
    }
  };

  const handleCreateFolders = async () => {
    if (parsedFolders.length === 0) return;
    setCreating(true);
    setResultMsg(null);

    try {
      if (isNativeDesktop) {
        if (!targetDir) {
          setResultMsg({ type: 'error', text: 'กรุณาเลือกโฟลเดอร์ปลายทางก่อนสร้าง' });
          setCreating(false);
          return;
        }
        const res = await window.electronAPI.createBulkFolders(targetDir, parsedFolders);
        if (res?.success) {
          setResultMsg({
            type: 'success',
            text: `สร้างโฟลเดอร์สำเร็จ ${res.createdCount} โฟลเดอร์${
              res.existingCount > 0 ? ` (มีอยู่แล้ว ${res.existingCount})` : ''
            }${res.failedCount > 0 ? ` • ไม่สำเร็จ ${res.failedCount}` : ''}`,
          });
        } else {
          setResultMsg({ type: 'error', text: res?.error || 'สร้างโฟลเดอร์ไม่สำเร็จ' });
        }
      } else {
        // Web fallback: pack empty folders inside a ZIP
        const zip = new JSZip();
        parsedFolders.forEach((folderPath) => {
          zip.folder(folderPath);
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        await downloadBlob(
          blob,
          `bulk-folders-${new Date().toISOString().slice(0, 10)}.zip`,
          'สร้างโฟลเดอร์เป็นชุด'
        );
        setResultMsg({
          type: 'success',
          text: `สร้างไฟล์ ZIP รวม ${parsedFolders.length} โฟลเดอร์เรียบร้อยแล้ว (แตกไฟล์เพื่อใช้งาน)`,
        });
      }
    } catch (err) {
      setResultMsg({ type: 'error', text: err.message || 'เกิดข้อผิดพลาด' });
    } finally {
      setCreating(false);
    }
  };

  const applyTemplate = (type) => {
    if (type === 'months') {
      setRawInput(THAI_MONTHS.join('\n'));
      setAddNumbering(false);
    } else if (type === 'quarters') {
      setRawInput('ไตรมาส 1 (ต.ค.-ธ.ค.)\nไตรมาส 2 (ม.ค.-มี.ค.)\nไตรมาส 3 (เม.ย.-มิ.ย.)\nไตรมาส 4 (ก.ค.-ก.ย.)');
      setAddNumbering(false);
    } else if (type === 'project') {
      setRawInput('01_เอกสารต้นฉบับ\n02_แบบร่างและแก้ไข\n03_รูปภาพประกอบ\n04_ไฟล์ส่งมอบสุดท้าย');
      setAddNumbering(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
          <FolderPlus className="text-indigo-600" size={26} />
          <span>สร้างโฟลเดอร์เป็นชุด (Bulk Folder Creator)</span>
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          วางรายชื่อจาก Excel หรือพิมพ์ทีละบรรทัดเพื่อสร้างโฟลเดอร์ทีเดียวหลายสิบ/หลายร้อยโฟลเดอร์ รองรับโฟลเดอร์ซ้อนด้วยเครื่องหมาย <code className="px-1.5 py-0.5 rounded bg-gray-100 text-xs">/</code>
        </p>
      </div>

      {/* Target Directory Bar (Desktop) */}
      {isNativeDesktop && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <FolderOpen size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-gray-500">สร้างโฟลเดอร์ไว้ในตำแหน่ง</div>
              <div className="text-sm font-mono text-gray-800 truncate mt-0.5" title={targetDir}>
                {targetDir || 'ยังไม่ได้เลือกโฟลเดอร์ปลายทาง'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {targetDir && (
              <button
                type="button"
                onClick={() => window.electronAPI?.showInFolder?.(targetDir)}
                className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-all"
              >
                เปิดโฟลเดอร์
              </button>
            )}
            <button
              type="button"
              onClick={handleSelectTargetDir}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all"
            >
              {targetDir ? 'เปลี่ยนโฟลเดอร์' : 'เลือกโฟลเดอร์ปลายทาง'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Input & Options (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-semibold text-gray-700">
              รายชื่อโฟลเดอร์ (1 บรรทัด = 1 โฟลเดอร์ • ก๊อปวางจาก Excel ได้เลย)
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => applyTemplate('months')}
                className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-[11px] font-medium flex items-center gap-1"
              >
                <Sparkles size={11} /> 12 เดือนไทย
              </button>
              <button
                type="button"
                onClick={() => applyTemplate('quarters')}
                className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-[11px] font-medium"
              >
                4 ไตรมาส
              </button>
              <button
                type="button"
                onClick={() => applyTemplate('project')}
                className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-[11px] font-medium"
              >
                ชุดงานเอกสาร
              </button>
              {rawInput && (
                <button
                  type="button"
                  onClick={() => setRawInput('')}
                  className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
                  title="ล้างข้อความ"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          <textarea
            rows={9}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder={'นายสมชาย ใจดี\nนางสาวสมหญิง รักงาน\nแผนกบัญชี/รายงานประจำเดือน\n...'}
            className="w-full p-3.5 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />

          {/* Prefix / Suffix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">คำนำหน้า (Prefix)</label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="เช่น 2569_"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">คำต่อท้าย (Suffix)</label>
              <input
                type="text"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                placeholder="เช่น _เสร็จแล้ว"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Auto Numbering */}
          <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={addNumbering}
                onChange={(e) => setAddNumbering(e.target.checked)}
                className="rounded accent-indigo-600"
              />
              <span>รันเลขลำดับนำหน้าอัตโนมัติ (เช่น 01_, 02_, 03_)</span>
            </label>

            {addNumbering && (
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">เริ่มเลขที่</label>
                  <input
                    type="number"
                    min={0}
                    value={startNum}
                    onChange={(e) => setStartNum(Math.max(0, Number(e.target.value)))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">จำนวนหลัก</label>
                  <select
                    value={padDigits}
                    onChange={(e) => setPadDigits(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs bg-white"
                  >
                    <option value={1}>1 หลัก (1, 2)</option>
                    <option value={2}>2 หลัก (01, 02)</option>
                    <option value={3}>3 หลัก (001, 002)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">ตัวคั่น</label>
                  <input
                    type="text"
                    value={numSep}
                    onChange={(e) => setNumSep(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs bg-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Optional Subfolders inside every created folder */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              สร้างโฟลเดอร์ย่อยข้างในทุกโฟลเดอร์ (คั่นด้วยลูกน้ำ , — ไม่บังคับ)
            </label>
            <input
              type="text"
              value={subfoldersTemplate}
              onChange={(e) => setSubfoldersTemplate(e.target.value)}
              placeholder="เช่น เอกสาร, รูปภาพ, ใบเสร็จ"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Right: Live Preview & Execute (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-800">ตัวอย่างโฟลเดอร์ที่จะสร้าง</h3>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
              {parsedFolders.length} โฟลเดอร์
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1.5">
            {parsedFolders.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">
                พิมพ์หรือวางรายชื่อทางซ้ายเพื่อดูตัวอย่างโฟลเดอร์
              </p>
            ) : (
              parsedFolders.map((path, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-700 font-mono">
                  <Folder size={14} className="text-amber-500 shrink-0" />
                  <span className="truncate" title={path}>
                    {path}
                  </span>
                </div>
              ))
            )}
          </div>

          {resultMsg && (
            <div
              className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 border ${
                resultMsg.type === 'error'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {resultMsg.type === 'error' ? (
                <AlertCircle size={15} className="shrink-0" />
              ) : (
                <CheckCircle2 size={15} className="shrink-0" />
              )}
              <span>{resultMsg.text}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleCreateFolders}
            disabled={creating || parsedFolders.length === 0 || (isNativeDesktop && !targetDir)}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {creating ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : isNativeDesktop ? (
              <FolderPlus size={16} />
            ) : (
              <Download size={16} />
            )}
            <span>
              {creating
                ? 'กำลังสร้างโฟลเดอร์...'
                : isNativeDesktop
                ? `สร้างทั้งหมด ${parsedFolders.length} โฟลเดอร์ทันที`
                : `ดาวน์โหลดเป็น ZIP (${parsedFolders.length} โฟลเดอร์)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
