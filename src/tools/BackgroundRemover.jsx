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
  ZoomIn,
  ZoomOut,
  Hand,
  Maximize2,
  Lasso,
  Layers,
  Scissors,
  Trash2,
  CheckCircle2,
  Crosshair,
  HardDrive,
  X,
} from 'lucide-react';
import { downloadBlob } from '../downloadManager';
import {
  isAiModelsCached,
  preloadAllBgAiModels,
  segmentWithSamPoints,
  clearSamImageCache,
} from './samEngine';

export default function BackgroundRemover() {
  const [mode, setMode] = useState('ai'); // 'ai' | 'solid'
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [imageKey, setImageKey] = useState('');
  const [hasResult, setHasResult] = useState(false);

  // AI Preload & Cache State
  const [modelsCached, setModelsCached] = useState(() => isAiModelsCached());
  const [preloadingModels, setPreloadingModels] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState({ percent: 0, text: '' });

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
  // 'erase' | 'restore' | 'object' | 'sam' | 'lasso' | 'wand' | 'pan' | 'view'
  const [editTool, setEditTool] = useState('object');
  const [brushSize, setBrushSize] = useState(36);
  const [brushSoftness, setBrushSoftness] = useState(30); // 0 = hard edge, 100 = super soft feather
  const [zoom, setZoom] = useState(1);
  const [baseDisplaySize, setBaseDisplaySize] = useState({ w: 480, h: 360 });
  const [undoCount, setUndoCount] = useState(0);
  const [cursorPos, setCursorPos] = useState(null);

  // Active Selection Mask (used by Object Picker, SlimSAM AI Select, and Lasso!)
  // { mask: Uint8Array (w*h, 1=selected), width, height, source: 'object'|'sam'|'lasso' }
  const [selectionMask, setSelectionMask] = useState(null);

  // SlimSAM interactive points: [{ x, y, label: 1 (keep) | 0 (exclude) }]
  const [samPoints, setSamPoints] = useState([]);
  const [samPointMode, setSamPointMode] = useState(1); // 1 = positive (green), 0 = negative (red)
  const [samBusy, setSamBusy] = useState(false);
  const [samStatus, setSamStatus] = useState('');

  // Lasso polygon points while drawing
  const [lassoPoints, setLassoPoints] = useState([]);

  // Output background preview & export
  const [outputBg, setOutputBg] = useState('transparent');
  const [customBgColor, setCustomBgColor] = useState('#ffffff');
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef(null);
  const origCanvasRef = useRef(null);
  const workCanvasRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const undoStackRef = useRef([]);
  const isDrawingRef = useRef(false);
  const lastPtRef = useRef(null);
  const panStartRef = useRef(null);
  const lassoPointsRef = useRef([]);

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      clearSamImageCache();
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

    // Overlay active selection mask (Object Picker / SlimSAM / Lasso)
    if (selectionMask && selectionMask.width === display.width && selectionMask.height === display.height) {
      const overlay = document.createElement('canvas');
      overlay.width = display.width;
      overlay.height = display.height;
      const octx = overlay.getContext('2d');
      const imgData = octx.createImageData(display.width, display.height);
      const data = imgData.data;
      const mask = selectionMask.mask;
      const w = display.width;
      const h = display.height;

      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const x = i % w;
        const y = (i - x) / w;
        // Detect border pixel for crisp selection outline
        const isEdge =
          x === 0 ||
          y === 0 ||
          x === w - 1 ||
          y === h - 1 ||
          !mask[i - 1] ||
          !mask[i + 1] ||
          !mask[i - w] ||
          !mask[i + w];

        const p = i * 4;
        if (isEdge) {
          data[p] = 79;
          data[p + 1] = 70;
          data[p + 2] = 229;
          data[p + 3] = 245;
        } else {
          data[p] = 99;
          data[p + 1] = 102;
          data[p + 2] = 241;
          data[p + 3] = 105;
        }
      }
      octx.putImageData(imgData, 0, 0);
      ctx.drawImage(overlay, 0, 0);
    }

    // Draw in-progress Lasso polygon
    if (lassoPoints.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
      for (let i = 1; i < lassoPoints.length; i++) {
        ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
      }
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = Math.max(2, display.width * 0.004);
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.fillStyle = 'rgba(99, 102, 241, 0.18)';
      ctx.fill();
      ctx.restore();
    }

    // Draw SlimSAM prompt points (green = keep, red = exclude)
    if (samPoints.length > 0) {
      const r = Math.max(6, Math.round(Math.max(display.width, display.height) * 0.01));
      samPoints.forEach((pt) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = pt.label === 1 ? '#10b981' : '#ef4444';
        ctx.fill();
        ctx.lineWidth = Math.max(2, r * 0.3);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      });
    }
  }, [selectionMask, lassoPoints, samPoints]);

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
    work.getContext('2d').putImageData(snap, 0, 0);
    setUndoCount(undoStackRef.current.length);
    setSelectionMask(null);
    setSamPoints([]);
    redrawDisplay();
  };

  const clearSelection = () => {
    setSelectionMask(null);
    setSamPoints([]);
    setLassoPoints([]);
    lassoPointsRef.current = [];
  };

  const handlePreloadModels = async () => {
    if (preloadingModels) return;
    setPreloadingModels(true);
    setError('');
    setPreloadProgress({ percent: 2, text: 'กำลังเริ่มดาวน์โหลดโมเดล AI เก็บลงเครื่อง...' });
    try {
      await preloadAllBgAiModels((p) => {
        setPreloadProgress({ percent: p.percent || 0, text: p.text || '' });
      });
      setModelsCached(true);
    } catch (err) {
      console.error(err);
      setError(`ดาวน์โหลดโมเดล AI ไม่สำเร็จ: ${err?.message || 'กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต'}`);
    } finally {
      setPreloadingModels(false);
    }
  };

  const loadImageToCanvas = async (url, key) => {
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

    clearSamImageCache();
    clearSelection();
    undoStackRef.current = [];
    setUndoCount(0);
    setImageKey(key);

    const autoBrush = Math.max(
      12,
      Math.min(140, Math.round(Math.max(img.naturalWidth, img.naturalHeight) * 0.035))
    );
    setBrushSize(autoBrush);

    const fitScale = Math.min(540 / img.naturalWidth, 440 / img.naturalHeight, 1);
    setBaseDisplaySize({
      w: Math.max(160, Math.round(img.naturalWidth * fitScale)),
      h: Math.max(120, Math.round(img.naturalHeight * fitScale)),
    });
    setZoom(1);

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
      await loadImageToCanvas(url, `${file.name}_${file.size}_${Date.now()}`);
    } catch {
      setError('ไม่สามารถโหลดรูปภาพได้');
    }
  };

  const hexToRgb = (hex) => {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };

  // Mode 1: AI Offline Removal (ISNet ONNX)
  const runAiRemoval = async () => {
    if (!sourceFile || !origCanvasRef.current) return;
    setProcessing(true);
    setError('');
    clearSelection();
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
              setProgressText(`กำลังดาวน์โหลดโมเดล AI เก็บลง cache... ${pct}%`);
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
      setProgressText('ลบพื้นหลังเสร็จสมบูรณ์! เลือกชิ้นลบต่อหรือใช้แปรงเก็บขอบได้เลย');
    } catch (err) {
      console.error(err);
      setError(
        `ประมวลผล AI ไม่สำเร็จ: ${err?.message || 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตสำหรับการโหลดโมเดลครั้งแรก'}`
      );
    } finally {
      setProcessing(false);
    }
  };

  // Mode 2: Fast Solid / White Background Removal
  const runSolidRemoval = () => {
    const orig = origCanvasRef.current;
    const work = workCanvasRef.current;
    if (!orig || !work) return;
    setProcessing(true);
    setError('');
    clearSelection();

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

  // Edge Shrink / Defringe (-1px alpha erosion to remove white halos)
  const handleShrinkEdge = () => {
    const work = workCanvasRef.current;
    if (!work) return;
    pushUndoSnapshot();
    const w = work.width;
    const h = work.height;
    const ctx = work.getContext('2d');
    const imgData = ctx.getImageData(0, 0, w, h);
    const src = imgData.data;
    const out = new Uint8ClampedArray(src);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4 + 3;
        if (src[idx] === 0) continue;
        const minNeighbor = Math.min(
          src[((y - 1) * w + x) * 4 + 3],
          src[((y + 1) * w + x) * 4 + 3],
          src[(y * w + x - 1) * 4 + 3],
          src[(y * w + x + 1) * 4 + 3]
        );
        if (minNeighbor < src[idx]) {
          out[idx] = Math.round(minNeighbor * 0.85);
        }
      }
    }

    imgData.data.set(out);
    ctx.putImageData(imgData, 0, 0);
    redrawDisplay();
  };

  const handleResetToOriginal = () => {
    const orig = origCanvasRef.current;
    const work = workCanvasRef.current;
    if (!orig || !work) return;
    pushUndoSnapshot();
    clearSelection();
    const ctx = work.getContext('2d');
    ctx.clearRect(0, 0, work.width, work.height);
    ctx.drawImage(orig, 0, 0);
    redrawDisplay();
  };

  // Apply Selection Mask: 'delete' (erase selected object) or 'keep' (keep ONLY selected object)
  const applySelectionAction = (action) => {
    const work = workCanvasRef.current;
    if (!work || !selectionMask) return;
    pushUndoSnapshot();

    const w = work.width;
    const h = work.height;
    const ctx = work.getContext('2d');
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const mask = selectionMask.mask;

    if (action === 'delete') {
      for (let i = 0; i < mask.length; i++) {
        if (mask[i]) data[i * 4 + 3] = 0;
      }
    } else if (action === 'keep') {
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) data[i * 4 + 3] = 0;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    clearSelection();
    redrawDisplay();
  };

  // --- Tool: Connected Component Object Picker ---
  const pickObjectIslandAt = (startX, startY) => {
    const work = workCanvasRef.current;
    if (!work) return;
    const w = work.width;
    const h = work.height;
    const sx = Math.floor(startX);
    const sy = Math.floor(startY);
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

    const data = work.getContext('2d').getImageData(0, 0, w, h).data;
    const startIdx = (sy * w + sx) * 4;
    if (data[startIdx + 3] < 15) {
      setSelectionMask(null);
      return;
    }

    const mask = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;

    const startPos = sy * w + sx;
    mask[startPos] = 1;
    queue[tail++] = startPos;

    while (head < tail) {
      const pos = queue[head++];
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
        if (npos < 0 || mask[npos]) continue;
        if (data[npos * 4 + 3] >= 15) {
          mask[npos] = 1;
          queue[tail++] = npos;
        }
      }
    }

    setSamPoints([]);
    setSelectionMask({ mask, width: w, height: h, source: 'object' });
  };

  // --- Tool: SlimSAM AI Click-to-Segment ---
  const handleSamClick = async (x, y, label) => {
    if (!origCanvasRef.current || samBusy) return;
    const nextPoints = [...samPoints, { x: Math.round(x), y: Math.round(y), label }];
    setSamPoints(nextPoints);
    setSamBusy(true);
    setError('');
    setSamStatus('กำลังวิเคราะห์วัตถุด้วย AI (SlimSAM)...');

    try {
      const origDataUrl = origCanvasRef.current.toDataURL('image/png');
      const res = await segmentWithSamPoints(imageKey, origDataUrl, nextPoints, (p) => {
        if (p?.text) setSamStatus(p.text);
        else if (p?.stage === 'download') {
          setSamStatus(`กำลังโหลดโมเดล SlimSAM เก็บลงเครื่อง... ${p.percent}%`);
        }
      });

      if (res?.mask) {
        setSelectionMask({
          mask: res.mask,
          width: res.width,
          height: res.height,
          source: 'sam',
        });
        setSamStatus('เลือกวัตถุสำเร็จ! กด "ลบวัตถุนี้" หรือ "เก็บเฉพาะวัตถุนี้" ด้านล่างได้เลย');
      }
    } catch (err) {
      console.error(err);
      setError(`AI จิ้มเลือกวัตถุไม่สำเร็จ: ${err?.message || 'กรุณาตรวจสอบอินเทอร์เน็ตสำหรับโหลดโมเดลครั้งแรก'}`);
      setSamStatus('');
    } finally {
      setSamBusy(false);
    }
  };

  // --- Tool: Lasso Polygon Mask ---
  const finalizeLassoMask = (pts) => {
    const work = workCanvasRef.current;
    if (!work || pts.length < 3) return;
    const w = work.width;
    const h = work.height;

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const mctx = maskCanvas.getContext('2d');
    mctx.beginPath();
    mctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      mctx.lineTo(pts[i].x, pts[i].y);
    }
    mctx.closePath();
    mctx.fillStyle = '#ffffff';
    mctx.fill();

    const mData = mctx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) {
      if (mData[i * 4 + 3] > 128) mask[i] = 1;
    }

    setSamPoints([]);
    setSelectionMask({ mask, width: w, height: h, source: 'lasso' });
  };

  // --- Soft/Feather Brush Engine ---
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
      cssRadius: brushSize / 2 / scaleX,
    };
  };

  const applyBrushDot = (x, y) => {
    const work = workCanvasRef.current;
    const orig = origCanvasRef.current;
    if (!work || !orig) return;
    const ctx = work.getContext('2d');
    const radius = brushSize / 2;
    const innerR = radius * Math.max(0, 1 - brushSoftness / 100);

    if (editTool === 'erase') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      if (brushSoftness > 5) {
        const grad = ctx.createRadialGradient(x, y, innerR, x, y, radius);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = '#000000';
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (editTool === 'restore') {
      if (brushSoftness <= 5) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(orig, 0, 0);
        ctx.restore();
      } else {
        // Soft-feathered restore using small temp patch canvas
        const d = Math.ceil(radius * 2) + 2;
        const left = Math.floor(x - radius) - 1;
        const top = Math.floor(y - radius) - 1;
        const patch = document.createElement('canvas');
        patch.width = d;
        patch.height = d;
        const pctx = patch.getContext('2d');
        pctx.drawImage(orig, -left, -top);
        pctx.globalCompositeOperation = 'destination-in';
        const cx = x - left;
        const cy = y - top;
        const grad = pctx.createRadialGradient(cx, cy, innerR, cx, cy, radius);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        pctx.fillStyle = grad;
        pctx.fillRect(0, 0, d, d);
        ctx.drawImage(patch, left, top);
      }
    }
  };

  const applyBrushSegment = (p1, p2) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, brushSize * 0.2);
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

    if (editTool === 'pan' || e.button === 1) {
      e.preventDefault();
      const scroller = scrollContainerRef.current;
      if (!scroller) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      };
      return;
    }

    e.preventDefault();
    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (editTool === 'wand') {
      runMagicWandAt(pt.x, pt.y);
      return;
    }

    if (editTool === 'object') {
      pickObjectIslandAt(pt.x, pt.y);
      return;
    }

    if (editTool === 'sam') {
      // Right-click = negative (red), Left-click = active samPointMode
      const label = e.button === 2 ? 0 : samPointMode;
      handleSamClick(pt.x, pt.y, label);
      return;
    }

    if (editTool === 'lasso') {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      isDrawingRef.current = true;
      setSelectionMask(null);
      lassoPointsRef.current = [{ x: pt.x, y: pt.y }];
      setLassoPoints([{ x: pt.x, y: pt.y }]);
      return;
    }

    // Brush: erase or restore
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pushUndoSnapshot();
    isDrawingRef.current = true;
    lastPtRef.current = pt;
    applyBrushDot(pt.x, pt.y);
    redrawDisplay();
  };

  const handlePointerMove = (e) => {
    if (panStartRef.current) {
      const scroller = scrollContainerRef.current;
      if (scroller) {
        scroller.scrollLeft = panStartRef.current.scrollLeft - (e.clientX - panStartRef.current.clientX);
        scroller.scrollTop = panStartRef.current.scrollTop - (e.clientY - panStartRef.current.clientY);
      }
      return;
    }

    const pt = getCanvasPoint(e);
    if (pt && (editTool === 'erase' || editTool === 'restore')) {
      setCursorPos({ x: pt.cssX, y: pt.cssY, r: Math.max(4, pt.cssRadius) });
    } else {
      setCursorPos(null);
    }

    if (!isDrawingRef.current || !pt) return;
    e.preventDefault();

    if (editTool === 'lasso') {
      const prev = lassoPointsRef.current[lassoPointsRef.current.length - 1];
      if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) >= 4) {
        lassoPointsRef.current.push({ x: pt.x, y: pt.y });
        setLassoPoints([...lassoPointsRef.current]);
      }
      return;
    }

    if (!lastPtRef.current) return;
    applyBrushSegment(lastPtRef.current, pt);
    lastPtRef.current = pt;
  };

  const handlePointerUp = () => {
    if (isDrawingRef.current && editTool === 'lasso') {
      const pts = lassoPointsRef.current;
      isDrawingRef.current = false;
      setLassoPoints([]);
      lassoPointsRef.current = [];
      if (pts.length >= 3) {
        finalizeLassoMask(pts);
      }
      return;
    }
    isDrawingRef.current = false;
    lastPtRef.current = null;
    panStartRef.current = null;
  };

  const adjustZoom = (delta) => {
    setZoom((prev) => Math.max(0.5, Math.min(5, Number((prev + delta).toFixed(2)))));
  };

  const handleCanvasWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    adjustZoom(e.deltaY < 0 ? 0.25 : -0.25);
  };

  // Export final image
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
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
            <Wand2 className="text-indigo-600" size={26} />
            <span>ลบพื้นหลัง &amp; แยกชิ้นวัตถุ (AI Studio)</span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            ลบพื้นหลังอัตโนมัติ (<strong>ISNet</strong>), จิ้มเลือกวัตถุละเอียด (<strong>SlimSAM AI</strong>), เลือกเป็นชิ้น, ลากวงล้อม, แปรงนุ่ม, ตัดขอบขาว และซูมได้ถึง 500%
          </p>
        </div>
      </div>

      {/* Offline AI Model Cache / Preload Bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              modelsCached ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'
            }`}
          >
            {modelsCached ? <CheckCircle2 size={19} /> : <HardDrive size={19} />}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-gray-800">
              {modelsCached
                ? 'โมเดล AI (ISNet + SlimSAM) เก็บไว้ในเครื่องเรียบร้อยแล้ว'
                : 'เตรียมโมเดล AI เก็บลงเครื่องล่วงหน้า (โหลดครั้งเดียว ใช้ได้ตลอด)'}
            </div>
            <div className="text-[11px] text-gray-500 truncate">
              {preloadingModels
                ? preloadProgress.text
                : modelsCached
                ? 'ใช้งานออฟไลน์ได้ทันที ไม่ต้องโหลดซ้ำแม้ปิด-เปิดแอปใหม่'
                : 'เก็บลง Cache ถาวรของแอป ไม่ต้องเสียเวลารอโหลดใหม่ทุกครั้ง'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {preloadingModels ? (
            <div className="w-36 space-y-1">
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-200"
                  style={{ width: `${preloadProgress.percent}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-right text-indigo-600">
                {preloadProgress.percent}%
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handlePreloadModels}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                modelsCached
                  ? 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
              }`}
            >
              <Download size={14} />
              <span>{modelsCached ? 'เช็ก/โหลดซ้ำ' : 'โหลด AI เก็บไว้เลย'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-2 rounded-2xl border border-gray-200 shadow-sm">
        <button
          type="button"
          onClick={() => {
            setMode('ai');
            setError('');
          }}
          className={`py-2.5 px-4 rounded-xl text-left transition-all flex items-center gap-3 ${
            mode === 'ai'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Sparkles size={19} className="shrink-0" />
          <div>
            <div className="text-sm font-bold">โหมด AI ออฟไลน์ (ISNet ONNX)</div>
            <div className={`text-[11px] ${mode === 'ai' ? 'text-indigo-100' : 'text-gray-400'}`}>
              ลบพื้นหลังคน สินค้า สัตว์ ฉากซับซ้อนอัตโนมัติ
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setMode('solid');
            setError('');
          }}
          className={`py-2.5 px-4 rounded-xl text-left transition-all flex items-center gap-3 ${
            mode === 'solid'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <SlidersHorizontal size={19} className="shrink-0" />
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
            ประมวลผลในเครื่อง 100% รองรับทั้งลบพื้นหลังอัตโนมัติและจิ้มเลือกแยกวัตถุทีละชิ้น
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Top Auto-Removal & Edge Refine Bar */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="text-xs font-medium text-gray-600 truncate">
                ไฟล์: <span className="font-semibold text-gray-900">{sourceFile.name}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700"
                >
                  เปลี่ยนรูป
                </button>
                <button
                  type="button"
                  onClick={handleShrinkEdge}
                  title="หดขอบโปร่งใสเข้ามา 1px ช่วยลบขอบขาวที่ติดรอบวัตถุหรือตัวหนังสือ"
                  className="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100 text-xs font-semibold text-indigo-700 flex items-center gap-1"
                >
                  <Scissors size={13} />
                  <span>ตัดขอบขาว (-1px)</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetToOriginal}
                  className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-medium text-gray-600"
                >
                  คืนภาพต้นฉบับ
                </button>
                <button
                  type="button"
                  onClick={mode === 'ai' ? runAiRemoval : runSolidRemoval}
                  disabled={processing}
                  className={`px-4 py-2 rounded-xl text-white text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-all disabled:opacity-50 ${
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
              <div className="space-y-1.5 pt-1">
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

          {/* Precision Object & Brush Selection Toolbar */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditTool('object')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    editTool === 'object'
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Layers size={14} />
                  <span>เลือกเป็นชิ้น</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditTool('sam')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    editTool === 'sam'
                      ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Crosshair size={14} />
                  <span>AI จิ้มเลือกวัตถุ (SAM)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditTool('lasso')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    editTool === 'lasso'
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Lasso size={14} />
                  <span>ลากวงล้อม</span>
                </button>

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
                  <span>ยางลบ</span>
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
                  <span>กู้คืน</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditTool('wand')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    editTool === 'wand'
                      ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <MousePointerClick size={14} />
                  <span>คทาวิเศษ</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditTool('pan')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    editTool === 'pan'
                      ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Hand size={14} />
                  <span>เลื่อนภาพ</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditTool('view')}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 border transition-all ${
                    editTool === 'view'
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Eye size={14} />
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

            {/* Tool-specific sub-controls */}
            {(editTool === 'erase' || editTool === 'restore') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-600 shrink-0">
                    ขนาดแปรง: <strong className="font-mono">{brushSize}px</strong>
                  </span>
                  <input
                    type="range"
                    min={4}
                    max={220}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="flex-1 accent-indigo-600"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-600 shrink-0">
                    ความนุ่มขอบ: <strong className="font-mono">{brushSoftness}%</strong>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={brushSoftness}
                    onChange={(e) => setBrushSoftness(Number(e.target.value))}
                    className="flex-1 accent-indigo-600"
                  />
                </div>
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
                  className="flex-1 max-w-xs accent-sky-600"
                />
                <span className="text-[11px] text-gray-400">คลิกจิ้มตรงสีพื้นหลังที่ต้องการลบ</span>
              </div>
            )}

            {editTool === 'object' && (
              <div className="text-xs text-gray-500 pt-0.5">
                คลิกที่ชิ้นวัตถุหรือตัวหนังสือใดก็ได้บนภาพด้านขวาเพื่อไฮไลต์ทั้งชิ้น แล้วกด <strong>ลบชิ้นนี้</strong> หรือ <strong>เก็บเฉพาะชิ้นนี้</strong>
              </div>
            )}

            {editTool === 'lasso' && (
              <div className="text-xs text-gray-500 pt-0.5">
                กดค้างแล้วลากวงล้อมรอบส่วนที่ต้องการบนภาพด้านขวา จากนั้นเลือก <strong>ลบในวง</strong> หรือ <strong>เก็บเฉพาะในวง</strong>
              </div>
            )}

            {editTool === 'sam' && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 bg-violet-50/70 border border-violet-200 rounded-xl p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-violet-800">จุดคลิก SlimSAM:</span>
                  <button
                    type="button"
                    onClick={() => setSamPointMode(1)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      samPointMode === 1
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    + จุดสีเขียว (เลือกวัตถุ)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSamPointMode(0)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      samPointMode === 0
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    - จุดสีแดง (ตัดส่วนที่ไม่เอาออก)
                  </button>
                </div>
                <span className="text-[11px] text-violet-700">
                  {samBusy ? (
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <RefreshCw size={12} className="animate-spin" /> {samStatus}
                    </span>
                  ) : (
                    samStatus || 'คลิกซ้าย = เพิ่มจุดเขียว • คลิกขวา = เพิ่มจุดแดง (แยกวัตถุซ้อนทับได้)'
                  )}
                </span>
              </div>
            )}

            {/* Active Selection Action Bar */}
            {selectionMask && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-indigo-50 border border-indigo-200 animate-fade-in">
                <span className="text-xs font-bold text-indigo-800">
                  เลือกพื้นที่แล้ว ({selectionMask.source === 'sam' ? 'SlimSAM AI' : selectionMask.source === 'lasso' ? 'วงล้อม Lasso' : 'ชิ้นวัตถุ'}) — ต้องการทำอะไรกับส่วนที่ไฮไลต์?
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applySelectionAction('delete')}
                    className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                  >
                    <Trash2 size={13} />
                    <span>ลบส่วนที่เลือกออก</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applySelectionAction('keep')}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                  >
                    <Check size={13} />
                    <span>เก็บเฉพาะส่วนที่เลือก (ลบอื่นหมด)</span>
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-medium flex items-center gap-1"
                  >
                    <X size={13} />
                    <span>ยกเลิก</span>
                  </button>
                </div>
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
                  พื้นที่แก้ไขและผลลัพธ์ (After)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Zoom Controls */}
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => adjustZoom(-0.25)}
                      disabled={zoom <= 0.5}
                      title="ซูมออก"
                      className="p-1 rounded-md hover:bg-white text-gray-700 disabled:opacity-35 transition-all"
                    >
                      <ZoomOut size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom(1)}
                      title="รีเซ็ตซูมเป็น 100%"
                      className="px-1.5 text-[11px] font-mono font-bold text-gray-700 hover:text-indigo-600 min-w-[42px] text-center"
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustZoom(0.25)}
                      disabled={zoom >= 5}
                      title="ซูมเข้า (หรือกด Ctrl + Scroll)"
                      className="p-1 rounded-md hover:bg-white text-gray-700 disabled:opacity-35 transition-all"
                    >
                      <ZoomIn size={14} />
                    </button>
                    {zoom !== 1 && (
                      <button
                        type="button"
                        onClick={() => setZoom(1)}
                        title="พอดีกรอบ"
                        className="p-1 rounded-md hover:bg-white text-indigo-600 transition-all"
                      >
                        <Maximize2 size={13} />
                      </button>
                    )}
                  </div>

                  {/* Background Preview Switcher */}
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
              </div>

              <div
                ref={scrollContainerRef}
                onWheel={handleCanvasWheel}
                className="rounded-xl overflow-auto border border-gray-200 h-[440px] p-4 flex"
                style={previewBgStyle}
              >
                <div className="relative m-auto shrink-0">
                  <canvas
                    ref={displayCanvasRef}
                    onContextMenu={(e) => {
                      if (editTool === 'sam') e.preventDefault();
                    }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onPointerLeave={() => {
                      handlePointerUp();
                      setCursorPos(null);
                    }}
                    style={{
                      width: `${Math.round(baseDisplaySize.w * zoom)}px`,
                      height: `${Math.round(baseDisplaySize.h * zoom)}px`,
                    }}
                    className={`block touch-none select-none shadow-sm ${
                      editTool === 'wand' || editTool === 'sam' || editTool === 'lasso'
                        ? 'cursor-crosshair'
                        : editTool === 'object'
                        ? 'cursor-pointer'
                        : editTool === 'pan'
                        ? 'cursor-grab active:cursor-grabbing'
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
              <p className="text-[11px] text-gray-400">
                เคล็ดลับ: กด <strong>Ctrl + เลื่อนลูกกลิ้งเมาส์</strong> เพื่อซูมสูงสุด 500% • โหมด <strong>AI จิ้มเลือกวัตถุ (SAM)</strong> คลิกซ้าย=จุดเขียว (เลือก) คลิกขวา=จุดแดง (ตัดออก)
              </p>

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
