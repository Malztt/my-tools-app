import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  Sparkles,
  Download,
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
  Wand2,
  SlidersHorizontal,
  Eraser,
  Paintbrush,
  Undo2,
  MousePointerClick,
  Eye,
} from 'lucide-react';
import { downloadBlob } from '../downloadManager';

export default function BackgroundRemover() {
  const [mode, setMode] = useState('ai'); // 'ai' | 'solid'
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [hasResult, setHasResult] = useState(false);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState('');

  // Solid / Magic Wand settings
  const [targetColor, setTargetColor] = useState('#ffffff');
  const [tolerance, setTolerance] = useState(32);
  const [softness, setSoftness] = useState(12);

  // Manual Editor tools on Result Canvas
  const [editTool, setEditTool] = useState('erase'); // 'view' | 'erase' | 'restore' | 'wand'
  const [brushSize, setBrushSize] = useState(36); // in original image px (scaled nicely)
  const [undoCount, setUndoCount] = useState(0);
  const [cursorPos, setCursorPos] = useState(null); // { x, y, r } in display CSS px

  // Output background preview & export
  const [outputBg, setOutputBg] = useState('transparent'); // transparent | white | custom
  const [customBgColor, setCustomBgColor] = useState('#ffffff');
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef(null);
  const origCanvasRef = useRef(null);
  const workCanvasRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const undoStackRef = useRef([]);
  const isDrawingRef = useRef(false);
  const lastPtRef = useRef(null);

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  const redrawDisplay = useCallback(() => {
    const work = workCanvasRef.current;
    const display = displayCanvasRef.current;
    if (!work || !display || work.width === 0 || work.height === 0) return;

    if (display.width !== work.width || display.height !== work.height) {
      display.width = work.width;
      display.height = work.height;
    }
    const ctx = display.getContext('2d');
    ctx.clearRect(0, 0, display.width, display.height);
    ctx.drawImage(work, 0, 0);
  }, []);

  useEffect(() => {
    if (hasResult) {
      redrawDisplay();
    }
  }, [hasResult, redrawDisplay]);

  const pushUndoSnapshot = () => {
    const work = workCanvasRef.current;
    if (!work || work.width === 0) return;
    const ctx = work.getContext('2d');
    const snap = ctx.getImageData(0, 0, work.width, work.height);
    undoStackRef.current.push(snap);
    if (undoStackRef.current.length > 15) {
      undoStackRef.current.shift();
    }
    setUndoCount(undoStackRef.current.length);
  };

  const handleUndo = () => {
    const work = workCanvasRef.current;
    if (!work || undoStackRef.current.length === 0) return;
    const snap = undoStackRef.current.pop();
    const ctx = work.getContext('2d');
    ctx.putImageData(snap, 0, 0);
    setUndoCount(undoStackRef.current.length);
    redrawDisplay();
  };

  const loadImageToCanvas = async (url) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const orig = document.createElement('canvas');
    orig.width = img.naturalWidth;
    orig.height = img.naturalHeight;
    orig.getContext('2d').drawImage(img, 0, 0);
    origCanvasRef.current = orig;

    const work = document.createElement('canvas');
    work.width = img.naturalWidth;
    work.height = img.naturalHeight;
    work.getContext('2d').drawImage(img, 0, 0);
    workCanvasRef.current = work;

    undoStackRef.current = [];
    setUndoCount(0);

    // Pick sensible default brush size proportional to image dimension
    const autoBrush = Math.max(12, Math.min(140, Math.round(Math.max(img.naturalWidth, img.naturalHeight) * 0.035)));
    setBrushSize(autoBrush);
    setHasResult(true);
    setTimeout(() => redrawDisplay(), 0);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);

    const url = URL.createObjectURL(file);
    setSourceFile(file);
    setSourceUrl(url);
    setError('');
    setProgressText('');
    setProgressPct(0);
    e.target.value = '';

    try {
      await loadImageToCanvas(url);
    } catch {
      setError('ไม่สามารถโหลดรูปภาพได้');
    }
  };

  const hexToRgb = (hex) => {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };

  // Mode 1: AI Offline Removal (ISNet ONNX via @imgly/background-removal)
  const runAiRemoval = async () => {
    if (!sourceFile || !origCanvasRef.current) return;
    setProcessing(true);
    setError('');
    setProgressPct(5);
    setProgressText('กำลังเตรียมโมเดล AI (ISNet ONNX)...');

    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const blob = await removeBackground(sourceFile, {
        model: 'isnet_fp16',
        output: { format: 'image/png', quality: 1 },
        progress: (key, current, total) => {
          if (total > 0) {
            const pct = Math.min(99, Math.round((current / total) * 100));
            setProgressPct(pct);
            if (String(key).includes('fetch')) {
              setProgressText(`กำลังดาวน์โหลดโมเดล AI (เก็บลง cache ใช้ครั้งต่อไปได้ทันที) ${pct}%`);
            } else {
              setProgressText(`กำลังวิเคราะห์และลบพื้นหลังด้วย AI... ${pct}%`);
            }
          }
        },
      });

      const blobUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = blobUrl;
      });
      URL.revokeObjectURL(blobUrl);

      pushUndoSnapshot();
      const work = workCanvasRef.current;
      const ctx = work.getContext('2d');
      ctx.clearRect(0, 0, work.width, work.height);
      ctx.drawImage(img, 0, 0, work.width, work.height);
      redrawDisplay();

      setProgressPct(100);
      setProgressText('ลบพื้นหลังเสร็จสมบูรณ์! สามารถใช้แปรงลบ/กู้คืนปรับแต่งต่อได้ทันที');
    } catch (err) {
      console.error(err);
      setError(
        `ประมวลผล AI ไม่สำเร็จ: ${err?.message || 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตสำหรับการโหลดโมเดลครั้งแรก'}`
      );
    } finally {
      setProcessing(false);
    }
  };

  // Mode 2: Fast Solid / White Background Removal (Signatures, Stamps, Logos)
  const runSolidRemoval = () => {
    const orig = origCanvasRef.current;
    const work = workCanvasRef.current;
    if (!orig || !work) return;
    setProcessing(true);
    setError('');

    try {
      pushUndoSnapshot();
      const origCtx = orig.getContext('2d');
      const imgData = origCtx.getImageData(0, 0, orig.width, orig.height);
      const data = imgData.data;
      const [tr, tg, tb] = hexToRgb(targetColor);
      const maxDist = (tolerance / 100) * 442;
      const softBand = Math.max(1, (softness / 100) * 180);

      for (let i = 0; i < data.length; i += 4) {
        const dr = data[i] - tr;
        const dg = data[i + 1] - tg;
        const db = data[i + 2] - tb;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);

        if (dist <= maxDist) {
          data[i + 3] = 0;
        } else if (dist < maxDist + softBand) {
          const factor = (dist - maxDist) / softBand;
          data[i + 3] = Math.round(data[i + 3] * factor);
        }
      }

      work.getContext('2d').putImageData(imgData, 0, 0);
      redrawDisplay();
    } catch (err) {
      setError(`ตัดพื้นหลังไม่สำเร็จ: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleResetToOriginal = () => {
    const orig = origCanvasRef.current;
    const work = workCanvasRef.current;
    if (!orig || !work) return;
    pushUndoSnapshot();
    const ctx = work.getContext('2d');
    ctx.clearRect(0, 0, work.width, work.height);
    ctx.drawImage(orig, 0, 0);
    redrawDisplay();
  };

  // --- Interactive Canvas Editing (Erase / Restore / Magic Wand Flood Fill) ---
  const getCanvasPoint = (e) => {
    const display = displayCanvasRef.current;
    if (!display) return null;
    const rect = display.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = display.width / rect.width;
    const scaleY = display.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      cssX: e.clientX - rect.left,
      cssY: e.clientY - rect.top,
      cssRadius: (brushSize / 2) / scaleX,
    };
  };

  const applyBrushDot = (x, y) => {
    const work = workCanvasRef.current;
    const orig = origCanvasRef.current;
    if (!work || !orig) return;
    const ctx = work.getContext('2d');
    const radius = brushSize / 2;

    if (editTool === 'erase') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (editTool === 'restore') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(orig, 0, 0);
      ctx.restore();
    }
  };

  const applyBrushSegment = (p1, p2) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, brushSize * 0.22);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      applyBrushDot(p1.x + dx * t, p1.y + dy * t);
    }
    redrawDisplay();
  };

  const runMagicWandAt = (startX, startY) => {
    const work = workCanvasRef.current;
    if (!work) return;
    const w = work.width;
    const h = work.height;
    const sx = Math.floor(startX);
    const sy = Math.floor(startY);
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

    pushUndoSnapshot();
    const ctx = work.getContext('2d');
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const startIdx = (sy * w + sx) * 4;
    if (data[startIdx + 3] === 0) return;

    const sr = data[startIdx];
    const sg = data[startIdx + 1];
    const sb = data[startIdx + 2];
    const maxDist = (tolerance / 100) * 442;
    const maxDistSq = maxDist * maxDist;

    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;

    const startPos = sy * w + sx;
    visited[startPos] = 1;
    queue[tail++] = startPos;

    while (head < tail) {
      const pos = queue[head++];
      const idx = pos * 4;
      data[idx + 3] = 0;

      const cx = pos % w;
      const cy = (pos - cx) / w;

      const neighbors = [
        cx > 0 ? pos - 1 : -1,
        cx < w - 1 ? pos + 1 : -1,
        cy > 0 ? pos - w : -1,
        cy < h - 1 ? pos + w : -1,
      ];

      for (let i = 0; i < 4; i++) {
        const npos = neighbors[i];
        if (npos < 0 || visited[npos]) continue;
        visited[npos] = 1;
        const nidx = npos * 4;
        if (data[nidx + 3] === 0) continue;
        const dr = data[nidx] - sr;
        const dg = data[nidx + 1] - sg;
        const db = data[nidx + 2] - sb;
        if (dr * dr + dg * dg + db * db <= maxDistSq) {
          queue[tail++] = npos;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    redrawDisplay();
  };

  const handlePointerDown = (e) => {
    if (editTool === 'view' || !hasResult) return;
    e.preventDefault();
    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (editTool === 'wand') {
      runMagicWandAt(pt.x, pt.y);
      return;
    }

    e.currentTarget.setPointerCapture?.(e.pointerId);
    pushUndoSnapshot();
    isDrawingRef.current = true;
    lastPtRef.current = pt;
    applyBrushDot(pt.x, pt.y);
    redrawDisplay();
  };

  const handlePointerMove = (e) => {
    const pt = getCanvasPoint(e);
    if (pt && (editTool === 'erase' || editTool === 'restore')) {
      setCursorPos({ x: pt.cssX, y: pt.cssY, r: Math.max(4, pt.cssRadius) });
    } else {
      setCursorPos(null);
    }

    if (!isDrawingRef.current || !pt || !lastPtRef.current) return;
    e.preventDefault();
    applyBrushSegment(lastPtRef.current, pt);
    lastPtRef.current = pt;
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
    lastPtRef.current = null;
  };

  // Build final export blob from editable workCanvasRef
  const buildFinalBlob = async (format = 'png') => {
    const work = workCanvasRef.current;
    if (!work || work.width === 0) return null;

    const out = document.createElement('canvas');
    out.width = work.width;
    out.height = work.height;
    const ctx = out.getContext('2d');

    if (outputBg === 'white' || (format === 'jpeg' && outputBg === 'transparent')) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
    } else if (outputBg === 'custom') {
      ctx.fillStyle = customBgColor;
      ctx.fillRect(0, 0, out.width, out.height);
    }

    ctx.drawImage(work, 0, 0);
    return new Promise((resolve) =>
      out.toBlob(resolve, format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.95)
    );
  };

  const handleDownload = async (format = 'png') => {
    const blob = await buildFinalBlob(format);
    if (!blob) return;
    const baseName = (sourceFile?.name || 'image').replace(/\.[^.]+$/, '');
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    await downloadBlob(blob, `${baseName}-nobg.${ext}`, 'ลบพื้นหลังรูปภาพ');
  };

  const handleCopyImage = async () => {
    const blob = await buildFinalBlob('png');
    if (!blob) return;
    try {
      if (window.electronAPI?.copyImageToClipboard) {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        await window.electronAPI.copyImageToClipboard(dataUrl);
      } else {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('คัดลอกรูปภาพไม่สำเร็จ กรุณากดดาวน์โหลดแทน');
    }
  };

  const previewBgStyle =
    outputBg === 'transparent'
      ? {
          backgroundImage: 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%)',
          backgroundSize: '18px 18px',
        }
      : { backgroundColor: outputBg === 'white' ? '#ffffff' : customBgColor };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
          <Wand2 className="text-indigo-600" size={26} />
          <span>ลบพื้นหลังรูปภาพ (Background Remover)</span>
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          ลบพื้นหลังด้วย <strong>AI ออฟไลน์ (ISNet ONNX)</strong>, <strong>ตัดพื้นขาวไวพิเศษ</strong> หรือ <strong>ใช้แปรงลบ/กู้คืน &amp; คทาวิเศษเลือกพื้นที่เอง</strong> บนภาพได้โดยตรง
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-2 rounded-2xl border border-gray-200 shadow-sm">
        <button
          type="button"
          onClick={() => {
            setMode('ai');
            setError('');
          }}
          className={`py-3 px-4 rounded-xl text-left transition-all flex items-center gap-3 ${
            mode === 'ai'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Sparkles size={20} className="shrink-0" />
          <div>
            <div className="text-sm font-bold">โหมด AI ออฟไลน์ (ISNet ONNX)</div>
            <div className={`text-[11px] ${mode === 'ai' ? 'text-indigo-100' : 'text-gray-400'}`}>
              เหมาะกับรูปคน สินค้า สัตว์ ฉากหลังซับซ้อน
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setMode('solid');
            setError('');
          }}
          className={`py-3 px-4 rounded-xl text-left transition-all flex items-center gap-3 ${
            mode === 'solid'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <SlidersHorizontal size={20} className="shrink-0" />
          <div>
            <div className="text-sm font-bold">โหมดตัดพื้นขาว / สีเรียบ (ทันที)</div>
            <div className={`text-[11px] ${mode === 'solid' ? 'text-emerald-100' : 'text-gray-400'}`}>
              เหมาะกับลายเซ็น ตราประทับ โลโก้พื้นขาว (&lt; 0.1 วิ)
            </div>
          </div>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />

      {!sourceFile ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="bg-white p-12 rounded-2xl border-2 border-dashed border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/20 transition-all text-center cursor-pointer"
        >
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4">
            <Upload size={30} />
          </div>
          <p className="text-base font-semibold text-gray-800">คลิกเพื่อเลือกรูปภาพ (PNG, JPG, WebP)</p>
          <p className="text-xs text-gray-500 mt-1">
            รูปภาพประมวลผลในเครื่องของคุณโดยตรง ไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์ภายนอก
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Top Auto-Removal Controls */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-medium text-gray-600 truncate">
                ไฟล์ต้นฉบับ: <span className="font-semibold text-gray-900">{sourceFile.name}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700"
                >
                  เปลี่ยนรูป
                </button>
                <button
                  type="button"
                  onClick={handleResetToOriginal}
                  className="px-3.5 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-medium text-gray-600"
                >
                  คืนภาพต้นฉบับ
                </button>
                <button
                  type="button"
                  onClick={mode === 'ai' ? runAiRemoval : runSolidRemoval}
                  disabled={processing}
                  className={`px-5 py-2 rounded-xl text-white text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-all disabled:opacity-50 ${
                    mode === 'ai' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {processing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  <span>
                    {processing
                      ? 'กำลังลบพื้นหลัง...'
                      : mode === 'ai'
                      ? 'ลบพื้นหลังอัตโนมัติ (AI)'
                      : 'ตัดพื้นหลังสีเรียบทั้งภาพ'}
                  </span>
                </button>
              </div>
            </div>

            {mode === 'solid' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-gray-100">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">สีพื้นหลังที่จะลบ</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={targetColor}
                      onChange={(e) => setTargetColor(e.target.value)}
                      className="h-9 w-11 p-1 rounded-lg border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={targetColor}
                      onChange={(e) => setTargetColor(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-mono uppercase"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    ความเข้มการตัดสี (Tolerance): {tolerance}%
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={75}
                    value={tolerance}
                    onChange={(e) => setTolerance(Number(e.target.value))}
                    className="w-full accent-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    ความเนียนขอบ (Feather): {softness}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={softness}
                    onChange={(e) => setSoftness(Number(e.target.value))}
                    className="w-full accent-emerald-600"
                  />
                </div>
              </div>
            )}

            {processing && mode === 'ai' && (
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-xs text-indigo-700 font-medium">
                  <span>{progressText}</span>
                  <span className="font-mono">{progressPct}%</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-200"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Manual Selection / Brush Refinement Toolbar */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-gray-700 mr-1">เลือกพื้นที่ลบ/กู้คืนเอง:</span>
                <button
                  type="button"
                  onClick={() => setEditTool('erase')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    editTool === 'erase'
                      ? 'bg-red-600 text-white border-red-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Eraser size={14} />
                  <span>ยางลบ (ลบเพิ่ม)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditTool('restore')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    editTool === 'restore'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Paintbrush size={14} />
                  <span>พู่กันกู้คืน</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditTool('wand')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    editTool === 'wand'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <MousePointerClick size={14} />
                  <span>คทาวิเศษ (จิ้มลบพื้นที่)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditTool('view')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    editTool === 'view'
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Eye size={14} />
                  <span>ดูอย่างเดียว</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleUndo}
                disabled={undoCount === 0}
                className="px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5 disabled:opacity-40"
              >
                <Undo2 size={14} />
                <span>ย้อนกลับ ({undoCount})</span>
              </button>
            </div>

            {(editTool === 'erase' || editTool === 'restore') && (
              <div className="flex items-center gap-3 pt-1">
                <span className="text-xs font-medium text-gray-600 shrink-0">
                  ขนาดหัวแปรง: <strong className="font-mono">{brushSize}px</strong>
                </span>
                <input
                  type="range"
                  min={6}
                  max={220}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="flex-1 max-w-xs accent-indigo-600"
                />
                <span className="text-[11px] text-gray-400 hidden sm:inline">
                  ลากเมาส์หรือนิ้วบนภาพด้านขวาเพื่อ{editTool === 'erase' ? 'ลบพื้นหลังเพิ่ม' : 'กู้คืนส่วนที่โดนตัดเกิน'}
                </span>
              </div>
            )}

            {editTool === 'wand' && (
              <div className="flex items-center gap-3 pt-1">
                <span className="text-xs font-medium text-gray-600 shrink-0">
                  ความกว้างสีคทาวิเศษ: <strong className="font-mono">{tolerance}%</strong>
                </span>
                <input
                  type="range"
                  min={5}
                  max={70}
                  value={tolerance}
                  onChange={(e) => setTolerance(Number(e.target.value))}
                  className="flex-1 max-w-xs accent-indigo-600"
                />
                <span className="text-[11px] text-gray-400 hidden sm:inline">
                  คลิกจิ้มตรงพื้นหลังในภาพด้านขวาเพื่อลบเฉพาะบริเวณที่ติดกัน
                </span>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Before / Interactive After Canvas */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Before (4 cols) */}
            <div className="lg:col-span-4 bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-2.5">
              <div className="text-xs font-bold text-gray-500">ภาพต้นฉบับ (Before)</div>
              <div className="bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center p-2 max-h-[420px]">
                <img src={sourceUrl} alt="Original" className="max-w-full max-h-[390px] object-contain" />
              </div>
            </div>

            {/* Interactive After Editor (8 cols) */}
            <div className="lg:col-span-8 bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-gray-700">
                  พื้นที่แก้ไขและผลลัพธ์ (After — ระบายหรือจิ้มลบได้ตรงนี้)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOutputBg('transparent')}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium border ${
                      outputBg === 'transparent'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    โปร่งใส
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutputBg('white')}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium border ${
                      outputBg === 'white'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    พื้นขาว
                  </button>
                  <label className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-gray-200 cursor-pointer">
                    <input
                      type="color"
                      value={customBgColor}
                      onChange={(e) => {
                        setCustomBgColor(e.target.value);
                        setOutputBg('custom');
                      }}
                      className="w-3.5 h-3.5 border-0 p-0 cursor-pointer"
                    />
                    <span>สีพื้น</span>
                  </label>
                </div>
              </div>

              <div
                className="rounded-xl overflow-hidden flex items-center justify-center p-3 border border-gray-200 min-h-[320px]"
                style={previewBgStyle}
              >
                <div className="relative inline-flex items-center justify-center max-w-full">
                  <canvas
                    ref={displayCanvasRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onPointerLeave={() => {
                      handlePointerUp();
                      setCursorPos(null);
                    }}
                    className={`max-w-full max-h-[480px] object-contain touch-none select-none ${
                      editTool === 'wand'
                        ? 'cursor-crosshair'
                        : editTool === 'erase' || editTool === 'restore'
                        ? 'cursor-none'
                        : 'cursor-default'
                    }`}
                  />
                  {cursorPos && (editTool === 'erase' || editTool === 'restore') && (
                    <div
                      className={`pointer-events-none absolute rounded-full border-2 shadow-sm ${
                        editTool === 'erase' ? 'border-red-500 bg-red-500/15' : 'border-emerald-500 bg-emerald-500/15'
                      }`}
                      style={{
                        left: cursorPos.x - cursorPos.r,
                        top: cursorPos.y - cursorPos.r,
                        width: cursorPos.r * 2,
                        height: cursorPos.r * 2,
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleDownload('png')}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Download size={14} />
                  <span>ดาวน์โหลด PNG (พื้นหลังโปร่งใส)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload('jpeg')}
                  className="py-2.5 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Download size={14} />
                  <span>JPG</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyImage}
                  className="py-2.5 px-4 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกรูป'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
