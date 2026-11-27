import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import {
  EyeOff,
  Upload,
  Download,
  Copy,
  Check,
  Undo2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Eye,
  ShieldCheck,
  Sparkles,
  Grid,
  Square,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { downloadBlob } from '../downloadManager';

// Apply a single redaction box (blur, pixelate, or solid bar) onto target 2D canvas context
const applyRedactionBox = (ctx, srcCanvas, box) => {
  const W = srcCanvas.width;
  const H = srcCanvas.height;
  const x = Math.max(0, Math.round(box.x * W));
  const y = Math.max(0, Math.round(box.y * H));
  const w = Math.max(1, Math.min(W - x, Math.round(box.w * W)));
  const h = Math.max(1, Math.min(H - y, Math.round(box.h * H)));
  if (w < 2 || h < 2) return;

  if (box.style === 'solid') {
    ctx.save();
    ctx.fillStyle = box.color || '#000000';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    return;
  }

  if (box.style === 'pixelate') {
    const blockSize = Math.max(4, Math.round((box.strength || 14) * (Math.max(W, H) / 1000)));
    const sw = Math.max(1, Math.ceil(w / blockSize));
    const sh = Math.max(1, Math.ceil(h / blockSize));
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(srcCanvas, x, y, w, h, 0, 0, sw, sh);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
    ctx.restore();
    return;
  }

  // Gaussian Blur: expand source crop with padding so edges don't bleed dark/transparent borders
  const blurPx = Math.max(4, Math.round((box.strength || 18) * (Math.max(W, H) / 1000)));
  const pad = blurPx * 2;
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sx2 = Math.min(W, x + w + pad);
  const sy2 = Math.min(H, y + h + pad);
  const sw = sx2 - sx;
  const sh = sy2 - sy;

  const tmp = document.createElement('canvas');
  tmp.width = sw;
  tmp.height = sh;
  const tctx = tmp.getContext('2d');
  tctx.filter = `blur(${blurPx}px)`;
  tctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(tmp, sx, sy, sw, sh);
  ctx.restore();
};

export default function PrivacyBlur() {
  const [file, setFile] = useState(null);
  const [fileKind, setFileKind] = useState(null); // 'image' | 'pdf'
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Pages array (for image: 1 item; for PDF: N items)
  // Each item: { pageNum, width, height, srcCanvas }
  const [pages, setPages] = useState([]);
  const [pageIdx, setPageIdx] = useState(0);

  // Redaction boxes per page index: { [pageIdx]: [{ id, x, y, w, h, style, strength, color }] }
  const [boxesByPage, setBoxesByPage] = useState({});
  const [style, setStyle] = useState('blur'); // 'blur' | 'pixelate' | 'solid'
  const [strength, setStrength] = useState(18); // blur px or pixelate block size
  const [solidColor, setSolidColor] = useState('#000000');
  const [showOriginal, setShowOriginal] = useState(false);

  // Live drawing box in normalized coords (0..1)
  const [draftBox, setDraftBox] = useState(null);

  const fileInputRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const dragStartRef = useRef(null);
  const pdfBytesRef = useRef(null);

  const activePage = pages[pageIdx] || null;
  const activeBoxes = useMemo(() => boxesByPage[pageIdx] || [], [boxesByPage, pageIdx]);
  const totalBoxesCount = Object.values(boxesByPage).reduce((sum, arr) => sum + arr.length, 0);

  // Load Image or PDF file
  const loadFile = useCallback(async (selected) => {
    if (!selected) return;
    const isPdf = selected.type === 'application/pdf' || selected.name.toLowerCase().endsWith('.pdf');
    const isImg = selected.type.startsWith('image/');
    if (!isPdf && !isImg) {
      setError('กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP) หรือไฟล์ PDF');
      return;
    }

    setError('');
    setLoading(true);
    setFile(selected);
    setPages([]);
    setBoxesByPage({});
    setPageIdx(0);
    setDraftBox(null);
    pdfBytesRef.current = null;

    try {
      if (isImg) {
        setFileKind('image');
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(selected);
        });
        const img = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = reject;
          im.src = dataUrl;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        setPages([{ pageNum: 1, width: c.width, height: c.height, srcCanvas: c }]);
      } else {
        setFileKind('pdf');
        const arrayBuf = await selected.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuf);
        pdfBytesRef.current = uint8;

        const pdf = await pdfjs.getDocument({ data: uint8.slice(0) }).promise;
        const renderedPages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 2.0 });
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.floor(vp.width));
          c.height = Math.max(1, Math.floor(vp.height));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          renderedPages.push({ pageNum: i, width: c.width, height: c.height, srcCanvas: c });
        }
        setPages(renderedPages);
      }
    } catch (err) {
      console.error(err);
      setError(`ไม่สามารถเปิดไฟล์ได้: ${err?.message || 'ไฟล์อาจเสียหายหรือติดรหัสผ่าน'}`);
      setFile(null);
      setFileKind(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Support Ctrl+V paste for instant screenshot redaction
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const pasted = items[i].getAsFile();
          if (pasted) {
            e.preventDefault();
            loadFile(pasted);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadFile]);

  // Render active page + all redaction boxes + active draft box
  const redraw = useCallback(() => {
    const canvas = displayCanvasRef.current;
    if (!canvas || !activePage) return;

    const src = activePage.srcCanvas;
    if (canvas.width !== src.width || canvas.height !== src.height) {
      canvas.width = src.width;
      canvas.height = src.height;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0);

    if (!showOriginal) {
      for (const box of activeBoxes) {
        applyRedactionBox(ctx, src, box);
      }
      if (draftBox && draftBox.w > 0.002 && draftBox.h > 0.002) {
        applyRedactionBox(ctx, src, draftBox);
        // Draw dashed selection outline while dragging
        ctx.save();
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = Math.max(2, canvas.width * 0.0025);
        ctx.setLineDash([8, 5]);
        ctx.strokeRect(
          draftBox.x * canvas.width,
          draftBox.y * canvas.height,
          draftBox.w * canvas.width,
          draftBox.h * canvas.height
        );
        ctx.restore();
      }
    }
  }, [activePage, activeBoxes, draftBox, showOriginal]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Convert pointer coordinates to normalized 0..1
  const getNormCoords = (e) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handlePointerDown = (e) => {
    if (!activePage || showOriginal) return;
    const pt = getNormCoords(e);
    dragStartRef.current = pt;
    setDraftBox({ x: pt.x, y: pt.y, w: 0, h: 0, style, strength, color: solidColor });
  };

  const handlePointerMove = (e) => {
    if (!dragStartRef.current) return;
    const pt = getNormCoords(e);
    const sx = dragStartRef.current.x;
    const sy = dragStartRef.current.y;
    setDraftBox({
      x: Math.min(sx, pt.x),
      y: Math.min(sy, pt.y),
      w: Math.abs(pt.x - sx),
      h: Math.abs(pt.y - sy),
      style,
      strength,
      color: solidColor,
    });
  };

  const handlePointerUp = () => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    if (draftBox && draftBox.w > 0.005 && draftBox.h > 0.005) {
      const newBox = { ...draftBox, id: `box-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
      setBoxesByPage((prev) => ({
        ...prev,
        [pageIdx]: [...(prev[pageIdx] || []), newBox],
      }));
    }
    setDraftBox(null);
  };

  const handleUndo = () => {
    setBoxesByPage((prev) => {
      const arr = prev[pageIdx] || [];
      if (arr.length === 0) return prev;
      return { ...prev, [pageIdx]: arr.slice(0, -1) };
    });
  };

  const handleDeleteBox = (boxId) => {
    setBoxesByPage((prev) => ({
      ...prev,
      [pageIdx]: (prev[pageIdx] || []).filter((b) => b.id !== boxId),
    }));
  };

  const handleClearPage = () => {
    setBoxesByPage((prev) => ({ ...prev, [pageIdx]: [] }));
  };

  // Render clean redacted canvas for any page index
  const buildRedactedCanvas = (idx) => {
    const p = pages[idx];
    const out = document.createElement('canvas');
    out.width = p.width;
    out.height = p.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(p.srcCanvas, 0, 0);
    for (const box of boxesByPage[idx] || []) {
      applyRedactionBox(ctx, p.srcCanvas, box);
    }
    return out;
  };

  const handleCopyImage = async () => {
    if (!activePage) return;
    const out = buildRedactedCanvas(pageIdx);
    out.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError('เบราว์เซอร์ไม่รองรับการคัดลอกรูปภาพ กรุณากดดาวน์โหลดแทน');
      }
    }, 'image/png');
  };

  const handleExport = async () => {
    if (!file || pages.length === 0) return;
    setExporting(true);
    setError('');
    try {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      if (fileKind === 'image') {
        const out = buildRedactedCanvas(0);
        const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
        if (blob) {
          await downloadBlob(blob, `${baseName}-redacted.png`, 'เบลอ/ปิดข้อมูลลับ');
        }
      } else {
        // Export truly flattened PDF (original text on redacted pages is permanently replaced with rasterized redacted image)
        const outPdf = await PDFDocument.create();
        const origPdf = await PDFDocument.load(pdfBytesRef.current.slice(0), { ignoreEncryption: true });

        for (let i = 0; i < pages.length; i++) {
          const pageBoxes = boxesByPage[i] || [];
          if (pageBoxes.length === 0) {
            // Untouched page: copy original vector page directly
            const [copiedPage] = await outPdf.copyPages(origPdf, [i]);
            outPdf.addPage(copiedPage);
          } else {
            // Redacted page: bake redactions permanently into JPEG so hidden text cannot be copied/recovered
            const redCanvas = buildRedactedCanvas(i);
            const jpgBytes = await new Promise((resolve) =>
              redCanvas.toBlob((b) => b.arrayBuffer().then(resolve), 'image/jpeg', 0.92)
            );
            const embedded = await outPdf.embedJpg(jpgBytes);
            const origPage = origPdf.getPage(i);
            const { width, height } = origPage.getSize();
            const newPage = outPdf.addPage([width, height]);
            newPage.drawImage(embedded, { x: 0, y: 0, width, height });
          }
        }

        const outBytes = await outPdf.save();
        const blob = new Blob([outBytes], { type: 'application/pdf' });
        await downloadBlob(blob, `${baseName}-redacted.pdf`, 'เบลอ/ปิดข้อมูลลับ');
      }
    } catch (err) {
      console.error(err);
      setError(`บันทึกไฟล์ไม่สำเร็จ: ${err?.message || 'เกิดข้อผิดพลาด'}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
            <EyeOff className="text-indigo-600" size={26} />
            <span>เบลอ / ปิดข้อมูลลับ (รูปภาพ &amp; PDF)</span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            ลากคลุมเพื่อเบลอ โมเสก หรือคาดดำปิดเลขบัตรประชาชน เบอร์โทร ยอดเงิน ก่อนส่งเอกสาร (รองรับวางรูป Ctrl+V • ออฟไลน์ 100%)
          </p>
        </div>

        {pages.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5"
            >
              <Upload size={14} />
              <span>เปลี่ยนไฟล์</span>
            </button>
            <button
              type="button"
              onClick={handleCopyImage}
              className="px-3.5 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5"
            >
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกหน้านี้'}</span>
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {exporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              <span>{fileKind === 'pdf' ? 'บันทึก PDF ปิดข้อมูลถาวร' : 'บันทึกรูป (PNG)'}</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Upload Dropzone */}
      {!file && !loading && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer?.files?.[0];
            if (f) loadFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="bg-white border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-2xl p-12 text-center cursor-pointer transition-all hover:bg-gray-50/50 shadow-sm"
        >
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
            <ShieldCheck size={28} />
          </div>
          <p className="text-base font-bold text-gray-900">คลิกเลือก ลากไฟล์มาวาง หรือกด Ctrl+V วางภาพหน้าจอ</p>
          <p className="text-xs text-gray-500 mt-1">
            รองรับ PNG, JPG, WebP และ PDF • ข้อมูลที่ปิดใน PDF จะถูกฝังทับถาวร ไม่สามารถลากคลุมหรือกู้คืนข้อความเดิมได้
          </p>
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
          <RefreshCw size={28} className="animate-spin text-indigo-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-800">กำลังโหลดไฟล์...</p>
        </div>
      )}

      {/* Main Redaction Workspace */}
      {activePage && !loading && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-sm flex flex-wrap items-center justify-between gap-3">
            {/* Style Switcher */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setStyle('blur')}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                  style === 'blur'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Sparkles size={14} />
                <span>เบลอ (Blur)</span>
              </button>
              <button
                type="button"
                onClick={() => setStyle('pixelate')}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                  style === 'pixelate'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Grid size={14} />
                <span>โมเสก (Mosaic)</span>
              </button>
              <button
                type="button"
                onClick={() => setStyle('solid')}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                  style === 'solid'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Square size={14} />
                <span>คาดทึบ (Solid)</span>
              </button>
            </div>

            {/* Strength / Color Controls */}
            <div className="flex items-center gap-3 flex-wrap">
              {style !== 'solid' ? (
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                  <span>{style === 'blur' ? 'ความเบลอ:' : 'ขนาดช่อง:'}</span>
                  <input
                    type="range"
                    min={style === 'blur' ? 8 : 6}
                    max={style === 'blur' ? 38 : 28}
                    value={strength}
                    onChange={(e) => setStrength(Number(e.target.value))}
                    className="w-24 accent-indigo-600"
                  />
                  <span className="font-mono text-gray-800 w-6">{strength}</span>
                </label>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-600">สี:</span>
                  {['#000000', '#1e293b', '#ffffff'].map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setSolidColor(col)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        solidColor === col ? 'border-indigo-500 scale-110' : 'border-gray-300'
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                </div>
              )}

              <div className="h-5 w-px bg-gray-200 hidden sm:block" />

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onMouseDown={() => setShowOriginal(true)}
                  onMouseUp={() => setShowOriginal(false)}
                  onMouseLeave={() => setShowOriginal(false)}
                  onTouchStart={() => setShowOriginal(true)}
                  onTouchEnd={() => setShowOriginal(false)}
                  className="px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold flex items-center gap-1 select-none"
                >
                  <Eye size={13} />
                  <span>กดค้างดูต้นฉบับ</span>
                </button>
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={activeBoxes.length === 0}
                  title="ย้อนกลับ 1 จุด"
                  className="px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold flex items-center gap-1 disabled:opacity-35"
                >
                  <Undo2 size={13} />
                  <span>ย้อนกลับ</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearPage}
                  disabled={activeBoxes.length === 0}
                  title="ล้างจุดที่ปิดในหน้านี้"
                  className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold flex items-center gap-1 disabled:opacity-35"
                >
                  <Trash2 size={13} />
                  <span>ล้างหน้านี้</span>
                </button>
              </div>
            </div>
          </div>

          {/* PDF Page Switcher (if multi-page) */}
          {pages.length > 1 && (
            <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-2 text-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                  disabled={pageIdx === 0}
                  className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="font-bold text-gray-800">
                  หน้า {pageIdx + 1} / {pages.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))}
                  disabled={pageIdx === pages.length - 1}
                  className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
              <span className="text-gray-500">
                ปิดข้อมูลแล้วทั้งหมด <strong className="text-indigo-600">{totalBoxesCount}</strong> จุด
              </span>
            </div>
          )}

          {/* Interactive Canvas */}
          <div className="bg-gray-100 rounded-2xl border border-gray-200 p-4 flex items-center justify-center overflow-auto min-h-[380px]">
            <canvas
              ref={displayCanvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="max-w-full max-h-[680px] w-auto h-auto rounded-lg shadow-md cursor-crosshair touch-none select-none"
            />
          </div>

          {/* Applied Redaction Chips for quick removal */}
          {activeBoxes.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-gray-600">จุดที่ปิดในหน้านี้ ({activeBoxes.length}):</span>
              {activeBoxes.map((b, idx) => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium"
                >
                  <span>
                    #{idx + 1} {b.style === 'blur' ? 'เบลอ' : b.style === 'pixelate' ? 'โมเสก' : 'คาดทึบ'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteBox(b.id)}
                    className="text-gray-400 hover:text-red-600"
                    title="ลบจุดนี้"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
