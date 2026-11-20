import React, { useState, useEffect, useRef, useMemo } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import QRCodeStyling from 'qr-code-styling';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Set worker source globally
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
import {
  Link, FileImage, QrCode, FileText, Copy, Check, Upload,
  Download, Scissors, Menu, X, Zap, Layout, FileType,
  Key, Eye, EyeOff, AlertCircle, Search, ExternalLink,
  FileSpreadsheet, Images as ImageIcon, FileType2, Files, GripVertical,
  NotebookPen, MessageSquare, Send, Trash2, Maximize2,
  PanelLeftOpen, PanelRightOpen, PanelRightClose, Type,
  Monitor, Camera, Clipboard, Crop, Share2, RotateCcw,
  Sparkles, Plus, ChevronLeft, ChevronRight, Sun, Moon, RefreshCw,
  Wifi, User, Phone, Mail, Palette, Frame, ShieldCheck,
  RotateCw, FlipHorizontal, FlipVertical, Lock, Unlock, SlidersHorizontal, Layers
} from 'lucide-react';

// --- Helper Functions ---
const formatSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// --- Components ---

// 2. Image Studio (Crop, Aspect Ratio, Fit/Pad, Resize, Rotate/Flip, Filters, Convert & Batch ZIP)
const ImageStudio = () => {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

  const [studioMode, setStudioMode] = useState('single'); // single, batch

  // --- Single Image States ---
  const [originalImage, setOriginalImage] = useState(null);
  const [workingImage, setWorkingImage] = useState(null);
  const [natSize, setNatSize] = useState({ w: 0, h: 0 });
  const [fileInfo, setFileInfo] = useState({ name: 'image.png', originalSize: 0 });

  // Active right-panel tab
  const [editTab, setEditTab] = useState('crop'); // crop, resize, adjust, export

  // Framing & Crop States
  const [framingMode, setFramingMode] = useState('crop'); // crop, pad
  const [ratioId, setRatioId] = useState('free'); // free, 16:9, 16:10, 4:3, 3:2, 1:1, 9:16, 4:5, a4
  const [padBgType, setPadBgType] = useState('blur'); // blur, white, black, custom
  const [padBgColor, setPadBgColor] = useState('#ffffff');
  const [cropBox, setCropBox] = useState({ x: 0, y: 0, w: 1, h: 1 }); // normalized 0..1
  const [dragState, setDragState] = useState(null);

  // Resize States
  const [outWidth, setOutWidth] = useState(0);
  const [outHeight, setOutHeight] = useState(0);
  const [lockResizeRatio, setLockResizeRatio] = useState(true);

  // Color Adjustments
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [grayscale, setGrayscale] = useState(false);

  // Export States
  const [format, setFormat] = useState('image/jpeg'); // image/jpeg, image/png, image/webp
  const [quality, setQuality] = useState(0.85);
  const [estimatedSize, setEstimatedSize] = useState(0);
  const [copiedImg, setCopiedImg] = useState(false);
  const [statusErr, setStatusErr] = useState('');

  // --- Batch Mode States ---
  const [batchFiles, setBatchFiles] = useState([]);
  const [batchRatio, setBatchRatio] = useState('keep');
  const [batchFit, setBatchFit] = useState('crop'); // crop, pad_blur, pad_white
  const [batchMaxWidth, setBatchMaxWidth] = useState(1920);
  const [batchFormat, setBatchFormat] = useState('image/jpeg');
  const [batchQuality, setBatchQuality] = useState(0.85);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);

  const imgRef = useRef(null);
  const fileInputRef = useRef(null);

  const aspectRatios = [
    { id: 'free', label: 'อิสระ', value: null },
    { id: '16:9', label: '16:9', value: 16 / 9 },
    { id: '16:10', label: '16:10', value: 16 / 10 },
    { id: '4:3', label: '4:3', value: 4 / 3 },
    { id: '3:2', label: '3:2', value: 3 / 2 },
    { id: '1:1', label: '1:1', value: 1 },
    { id: '9:16', label: '9:16', value: 9 / 16 },
    { id: '4:5', label: '4:5', value: 4 / 5 },
    { id: 'a4', label: 'A4', value: 210 / 297 }
  ];

  const currentRatioObj = aspectRatios.find((r) => r.id === ratioId) || aspectRatios[0];

  const filterCss = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale ? 100 : 0}%)`;

  // Compute natural dimensions of the active crop or pad result
  const computeSourceOutputDims = (w, h, box, fMode, rVal) => {
    if (!w || !h) return { w: 0, h: 0 };
    if (fMode === 'pad' && rVal) {
      const imgRatio = w / h;
      if (imgRatio > rVal) {
        return { w: Math.round(w), h: Math.round(w / rVal) };
      }
      return { w: Math.round(h * rVal), h: Math.round(h) };
    }
    return {
      w: Math.max(1, Math.round(box.w * w)),
      h: Math.max(1, Math.round(box.h * h))
    };
  };

  // Load image into single studio
  const loadImageFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setStatusErr('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const img = new Image();
      img.onload = () => {
        setOriginalImage(dataUrl);
        setWorkingImage(dataUrl);
        setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
        setFileInfo({ name: file.name || 'pasted-image.png', originalSize: file.size });
        setFramingMode('crop');
        setRatioId('free');
        setCropBox({ x: 0, y: 0, w: 1, h: 1 });
        setOutWidth(img.naturalWidth);
        setOutHeight(img.naturalHeight);
        setBrightness(100);
        setContrast(100);
        setSaturation(100);
        setGrayscale(false);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Global Ctrl+V Paste listener for Single Studio
  useEffect(() => {
    if (studioMode !== 'single') return;
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            loadImageFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [studioMode]);

  // Apply aspect ratio preset
  const applyAspectRatio = (newRatioId) => {
    setRatioId(newRatioId);
    const rObj = aspectRatios.find((r) => r.id === newRatioId);
    const rVal = rObj?.value || null;

    if (!rVal) {
      setFramingMode('crop');
      const fullBox = { x: 0, y: 0, w: 1, h: 1 };
      setCropBox(fullBox);
      if (natSize.w && natSize.h) {
        setOutWidth(natSize.w);
        setOutHeight(natSize.h);
      }
      return;
    }

    if (framingMode === 'pad') {
      const dims = computeSourceOutputDims(natSize.w, natSize.h, cropBox, 'pad', rVal);
      setOutWidth(dims.w);
      setOutHeight(dims.h);
      return;
    }

    // Crop mode: fit largest centered box with exact aspect ratio rVal
    if (natSize.w && natSize.h) {
      const imgRatio = natSize.w / natSize.h;
      let bw = 1;
      let bh = 1;
      if (imgRatio > rVal) {
        bh = 1;
        bw = rVal / imgRatio;
      } else {
        bw = 1;
        bh = imgRatio / rVal;
      }
      const nextBox = { x: (1 - bw) / 2, y: (1 - bh) / 2, w: bw, h: bh };
      setCropBox(nextBox);
      setOutWidth(Math.max(1, Math.round(bw * natSize.w)));
      setOutHeight(Math.max(1, Math.round(bh * natSize.h)));
    }
  };

  const handleFramingModeChange = (mode) => {
    setFramingMode(mode);
    let targetRatioId = ratioId;
    if (mode === 'pad' && ratioId === 'free') {
      targetRatioId = '16:9';
      setRatioId('16:9');
    }
    const rVal = aspectRatios.find((r) => r.id === targetRatioId)?.value || null;
    if (mode === 'pad') {
      const dims = computeSourceOutputDims(natSize.w, natSize.h, cropBox, 'pad', rVal);
      setOutWidth(dims.w);
      setOutHeight(dims.h);
    } else if (rVal && natSize.w && natSize.h) {
      const imgRatio = natSize.w / natSize.h;
      const bw = imgRatio > rVal ? rVal / imgRatio : 1;
      const bh = imgRatio > rVal ? 1 : imgRatio / rVal;
      const nextBox = { x: (1 - bw) / 2, y: (1 - bh) / 2, w: bw, h: bh };
      setCropBox(nextBox);
      setOutWidth(Math.max(1, Math.round(bw * natSize.w)));
      setOutHeight(Math.max(1, Math.round(bh * natSize.h)));
    }
  };

  // Rotate or Flip workingImage cleanly
  const applyTransform = (type) => {
    if (!workingImage) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (type === 'rot_right' || type === 'rot_left') {
        canvas.width = img.naturalHeight;
        canvas.height = img.naturalWidth;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(type === 'rot_right' ? Math.PI / 2 : -Math.PI / 2);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      } else if (type === 'flip_h') {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
      } else if (type === 'flip_v') {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.translate(0, canvas.height);
        ctx.scale(1, -1);
        ctx.drawImage(img, 0, 0);
      }
      const nextUrl = canvas.toDataURL('image/png');
      setWorkingImage(nextUrl);
      setNatSize({ w: canvas.width, h: canvas.height });
      setCropBox({ x: 0, y: 0, w: 1, h: 1 });
      setRatioId('free');
      setFramingMode('crop');
      setOutWidth(canvas.width);
      setOutHeight(canvas.height);
    };
    img.src = workingImage;
  };

  // Pointer handlers for interactive crop box move & corner resize
  const getNormPoint = (e) => {
    const el = imgRef.current;
    if (!el) return { x: 0, y: 0 };
    const b = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
      y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))
    };
  };

  const startCropDrag = (e, mode) => {
    if (framingMode !== 'crop' || !workingImage) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getNormPoint(e);
    setDragState({ mode, startPt: pt, startBox: { ...cropBox } });
  };

  const onCropPointerMove = (e) => {
    if (!dragState || !natSize.w || !natSize.h) return;
    e.preventDefault();
    const pt = getNormPoint(e);
    const dx = pt.x - dragState.startPt.x;
    const dy = pt.y - dragState.startPt.y;
    const sb = dragState.startBox;
    const minN = 0.05;
    const targetRatio = currentRatioObj.value;
    const imgRatio = natSize.w / natSize.h;

    let next = { ...sb };

    if (dragState.mode === 'move') {
      next.x = Math.min(1 - sb.w, Math.max(0, sb.x + dx));
      next.y = Math.min(1 - sb.h, Math.max(0, sb.y + dy));
    } else {
      let left = sb.x;
      let top = sb.y;
      let right = sb.x + sb.w;
      let bottom = sb.y + sb.h;

      if (dragState.mode.includes('l')) left = Math.min(right - minN, Math.max(0, sb.x + dx));
      if (dragState.mode.includes('r')) right = Math.max(left + minN, Math.min(1, sb.x + sb.w + dx));
      if (dragState.mode.includes('t')) top = Math.min(bottom - minN, Math.max(0, sb.y + dy));
      if (dragState.mode.includes('b')) bottom = Math.max(top + minN, Math.min(1, sb.y + sb.h + dy));

      let w = right - left;
      let h = bottom - top;

      if (targetRatio) {
        // Maintain exact pixel aspect ratio: (w * natW) / (h * natH) = targetRatio => w / h = targetRatio / imgRatio
        const normRatio = targetRatio / imgRatio;
        h = w / normRatio;
        if (dragState.mode.includes('t')) {
          top = bottom - h;
          if (top < 0) {
            top = 0;
            h = bottom;
            w = h * normRatio;
            if (dragState.mode.includes('l')) left = right - w;
          }
        } else {
          if (top + h > 1) {
            h = 1 - top;
            w = h * normRatio;
            if (dragState.mode.includes('l')) left = right - w;
          }
        }
        if (left < 0) {
          left = 0;
          w = right;
          h = w / normRatio;
          if (dragState.mode.includes('t')) top = bottom - h;
        }
        if (left + w > 1) {
          w = 1 - left;
          h = w / normRatio;
          if (dragState.mode.includes('t')) top = bottom - h;
        }
      }

      next = {
        x: Math.max(0, Math.min(1 - minN, left)),
        y: Math.max(0, Math.min(1 - minN, top)),
        w: Math.max(minN, Math.min(1, w)),
        h: Math.max(minN, Math.min(1, h))
      };
    }

    setCropBox(next);
    setOutWidth(Math.max(1, Math.round(next.w * natSize.w)));
    setOutHeight(Math.max(1, Math.round(next.h * natSize.h)));
  };

  const endCropDrag = (e) => {
    if (!dragState) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setDragState(null);
  };

  // Resize input handlers
  const handleOutWidthChange = (val) => {
    const num = Math.max(1, Math.min(8000, parseInt(val, 10) || 0));
    setOutWidth(num);
    if (lockResizeRatio && outWidth > 0 && outHeight > 0) {
      const ratio = outWidth / outHeight;
      setOutHeight(Math.max(1, Math.round(num / ratio)));
    }
  };

  const handleOutHeightChange = (val) => {
    const num = Math.max(1, Math.min(8000, parseInt(val, 10) || 0));
    setOutHeight(num);
    if (lockResizeRatio && outWidth > 0 && outHeight > 0) {
      const ratio = outWidth / outHeight;
      setOutWidth(Math.max(1, Math.round(num * ratio)));
    }
  };

  const applyResolutionPreset = (preset) => {
    const baseDims = computeSourceOutputDims(natSize.w, natSize.h, cropBox, framingMode, currentRatioObj.value);
    if (!baseDims.w || !baseDims.h) return;
    const baseRatio = baseDims.w / baseDims.h;

    if (preset.type === 'scale') {
      setOutWidth(Math.max(1, Math.round(baseDims.w * preset.val)));
      setOutHeight(Math.max(1, Math.round(baseDims.h * preset.val)));
    } else if (preset.type === 'width') {
      setOutWidth(preset.val);
      setOutHeight(Math.max(1, Math.round(preset.val / baseRatio)));
    }
  };

  // Render final processed Canvas for Single Image
  const renderFinalCanvas = async () => {
    if (!workingImage || !outWidth || !outHeight) return null;
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = workingImage;
    });

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (framingMode === 'pad' && currentRatioObj.value) {
      // 1. Draw Pad Background
      if (padBgType === 'blur') {
        ctx.save();
        ctx.filter = `blur(${Math.max(18, Math.round(outWidth * 0.025))}px) brightness(0.82)`;
        const coverScale = Math.max(outWidth / img.naturalWidth, outHeight / img.naturalHeight) * 1.1;
        const cw = img.naturalWidth * coverScale;
        const ch = img.naturalHeight * coverScale;
        ctx.drawImage(img, (outWidth - cw) / 2, (outHeight - ch) / 2, cw, ch);
        ctx.restore();
      } else {
        ctx.fillStyle = padBgType === 'white' ? '#ffffff' : padBgType === 'black' ? '#000000' : padBgColor;
        ctx.fillRect(0, 0, outWidth, outHeight);
      }

      // 2. Draw crisp centered full image with filters
      ctx.save();
      ctx.filter = filterCss;
      const fitScale = Math.min(outWidth / img.naturalWidth, outHeight / img.naturalHeight);
      const dw = img.naturalWidth * fitScale;
      const dh = img.naturalHeight * fitScale;
      ctx.drawImage(img, (outWidth - dw) / 2, (outHeight - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      // Crop mode
      if (format === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outWidth, outHeight);
      }
      const sx = Math.round(cropBox.x * img.naturalWidth);
      const sy = Math.round(cropBox.y * img.naturalHeight);
      const sw = Math.max(1, Math.round(cropBox.w * img.naturalWidth));
      const sh = Math.max(1, Math.round(cropBox.h * img.naturalHeight));

      ctx.save();
      ctx.filter = filterCss;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outWidth, outHeight);
      ctx.restore();
    }

    return canvas;
  };

  // Debounced live file size estimation
  useEffect(() => {
    if (!workingImage || !outWidth || !outHeight) return;
    const timer = setTimeout(async () => {
      try {
        const canvas = await renderFinalCanvas();
        if (!canvas) return;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality));
        if (blob) setEstimatedSize(blob.size);
      } catch {
        // ignore estimation errors
      }
    }, 260);
    return () => clearTimeout(timer);
  }, [
    workingImage, outWidth, outHeight, cropBox, framingMode, ratioId,
    padBgType, padBgColor, brightness, contrast, saturation, grayscale, format, quality
  ]);

  const handleDownloadSingle = async () => {
    setStatusErr('');
    try {
      const canvas = await renderFinalCanvas();
      if (!canvas) return;
      const ext = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';
      const baseName = (fileInfo.name || 'image').replace(/\.[^/.]+$/, '');
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality));
      if (blob) saveAs(blob, `${baseName}-${outWidth}x${outHeight}.${ext}`);
    } catch (err) {
      setStatusErr('ดาวน์โหลดไม่สำเร็จ: ' + err.message);
    }
  };

  const handleCopySingleImage = async () => {
    setStatusErr('');
    try {
      const canvas = await renderFinalCanvas();
      if (!canvas) return;
      if (isElectron && window.electronAPI?.copyImageToClipboard) {
        await window.electronAPI.copyImageToClipboard(canvas.toDataURL('image/png'));
      } else if (navigator.clipboard && window.ClipboardItem) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      } else {
        throw new Error('เบราว์เซอร์ไม่รองรับการคัดลอกรูปภาพ กรุณากดดาวน์โหลดแทน');
      }
      setCopiedImg(true);
      setTimeout(() => setCopiedImg(false), 2500);
    } catch (err) {
      setStatusErr(err.message);
    }
  };

  // --- Batch Processing ---
  const handleBatchProcess = async () => {
    if (batchFiles.length === 0) return;
    setBatchProcessing(true);
    setBatchProgress(0);
    try {
      const zip = new JSZip();
      const targetR = batchRatio === 'keep' ? null : (aspectRatios.find((r) => r.id === batchRatio)?.value || null);
      const ext = batchFormat === 'image/png' ? 'png' : batchFormat === 'image/webp' ? 'webp' : 'jpg';

      for (let i = 0; i < batchFiles.length; i++) {
        const file = batchFiles[i];
        const imgUrl = URL.createObjectURL(file);
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = reject;
          el.src = imgUrl;
        });

        let w = img.naturalWidth;
        let h = img.naturalHeight;
        let sx = 0, sy = 0, sw = w, sh = h;

        if (targetR) {
          const imgR = w / h;
          if (batchFit === 'crop') {
            if (imgR > targetR) {
              sw = Math.round(h * targetR);
              sx = Math.round((w - sw) / 2);
            } else {
              sh = Math.round(w / targetR);
              sy = Math.round((h - sh) / 2);
            }
            w = sw;
            h = sh;
          } else {
            if (imgR > targetR) {
              h = Math.round(w / targetR);
            } else {
              w = Math.round(h * targetR);
            }
          }
        }

        if (batchMaxWidth > 0 && w > batchMaxWidth) {
          const scale = batchMaxWidth / w;
          w = batchMaxWidth;
          h = Math.max(1, Math.round(h * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (targetR && batchFit !== 'crop') {
          if (batchFit === 'pad_blur') {
            ctx.save();
            ctx.filter = `blur(${Math.max(16, Math.round(w * 0.025))}px) brightness(0.82)`;
            const coverScale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * 1.1;
            const cw = img.naturalWidth * coverScale;
            const ch = img.naturalHeight * coverScale;
            ctx.drawImage(img, (w - cw) / 2, (h - ch) / 2, cw, ch);
            ctx.restore();
          } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
          }
          const fitScale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
          const dw = img.naturalWidth * fitScale;
          const dh = img.naturalHeight * fitScale;
          ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        } else {
          if (batchFormat === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        }

        URL.revokeObjectURL(imgUrl);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, batchFormat, batchQuality));
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        zip.file(`${baseName}-${w}x${h}.${ext}`, blob);
        setBatchProgress(Math.round(((i + 1) / batchFiles.length) * 100));
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `images-batch-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err) {
      setStatusErr('ประมวลผลชุดภาพไม่สำเร็จ: ' + err.message);
    } finally {
      setBatchProcessing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header + Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
            <FileImage size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">จัดการรูปภาพ (Image Studio)</h2>
            <p className="text-xs text-gray-500">
              ครอปภาพ ปรับสัดส่วน 16:9 / 16:10 เติมขอบเบลอ ปรับความละเอียด แปลงไฟล์ และบีบอัดในที่เดียว
            </p>
          </div>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-xl self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setStudioMode('single')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              studioMode === 'single' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Crop size={14} /> แต่ง & ครอปทีละรูป
          </button>
          <button
            type="button"
            onClick={() => setStudioMode('batch')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              studioMode === 'batch' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Layers size={14} /> ย่อ/แปลงหลายรูป (ZIP)
          </button>
        </div>
      </div>

      {studioMode === 'single' ? (
        !workingImage ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) loadImageFile(f);
            }}
            className="bg-white p-12 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 hover:border-indigo-400 hover:bg-gray-50/60 transition-all cursor-pointer text-center space-y-4"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                if (e.target.files?.[0]) loadImageFile(e.target.files[0]);
                e.target.value = '';
              }}
              className="hidden"
            />
            <div className="bg-indigo-50 text-indigo-600 rounded-2xl p-4 w-16 h-16 mx-auto flex items-center justify-center">
              <Upload size={32} />
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-base">คลิกเพื่อเลือกรูปภาพ ลากไฟล์มาวาง หรือกด Ctrl+V เพื่อวางรูป</p>
              <p className="text-xs text-gray-500 mt-1">รองรับ JPG, PNG, WEBP, GIF — ประมวลผลในเครื่อง 100% ไม่เสียความคมชัด</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Workspace Canvas (7 cols) */}
            <div className="lg:col-span-7 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
              {/* Top Info Bar */}
              <div className="p-3.5 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-700 truncate max-w-[180px]">{fileInfo.name}</span>
                  <span className="px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 font-mono text-[11px]">
                    ต้นฉบับ {natSize.w}×{natSize.h}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-mono text-[11px]">
                    ผลลัพธ์ {outWidth}×{outHeight}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (!originalImage) return;
                      const img = new Image();
                      img.onload = () => {
                        setWorkingImage(originalImage);
                        setNatSize({ w: img.naturalWidth, h: img.naturalHeight });
                        setCropBox({ x: 0, y: 0, w: 1, h: 1 });
                        setRatioId('free');
                        setFramingMode('crop');
                        setOutWidth(img.naturalWidth);
                        setOutHeight(img.naturalHeight);
                        setBrightness(100);
                        setContrast(100);
                        setSaturation(100);
                        setGrayscale(false);
                      };
                      img.src = originalImage;
                    }}
                    className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 flex items-center gap-1"
                  >
                    <RotateCcw size={12} /> รีเซ็ต
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOriginalImage(null);
                      setWorkingImage(null);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1"
                  >
                    <Trash2 size={12} /> เปลี่ยนรูป
                  </button>
                </div>
              </div>

              {/* Interactive Canvas Stage */}
              <div className="p-4 bg-slate-900 min-h-[380px] flex flex-col items-center justify-center relative select-none">
                {framingMode === 'pad' && currentRatioObj.value ? (
                  /* Live Fit / Pad Preview */
                  <div
                    className="relative overflow-hidden rounded-lg border border-slate-700 shadow-lg flex items-center justify-center"
                    style={{
                      aspectRatio: `${currentRatioObj.value}`,
                      maxHeight: '440px',
                      maxWidth: '100%',
                      width: currentRatioObj.value >= 1 ? '100%' : 'auto',
                      height: currentRatioObj.value < 1 ? '420px' : 'auto',
                      backgroundColor: padBgType === 'white' ? '#ffffff' : padBgType === 'black' ? '#000000' : padBgColor
                    }}
                  >
                    {padBgType === 'blur' && (
                      <img
                        src={workingImage}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover scale-110 pointer-events-none"
                        style={{ filter: 'blur(18px) brightness(0.82)' }}
                      />
                    )}
                    <img
                      src={workingImage}
                      alt="Pad Preview"
                      className="relative z-10 max-w-full max-h-full object-contain pointer-events-none"
                      style={{ filter: filterCss }}
                    />
                  </div>
                ) : (
                  /* Live Interactive Crop Stage */
                  <div
                    onPointerMove={onCropPointerMove}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                    className="relative inline-block max-w-full overflow-hidden rounded-lg touch-none border border-slate-700"
                  >
                    <img
                      ref={imgRef}
                      src={workingImage}
                      alt="Edit Canvas"
                      draggable={false}
                      className="block max-h-[460px] w-auto max-w-full object-contain pointer-events-none select-none"
                      style={{ filter: filterCss }}
                    />

                    {/* Interactive Draggable & Resizable Crop Box */}
                    <div
                      onPointerDown={(e) => startCropDrag(e, 'move')}
                      className="absolute border-2 border-indigo-400 cursor-move"
                      style={{
                        left: `${cropBox.x * 100}%`,
                        top: `${cropBox.y * 100}%`,
                        width: `${cropBox.w * 100}%`,
                        height: `${cropBox.h * 100}%`,
                        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.58)'
                      }}
                    >
                      {/* Rule of Thirds Grid Lines */}
                      <div className="absolute inset-0 pointer-events-none opacity-35">
                        <div className="absolute top-1/3 inset-x-0 h-px bg-white" />
                        <div className="absolute top-2/3 inset-x-0 h-px bg-white" />
                        <div className="absolute left-1/3 inset-y-0 w-px bg-white" />
                        <div className="absolute left-2/3 inset-y-0 w-px bg-white" />
                      </div>

                      {/* 4 Resizable Corner Handles */}
                      <div
                        onPointerDown={(e) => startCropDrag(e, 'tl')}
                        className="absolute -top-2 -left-2 w-4 h-4 bg-white border-2 border-indigo-600 rounded-sm cursor-nwse-resize"
                      />
                      <div
                        onPointerDown={(e) => startCropDrag(e, 'tr')}
                        className="absolute -top-2 -right-2 w-4 h-4 bg-white border-2 border-indigo-600 rounded-sm cursor-nesw-resize"
                      />
                      <div
                        onPointerDown={(e) => startCropDrag(e, 'bl')}
                        className="absolute -bottom-2 -left-2 w-4 h-4 bg-white border-2 border-indigo-600 rounded-sm cursor-nesw-resize"
                      />
                      <div
                        onPointerDown={(e) => startCropDrag(e, 'br')}
                        className="absolute -bottom-2 -right-2 w-4 h-4 bg-white border-2 border-indigo-600 rounded-sm cursor-nwse-resize"
                      />
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-slate-400 mt-3">
                  {framingMode === 'pad'
                    ? 'โหมดเติมขอบ: รักษาเนื้อหาภาพทั้งหมดไว้ครบ 100% ในสัดส่วนที่เลือก'
                    : '💡 ลากตรงกลางกรอบเพื่อเลื่อนตำแหน่ง หรือลากมุมทั้ง 4 ด้านเพื่อปรับขนาดกรอบครอป'}
                </p>
              </div>
            </div>

            {/* Right Controls Panel (5 cols) */}
            <div className="lg:col-span-5 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-gray-100 overflow-x-auto">
                {[
                  { id: 'crop', label: '1. ครอป/สัดส่วน' },
                  { id: 'resize', label: '2. ความละเอียด' },
                  { id: 'adjust', label: '3. ปรับสี' },
                  { id: 'export', label: '4. บีบอัด/โหลด' }
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setEditTab(t.id)}
                    className={`flex-1 py-3 px-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                      editTab === t.id
                        ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/60'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-5 space-y-5">
                {/* Tab 1: Crop & Ratio & Rotate/Flip */}
                {editTab === 'crop' && (
                  <div className="space-y-5 animate-fade-in">
                    {/* Framing Mode: Crop vs Fit/Pad */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleFramingModeChange('crop')}
                        className={`py-2.5 px-3 rounded-xl border-2 text-xs font-semibold transition-all ${
                          framingMode === 'crop' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        ✂️ ตัดภาพ (Crop)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFramingModeChange('pad')}
                        className={`py-2.5 px-3 rounded-xl border-2 text-xs font-semibold transition-all ${
                          framingMode === 'pad' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        🖼️ เติมขอบไม่ตัดภาพ (Fit)
                      </button>
                    </div>

                    {/* Aspect Ratio Grid */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-2">อัตราส่วนภาพ (Aspect Ratio)</label>
                      <div className="grid grid-cols-3 gap-2">
                        {aspectRatios.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            disabled={framingMode === 'pad' && r.id === 'free'}
                            onClick={() => applyAspectRatio(r.id)}
                            className={`py-2 px-2 rounded-xl border text-xs font-semibold transition-all disabled:opacity-35 ${
                              ratioId === r.id
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Pad Background Options */}
                    {framingMode === 'pad' && (
                      <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2.5 animate-fade-in">
                        <label className="block text-xs font-semibold text-gray-700">พื้นหลังส่วนที่เติมขอบ</label>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[
                            { id: 'blur', label: 'เบลอภาพ' },
                            { id: 'white', label: 'สีขาว' },
                            { id: 'black', label: 'สีดำ' },
                            { id: 'custom', label: 'เลือกสี' }
                          ].map((bg) => (
                            <button
                              key={bg.id}
                              type="button"
                              onClick={() => setPadBgType(bg.id)}
                              className={`py-1.5 rounded-lg border text-xs font-medium ${
                                padBgType === bg.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-200 text-gray-600'
                              }`}
                            >
                              {bg.label}
                            </button>
                          ))}
                        </div>
                        {padBgType === 'custom' && (
                          <div className="flex items-center gap-2 pt-1">
                            <input type="color" value={padBgColor} onChange={(e) => setPadBgColor(e.target.value)} className="h-8 w-12 rounded border cursor-pointer" />
                            <input type="text" value={padBgColor} onChange={(e) => setPadBgColor(e.target.value)} className="flex-1 p-1.5 text-xs font-mono uppercase rounded-lg border border-gray-200" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Rotate & Flip */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-2">หมุน & พลิกภาพ</label>
                      <div className="grid grid-cols-4 gap-2">
                        <button type="button" onClick={() => applyTransform('rot_left')} className="py-2 rounded-xl border border-gray-200 hover:bg-gray-50 flex flex-col items-center gap-1 text-[11px] text-gray-700">
                          <RotateCcw size={16} /> ซ้าย 90°
                        </button>
                        <button type="button" onClick={() => applyTransform('rot_right')} className="py-2 rounded-xl border border-gray-200 hover:bg-gray-50 flex flex-col items-center gap-1 text-[11px] text-gray-700">
                          <RotateCw size={16} /> ขวา 90°
                        </button>
                        <button type="button" onClick={() => applyTransform('flip_h')} className="py-2 rounded-xl border border-gray-200 hover:bg-gray-50 flex flex-col items-center gap-1 text-[11px] text-gray-700">
                          <FlipHorizontal size={16} /> พลิกซ้าย-ขวา
                        </button>
                        <button type="button" onClick={() => applyTransform('flip_v')} className="py-2 rounded-xl border border-gray-200 hover:bg-gray-50 flex flex-col items-center gap-1 text-[11px] text-gray-700">
                          <FlipVertical size={16} /> พลิกบน-ล่าง
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 2: Re-Resolution */}
                {editTab === 'resize' && (
                  <div className="space-y-5 animate-fade-in">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">ความกว้าง (Width px)</label>
                        <input
                          type="number"
                          min="1"
                          max="8000"
                          value={outWidth}
                          onChange={(e) => handleOutWidthChange(e.target.value)}
                          className="w-full p-2.5 rounded-xl border border-gray-200 font-mono text-sm outline-none focus:border-indigo-500"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => setLockResizeRatio(!lockResizeRatio)}
                        title={lockResizeRatio ? 'ล็อกอัตราส่วนอยู่' : 'ปลดล็อกอัตราส่วน'}
                        className={`p-2.5 rounded-xl border mb-0.5 transition-all ${
                          lockResizeRatio ? 'bg-indigo-50 border-indigo-300 text-indigo-600' : 'border-gray-200 text-gray-400'
                        }`}
                      >
                        {lockResizeRatio ? <Lock size={18} /> : <Unlock size={18} />}
                      </button>

                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">ความสูง (Height px)</label>
                        <input
                          type="number"
                          min="1"
                          max="8000"
                          value={outHeight}
                          onChange={(e) => handleOutHeightChange(e.target.value)}
                          className="w-full p-2.5 rounded-xl border border-gray-200 font-mono text-sm outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-2">ความละเอียดสำเร็จรูป (Presets)</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: '4K UHD (กว้าง 3840px)', type: 'width', val: 3840 },
                          { label: 'Full HD (กว้าง 1920px)', type: 'width', val: 1920 },
                          { label: 'HD (กว้าง 1280px)', type: 'width', val: 1280 },
                          { label: 'Web / Line (กว้าง 800px)', type: 'width', val: 800 },
                          { label: 'ขนาดต้นฉบับ (100%)', type: 'scale', val: 1 },
                          { label: 'ย่อเหลือ 75%', type: 'scale', val: 0.75 },
                          { label: 'ย่อเหลือ 50%', type: 'scale', val: 0.5 },
                          { label: 'ย่อเหลือ 25%', type: 'scale', val: 0.25 }
                        ].map((p, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => applyResolutionPreset(p)}
                            className="py-2 px-3 rounded-xl border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/40 text-xs font-medium text-gray-700 text-left transition-all"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 3: Color Adjustments */}
                {editTab === 'adjust' && (
                  <div className="space-y-4 animate-fade-in">
                    <div>
                      <div className="flex justify-between text-xs font-medium text-gray-700 mb-1">
                        <span>ความสว่าง (Brightness)</span>
                        <span className="font-mono">{brightness}%</span>
                      </div>
                      <input type="range" min="50" max="150" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs font-medium text-gray-700 mb-1">
                        <span>คอนทราสต์ (Contrast)</span>
                        <span className="font-mono">{contrast}%</span>
                      </div>
                      <input type="range" min="50" max="150" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs font-medium text-gray-700 mb-1">
                        <span>ความสดสี (Saturation)</span>
                        <span className="font-mono">{saturation}%</span>
                      </div>
                      <input type="range" min="0" max="200" value={saturation} onChange={(e) => setSaturation(Number(e.target.value))} className="w-full accent-indigo-600" />
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} className="rounded accent-indigo-600 w-4 h-4" />
                        <span>โหมดภาพขาว-ดำ (Grayscale)</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => { setBrightness(100); setContrast(100); setSaturation(100); setGrayscale(false); }}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        คืนค่าสีเดิม
                      </button>
                    </div>
                  </div>
                )}

                {/* Tab 4: Export & Compression */}
                {editTab === 'export' && (
                  <div className="space-y-4 animate-fade-in">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-2">รูปแบบไฟล์ (Format)</label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'image/jpeg', label: 'JPG (ไฟล์เล็ก)' },
                          { id: 'image/png', label: 'PNG (คมชัดสูง)' },
                          { id: 'image/webp', label: 'WEBP (เว็บไว)' }
                        ].map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setFormat(f.id)}
                            className={`py-2 px-2 rounded-xl border text-xs font-semibold transition-all ${
                              format === f.id ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {format !== 'image/png' && (
                      <div>
                        <div className="flex justify-between text-xs font-medium text-gray-700 mb-1">
                          <span>คุณภาพ / การบีบอัด (Quality)</span>
                          <span className="font-mono text-indigo-600">{Math.round(quality * 100)}%</span>
                        </div>
                        <input type="range" min="0.1" max="1.0" step="0.05" value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full accent-indigo-600" />
                      </div>
                    )}

                    {/* Size comparison card */}
                    <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs">
                      <div>
                        <div className="text-gray-500">ขนาดไฟล์ต้นฉบับ</div>
                        <div className="font-bold text-gray-800">{formatSize(fileInfo.originalSize)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-gray-500">ขนาดไฟล์ใหม่ (ประมาณ)</div>
                        <div className="font-bold text-indigo-600">
                          {estimatedSize ? formatSize(estimatedSize) : '...'}
                          {estimatedSize > 0 && fileInfo.originalSize > 0 && (
                            <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${estimatedSize <= fileInfo.originalSize ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {estimatedSize <= fileInfo.originalSize ? '-' : '+'}
                              {Math.abs(Math.round(((fileInfo.originalSize - estimatedSize) / fileInfo.originalSize) * 100))}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {statusErr && (
                  <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs text-center">
                    {statusErr}
                  </div>
                )}

                {/* Always-visible Action Footer */}
                <div className="pt-3 border-t border-gray-100 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleCopySingleImage}
                    className="py-3 px-3 rounded-xl border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 font-semibold text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5"
                  >
                    {copiedImg ? <Check size={17} className="text-emerald-600" /> : <Copy size={17} />}
                    <span>{copiedImg ? 'คัดลอกแล้ว!' : 'คัดลอกรูป'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSingle}
                    className="py-3 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-lg shadow-indigo-100 transition-all flex items-center justify-center gap-1.5"
                  >
                    <Download size={17} />
                    <span>ดาวน์โหลด</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        /* Batch Resize & Convert Mode */
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6 animate-fade-in">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative cursor-pointer">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setBatchFiles(Array.from(e.target.files || []))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <Layers size={36} className="text-indigo-500 mx-auto mb-3" />
            <p className="font-semibold text-gray-800">
              {batchFiles.length > 0 ? `เลือกแล้ว ${batchFiles.length} รูปภาพ (คลิกเพื่อเปลี่ยนชุดรูป)` : 'คลิกเพื่อเลือกรูปภาพหลายรูปพร้อมกัน'}
            </p>
            <p className="text-xs text-gray-500 mt-1">ระบบจะปรับสัดส่วน ย่อความละเอียด แปลงไฟล์ และรวมเป็นไฟล์ ZIP ให้อัตโนมัติ</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">ปรับสัดส่วน</label>
              <select value={batchRatio} onChange={(e) => setBatchRatio(e.target.value)} className="w-full p-2.5 rounded-xl border border-gray-200 text-sm bg-white">
                <option value="keep">คงสัดส่วนเดิม</option>
                <option value="16:9">16:9</option>
                <option value="16:10">16:10</option>
                <option value="4:3">4:3</option>
                <option value="1:1">1:1 (สี่เหลี่ยมจัตุรัส)</option>
                <option value="9:16">9:16 (แนวตั้ง)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">วิธีปรับสัดส่วน</label>
              <select value={batchFit} onChange={(e) => setBatchFit(e.target.value)} disabled={batchRatio === 'keep'} className="w-full p-2.5 rounded-xl border border-gray-200 text-sm bg-white disabled:opacity-50">
                <option value="crop">ครอปตรงกลาง (Center Crop)</option>
                <option value="pad_blur">เติมขอบพื้นหลังเบลอ (Fit Blur)</option>
                <option value="pad_white">เติมขอบสีขาว (Fit White)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">ความกว้างสูงสุด (Max Width)</label>
              <select value={batchMaxWidth} onChange={(e) => setBatchMaxWidth(Number(e.target.value))} className="w-full p-2.5 rounded-xl border border-gray-200 text-sm bg-white">
                <option value={0}>คงขนาดเดิม</option>
                <option value={3840}>3840 px (4K)</option>
                <option value={1920}>1920 px (Full HD)</option>
                <option value={1280}>1280 px (HD)</option>
                <option value={1080}>1080 px (Social)</option>
                <option value={800}>800 px (Web)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">นามสกุล & คุณภาพ ({Math.round(batchQuality * 100)}%)</label>
              <div className="flex gap-2">
                <select value={batchFormat} onChange={(e) => setBatchFormat(e.target.value)} className="flex-1 p-2.5 rounded-xl border border-gray-200 text-sm bg-white">
                  <option value="image/jpeg">JPG</option>
                  <option value="image/png">PNG</option>
                  <option value="image/webp">WEBP</option>
                </select>
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={Math.round(batchQuality * 100)}
                  onChange={(e) => setBatchQuality(Math.min(1, Math.max(0.1, Number(e.target.value) / 100)))}
                  className="w-16 p-2.5 rounded-xl border border-gray-200 text-sm text-center font-mono"
                />
              </div>
            </div>
          </div>

          {batchProcessing && (
            <div className="space-y-1.5">
              <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-600 transition-all duration-200" style={{ width: `${batchProgress}%` }} />
              </div>
              <p className="text-xs text-center text-indigo-600 font-medium">กำลังประมวลผล... {batchProgress}%</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleBatchProcess}
            disabled={batchFiles.length === 0 || batchProcessing}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl shadow-lg shadow-indigo-100 transition-all flex items-center justify-center gap-2"
          >
            <Download size={20} />
            <span>{batchProcessing ? 'กำลังสร้างไฟล์ ZIP...' : `ประมวลผลทั้งหมด (${batchFiles.length} รูป) และดาวน์โหลด ZIP`}</span>
          </button>
        </div>
      )}
    </div>
  );
};

// 3. PDF Optimizer (Rasterize Pages to Images)
const PdfOptimizer = () => {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedPdf, setProcessedPdf] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [qualityLevel, setQualityLevel] = useState(70); // 10-100

  const [numPages, setNumPages] = useState(0);

  const handleFileChange = async (e) => {
    if (e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setProcessedPdf(null);
      setStatusMsg('');
      setProgress(0);

      // Get page count for estimation
      try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        setNumPages(pdf.numPages);
      } catch (err) {
        console.error("Error reading PDF metadata:", err);
        setNumPages(0);
      }
    }
  };

  const processPdf = async () => {
    if (!file) return;
    setIsProcessing(true);
    setStatusMsg('กำลังเตรียมการ...');
    setProgress(0);

    try {
      // Import libraries dynamically
      // const PDFLib = await import('pdf-lib');
      // const pdfjs = await import('pdfjs-dist');

      // Set worker source (using unpkg for better compatibility with newer versions)
      // pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;

      const newPdfDoc = await PDFDocument.create();

      for (let i = 1; i <= numPages; i++) {
        setStatusMsg(`กำลังแปลงหน้า ${i} จาก ${numPages}...`);
        setProgress(Math.round((i / numPages) * 100));

        const page = await pdf.getPage(i);


        // Determine scale and quality based on slider (10-100)
        // Tune formula to favor size reduction
        const qualityVal = qualityLevel / 100;

        // Scale: 0.5 to 1.5 (Reduced from 2.0 max)
        const scale = 0.5 + (1.0 * (qualityLevel / 100));

        // JPEG Quality: 0.2 to 0.8 (Capped at 0.8 to ensure compression)
        const quality = 0.2 + (0.6 * qualityVal);

        const viewport = page.getViewport({ scale: scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        // Convert to JPEG
        const imgDataUrl = canvas.toDataURL('image/jpeg', quality);
        const imgBytes = await fetch(imgDataUrl).then(res => res.arrayBuffer());

        const jpgImage = await newPdfDoc.embedJpg(imgBytes);
        const newPage = newPdfDoc.addPage([jpgImage.width, jpgImage.height]);
        newPage.drawImage(jpgImage, {
          x: 0,
          y: 0,
          width: jpgImage.width,
          height: jpgImage.height,
        });
      }

      setStatusMsg('กำลังรวมไฟล์ PDF...');
      const pdfBytes = await newPdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      setProcessedPdf({
        url: url,
        size: pdfBytes.byteLength
      });
      setStatusMsg('เสร็จสิ้น!');

    } catch (err) {
      console.error(err);
      setStatusMsg('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">จัดการไฟล์ PDF</h2>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        {!file ? (
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:bg-gray-50 transition-colors relative cursor-pointer group">
            <input type="file" accept=".pdf" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            <div className="bg-red-100 text-red-600 rounded-full p-4 w-16 h-16 mx-auto mb-4 group-hover:scale-110 transition-transform flex items-center justify-center"><FileType size={32} /></div>
            <p className="font-medium text-gray-700">อัปโหลดไฟล์ PDF</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="bg-red-100 p-3 rounded-lg text-red-600"><FileType size={24} /></div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{file.name}</p>
                <p className="text-sm text-gray-500">{formatSize(file.size)} • {numPages} หน้า</p>
              </div>
              <button onClick={() => setFile(null)} className="text-gray-400 hover:text-red-500"><X size={20} /></button>
            </div>

            {!processedPdf ? (
              <div className="space-y-3">
                <button onClick={processPdf} disabled={isProcessing} className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-red-200 flex justify-center items-center gap-2">
                  {isProcessing ? <><span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span><span>{statusMsg} ({progress}%)</span></> : <><Zap size={20} /><span>เริ่มบีบอัด</span></>}
                </button>
                <p className="text-xs text-gray-400 text-center">เมื่อบีบอัดแล้วข้อความจะไม่สามารถค้นหาได้</p>

                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-gray-700">ระดับคุณภาพ: {qualityLevel}%</label>
                    <span className="text-xs text-gray-500">
                      ประมาณ: ~{formatSize(numPages * 150000 * (qualityLevel / 100))}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={qualityLevel}
                    onChange={(e) => setQualityLevel(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-600"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>เล็ก (10%)</span>
                    <span>ชัดมาก (100%)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-fade-in">
                <div className="p-4 bg-green-50 border border-green-100 rounded-xl flex flex-col gap-1 text-green-700">
                  <div className="flex items-center gap-2 font-bold"><Check size={20} /> <span>เรียบร้อย!</span></div>
                  <div className="text-sm ml-7">ขนาดใหม่: {formatSize(processedPdf.size)} <span className="bg-green-200 px-2 rounded-full">-{Math.round(((file.size - processedPdf.size) / file.size) * 100)}%</span></div>
                </div>
                <a href={processedPdf.url} download={`optimized-${file.name}`} className="w-full bg-gray-900 text-white font-medium py-3 rounded-xl hover:bg-gray-800 transition-all flex justify-center items-center gap-2">
                  <Download size={20} /> ดาวน์โหลดไฟล์ใหม่
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// 4. Advanced QR Code Generator (Pro Suite)
const QRCodeGenerator = () => {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

  // Content Type & Fields
  const [contentType, setContentType] = useState('url'); // url, text, wifi, vcard, contact
  const [url, setUrl] = useState('https://example.com');
  const [plainText, setPlainText] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiEncryption, setWifiEncryption] = useState('WPA'); // WPA, WEP, nopass
  const [wifiHidden, setWifiHidden] = useState(false);
  const [showWifiPass, setShowWifiPass] = useState(false);

  const [vcardName, setVcardName] = useState('');
  const [vcardOrg, setVcardOrg] = useState('');
  const [vcardTitle, setVcardTitle] = useState('');
  const [vcardPhone, setVcardPhone] = useState('');
  const [vcardEmail, setVcardEmail] = useState('');

  const [contactMode, setContactMode] = useState('tel'); // tel, email
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSubject, setContactSubject] = useState('');

  // Tabs & Export
  const [activeTab, setActiveTab] = useState('content'); // content, colors, logo, design, frame
  const [size, setSize] = useState(1024);
  const [fileExt, setFileExt] = useState('png');
  const [isExporting, setIsExporting] = useState(false);
  const [copiedImg, setCopiedImg] = useState(false);
  const [copyErr, setCopyErr] = useState('');

  // Design Options
  const [shape, setShape] = useState('square'); // square, circle
  const [dotType, setDotType] = useState('rounded');
  const [cornerSquareType, setCornerSquareType] = useState('extra-rounded');
  const [cornerDotType, setCornerDotType] = useState('dot');
  const [qrMargin, setQrMargin] = useState(12);
  const [errorLevel, setErrorLevel] = useState('Q'); // L, M, Q, H

  // Color Options
  const [transparentBg, setTransparentBg] = useState(false);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [fgType, setFgType] = useState('single'); // single, gradient
  const [fgColor, setFgColor] = useState('#111d47');
  const [gradientColor1, setGradientColor1] = useState('#1e3a8a');
  const [gradientColor2, setGradientColor2] = useState('#4f46e5');
  const [gradientType, setGradientType] = useState('linear');
  const [rotation, setRotation] = useState(45);
  const [customEyeColor, setCustomEyeColor] = useState(false);
  const [eyeFrameColor, setEyeFrameColor] = useState('#4f46e5');
  const [eyeBallColor, setEyeBallColor] = useState('#111d47');

  // Logo Options
  const [logo, setLogo] = useState(null);
  const [selectedDefaultLogoIdx, setSelectedDefaultLogoIdx] = useState(null);
  const [logoSize, setLogoSize] = useState(0.38);
  const [logoMargin, setLogoMargin] = useState(8);
  const [hideBgDots, setHideBgDots] = useState(true);

  // Frame & Caption Options
  const [frameStyle, setFrameStyle] = useState('none'); // none, card, banner, top_banner
  const [frameText, setFrameText] = useState('สแกนที่นี่');
  const [frameColor, setFrameColor] = useState('#111d47');
  const [frameTextColor, setFrameTextColor] = useState('#ffffff');

  const ref = useRef(null);

  // Quick Style Presets
  const presets = [
    {
      id: 'classic',
      name: 'คลาสสิก',
      preview: ['#000000', '#ffffff'],
      apply: () => {
        setTransparentBg(false);
        setBgColor('#ffffff');
        setFgType('single');
        setFgColor('#000000');
        setCustomEyeColor(false);
        setDotType('square');
        setCornerSquareType('square');
        setCornerDotType('square');
        setShape('square');
      }
    },
    {
      id: 'navy_gold',
      name: 'กรมท่า-ทอง',
      preview: ['#1e3a8a', '#d97706'],
      apply: () => {
        setTransparentBg(false);
        setBgColor('#ffffff');
        setFgType('single');
        setFgColor('#1e3a8a');
        setCustomEyeColor(true);
        setEyeFrameColor('#1e3a8a');
        setEyeBallColor('#d97706');
        setDotType('rounded');
        setCornerSquareType('extra-rounded');
        setCornerDotType('dot');
        setShape('square');
        setFrameColor('#1e3a8a');
        setFrameTextColor('#ffffff');
      }
    },
    {
      id: 'emerald',
      name: 'มรกต',
      preview: ['#047857', '#0d9488'],
      apply: () => {
        setTransparentBg(false);
        setBgColor('#ffffff');
        setFgType('gradient');
        setGradientColor1('#047857');
        setGradientColor2('#0d9488');
        setGradientType('linear');
        setRotation(135);
        setCustomEyeColor(true);
        setEyeFrameColor('#065f46');
        setEyeBallColor('#0d9488');
        setDotType('extra-rounded');
        setCornerSquareType('extra-rounded');
        setCornerDotType('dot');
        setShape('square');
        setFrameColor('#047857');
        setFrameTextColor('#ffffff');
      }
    },
    {
      id: 'sunset',
      name: 'ซันเซ็ต',
      preview: ['#e11d48', '#f97316'],
      apply: () => {
        setTransparentBg(false);
        setBgColor('#ffffff');
        setFgType('gradient');
        setGradientColor1('#e11d48');
        setGradientColor2('#f97316');
        setGradientType('linear');
        setRotation(45);
        setCustomEyeColor(true);
        setEyeFrameColor('#be123c');
        setEyeBallColor('#ea580c');
        setDotType('classy-rounded');
        setCornerSquareType('extra-rounded');
        setCornerDotType('dot');
        setShape('square');
        setFrameColor('#e11d48');
        setFrameTextColor('#ffffff');
      }
    },
    {
      id: 'modern',
      name: 'โมเดิร์น',
      preview: ['#4f46e5', '#7c3aed'],
      apply: () => {
        setTransparentBg(false);
        setBgColor('#ffffff');
        setFgType('gradient');
        setGradientColor1('#4f46e5');
        setGradientColor2('#7c3aed');
        setGradientType('linear');
        setRotation(45);
        setCustomEyeColor(false);
        setDotType('dots');
        setCornerSquareType('dot');
        setCornerDotType('dot');
        setShape('square');
        setFrameColor('#4f46e5');
        setFrameTextColor('#ffffff');
      }
    },
    {
      id: 'minimal',
      name: 'มินิมอล',
      preview: ['#1e293b', '#f8fafc'],
      apply: () => {
        setTransparentBg(false);
        setBgColor('#f8fafc');
        setFgType('single');
        setFgColor('#1e293b');
        setCustomEyeColor(false);
        setDotType('classy');
        setCornerSquareType('extra-rounded');
        setCornerDotType('rounded');
        setShape('square');
        setFrameColor('#1e293b');
        setFrameTextColor('#ffffff');
      }
    }
  ];

  // Build encoded QR data string based on contentType
  const escapeWifi = (str) => str.replace(/([\\;,:"])/g, '\\$1');

  const qrData = useMemo(() => {
    switch (contentType) {
      case 'url':
        return url.trim() || 'https://example.com';
      case 'text':
        return plainText.trim() || 'ข้อความตัวอย่าง';
      case 'wifi': {
        const ssid = escapeWifi(wifiSsid.trim());
        const pass = wifiEncryption === 'nopass' ? '' : escapeWifi(wifiPassword);
        return `WIFI:T:${wifiEncryption};S:${ssid};P:${pass};H:${wifiHidden ? 'true' : 'false'};;`;
      }
      case 'vcard': {
        const lines = [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `FN:${vcardName.trim() || 'ชื่อ-นามสกุล'}`,
          vcardOrg.trim() ? `ORG:${vcardOrg.trim()}` : '',
          vcardTitle.trim() ? `TITLE:${vcardTitle.trim()}` : '',
          vcardPhone.trim() ? `TEL;TYPE=CELL:${vcardPhone.trim()}` : '',
          vcardEmail.trim() ? `EMAIL:${vcardEmail.trim()}` : '',
          'END:VCARD'
        ].filter(Boolean);
        return lines.join('\n');
      }
      case 'contact': {
        if (contactMode === 'tel') {
          return `tel:${contactPhone.trim().replace(/\s+/g, '')}`;
        }
        const subj = contactSubject.trim() ? `?subject=${encodeURIComponent(contactSubject.trim())}` : '';
        return `mailto:${contactEmail.trim()}${subj}`;
      }
      default:
        return url.trim() || 'https://example.com';
    }
  }, [
    contentType, url, plainText, wifiSsid, wifiPassword, wifiEncryption, wifiHidden,
    vcardName, vcardOrg, vcardTitle, vcardPhone, vcardEmail,
    contactMode, contactPhone, contactEmail, contactSubject
  ]);

  // Build QRCodeStyling options object
  const buildQrOptions = (renderSize = 260, renderType = 'svg') => {
    const dotsOptions = {
      type: dotType,
      color: fgType === 'single' ? fgColor : undefined,
      gradient: fgType === 'gradient'
        ? {
            type: gradientType,
            rotation: rotation * (Math.PI / 180),
            colorStops: [
              { offset: 0, color: gradientColor1 },
              { offset: 1, color: gradientColor2 }
            ]
          }
        : undefined
    };

    const defaultEyeColor = fgType === 'single' ? fgColor : gradientColor1;

    return {
      width: renderSize,
      height: renderSize,
      type: renderType,
      shape,
      margin: Math.round((qrMargin / 260) * renderSize),
      data: qrData,
      image: logo || undefined,
      qrOptions: {
        errorCorrectionLevel: errorLevel
      },
      dotsOptions,
      backgroundOptions: {
        color: transparentBg ? 'rgba(0, 0, 0, 0)' : bgColor
      },
      cornersSquareOptions: {
        type: cornerSquareType,
        color: customEyeColor ? eyeFrameColor : defaultEyeColor
      },
      cornersDotOptions: {
        type: cornerDotType,
        color: customEyeColor ? eyeBallColor : defaultEyeColor
      },
      imageOptions: {
        crossOrigin: 'anonymous',
        hideBackgroundDots: hideBgDots,
        imageSize: logoSize,
        margin: Math.round((logoMargin / 260) * renderSize)
      }
    };
  };

  const [qrCode] = useState(() => new QRCodeStyling(buildQrOptions(260, 'svg')));

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = '';
      qrCode.append(ref.current);
    }
  }, [qrCode]);

  useEffect(() => {
    qrCode.update(buildQrOptions(260, 'svg'));
  }, [
    qrCode, qrData, logo, shape, dotType, cornerSquareType, cornerDotType,
    qrMargin, errorLevel, transparentBg, bgColor, fgType, fgColor,
    gradientColor1, gradientColor2, gradientType, rotation,
    customEyeColor, eyeFrameColor, eyeBallColor, logoSize, logoMargin, hideBgDots
  ]);

  const handleSelectDefaultLogo = async (logoPath, index) => {
    setSelectedDefaultLogoIdx(index);
    setErrorLevel('H'); // Auto boost error correction for logo scannability
    try {
      const res = await fetch(logoPath);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => setLogo(reader.result);
      reader.readAsDataURL(blob);
    } catch {
      setLogo(logoPath);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedDefaultLogoIdx(null);
      setErrorLevel('H');
      const reader = new FileReader();
      reader.onload = (ev) => setLogo(ev.target.result);
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  // Helper: Draw rounded rectangle path on Canvas
  const drawRoundedRect = (ctx, x, y, w, h, r) => {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  };

  // Compose high-resolution PNG/JPEG Blob (including optional Frame & Caption)
  const renderHighResCanvas = async (targetSize, format = 'png') => {
    const tempQr = new QRCodeStyling(buildQrOptions(targetSize, 'canvas'));
    const rawBlob = await tempQr.getRawData('png');
    if (!rawBlob) throw new Error('ไม่สามารถสร้างภาพ QR Code ได้');

    const imgUrl = URL.createObjectURL(rawBlob);
    const qrImg = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imgUrl;
    });

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const caption = frameText.trim();

      if (frameStyle === 'none') {
        canvas.width = targetSize;
        canvas.height = targetSize;
        if (format === 'jpeg') {
          ctx.fillStyle = transparentBg ? '#ffffff' : bgColor;
          ctx.fillRect(0, 0, targetSize, targetSize);
        }
        ctx.drawImage(qrImg, 0, 0, targetSize, targetSize);
        return canvas;
      }

      const pad = Math.round(targetSize * 0.065);
      const bannerH = Math.round(targetSize * 0.16);
      const radius = Math.round(targetSize * 0.05);
      const borderW = Math.max(4, Math.round(targetSize * 0.012));
      const totalW = targetSize + pad * 2;
      const totalH = targetSize + pad * 2 + bannerH;

      canvas.width = totalW;
      canvas.height = totalH;

      const cardBg = transparentBg ? '#ffffff' : bgColor;
      const fontSize = Math.round(targetSize * 0.068);
      ctx.font = `700 ${fontSize}px "Segoe UI", Tahoma, "THSarabunPSK", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (frameStyle === 'card') {
        // Rounded card with border + caption text below QR
        drawRoundedRect(ctx, borderW / 2, borderW / 2, totalW - borderW, totalH - borderW, radius);
        ctx.fillStyle = cardBg;
        ctx.fill();
        ctx.lineWidth = borderW;
        ctx.strokeStyle = frameColor;
        ctx.stroke();

        ctx.drawImage(qrImg, pad, pad, targetSize, targetSize);

        if (caption) {
          ctx.fillStyle = frameColor;
          ctx.fillText(caption, totalW / 2, pad + targetSize + bannerH / 2, totalW - pad * 2);
        }
      } else if (frameStyle === 'banner') {
        // Rounded card with solid colored bottom banner strip
        ctx.save();
        drawRoundedRect(ctx, borderW / 2, borderW / 2, totalW - borderW, totalH - borderW, radius);
        ctx.clip();

        ctx.fillStyle = cardBg;
        ctx.fillRect(0, 0, totalW, totalH);
        ctx.drawImage(qrImg, pad, pad, targetSize, targetSize);

        ctx.fillStyle = frameColor;
        ctx.fillRect(0, totalH - bannerH, totalW, bannerH);

        if (caption) {
          ctx.fillStyle = frameTextColor;
          ctx.fillText(caption, totalW / 2, totalH - bannerH / 2, totalW - pad * 1.5);
        }
        ctx.restore();

        drawRoundedRect(ctx, borderW / 2, borderW / 2, totalW - borderW, totalH - borderW, radius);
        ctx.lineWidth = borderW;
        ctx.strokeStyle = frameColor;
        ctx.stroke();
      } else if (frameStyle === 'top_banner') {
        // Rounded card with solid colored top banner strip
        ctx.save();
        drawRoundedRect(ctx, borderW / 2, borderW / 2, totalW - borderW, totalH - borderW, radius);
        ctx.clip();

        ctx.fillStyle = cardBg;
        ctx.fillRect(0, 0, totalW, totalH);

        ctx.fillStyle = frameColor;
        ctx.fillRect(0, 0, totalW, bannerH);

        if (caption) {
          ctx.fillStyle = frameTextColor;
          ctx.fillText(caption, totalW / 2, bannerH / 2, totalW - pad * 1.5);
        }

        ctx.drawImage(qrImg, pad, bannerH + pad, targetSize, targetSize);
        ctx.restore();

        drawRoundedRect(ctx, borderW / 2, borderW / 2, totalW - borderW, totalH - borderW, radius);
        ctx.lineWidth = borderW;
        ctx.strokeStyle = frameColor;
        ctx.stroke();
      }

      return canvas;
    } finally {
      URL.revokeObjectURL(imgUrl);
    }
  };

  const onDownloadClick = async () => {
    setIsExporting(true);
    setCopyErr('');
    try {
      const safeName = `qr-${contentType}-${new Date().toISOString().slice(0, 10)}`;
      if (fileExt === 'svg') {
        const tempQr = new QRCodeStyling(buildQrOptions(size, 'svg'));
        const svgBlob = await tempQr.getRawData('svg');
        if (svgBlob) saveAs(svgBlob, `${safeName}.svg`);
        return;
      }

      const canvas = await renderHighResCanvas(size, fileExt);
      const mime = fileExt === 'jpeg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.96));
      if (blob) saveAs(blob, `${safeName}.${fileExt}`);
    } catch (err) {
      setCopyErr('ดาวน์โหลดไม่สำเร็จ: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const onCopyImageClick = async () => {
    setIsExporting(true);
    setCopyErr('');
    try {
      const canvas = await renderHighResCanvas(Math.min(size, 1024), 'png');
      if (isElectron && window.electronAPI?.copyImageToClipboard) {
        const dataUrl = canvas.toDataURL('image/png');
        await window.electronAPI.copyImageToClipboard(dataUrl);
      } else if (navigator.clipboard && window.ClipboardItem) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      } else {
        throw new Error('เบราว์เซอร์ไม่รองรับการคัดลอกรูปภาพ กรุณากดดาวน์โหลดแทน');
      }
      setCopiedImg(true);
      setTimeout(() => setCopiedImg(false), 2500);
    } catch (err) {
      setCopyErr(err.message || 'ไม่สามารถคัดลอกรูปได้');
    } finally {
      setIsExporting(false);
    }
  };

  // Helper to render shape preview icons
  const renderShapePreview = (type, isFrame = false) => {
    const commonClass = 'bg-gray-800';
    if (isFrame) {
      switch (type) {
        case 'square': return <div className="w-5 h-5 border-2 border-gray-800"></div>;
        case 'dot': return <div className="w-5 h-5 border-2 border-gray-800 rounded-full"></div>;
        case 'extra-rounded': return <div className="w-5 h-5 border-2 border-gray-800 rounded-lg"></div>;
        default: return <div className="w-5 h-5 border-2 border-gray-800"></div>;
      }
    } else {
      switch (type) {
        case 'square': return <div className={`w-4 h-4 ${commonClass}`}></div>;
        case 'dot':
        case 'dots': return <div className={`w-4 h-4 ${commonClass} rounded-full`}></div>;
        case 'rounded': return <div className={`w-4 h-4 ${commonClass} rounded-md`}></div>;
        case 'extra-rounded': return <div className={`w-4 h-4 ${commonClass} rounded-lg`}></div>;
        case 'classy': return <div className={`w-4 h-4 ${commonClass} rounded-tr-lg rounded-bl-lg`}></div>;
        case 'classy-rounded': return <div className={`w-4 h-4 ${commonClass} rounded-tr-lg rounded-bl-lg rounded-tl-sm rounded-br-sm`}></div>;
        default: return <div className={`w-4 h-4 ${commonClass}`}></div>;
      }
    }
  };

  const contentTypes = [
    { id: 'url', label: 'ลิงก์ URL', icon: Link },
    { id: 'text', label: 'ข้อความ', icon: FileText },
    { id: 'wifi', label: 'Wi-Fi', icon: Wifi },
    { id: 'vcard', label: 'นามบัตร', icon: User },
    { id: 'contact', label: 'โทร/อีเมล', icon: Phone }
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
            <QrCode size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">สร้าง QR Code</h2>
            <p className="text-xs text-gray-500">
              รองรับลิงก์, Wi-Fi, นามบัตร พร้อมใส่โลโก้ กรอบข้อความ และคัดลอกไปวางใช้งานได้ทันที
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            presets[1].apply();
            setFrameStyle('none');
            setQrMargin(12);
            setErrorLevel(logo ? 'H' : 'Q');
          }}
          className="self-start sm:self-auto px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-xl border border-gray-200 flex items-center gap-1.5 transition-all"
        >
          <RotateCcw size={14} />
          <span>รีเซ็ตดีไซน์</span>
        </button>
      </div>

      {/* Quick Style Presets Strip */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={15} className="text-indigo-600" />
          <span className="text-xs font-semibold text-gray-700">ธีมดีไซน์สำเร็จรูป (คลิกเพื่อเปลี่ยนทันที)</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={p.apply}
              className="flex items-center gap-2 p-2 rounded-xl border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/40 transition-all text-left"
            >
              <span
                className="w-5 h-5 rounded-full shrink-0 border border-gray-200 shadow-inner"
                style={{ background: `linear-gradient(135deg, ${p.preview[0]} 50%, ${p.preview[1]} 50%)` }}
              />
              <span className="text-xs font-medium text-gray-700 truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Control Panel (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Control Tabs */}
          <div className="flex border-b border-gray-100 overflow-x-auto">
            {[
              { id: 'content', label: '1. เนื้อหา' },
              { id: 'colors', label: '2. สี' },
              { id: 'logo', label: '3. โลโก้' },
              { id: 'design', label: '4. ดีไซน์' },
              { id: 'frame', label: '5. กรอบ & ข้อความ' }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3.5 px-3 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/70'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-5 min-h-[410px]">
            {/* Tab 1: Content */}
            {activeTab === 'content' && (
              <div className="space-y-5 animate-fade-in">
                {/* Content Type Selector */}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {contentTypes.map((ct) => (
                    <button
                      key={ct.id}
                      type="button"
                      onClick={() => setContentType(ct.id)}
                      className={`flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border text-xs font-medium transition-all ${
                        contentType === ct.id
                          ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <ct.icon size={17} />
                      <span>{ct.label}</span>
                    </button>
                  ))}
                </div>

                {/* Form: URL */}
                {contentType === 'url' && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">ลิงก์เว็บไซต์ (URL)</label>
                    <div className="relative">
                      <input
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://www.example.com"
                        className="w-full pl-4 pr-10 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all text-sm"
                      />
                      <div className="absolute right-3 top-3 text-gray-400"><Link size={18} /></div>
                    </div>
                    <p className="text-xs text-gray-500">วางลิงก์เว็บ, Google Form, Google Drive หรือลิงก์ LINE OA ได้ทันที</p>
                  </div>
                )}

                {/* Form: Text */}
                {contentType === 'text' && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">ข้อความทั่วไป (รองรับภาษาไทย)</label>
                    <textarea
                      rows={5}
                      value={plainText}
                      onChange={(e) => setPlainText(e.target.value)}
                      placeholder="พิมพ์ข้อความที่ต้องการแสดงเมื่อสแกน QR Code..."
                      className="w-full p-3.5 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-sm resize-y"
                    />
                  </div>
                )}

                {/* Form: Wi-Fi */}
                {contentType === 'wifi' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">ชื่อ Wi-Fi (SSID)</label>
                      <input
                        type="text"
                        value={wifiSsid}
                        onChange={(e) => setWifiSsid(e.target.value)}
                        placeholder="เช่น Office_WiFi_5G"
                        className="w-full p-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">ความปลอดภัย</label>
                        <select
                          value={wifiEncryption}
                          onChange={(e) => setWifiEncryption(e.target.value)}
                          className="w-full p-3 rounded-xl border border-gray-200 bg-white outline-none text-sm"
                        >
                          <option value="WPA">WPA / WPA2 / WPA3 (ทั่วไป)</option>
                          <option value="WEP">WEP</option>
                          <option value="nopass">ไม่มีรหัสผ่าน (Open)</option>
                        </select>
                      </div>
                      {wifiEncryption !== 'nopass' && (
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">รหัสผ่าน Wi-Fi</label>
                          <div className="relative">
                            <input
                              type={showWifiPass ? 'text' : 'password'}
                              value={wifiPassword}
                              onChange={(e) => setWifiPassword(e.target.value)}
                              placeholder="รหัสผ่าน"
                              className="w-full pl-3 pr-10 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => setShowWifiPass(!showWifiPass)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                            >
                              {showWifiPass ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wifiHidden}
                        onChange={(e) => setWifiHidden(e.target.checked)}
                        className="rounded accent-indigo-600"
                      />
                      <span>เครือข่ายแบบซ่อนชื่อ (Hidden SSID)</span>
                    </label>
                  </div>
                )}

                {/* Form: vCard */}
                {contentType === 'vcard' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">ชื่อ - นามสกุล</label>
                      <input
                        type="text"
                        value={vcardName}
                        onChange={(e) => setVcardName(e.target.value)}
                        placeholder="เช่น สมชาย ใจดี"
                        className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">หน่วยงาน / บริษัท</label>
                        <input
                          type="text"
                          value={vcardOrg}
                          onChange={(e) => setVcardOrg(e.target.value)}
                          placeholder="ชื่อหน่วยงาน"
                          className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">ตำแหน่ง</label>
                        <input
                          type="text"
                          value={vcardTitle}
                          onChange={(e) => setVcardTitle(e.target.value)}
                          placeholder="เช่น นักวิชาการ"
                          className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">เบอร์โทรศัพท์</label>
                        <input
                          type="tel"
                          value={vcardPhone}
                          onChange={(e) => setVcardPhone(e.target.value)}
                          placeholder="081-234-5678"
                          className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">อีเมล</label>
                        <input
                          type="email"
                          value={vcardEmail}
                          onChange={(e) => setVcardEmail(e.target.value)}
                          placeholder="name@example.com"
                          className="w-full p-2.5 rounded-xl border border-gray-200 outline-none text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Form: Phone / Email */}
                {contentType === 'contact' && (
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setContactMode('tel')}
                        className={`flex-1 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 ${
                          contactMode === 'tel' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        <Phone size={15} /> โทรออกทันที (Phone)
                      </button>
                      <button
                        type="button"
                        onClick={() => setContactMode('email')}
                        className={`flex-1 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 ${
                          contactMode === 'email' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        <Mail size={15} /> ส่งอีเมล (Email)
                      </button>
                    </div>
                    {contactMode === 'tel' ? (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">หมายเลขโทรศัพท์</label>
                        <input
                          type="tel"
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          placeholder="0812345678"
                          className="w-full p-3 rounded-xl border border-gray-200 outline-none text-sm"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">อีเมลปลายทาง</label>
                          <input
                            type="email"
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            placeholder="contact@example.com"
                            className="w-full p-3 rounded-xl border border-gray-200 outline-none text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">หัวข้ออีเมล (ไม่บังคับ)</label>
                          <input
                            type="text"
                            value={contactSubject}
                            onChange={(e) => setContactSubject(e.target.value)}
                            placeholder="ติดต่อสอบถามเรื่อง..."
                            className="w-full p-3 rounded-xl border border-gray-200 outline-none text-sm"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Colors */}
            {activeTab === 'colors' && (
              <div className="space-y-5 animate-fade-in">
                {/* Background */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">สีพื้นหลัง (Background)</label>
                    <label className="flex items-center gap-2 text-xs text-indigo-600 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={transparentBg}
                        onChange={(e) => setTransparentBg(e.target.checked)}
                        className="rounded accent-indigo-600"
                      />
                      <span>พื้นหลังโปร่งใส (PNG)</span>
                    </label>
                  </div>
                  {!transparentBg && (
                    <div className="flex items-center gap-3">
                      <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-10 w-14 p-1 rounded-lg border cursor-pointer" />
                      <input
                        type="text"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        className="flex-1 p-2.5 rounded-xl border border-gray-200 outline-none uppercase font-mono text-sm"
                      />
                    </div>
                  )}
                </div>

                <hr className="border-gray-100" />

                {/* Foreground */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700">สีของตัว QR Code</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="radio" name="fgType" checked={fgType === 'single'} onChange={() => setFgType('single')} className="accent-indigo-600" />
                      <span>สีเดียว</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="radio" name="fgType" checked={fgType === 'gradient'} onChange={() => setFgType('gradient')} className="accent-indigo-600" />
                      <span>ไล่สี (Gradient)</span>
                    </label>
                  </div>

                  {fgType === 'single' ? (
                    <div className="flex items-center gap-3">
                      <input type="color" value={fgColor} onChange={(e) => setFgColor(e.target.value)} className="h-10 w-14 p-1 rounded-lg border cursor-pointer" />
                      <input
                        type="text"
                        value={fgColor}
                        onChange={(e) => setFgColor(e.target.value)}
                        className="flex-1 p-2.5 rounded-xl border border-gray-200 outline-none uppercase font-mono text-sm"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-xs text-gray-500 block mb-1">สีเริ่ม</span>
                          <div className="flex items-center gap-2">
                            <input type="color" value={gradientColor1} onChange={(e) => setGradientColor1(e.target.value)} className="h-9 w-11 p-1 rounded-lg border cursor-pointer" />
                            <input type="text" value={gradientColor1} onChange={(e) => setGradientColor1(e.target.value)} className="w-full p-2 rounded-lg border border-gray-200 outline-none uppercase font-mono text-xs" />
                          </div>
                        </div>
                        <div>
                          <span className="text-xs text-gray-500 block mb-1">สีจบ</span>
                          <div className="flex items-center gap-2">
                            <input type="color" value={gradientColor2} onChange={(e) => setGradientColor2(e.target.value)} className="h-9 w-11 p-1 rounded-lg border cursor-pointer" />
                            <input type="text" value={gradientColor2} onChange={(e) => setGradientColor2(e.target.value)} className="w-full p-2 rounded-lg border border-gray-200 outline-none uppercase font-mono text-xs" />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <select value={gradientType} onChange={(e) => setGradientType(e.target.value)} className="border rounded-lg px-3 py-2 text-xs">
                          <option value="linear">Linear (เส้นตรง)</option>
                          <option value="radial">Radial (วงกลม)</option>
                        </select>
                        <div className="flex items-center gap-2 flex-1">
                          <span className="text-xs text-gray-500 whitespace-nowrap">มุม: {rotation}°</span>
                          <input type="range" min="0" max="360" value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="w-full accent-indigo-600" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <hr className="border-gray-100" />

                {/* Custom Eye Colors */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customEyeColor}
                      onChange={(e) => setCustomEyeColor(e.target.checked)}
                      className="rounded accent-indigo-600"
                    />
                    <span>แยกสีกรอบตา / ลูกตา (Custom Eye Color)</span>
                  </label>
                  {customEyeColor && (
                    <div className="grid grid-cols-2 gap-3 animate-fade-in">
                      <div>
                        <span className="text-xs text-gray-500 block mb-1">สีกรอบตา</span>
                        <div className="flex items-center gap-2">
                          <input type="color" value={eyeFrameColor} onChange={(e) => setEyeFrameColor(e.target.value)} className="h-9 w-11 p-1 rounded-lg border cursor-pointer" />
                          <input type="text" value={eyeFrameColor} onChange={(e) => setEyeFrameColor(e.target.value)} className="w-full p-2 rounded-lg border border-gray-200 outline-none uppercase font-mono text-xs" />
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 block mb-1">สีลูกตา</span>
                        <div className="flex items-center gap-2">
                          <input type="color" value={eyeBallColor} onChange={(e) => setEyeBallColor(e.target.value)} className="h-9 w-11 p-1 rounded-lg border cursor-pointer" />
                          <input type="text" value={eyeBallColor} onChange={(e) => setEyeBallColor(e.target.value)} className="w-full p-2 rounded-lg border border-gray-200 outline-none uppercase font-mono text-xs" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 3: Logo */}
            {activeTab === 'logo' && (
              <div className="space-y-5 animate-fade-in">
                <div className="space-y-2.5">
                  <label className="text-sm font-medium text-gray-700 block">เลือกโลโก้มาตรฐาน</label>
                  <div className="flex gap-3">
                    {['./default-logo-1.png', './default-logo-2.png'].map((l, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSelectDefaultLogo(l, i)}
                        className={`w-16 h-16 border-2 rounded-xl p-2 transition-all bg-white ${
                          selectedDefaultLogoIdx === i && logo
                            ? 'border-indigo-600 ring-2 ring-indigo-100'
                            : 'border-gray-200 hover:border-indigo-400'
                        }`}
                      >
                        <img src={l} className="w-full h-full object-contain" alt={`Default Logo ${i + 1}`} />
                      </button>
                    ))}
                    {logo && (
                      <button
                        type="button"
                        onClick={() => { setLogo(null); setSelectedDefaultLogoIdx(null); }}
                        className="px-3 h-16 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 text-xs font-medium flex flex-col items-center justify-center gap-1"
                      >
                        <Trash2 size={16} />
                        <span>เอาโลโก้ออก</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">หรือ อัปโหลดโลโก้ของคุณเอง</label>
                  <div className="relative overflow-hidden bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl w-full p-5 text-center hover:bg-gray-100 transition-all cursor-pointer">
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <Upload size={26} className="text-gray-400" />
                      <span className="text-xs font-medium text-gray-600">
                        {logo ? 'คลิกเพื่อเปลี่ยนรูปโลโก้ใหม่' : 'คลิกหรือลากไฟล์รูปภาพโลโก้ (PNG, JPG, WEBP)'}
                      </span>
                    </div>
                  </div>
                </div>

                {logo && (
                  <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
                    <div className="flex items-center gap-3">
                      <img src={logo} alt="Selected Logo" className="w-12 h-12 object-contain bg-white rounded-lg p-1 border border-gray-200" />
                      <div className="flex-1 text-xs">
                        <div className="font-semibold text-gray-700">ปรับแต่งโลโก้ตรงกลาง</div>
                        <div className="text-gray-500">ปรับระดับ Error Correction เป็น H ให้อัตโนมัติเพื่อสแกนติดง่าย</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-gray-700 block mb-1">ขนาดโลโก้: {Math.round(logoSize * 100)}%</label>
                        <input type="range" min="0.15" max="0.55" step="0.02" value={logoSize} onChange={(e) => setLogoSize(Number(e.target.value))} className="w-full accent-indigo-600" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-700 block mb-1">ระยะห่างรอบโลโก้: {logoMargin}px</label>
                        <input type="range" min="0" max="24" step="1" value={logoMargin} onChange={(e) => setLogoMargin(Number(e.target.value))} className="w-full accent-indigo-600" />
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hideBgDots}
                        onChange={(e) => setHideBgDots(e.target.checked)}
                        className="rounded accent-indigo-600"
                      />
                      <span>ซ่อนจุด QR ด้านหลังโลโก้ (ช่วยให้โลโก้เด่นและสแกนง่ายขึ้น)</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: Design */}
            {activeTab === 'design' && (
              <div className="space-y-5 animate-fade-in">
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-2">รูปทรงโดยรวม (Shape)</label>
                  <div className="grid grid-cols-2 gap-3">
                    {['square', 'circle'].map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setShape(type)}
                        className={`py-2.5 px-4 rounded-xl border-2 flex items-center justify-center gap-2 text-xs font-medium transition-all ${
                          shape === type ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <div className={`w-4 h-4 bg-current ${type === 'circle' ? 'rounded-full' : 'rounded-sm'}`} />
                        <span>{type === 'square' ? 'สี่เหลี่ยม (Square)' : 'วงกลม (Circle)'}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-2">รูปทรงจุด (Body Pattern)</label>
                  <div className="grid grid-cols-6 gap-2">
                    {['square', 'dots', 'rounded', 'extra-rounded', 'classy', 'classy-rounded'].map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setDotType(type)}
                        className={`aspect-square rounded-xl border-2 p-2 flex items-center justify-center hover:bg-gray-50 transition-all ${
                          dotType === type ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200'
                        }`}
                        title={type}
                      >
                        {renderShapePreview(type, false)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-2">กรอบตา (Eye Frame)</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['square', 'dot', 'extra-rounded'].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setCornerSquareType(type)}
                          className={`aspect-square rounded-xl border-2 p-1 flex items-center justify-center hover:bg-gray-50 transition-all ${
                            cornerSquareType === type ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200'
                          }`}
                          title={type}
                        >
                          {renderShapePreview(type, true)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-2">ลูกตา (Eye Ball)</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['square', 'dot', 'rounded'].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setCornerDotType(type)}
                          className={`aspect-square rounded-xl border-2 p-1 flex items-center justify-center hover:bg-gray-50 transition-all ${
                            cornerDotType === type ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200'
                          }`}
                          title={type}
                        >
                          {renderShapePreview(type, false)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <hr className="border-gray-100" />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">
                      ขอบขาวรอบ QR (Quiet Zone): {qrMargin}px
                    </label>
                    <input type="range" min="0" max="36" value={qrMargin} onChange={(e) => setQrMargin(Number(e.target.value))} className="w-full accent-indigo-600" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">
                      ความทนทานการสแกน (Error Correction)
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { id: 'L', desc: '7%' },
                        { id: 'M', desc: '15%' },
                        { id: 'Q', desc: '25%' },
                        { id: 'H', desc: '30%' }
                      ].map((lvl) => (
                        <button
                          key={lvl.id}
                          type="button"
                          onClick={() => setErrorLevel(lvl.id)}
                          className={`py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                            errorLevel === lvl.id
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {lvl.id} <span className="text-[10px] opacity-75">({lvl.desc})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 5: Frame & Caption */}
            {activeTab === 'frame' && (
              <div className="space-y-5 animate-fade-in">
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-2.5">รูปแบบกรอบและข้อความกำกับ</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                      { id: 'none', label: 'ไม่มีกรอบ' },
                      { id: 'card', label: 'กรอบการ์ด' },
                      { id: 'banner', label: 'แถบสีด้านล่าง' },
                      { id: 'top_banner', label: 'แถบสีด้านบน' }
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFrameStyle(f.id)}
                        className={`py-3 px-2 rounded-xl border-2 text-xs font-semibold transition-all ${
                          frameStyle === f.id
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {frameStyle !== 'none' && (
                  <div className="space-y-4 animate-fade-in">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">ข้อความกำกับบนกรอบ</label>
                      <input
                        type="text"
                        value={frameText}
                        onChange={(e) => setFrameText(e.target.value)}
                        placeholder="เช่น สแกนที่นี่, แบบประเมินความพึงพอใจ, Wi-Fi สำนักงาน"
                        className="w-full p-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-xs text-gray-500 block mb-1">สีกรอบ / แถบสี</span>
                        <div className="flex items-center gap-2">
                          <input type="color" value={frameColor} onChange={(e) => setFrameColor(e.target.value)} className="h-9 w-11 p-1 rounded-lg border cursor-pointer" />
                          <input type="text" value={frameColor} onChange={(e) => setFrameColor(e.target.value)} className="w-full p-2 rounded-lg border border-gray-200 outline-none uppercase font-mono text-xs" />
                        </div>
                      </div>
                      {frameStyle !== 'card' && (
                        <div>
                          <span className="text-xs text-gray-500 block mb-1">สีตัวอักษร</span>
                          <div className="flex items-center gap-2">
                            <input type="color" value={frameTextColor} onChange={(e) => setFrameTextColor(e.target.value)} className="h-9 w-11 p-1 rounded-lg border cursor-pointer" />
                            <input type="text" value={frameTextColor} onChange={(e) => setFrameTextColor(e.target.value)} className="w-full p-2 rounded-lg border border-gray-200 outline-none uppercase font-mono text-xs" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Live Preview & Export Panel (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 sticky top-6 space-y-5">
            {/* Live Preview Box (Matches exported frame & caption) */}
            <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-gray-50 border border-gray-100">
              <div
                className="overflow-hidden transition-all"
                style={{
                  borderRadius: frameStyle !== 'none' ? '16px' : '12px',
                  border: frameStyle !== 'none' ? `4px solid ${frameColor}` : '1px solid #e5e7eb',
                  backgroundColor: transparentBg && frameStyle === 'none'
                    ? 'transparent'
                    : (transparentBg ? '#ffffff' : bgColor),
                  backgroundImage: transparentBg && frameStyle === 'none'
                    ? 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%)'
                    : 'none',
                  backgroundSize: '16px 16px'
                }}
              >
                {frameStyle === 'top_banner' && (
                  <div
                    className="py-2.5 px-4 text-center font-bold text-sm tracking-wide"
                    style={{ backgroundColor: frameColor, color: frameTextColor }}
                  >
                    {frameText || 'สแกนที่นี่'}
                  </div>
                )}

                <div className={frameStyle !== 'none' ? 'p-3' : 'p-2'}>
                  <div ref={ref} className="flex items-center justify-center" />
                </div>

                {frameStyle === 'card' && (
                  <div
                    className="pb-3 px-4 text-center font-bold text-sm"
                    style={{ color: frameColor }}
                  >
                    {frameText || 'สแกนที่นี่'}
                  </div>
                )}

                {frameStyle === 'banner' && (
                  <div
                    className="py-2.5 px-4 text-center font-bold text-sm tracking-wide"
                    style={{ backgroundColor: frameColor, color: frameTextColor }}
                  >
                    {frameText || 'สแกนที่นี่'}
                  </div>
                )}
              </div>
            </div>

            {/* Resolution Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium text-gray-700">
                <span>ความละเอียดภาพ (Resolution)</span>
                <span className="font-mono text-indigo-600">{size} × {size} px</span>
              </div>
              <input
                type="range"
                min="300"
                max="2000"
                step="100"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>

            {/* File Format Selector */}
            <div className="flex gap-2">
              {['png', 'jpeg', 'svg'].map((ext) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => setFileExt(ext)}
                  className={`flex-1 py-2 text-xs font-semibold uppercase rounded-xl border transition-all ${
                    fileExt === ext
                      ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {ext}
                </button>
              ))}
            </div>

            {fileExt === 'svg' && frameStyle !== 'none' && (
              <p className="text-[11px] text-amber-600 text-center">
                * ไฟล์ SVG จะส่งออกเฉพาะตัว QR (หากต้องการให้ติดกรอบและข้อความด้วย แนะนำเลือก PNG หรือ JPEG)
              </p>
            )}

            {copyErr && (
              <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs text-center">
                {copyErr}
              </div>
            )}

            {/* Action Buttons: Copy Image + Download */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onCopyImageClick}
                disabled={isExporting}
                className="py-3 px-4 rounded-xl border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {copiedImg ? <Check size={18} className="text-emerald-600" /> : <Copy size={18} />}
                <span>{copiedImg ? 'คัดลอกรูปแล้ว!' : 'คัดลอกรูป QR'}</span>
              </button>

              <button
                type="button"
                onClick={onDownloadClick}
                disabled={isExporting}
                className="py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Download size={18} />
                <span>{isExporting ? 'กำลังสร้าง...' : `ดาวน์โหลด ${fileExt.toUpperCase()}`}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 5. Gemini OCR (Screen Capture + Electron Snipping Tool + Interactive Crop + Real API + PDF Support)
const GeminiOCR = ({ pendingSnip, onClearPendingSnip }) => {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

  const [apiKey, setApiKey] = useState(() => {
    let key = localStorage.getItem('gemini_api_key');
    if (key === 'AIzaSyCtlgXxgZtDw3nC8j5k61ym2xknOg8Veyk') {
      localStorage.removeItem('gemini_api_key');
      key = null;
    }
    return key || import.meta.env.VITE_GEMINI_API_KEY || '';
  });
  const [showKeyInput, setShowKeyInput] = useState(() => !apiKey);
  const [showKeyText, setShowKeyText] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  // Desktop App Global Hotkey state
  const [hotkey, setHotkey] = useState(() => localStorage.getItem('ocr_global_hotkey') || 'CommandOrControl+Shift+X');
  const [hotkeyStatus, setHotkeyStatus] = useState('');

  // Source image / PDF state
  const [image, setImage] = useState(null); // Full image DataURL
  const [sourceLabel, setSourceLabel] = useState('');
  const [pdfPages, setPdfPages] = useState([]); // Array of rendered page DataURLs if PDF
  const [currentPdfPage, setCurrentPdfPage] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Interactive crop state (normalized 0..1 relative to image element)
  const [cropRect, setCropRect] = useState(null); // { x, y, w, h }
  const [isSelecting, setIsSelecting] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [croppedPreview, setCroppedPreview] = useState(null); // DataURL of cropped region
  const [croppedPixelSize, setCroppedPixelSize] = useState(null); // { w, h }

  // OCR Options & Output state
  const [ocrMode, setOcrMode] = useState('standard'); // standard, table, summary, translate_th
  const [appendMode, setAppendMode] = useState(false);
  const [autoOcrOnCrop, setAutoOcrOnCrop] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [autoCopiedNotice, setAutoCopiedNotice] = useState(false);
  const [history, setHistory] = useState([]); // [{ id, preview, text, time }]

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);

  const ocrPrompts = {
    standard: 'Extract all text from this image accurately. Preserve the original language (Thai/English), line breaks, and formatting. Output ONLY the extracted text without markdown code fences or extra commentary.',
    table: 'Extract all text and tabular data from this image. Format tables clearly using Markdown table syntax or structured columns, preserving Thai/English text accurately.',
    summary: 'Extract the text from this image and provide: 1) The exact extracted text, and 2) A concise bullet-point summary in Thai.',
    translate_th: 'Extract all text from this image and translate it naturally into Thai. Show both the original text and the Thai translation.'
  };

  // Sync saved hotkey with Electron main process on mount
  useEffect(() => {
    if (!isElectron) return;
    const saved = localStorage.getItem('ocr_global_hotkey');
    if (saved) {
      window.electronAPI.setHotkey(saved).then((res) => {
        if (res?.success) setHotkey(res.hotkey);
      });
    } else {
      window.electronAPI.getHotkey().then((hk) => {
        if (hk) setHotkey(hk);
      });
    }
  }, [isElectron]);

  const handleChangeHotkey = async (newHk) => {
    setHotkey(newHk);
    localStorage.setItem('ocr_global_hotkey', newHk);
    if (isElectron) {
      const res = await window.electronAPI.setHotkey(newHk);
      if (res?.success) {
        setHotkeyStatus('บันทึกคีย์ลัดแล้ว');
        setTimeout(() => setHotkeyStatus(''), 2000);
      } else if (res?.error) {
        setError(res.error);
      }
    }
  };

  const formatHotkeyLabel = (hk) =>
    hk.replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ');

  const handleSaveApiKey = (newKey) => {
    const trimmed = newKey.trim();
    setApiKey(trimmed);
    if (trimmed) {
      localStorage.setItem('gemini_api_key', trimmed);
    } else {
      localStorage.removeItem('gemini_api_key');
    }
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  // Load a DataURL image into the workspace
  const loadWorkspaceImage = (dataUrl, label = 'รูปภาพ') => {
    setImage(dataUrl);
    setSourceLabel(label);
    setCropRect(null);
    setCroppedPreview(null);
    setCroppedPixelSize(null);
    setError('');
  };

  // Handle incoming snip from Electron fullscreen Snipping Overlay (Global Hotkey or button)
  useEffect(() => {
    if (!pendingSnip) return;
    const { croppedDataUrl, fullDataUrl, pixelSize, normalizedRect } = pendingSnip;
    setPdfPages([]);
    setImage(fullDataUrl || croppedDataUrl);
    setSourceLabel('แคปหน้าือด่วน (Snipping Tool)');
    if (normalizedRect) setCropRect(normalizedRect);
    if (pixelSize) setCroppedPixelSize(pixelSize);
    setCroppedPreview(croppedDataUrl);
    onClearPendingSnip?.();

    if (croppedDataUrl) {
      handleExtractText(croppedDataUrl, true);
    }
  }, [pendingSnip]);

  // Load File (Image or PDF)
  const processFile = async (file, labelPrefix = 'อัปโหลด') => {
    if (!file) return;
    setError('');

    if (file.type === 'application/pdf') {
      setPdfLoading(true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const renderedPages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
          renderedPages.push(canvas.toDataURL('image/jpeg', 0.92));
        }
        setPdfPages(renderedPages);
        setCurrentPdfPage(0);
        if (renderedPages.length > 0) {
          loadWorkspaceImage(renderedPages[0], `${file.name} (หน้า 1/${renderedPages.length})`);
        }
      } catch (err) {
        setError('ไม่สามารถอ่านไฟล์ PDF ได้: ' + err.message);
      } finally {
        setPdfLoading(false);
      }
      return;
    }

    if (file.type.startsWith('image/')) {
      setPdfPages([]);
      const reader = new FileReader();
      reader.onloadend = () => {
        loadWorkspaceImage(reader.result, `${labelPrefix}: ${file.name || 'ภาพถ่าย'}`);
      };
      reader.readAsDataURL(file);
    } else {
      setError('รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, WEBP) หรือ PDF เท่านั้น');
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file, 'ไฟล์');
    e.target.value = '';
  };

  // 1. Desktop Screen Capture (Native Electron Snipping Tool OR Browser getDisplayMedia)
  const handleScreenCapture = async () => {
    setError('');
    if (isElectron) {
      await window.electronAPI.startSnip();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setError('เบราว์เซอร์บนอุปกรณ์นี้ไม่รองรับการแคปหน้าจอโดยตรง (บนมือถือแนะนำให้แคปหน้าจอแล้วกดปุ่ม "วางรูป" หรือ "เลือกรูป/ถ่ายภาพ")');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'never' },
        audio: false
      });

      const track = stream.getVideoTracks()[0];
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      await new Promise((resolve) => setTimeout(resolve, 150));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      track.stop();
      stream.getTracks().forEach((t) => t.stop());

      const dataUrl = canvas.toDataURL('image/png');
      setPdfPages([]);
      loadWorkspaceImage(dataUrl, 'แคปหน้าจอ (ลากคลุมส่วนที่ต้องการดึงข้อความ)');
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        setError('ไม่สามารถแคปหน้าจอได้: ' + err.message);
      }
    }
  };

  // 2. Paste from Clipboard button (Mobile & Desktop)
  const handleClipboardButton = async () => {
    setError('');
    if (!navigator.clipboard || !navigator.clipboard.read) {
      setError('กรุณากด Ctrl+V (หรือแตะค้างแล้ววาง) เพื่อวางรูปจากคลิปบอร์ด');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], 'clipboard-image.png', { type: imageType });
          processFile(file, 'วางจากคลิปบอร์ด');
          return;
        }
      }
      setError('ไม่พบรูปภาพในคลิปบอร์ด (ลองแคปหน้าจอหรือคัดลอกรูปภาพก่อน)');
    } catch {
      setError('เบราว์เซอร์ไม่อนุญาตให้อ่านคลิปบอร์ดอัตโนมัติ กรุณากด Ctrl+V (หรือ Cmd+V) บนหน้าจอนี้ได้เลย');
    }
  };

  // Global Paste Event Listener (Ctrl+V / Cmd+V anywhere)
  useEffect(() => {
    const handleGlobalPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file, 'วางจากคลิปบอร์ด (Ctrl+V)');
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, []);

  // Switch PDF page
  const changePdfPage = (newIndex) => {
    if (newIndex < 0 || newIndex >= pdfPages.length) return;
    setCurrentPdfPage(newIndex);
    loadWorkspaceImage(pdfPages[newIndex], `PDF (หน้า ${newIndex + 1}/${pdfPages.length})`);
  };

  // Compute cropped DataURL from normalized rect { x, y, w, h }
  const generateCroppedImage = (rect) => {
    const imgEl = imgRef.current;
    if (!imgEl || !rect || rect.w < 0.01 || rect.h < 0.01) {
      setCroppedPreview(null);
      setCroppedPixelSize(null);
      return null;
    }
    const natW = imgEl.naturalWidth;
    const natH = imgEl.naturalHeight;
    const sx = Math.max(0, Math.round(rect.x * natW));
    const sy = Math.max(0, Math.round(rect.y * natH));
    const sw = Math.min(natW - sx, Math.max(1, Math.round(rect.w * natW)));
    const sh = Math.min(natH - sy, Math.max(1, Math.round(rect.h * natH)));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, sw, sh);
    const croppedUrl = canvas.toDataURL('image/png');
    setCroppedPreview(croppedUrl);
    setCroppedPixelSize({ w: sw, h: sh });
    return croppedUrl;
  };

  // Pointer coordinates normalized (0..1) relative to rendered image
  const getNormalizedCoords = (e) => {
    const imgEl = imgRef.current;
    if (!imgEl) return { x: 0, y: 0 };
    const bounds = imgEl.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (e.clientY - bounds.top) / bounds.height));
    return { x, y };
  };

  const handlePointerDown = (e) => {
    if (!image || loading) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const coords = getNormalizedCoords(e);
    setIsSelecting(true);
    setDragStart(coords);
    setCropRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e) => {
    if (!isSelecting || !dragStart) return;
    e.preventDefault();
    const coords = getNormalizedCoords(e);
    const x = Math.min(dragStart.x, coords.x);
    const y = Math.min(dragStart.y, coords.y);
    const w = Math.abs(coords.x - dragStart.x);
    const h = Math.abs(coords.y - dragStart.y);
    setCropRect({ x, y, w, h });
  };

  const handlePointerUp = (e) => {
    if (!isSelecting) return;
    setIsSelecting(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if not captured
    }
    if (!cropRect || cropRect.w < 0.015 || cropRect.h < 0.015) {
      setCropRect(null);
      setCroppedPreview(null);
      setCroppedPixelSize(null);
      return;
    }
    const croppedUrl = generateCroppedImage(cropRect);
    if (autoOcrOnCrop && croppedUrl) {
      handleExtractText(croppedUrl, true);
    }
  };

  const clearSelection = () => {
    setCropRect(null);
    setCroppedPreview(null);
    setCroppedPixelSize(null);
  };

  const copyStringToSystemClipboard = (str) => {
    if (!str) return;
    if (isElectron && window.electronAPI?.copyToClipboard) {
      window.electronAPI.copyToClipboard(str);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(str).catch(() => {});
    }
  };

  // Run Gemini OCR on either cropped region or full image
  const handleExtractText = async (overrideDataUrl = null, autoCopyResult = false) => {
    if (!apiKey) {
      setShowKeyInput(true);
      setError('กรุณาใส่ Gemini API Key ด้านบนก่อนเริ่มดึงข้อความ');
      return;
    }
    const targetDataUrl = overrideDataUrl || croppedPreview || image;
    if (!targetDataUrl) return;

    setLoading(true);
    setError('');
    setAutoCopiedNotice(false);
    if (!appendMode) setText('');

    try {
      const base64Data = targetDataUrl.replace(/^data:.+;base64,/, '');
      const detectedMime = targetDataUrl.match(/^data:([^;]+);/)?.[1] || 'image/png';

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: ocrPrompts[ocrMode] || ocrPrompts.standard },
                  { inline_data: { mime_type: detectedMime, data: base64Data } }
                ]
              }
            ]
          })
        }
      );

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      const extracted = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      if (!extracted) {
        throw new Error('ไม่พบข้อความในบริเวณที่เลือก ลองลากคลุมพื้นที่ให้กว้างขึ้น');
      }

      const finalOutput = appendMode && text ? `${text}\n\n---\n${extracted}` : extracted;
      setText(finalOutput);

      if (autoCopyResult || isElectron) {
        copyStringToSystemClipboard(finalOutput);
        setAutoCopiedNotice(true);
        setTimeout(() => setAutoCopiedNotice(false), 4000);
      }

      // Save to session history
      setHistory((prev) => [
        {
          id: Date.now(),
          preview: targetDataUrl,
          text: extracted,
          isCropped: Boolean(overrideDataUrl || croppedPreview),
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        },
        ...prev.slice(0, 9)
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyText = () => {
    if (!text) return;
    copyStringToSystemClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareText = async () => {
    if (!text) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'ข้อความจาก OCR', text });
      } catch {
        // user cancelled share
      }
    } else {
      handleCopyText();
    }
  };

  const handleDownloadTxt = () => {
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `ocr-text-${new Date().toISOString().slice(0, 10)}.txt`);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header, Hotkey Setting & API Key Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <Crop size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 flex-wrap">
                <span>ดึงข้อความ OCR</span>
                <span className="text-xs bg-indigo-50 text-indigo-600 px-2.5 py-0.5 rounded-full font-medium">
                  {isElectron ? 'Windows Desktop App' : 'PC & มือถือ'}
                </span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {isElectron
                  ? `กดคีย์ลัด ${formatHotkeyLabel(hotkey)} จากหน้าจอไหนก็ได้เพื่อลากคลุมดึงข้อความเหมือน Snipping Tool`
                  : 'แคปหน้าจอ วางรูป (Ctrl+V) หรือถ่ายภาพ แล้วลากคลุมเฉพาะกรอบข้อความที่ต้องการนำออกไปใช้'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* Global Hotkey Selector (Active in Windows Electron App & previewable on Web) */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
            <span className="text-slate-500 font-medium">คีย์ลัดแคปจอ:</span>
            <select
              value={hotkey}
              onChange={(e) => handleChangeHotkey(e.target.value)}
              className="bg-transparent font-semibold text-indigo-700 outline-none cursor-pointer"
            >
              <option value="CommandOrControl+Shift+X">Ctrl + Shift + X</option>
              <option value="Alt+Shift+S">Alt + Shift + S</option>
              <option value="CommandOrControl+Shift+A">Ctrl + Shift + A</option>
              <option value="F8">ปุ่ม F8</option>
              <option value="F9">ปุ่ม F9</option>
            </select>
            {hotkeyStatus && <span className="text-emerald-600 text-[11px] font-medium">✓</span>}
          </div>

          <button
            onClick={() => setShowKeyInput(!showKeyInput)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition-all ${
              apiKey
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
            }`}
          >
            <Key size={15} />
            <span>{apiKey ? 'ตั้งค่า API Key แล้ว' : 'ใส่ Gemini API Key'}</span>
          </button>
        </div>
      </div>

      {/* Collapsible API Key Bar */}
      {showKeyInput && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-indigo-100 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <Key size={14} className="text-indigo-600" />
              Gemini API Key (บันทึกไว้ในเครื่องของคุณอัตโนมัติ)
            </label>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
            >
              <span>ขอรับฟรีที่ Google AI Studio</span>
              <ExternalLink size={12} />
            </a>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKeyText ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => handleSaveApiKey(e.target.value)}
                placeholder="วาง Gemini API Key ของคุณที่นี่ (AIzaSy...)"
                className="w-full pl-3.5 pr-10 py-2.5 text-sm rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKeyText(!showKeyText)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showKeyText ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowKeyInput(false)}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-xl transition-all flex items-center gap-1.5"
            >
              {keySaved ? <Check size={15} /> : null}
              <span>พร้อมใช้งาน</span>
            </button>
          </div>
        </div>
      )}

      {/* Action Bar: 4 Capture / Input Methods */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* 1. Screen Capture / Snipping Tool (PC) */}
        <button
          type="button"
          onClick={handleScreenCapture}
          className="flex flex-col items-center justify-center gap-2 p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl shadow-sm shadow-indigo-100 transition-all group"
        >
          <Monitor size={24} className="group-hover:scale-110 transition-transform" />
          <div className="text-center">
            <div className="text-sm font-semibold">
              {isElectron ? 'ลากคลุมหน้าจอ (Snip)' : 'แคปหน้าจอทันที'}
            </div>
            <div className="text-[11px] text-indigo-100">
              {isElectron ? `หรือกด ${formatHotkeyLabel(hotkey)}` : 'เลือกหน้าต่าง/แท็บ (บนคอม)'}
            </div>
          </div>
        </button>

        {/* 2. Paste from Clipboard (PC & Mobile) */}
        <button
          type="button"
          onClick={handleClipboardButton}
          className="flex flex-col items-center justify-center gap-2 p-4 bg-white hover:bg-indigo-50/60 text-gray-800 rounded-2xl shadow-sm border border-gray-200 hover:border-indigo-300 transition-all group"
        >
          <Clipboard size={24} className="text-indigo-600 group-hover:scale-110 transition-transform" />
          <div className="text-center">
            <div className="text-sm font-semibold">วางรูปจากคลิปบอร์ด</div>
            <div className="text-[11px] text-gray-500">หรือกด Ctrl+V / วางบนมือถือ</div>
          </div>
        </button>

        {/* 3. Mobile Camera Capture */}
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-4 bg-white hover:bg-indigo-50/60 text-gray-800 rounded-2xl shadow-sm border border-gray-200 hover:border-indigo-300 transition-all group"
        >
          <Camera size={24} className="text-indigo-600 group-hover:scale-110 transition-transform" />
          <div className="text-center">
            <div className="text-sm font-semibold">ถ่ายภาพ / สแกน</div>
            <div className="text-[11px] text-gray-500">เปิดกล้องมือถือถ่ายแล้วเลือกส่วน</div>
          </div>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileUpload}
            className="hidden"
          />
        </button>

        {/* 4. Upload Image or PDF */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-4 bg-white hover:bg-indigo-50/60 text-gray-800 rounded-2xl shadow-sm border border-gray-200 hover:border-indigo-300 transition-all group"
        >
          <Upload size={24} className="text-indigo-600 group-hover:scale-110 transition-transform" />
          <div className="text-center">
            <div className="text-sm font-semibold">เลือกรูป / PDF</div>
            <div className="text-[11px] text-gray-500">คลังภาพมือถือ หรือไฟล์ในเครื่อง</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
        </button>
      </div>

      {/* Main Two-Column Workspace: Left = Interactive Crop Canvas, Right = Extracted Text */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Image / Screen Crop Workspace (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          {/* Workspace Toolbar */}
          <div className="p-3.5 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                <Crop size={15} className="text-indigo-600" />
                {image ? sourceLabel || 'ลากคลุมส่วนที่ต้องการบนภาพ' : 'พื้นที่เลือกส่วนภาพ (Region Crop)'}
              </span>
              {croppedPixelSize && (
                <span className="text-[11px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-mono">
                  {croppedPixelSize.w} × {croppedPixelSize.h} px
                </span>
              )}
            </div>

            {image && (
              <div className="flex items-center gap-2">
                {cropRect && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-xs px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center gap-1"
                  >
                    <RotateCcw size={12} />
                    <span>ใช้ทั้งภาพ</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setImage(null);
                    setCropRect(null);
                    setCroppedPreview(null);
                    setPdfPages([]);
                  }}
                  className="text-xs px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1"
                >
                  <Trash2 size={12} />
                  <span>ล้างรูป</span>
                </button>
              </div>
            )}
          </div>

          {/* PDF Page Switcher if PDF loaded */}
          {pdfPages.length > 1 && (
            <div className="px-4 py-2 bg-indigo-50/70 border-b border-indigo-100 flex items-center justify-between text-xs">
              <span className="font-medium text-indigo-800">
                เอกสาร PDF ({pdfPages.length} หน้า) — เลือกหน้าแล้วลากคลุมจุดที่ต้องการได้
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => changePdfPage(currentPdfPage - 1)}
                  disabled={currentPdfPage === 0}
                  className="p-1 rounded-lg bg-white border border-indigo-200 text-indigo-700 disabled:opacity-40"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="px-2 font-semibold text-indigo-900">
                  หน้า {currentPdfPage + 1} / {pdfPages.length}
                </span>
                <button
                  type="button"
                  onClick={() => changePdfPage(currentPdfPage + 1)}
                  disabled={currentPdfPage === pdfPages.length - 1}
                  className="p-1 rounded-lg bg-white border border-indigo-200 text-indigo-700 disabled:opacity-40"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* Interactive Canvas Container */}
          <div className="p-4 flex flex-col items-center justify-center min-h-[340px] bg-slate-900/95 relative">
            {pdfLoading ? (
              <div className="text-center text-white space-y-3 py-12">
                <div className="animate-spin rounded-full h-9 w-9 border-b-2 border-indigo-400 mx-auto"></div>
                <p className="text-sm text-slate-300">กำลังแปลงหน้า PDF เป็นภาพความละเอียดสูง...</p>
              </div>
            ) : !image ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) processFile(file, 'ลากวางไฟล์');
                }}
                className="w-full h-72 border-2 border-dashed border-slate-700 hover:border-indigo-400 rounded-xl flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-colors"
              >
                <Crop size={42} className="text-indigo-400 mb-3" />
                <p className="text-white font-medium text-sm">
                  {isElectron ? (
                    <>
                      กดคีย์ลัด <kbd className="px-2 py-0.5 bg-indigo-600 text-white rounded text-xs">{formatHotkeyLabel(hotkey)}</kbd> จากหน้าจอไหนก็ได้เพื่อลากคลุมดึงข้อความทันที
                    </>
                  ) : (
                    <>
                      กดปุ่ม &ldquo;แคปหน้าจอทันที&rdquo; ด้านบน หรือกด <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 rounded text-xs">Ctrl+V</kbd> เพื่อวางภาพ
                    </>
                  )}
                </p>
                <p className="text-slate-400 text-xs mt-1.5 max-w-md">
                  หรือลากไฟล์รูปภาพ / PDF มาวางในกรอบนี้ แล้วใช้เมาส์หรือนิ้วลากคลุมเฉพาะข้อความที่ต้องการ
                </p>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center space-y-3">
                {/* Instruction banner above image */}
                <div className="w-full flex items-center justify-between text-xs text-slate-300 bg-slate-800/90 px-3 py-1.5 rounded-lg">
                  <span>💡 ใช้เมาส์หรือนิ้วลากคลุมกรอบข้อความใหม่บนภาพได้ตลอดเวลา</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none text-indigo-300 font-medium">
                    <input
                      type="checkbox"
                      checked={autoOcrOnCrop}
                      onChange={(e) => setAutoOcrOnCrop(e.target.checked)}
                      className="rounded accent-indigo-500"
                    />
                    <span>ลากปุ๊บอ่านปั๊บ (Auto)</span>
                  </label>
                </div>

                {/* Touch & Mouse Interactive Wrapper */}
                <div
                  ref={containerRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="relative inline-block max-w-full overflow-hidden rounded-lg select-none touch-none cursor-crosshair border border-slate-700"
                >
                  <img
                    ref={imgRef}
                    src={image}
                    alt="OCR Workspace"
                    draggable={false}
                    className="block max-h-[480px] w-auto max-w-full object-contain pointer-events-none select-none"
                  />

                  {/* Selection Box Overlay */}
                  {cropRect && cropRect.w > 0.005 && cropRect.h > 0.005 && (
                    <div
                      className="absolute border-2 border-indigo-400 pointer-events-none"
                      style={{
                        left: `${cropRect.x * 100}%`,
                        top: `${cropRect.y * 100}%`,
                        width: `${cropRect.w * 100}%`,
                        height: `${cropRect.h * 100}%`,
                        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.58)'
                      }}
                    >
                      <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-indigo-600 rounded-sm" />
                      <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-indigo-600 rounded-sm" />
                      <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-indigo-600 rounded-sm" />
                      <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-indigo-600 rounded-sm" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Controls of Left Column: Cropped Preview + Mode + Trigger Button */}
          {image && (
            <div className="p-4 bg-white border-t border-gray-100 space-y-4">
              {croppedPreview && (
                <div className="flex items-center gap-3 p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-xl">
                  <img
                    src={croppedPreview}
                    alt="Cropped region"
                    className="h-14 max-w-[140px] object-contain rounded border border-indigo-200 bg-white"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-indigo-900">
                      เลือกเฉพาะส่วนแล้ว {croppedPixelSize ? `(${croppedPixelSize.w} × ${croppedPixelSize.h} px)` : ''}
                    </div>
                    <div className="text-[11px] text-indigo-600">
                      ระบบจะส่งเฉพาะกรอบที่เลือกนี้ไปดึงข้อความ ทำให้เร็วและแม่นยำขึ้น
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">รูปแบบการดึงข้อมูล</label>
                  <select
                    value={ocrMode}
                    onChange={(e) => setOcrMode(e.target.value)}
                    className="w-full p-2.5 text-sm rounded-xl border border-gray-200 bg-white focus:border-indigo-500 outline-none"
                  >
                    <option value="standard">ข้อความทั่วไป (คงรูปแบบเดิม)</option>
                    <option value="table">ตาราง / แยกคอลัมน์</option>
                    <option value="summary">ดึงข้อความ + สรุปใจความสำคัญ</option>
                    <option value="translate_th">ดึงข้อความ + แปลเป็นภาษาไทย</option>
                  </select>
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50 text-xs font-medium text-gray-700 h-[42px]">
                    <input
                      type="checkbox"
                      checked={appendMode}
                      onChange={(e) => setAppendMode(e.target.checked)}
                      className="rounded accent-indigo-600 w-4 h-4"
                    />
                    <span>นำข้อความไปต่อท้ายผลลัพธ์เดิม (Append)</span>
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleExtractText()}
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-indigo-100 transition-all flex justify-center items-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span>
                    <span>กำลังดึงข้อความด้วย Gemini AI...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={19} />
                    <span>
                      {croppedPreview ? 'ดึงข้อความจากส่วนที่เลือก' : 'ดึงข้อความจากทั้งภาพ'}
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Extracted Text & Export Tools (5 cols) */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-gray-800 text-base">ข้อความที่ดึงได้ (แก้ไขต่อได้)</h3>
              <p className="text-xs text-gray-400">
                {text ? `${text.length} ตัวอักษร • ${text.split('\n').length} บรรทัด` : 'พร้อมนำไปคัดลอก แชร์ หรือดาวน์โหลด'}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyText}
                disabled={!text}
                className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'คัดลอกแล้ว!' : 'คัดลอก'}</span>
              </button>

              <button
                type="button"
                onClick={handleShareText}
                disabled={!text}
                title="แชร์ไปยังแอปอื่น (เช่น LINE, Notes)"
                className="p-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-40 text-xs transition-all"
              >
                <Share2 size={15} />
              </button>

              <button
                type="button"
                onClick={handleDownloadTxt}
                disabled={!text}
                title="ดาวน์โหลดไฟล์ .txt"
                className="p-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-40 text-xs transition-all"
              >
                <Download size={15} />
              </button>

              {text && (
                <button
                  type="button"
                  onClick={() => setText('')}
                  title="ล้างข้อความ"
                  className="p-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs transition-all"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>

          {autoCopiedNotice && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-medium flex items-center gap-2 animate-fade-in">
              <Check size={16} className="shrink-0" />
              <span>คัดลอกข้อความเข้า Clipboard อัตโนมัติแล้ว! กด Ctrl+V วางใช้งานได้เลย</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs flex items-start gap-2.5">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ข้อความที่ดึงจากส่วนที่เลือกจะแสดงที่นี่... (สามารถพิมพ์แก้ไขเพิ่มเติมก่อนนำไปใช้ได้เลย)"
            className="w-full p-4 bg-gray-50 focus:bg-white rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none resize-y min-h-[290px] text-sm leading-relaxed transition-all"
          />

          {/* Recent Extractions History */}
          {history.length > 0 && (
            <div className="pt-2 border-t border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">
                  ประวัติที่ดึงล่าสุด ({history.length})
                </span>
                <button
                  type="button"
                  onClick={() => setHistory([])}
                  className="text-[11px] text-gray-400 hover:text-red-500"
                >
                  ล้างประวัติ
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2.5 p-2 rounded-xl bg-gray-50 hover:bg-indigo-50/50 border border-gray-100 text-xs group"
                  >
                    <img
                      src={item.preview}
                      alt="thumb"
                      className="w-10 h-10 object-cover rounded border border-gray-200 bg-white shrink-0"
                    />
                    <div
                      onClick={() => setText(item.text)}
                      className="flex-1 min-w-0 cursor-pointer"
                    >
                      <div className="truncate font-medium text-gray-700">{item.text}</div>
                      <div className="text-[10px] text-gray-400">
                        {item.time} • {item.isCropped ? 'เฉพาะส่วน' : 'ทั้งภาพ'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setText((prev) => (prev ? `${prev}\n${item.text}` : item.text))}
                      title="นำข้อความนี้ไปต่อท้าย"
                      className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:text-indigo-600 hover:border-indigo-200"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 7. PDF Converter (PDF <-> JPG)
const PdfConverter = () => {
  const [mode, setMode] = useState('pdf_to_jpg'); // pdf_to_jpg, jpg_to_pdf
  const [files, setFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [result, setResult] = useState(null);
  const [selectedPages, setSelectedPages] = useState([]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(Array.from(e.target.files));
      setResult(null);
      setStatusMsg('');
      setSelectedPages([]);
    }
  };

  const convertPdfToJpg = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setStatusMsg('กำลังแปลง PDF เป็นรูปภาพ...');

    try {
      // const pdfjs = await import('pdfjs-dist');
      // pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

      const file = files[0];
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;
      const images = [];

      for (let i = 1; i <= numPages; i++) {
        setStatusMsg(`กำลังแปลงหน้า ${i} จาก ${numPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // High quality
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.9));
      }

      setResult({ type: 'images', data: images });
      setSelectedPages(images.map((_, i) => i)); // Select all by default
      setStatusMsg('เสร็จสิ้น!');
    } catch (err) {
      console.error(err);
      setStatusMsg('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const convertJpgToPdf = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setStatusMsg('กำลังรวมรูปภาพเป็น PDF...');

    try {
      // const PDFLib = await import('pdf-lib');
      const newPdfDoc = await PDFDocument.create();

      for (let i = 0; i < files.length; i++) {
        setStatusMsg(`กำลังประมวลผลรูปที่ ${i + 1}...`);
        const file = files[i];
        const arrayBuffer = await file.arrayBuffer();
        let image;
        if (file.type === 'image/jpeg') {
          image = await newPdfDoc.embedJpg(arrayBuffer);
        } else if (file.type === 'image/png') {
          image = await newPdfDoc.embedPng(arrayBuffer);
        } else {
          continue; // Skip unsupported
        }

        const page = newPdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height,
        });
      }

      const pdfBytes = await newPdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      setResult({ type: 'pdf', url: url });
      setStatusMsg('เสร็จสิ้น!');
    } catch (err) {
      console.error(err);
      setStatusMsg('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const togglePageSelection = (index) => {
    setSelectedPages(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const downloadZip = async () => {
    if (!result || result.type !== 'images') return;
    const JSZip = (await import('jszip')).default;
    const saveAs = (await import('file-saver')).saveAs;
    const zip = new JSZip();

    selectedPages.forEach(index => {
      const imgData = result.data[index];
      const base64Data = imgData.replace(/^data:image\/(png|jpeg);base64,/, "");
      zip.file(`page-${index + 1}.jpg`, base64Data, { base64: true });
    });

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "selected-pages.zip");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">แปลงไฟล์ PDF / รูปภาพ</h2>
      </div>

      <div className="flex justify-center gap-4 mb-6">
        <button onClick={() => { setMode('pdf_to_jpg'); setFiles([]); setResult(null); }} className={`px-4 py-2 rounded-lg font-medium transition-all ${mode === 'pdf_to_jpg' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>PDF เป็น JPG</button>
        <button onClick={() => { setMode('jpg_to_pdf'); setFiles([]); setResult(null); }} className={`px-4 py-2 rounded-lg font-medium transition-all ${mode === 'jpg_to_pdf' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>JPG เป็น PDF</button>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="space-y-6">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative cursor-pointer group">
            <input
              type="file"
              accept={mode === 'pdf_to_jpg' ? ".pdf" : "image/jpeg, image/png"}
              multiple={mode === 'jpg_to_pdf'}
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="bg-indigo-100 text-indigo-600 rounded-full p-4 w-16 h-16 mx-auto mb-4 group-hover:scale-110 transition-transform flex items-center justify-center">
              {mode === 'pdf_to_jpg' ? <FileType2 size={32} /> : <ImageIcon size={32} />}
            </div>
            <p className="font-medium text-gray-700">
              {files.length > 0 ? `เลือกแล้ว ${files.length} ไฟล์` : (mode === 'pdf_to_jpg' ? "อัปโหลดไฟล์ PDF" : "อัปโหลดรูปภาพ (เลือกได้หลายรูป)")}
            </p>
          </div>

          <button
            onClick={mode === 'pdf_to_jpg' ? convertPdfToJpg : convertJpgToPdf}
            disabled={isProcessing || files.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span> : <><Zap size={20} /><span>เริ่มแปลงไฟล์</span></>}
          </button>
          {statusMsg && <p className="text-center text-sm text-gray-500">{statusMsg}</p>}

          {result && (
            <div className="space-y-4 animate-fade-in">
              <div className="p-4 bg-green-50 border border-green-100 rounded-xl flex items-center gap-2 font-bold text-green-700">
                <Check size={20} /> <span>เรียบร้อย!</span>
              </div>
              {result.type === 'pdf' ? (
                <a href={result.url} download="converted.pdf" className="block w-full bg-gray-900 text-white font-medium py-3 rounded-xl hover:bg-gray-800 transition-all text-center">ดาวน์โหลด PDF</a>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">เลือก {selectedPages.length} จาก {result.data.length} รูป</span>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedPages(result.data.map((_, i) => i))} className="text-xs text-indigo-600 hover:underline">เลือกทั้งหมด</button>
                      <button onClick={() => setSelectedPages([])} className="text-xs text-gray-500 hover:underline">ไม่เลือกเลย</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {result.data.map((img, idx) => (
                      <div key={idx} className={`relative group cursor-pointer border-2 rounded-lg overflow-hidden ${selectedPages.includes(idx) ? 'border-indigo-500' : 'border-transparent'}`} onClick={() => togglePageSelection(idx)}>
                        <img src={img} alt={`Page ${idx + 1}`} className="w-full h-auto" />
                        <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center ${selectedPages.includes(idx) ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-transparent border border-gray-400'}`}>
                          <Check size={14} />
                        </div>
                        <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs text-center py-1">หน้า {idx + 1}</div>
                      </div>
                    ))}
                  </div>
                  <button onClick={downloadZip} disabled={selectedPages.length === 0} className="w-full bg-gray-900 text-white font-medium py-3 rounded-xl hover:bg-gray-800 transition-all flex justify-center items-center gap-2 disabled:opacity-50">
                    <Download size={20} /> ดาวน์โหลดที่เลือก (ZIP)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 8. Excel Converter (XLS <-> CSV)
const ExcelConverter = () => {
  const [mode, setMode] = useState('xls_to_csv'); // xls_to_csv, csv_to_xls, split_sheets, merge_files
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [result, setResult] = useState(null);

  // Split/Merge States
  const [sheets, setSheets] = useState([]); // { originalName, newName, selected }
  const [mergeFiles, setMergeFiles] = useState([]);
  const [wb, setWb] = useState(null); // Valid workbook for split mode

  const handleFileChange = async (e) => {
    if (mode === 'merge_files') {
      if (e.target.files && e.target.files.length > 0) {
        setMergeFiles(Array.from(e.target.files));
        setResult(null);
        setStatusMsg('');
      }
      return;
    }

    if (e.target.files[0]) {
      const f = e.target.files[0];
      setFile(f);
      setResult(null);
      setStatusMsg('');

      if (mode === 'split_sheets') {
        try {
          // Switch to ExcelJS for reading sheet names too
          const ExcelJS = (await import('exceljs')).default;
          // Note: ExcelJS buffer load is async
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(await f.arrayBuffer());

          setSheets(workbook.worksheets.map(ws => ({
            originalName: ws.name,
            newName: ws.name,
            selected: true
          })));
        } catch (err) {
          console.error(err);
          setStatusMsg('Error reading Excel file');
        }
      }
    }
  };

  const toggleSheetSelection = (index) => {
    const newSheets = [...sheets];
    newSheets[index].selected = !newSheets[index].selected;
    setSheets(newSheets);
  };

  const updateSheetName = (index, name) => {
    const newSheets = [...sheets];
    newSheets[index].newName = name;
    setSheets(newSheets);
  };

  const processFile = async () => {
    if ((mode !== 'merge_files' && !file) || (mode === 'merge_files' && mergeFiles.length === 0)) return;
    setIsProcessing(true);
    setStatusMsg('กำลังประมวลผล...');

    try {
      const ExcelJS = (await import('exceljs')).default;
      const JSZip = (await import('jszip')).default;

      if (mode === 'xls_to_csv') {
        const workbook = new ExcelJS.Workbook();
        const arrayBuffer = await file.arrayBuffer();
        await workbook.xlsx.load(arrayBuffer);

        const worksheet = workbook.worksheets[0];
        const csvBuffer = await workbook.csv.writeBuffer();

        const blob = new Blob([csvBuffer], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        setResult({ url, name: file.name.replace(/\.[^/.]+$/, "") + ".csv" });

      } else if (mode === 'csv_to_xls') {
        const workbook = new ExcelJS.Workbook();
        const buffer = await file.arrayBuffer();
        await workbook.csv.load(buffer);

        const xlsxBuffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        setResult({ url, name: file.name.replace(/\.[^/.]+$/, "") + ".xlsx" });

      } else if (mode === 'split_sheets') {
        const selectedSheets = sheets.filter(s => s.selected);
        if (selectedSheets.length === 0) throw new Error("Please select at least one sheet");

        const processSingleSplit = async (targetSheetName, newName) => {
          const workbook = new ExcelJS.Workbook();
          const arrayBuffer = await file.arrayBuffer();
          await workbook.xlsx.load(arrayBuffer);

          const sheetsToRemove = workbook.worksheets.filter(ws => ws.name !== targetSheetName);
          sheetsToRemove.forEach(ws => {
            workbook.removeWorksheet(ws.id);
          });

          const remainingSheet = workbook.getWorksheet(targetSheetName);
          if (remainingSheet && targetSheetName !== newName) {
            remainingSheet.name = newName;
          }

          return await workbook.xlsx.writeBuffer();
        };

        if (selectedSheets.length === 1) {
          const s = selectedSheets[0];
          const buffer = await processSingleSplit(s.originalName, s.newName);
          const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = URL.createObjectURL(blob);
          setResult({ url, name: `${s.newName}.xlsx` });
        } else {
          const zip = new JSZip();
          for (const s of selectedSheets) {
            const buffer = await processSingleSplit(s.originalName, s.newName);
            zip.file(`${s.newName}.xlsx`, buffer);
          }
          const content = await zip.generateAsync({ type: "blob" });
          const url = URL.createObjectURL(content);
          setResult({ url, name: "split_sheets.zip" });
        }

      } else if (mode === 'merge_files') {
        const masterFile = mergeFiles[0];
        const masterWorkbook = new ExcelJS.Workbook();
        await masterWorkbook.xlsx.load(await masterFile.arrayBuffer());

        const existingNames = new Set(masterWorkbook.worksheets.map(ws => ws.name));

        for (let i = 1; i < mergeFiles.length; i++) {
          const f = mergeFiles[i];
          const sourceWorkbook = new ExcelJS.Workbook();
          await sourceWorkbook.xlsx.load(await f.arrayBuffer());

          sourceWorkbook.worksheets.forEach(sourceSheet => {
            let targetName = sourceSheet.name;
            if (existingNames.has(targetName)) {
              targetName = `${f.name.replace(/\.[^/.]+$/, "")}_${sourceSheet.name}`;
            }
            targetName = targetName.replace(/[\\/?*[\]:]/g, "").substring(0, 31);

            let finalName = targetName;
            let counter = 1;
            while (existingNames.has(finalName)) {
              finalName = targetName.substring(0, 28) + `_${counter}`;
              counter++;
            }
            existingNames.add(finalName);

            const newSheet = masterWorkbook.addWorksheet(finalName, {
              properties: sourceSheet.properties,
              pageSetup: sourceSheet.pageSetup,
              views: sourceSheet.views,
              state: sourceSheet.state
            });

            sourceSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
              const newRow = newSheet.getRow(rowNumber);
              newRow.height = row.height;
              newRow.hidden = row.hidden;
              newRow.outlineLevel = row.outlineLevel;

              row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const newCell = newRow.getCell(colNumber);
                newCell.value = cell.value;
                newCell.style = cell.style;
                newCell.numFmt = cell.numFmt;

                const col = newSheet.getColumn(colNumber);
                const sourceCol = sourceSheet.getColumn(colNumber);
                if (sourceCol) {
                  col.width = sourceCol.width;
                  col.hidden = sourceCol.hidden;
                  col.outlineLevel = sourceCol.outlineLevel;
                }
              });
              newRow.commit();
            });

            if (sourceSheet.tables) {
              Object.values(sourceSheet.tables).forEach(table => {
                try {
                  newSheet.addTable(table);
                } catch (e) { console.warn("Could not copy table", e); }
              });
            }

            sourceSheet.getImages().forEach(img => {
              const media = sourceWorkbook.getImage(img.imageId);
              const newImgId = masterWorkbook.addImage({
                buffer: media.buffer,
                extension: media.extension,
              });
              newSheet.addImage(newImgId, img.range);
            });
          });
        }

        const buffer = await masterWorkbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        setResult({ url, name: "merged_workbook.xlsx" });
      }

      setStatusMsg('เสร็จสิ้น!');
    } catch (err) {
      console.error(err);
      setStatusMsg('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">เครื่องมือ Excel</h2>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="bg-gray-100 p-1 rounded-xl flex mb-6 overflow-x-auto">
          <button onClick={() => { setMode('xls_to_csv'); setFile(null); setResult(null); }} className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${mode === 'xls_to_csv' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Excel → CSV</button>
          <button onClick={() => { setMode('csv_to_xls'); setFile(null); setResult(null); }} className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${mode === 'csv_to_xls' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>CSV → Excel</button>
          <button onClick={() => { setMode('split_sheets'); setFile(null); setResult(null); }} className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${mode === 'split_sheets' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>แยก Sheet</button>
          <button onClick={() => { setMode('merge_files'); setMergeFiles([]); setResult(null); }} className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${mode === 'merge_files' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>รวมไฟล์</button>
        </div>

        {mode === 'merge_files' ? (
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative cursor-pointer group mb-4">
            <input type="file" accept=".xlsx,.xls" multiple onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            <div className="bg-indigo-100 text-indigo-600 rounded-full p-4 w-12 h-12 mx-auto mb-3 group-hover:scale-110 transition-transform flex items-center justify-center"><Upload size={24} /></div>
            <p className="font-medium text-gray-700">เลือกไฟล์ Excel หลายไฟล์</p>
            {mergeFiles.length > 0 && <div className="mt-2"><span className="text-sm font-medium text-green-600 bg-green-100 px-3 py-1 rounded-full">เลือกแล้ว {mergeFiles.length} ไฟล์</span></div>}
          </div>
        ) : !file ? (
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative cursor-pointer group mb-4">
            <input type="file" accept={mode === 'csv_to_xls' ? ".csv" : ".xlsx,.xls"} onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            <div className="bg-indigo-100 text-indigo-600 rounded-full p-4 w-12 h-12 mx-auto mb-3 group-hover:scale-110 transition-transform flex items-center justify-center"><FileSpreadsheet size={32} /></div>
            <p className="font-medium text-gray-700">อัปโหลดไฟล์ {mode === 'csv_to_xls' ? 'CSV' : 'Excel'}</p>
          </div>
        ) : (
          <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200 mb-4">
            <div className="bg-green-100 p-3 rounded-lg text-green-600"><FileSpreadsheet size={24} /></div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{file.name}</p>
              <p className="text-sm text-gray-500">{formatSize(file.size)}</p>
            </div>
            <button onClick={() => setFile(null)} className="text-gray-400 hover:text-red-500"><X size={20} /></button>
          </div>
        )}

        {/* Split Sheets UI */}
        {mode === 'split_sheets' && sheets.length > 0 && (
          <div className="space-y-3 mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">เลือก Sheet ที่ต้องการแยก</span>
              <div className="flex gap-2">
                <button onClick={() => setSheets(sheets.map(s => ({ ...s, selected: true })))} className="text-xs text-indigo-600 hover:underline">เลือกทั้งหมด</button>
                <button onClick={() => setSheets(sheets.map(s => ({ ...s, selected: false })))} className="text-xs text-gray-500 hover:underline">ไม่เลือก</button>
              </div>
            </div>
            <div className="max-h-[300px] overflow-y-auto pr-2 space-y-2 border rounded-xl p-2 bg-gray-50">
              {sheets.map((sheet, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-indigo-300 transition-colors shadow-sm">
                  <input
                    type="checkbox"
                    checked={sheet.selected}
                    onChange={() => toggleSheetSelection(idx)}
                    className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-xs text-gray-400">ชื่อ Sheet เดิม: <span className="font-medium text-gray-600">{sheet.originalName}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">ชื่อไฟล์ใหม่:</span>
                      <input
                        type="text"
                        value={sheet.newName}
                        onChange={(e) => updateSheetName(idx, e.target.value)}
                        className="flex-1 text-sm border-b border-gray-300 focus:border-indigo-500 outline-none bg-transparent py-0.5 text-gray-800 placeholder-gray-300"
                        placeholder="ตั้งชื่อไฟล์..."
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="text-xs text-gray-400">.xlsx</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={processFile}
          disabled={isProcessing || (mode !== 'merge_files' && !file) || (mode === 'merge_files' && mergeFiles.length === 0)}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span> : <><Zap size={20} /><span>เริ่มประมวลผล</span></>}
        </button>

        {statusMsg && <p className="text-center text-sm text-gray-500 mt-4 animate-pulse">{statusMsg}</p>}

        {result && (
          <div className="mt-6 p-4 bg-green-50 border border-green-100 rounded-xl flex items-center justify-between animate-fade-in shadow-sm">
            <div className="flex items-center gap-2 font-bold text-green-700">
              <Check size={20} /> <span>เสร็จเรียบร้อย!</span>
            </div>
            <a href={result.url} download={result.name} className="bg-gray-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-all flex items-center gap-2 shadow-md">
              <Download size={16} /> ดาวน์โหลดผลลัพธ์
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Sortable Item Component ---
const SortableItem = (props) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {typeof props.children === 'function' ? props.children(listeners) : <div {...listeners}>{props.children}</div>}
    </div>
  );
};

// 9. PDF Merger (Merge Multiple PDFs - Page Level)
const PdfMerger = () => {
  const [pages, setPages] = useState([]); // { id, file, pageIndex, thumbnail }
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [resultPdf, setResultPdf] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleFileChange = async (e) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setIsProcessing(true);
    setStatusMsg('กำลังอ่านไฟล์และแยกหน้า...');

    const newPages = [];
    const files = Array.from(e.target.files);

    try {
      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 0.3 }); // Low scale for thumbnail
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ canvasContext: context, viewport: viewport }).promise;
          const thumbnail = canvas.toDataURL('image/jpeg', 0.8);

          newPages.push({
            id: `${file.name}-${i}-${Date.now()}-${Math.random()}`,
            file: file,
            pageIndex: i - 1, // 0-based index for pdf-lib
            pageNumber: i,    // 1-based for display
            thumbnail: thumbnail,
            fileName: file.name
          });
        }
      }

      setPages(prev => [...prev, ...newPages]);
      setResultPdf(null);
      setStatusMsg('');
    } catch (err) {
      console.error(err);
      setStatusMsg('เกิดข้อผิดพลาดในการอ่านไฟล์: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const removePage = (id) => {
    setPages(prev => prev.filter(page => page.id !== id));
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      setPages((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const mergePdfs = async () => {
    if (pages.length === 0) {
      setStatusMsg('กรุณาเพิ่มไฟล์ PDF');
      return;
    }
    setIsProcessing(true);
    setStatusMsg('กำลังรวมไฟล์...');

    try {
      const mergedPdf = await PDFDocument.create();
      const loadedDocs = new Map(); // Cache loaded docs: Map<File, PDFDocument>

      for (const page of pages) {
        let srcDoc = loadedDocs.get(page.file);
        if (!srcDoc) {
          const arrayBuffer = await page.file.arrayBuffer();
          srcDoc = await PDFDocument.load(arrayBuffer);
          loadedDocs.set(page.file, srcDoc);
        }

        const [copiedPage] = await mergedPdf.copyPages(srcDoc, [page.pageIndex]);
        mergedPdf.addPage(copiedPage);
      }

      const pdfBytes = await mergedPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      setResultPdf(url);
      setStatusMsg('เสร็จสิ้น!');
    } catch (err) {
      console.error(err);
      setStatusMsg('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">รวมไฟล์ PDF (จัดเรียงหน้าได้)</h2>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="space-y-6">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative cursor-pointer group">
            <input type="file" accept=".pdf" multiple onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            <div className="bg-red-100 text-red-600 rounded-full p-4 w-16 h-16 mx-auto mb-4 group-hover:scale-110 transition-transform flex items-center justify-center"><Files size={32} /></div>
            <p className="font-medium text-gray-700">เพิ่มไฟล์ PDF (เลือกได้หลายไฟล์)</p>
            <p className="text-xs text-gray-400 mt-2">ระบบจะแยกทุกหน้าออกมาให้คุณจัดเรียงใหม่ได้</p>
          </div>

          {pages.length > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-sm font-medium text-gray-700">รายการหน้า ({pages.length}) - ลากเพื่อจัดลำดับ</p>
                <button onClick={() => setPages([])} className="text-xs text-red-500 hover:text-red-700">ล้างทั้งหมด</button>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={pages.map(p => p.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 max-h-[500px] overflow-y-auto p-2 bg-gray-50 rounded-xl border border-gray-200">
                    {pages.map((page, i) => (
                      <SortableItem key={page.id} id={page.id}>
                        {(listeners) => (
                          <div className="relative group bg-white p-2 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow h-full">
                            <div {...listeners} className="absolute top-2 left-2 z-20 bg-white/80 p-1 rounded cursor-grab active:cursor-grabbing hover:bg-white touch-none">
                              <GripVertical size={14} className="text-gray-500" />
                            </div>
                            <div className="aspect-[3/4] bg-gray-100 mb-2 rounded overflow-hidden relative">
                              <img src={page.thumbnail} alt={`Page ${page.pageNumber}`} className="w-full h-full object-contain" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                            </div>
                            <div className="text-xs text-gray-500 truncate" title={page.fileName}>{page.fileName}</div>
                            <div className="text-xs font-bold text-gray-700 text-center mt-1">หน้า {page.pageNumber}</div>
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                removePage(page.id);
                              }}
                              className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                            >
                              <X size={12} />
                            </button>
                            <div className="absolute bottom-2 right-2 bg-black/50 text-white px-1.5 py-0.5 rounded text-[10px] font-mono">
                              {i + 1}
                            </div>
                          </div>
                        )}
                      </SortableItem>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          <button
            onClick={mergePdfs}
            disabled={isProcessing || pages.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? <><span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span><span>{statusMsg}</span></> : <><Zap size={20} /><span>รวมไฟล์ PDF</span></>}
          </button>

          {resultPdf && (
            <div className="space-y-4 animate-fade-in">
              <div className="p-4 bg-green-50 border border-green-100 rounded-xl flex items-center gap-2 font-bold text-green-700">
                <Check size={20} /> <span>เรียบร้อย!</span>
              </div>
              <a href={resultPdf} download="merged.pdf" className="block w-full bg-gray-900 text-white font-medium py-3 rounded-xl hover:bg-gray-800 transition-all text-center">ดาวน์โหลดไฟล์ที่รวมแล้ว</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 10. PDF Splitter (Extract Pages)
const PdfSplitter = () => {
  const [file, setFile] = useState(null);
  const [pages, setPages] = useState([]); // { index, imgData }
  const [selectedPages, setSelectedPages] = useState(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [resultPdf, setResultPdf] = useState(null);

  const handleFileChange = async (e) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setPages([]);
    setSelectedPages(new Set());
    setResultPdf(null);
    setIsProcessing(true);
    setStatusMsg('กำลังอ่านไฟล์...');

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;
      const newPages = [];

      for (let i = 1; i <= numPages; i++) {
        setStatusMsg(`กำลังโหลดหน้า ${i} จาก ${numPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.3 }); // Thumbnail scale
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        newPages.push({
          index: i - 1, // 0-based for pdf-lib
          pageNumber: i, // 1-based for display
          imgData: canvas.toDataURL('image/jpeg', 0.8)
        });
      }

      setPages(newPages);
      setStatusMsg('');
    } catch (err) {
      console.error(err);
      setStatusMsg('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const togglePage = (index) => {
    const newSelected = new Set(selectedPages);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedPages(newSelected);
  };

  const selectAll = () => {
    if (selectedPages.size === pages.length) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(pages.map(p => p.index)));
    }
  };

  const extractPages = async () => {
    if (selectedPages.size === 0) return;
    setIsProcessing(true);
    setStatusMsg('กำลังสร้างไฟล์ใหม่...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const srcDoc = await PDFDocument.load(arrayBuffer);
      const newDoc = await PDFDocument.create();

      // Sort selected pages to maintain order
      const sortedIndices = Array.from(selectedPages).sort((a, b) => a - b);
      const copiedPages = await newDoc.copyPages(srcDoc, sortedIndices);

      copiedPages.forEach(page => newDoc.addPage(page));

      const pdfBytes = await newDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      setResultPdf(url);
      setStatusMsg('เสร็จสิ้น!');
    } catch (err) {
      console.error(err);
      setStatusMsg('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">แยกไฟล์ PDF (เลือกหน้า)</h2>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        {!file ? (
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:bg-gray-50 transition-colors relative cursor-pointer group">
            <input type="file" accept=".pdf" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            <div className="bg-indigo-100 text-indigo-600 rounded-full p-4 w-16 h-16 mx-auto mb-4 group-hover:scale-110 transition-transform flex items-center justify-center"><Scissors size={32} /></div>
            <p className="font-medium text-gray-700">อัปโหลดไฟล์ PDF เพื่อแยกหน้า</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="bg-red-100 p-2 rounded-lg text-red-600"><FileType size={20} /></div>
                <div>
                  <p className="font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">{pages.length} หน้า</p>
                </div>
              </div>
              <button onClick={() => setFile(null)} className="text-gray-400 hover:text-red-500"><X size={20} /></button>
            </div>

            {isProcessing && !pages.length ? (
              <div className="text-center py-10">
                <span className="animate-spin inline-block rounded-full h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 mb-2"></span>
                <p className="text-gray-500">{statusMsg}</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-gray-700">เลือกหน้าที่ต้องการแยก ({selectedPages.size})</p>
                  <button onClick={selectAll} className="text-sm text-indigo-600 hover:underline font-medium">
                    {selectedPages.size === pages.length ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 max-h-[500px] overflow-y-auto p-2">
                  {pages.map((page) => (
                    <div
                      key={page.index}
                      onClick={() => togglePage(page.index)}
                      className={`relative group cursor-pointer border-2 rounded-lg overflow-hidden transition-all ${selectedPages.has(page.index) ? 'border-indigo-600 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-indigo-300'}`}
                    >
                      <div className="aspect-[3/4] bg-gray-100 relative">
                        <img src={page.imgData} alt={`Page ${page.pageNumber}`} className="w-full h-full object-contain" />
                        <div className={`absolute inset-0 transition-colors ${selectedPages.has(page.index) ? 'bg-indigo-600/10' : 'group-hover:bg-black/5'}`} />
                      </div>
                      <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all ${selectedPages.has(page.index) ? 'bg-indigo-600 text-white scale-100' : 'bg-gray-200 text-transparent scale-90 group-hover:scale-100'}`}>
                        <Check size={14} />
                      </div>
                      <div className="absolute bottom-0 inset-x-0 bg-white/90 text-center py-1 text-xs font-medium text-gray-600 border-t border-gray-100">
                        หน้า {page.pageNumber}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={extractPages}
                  disabled={isProcessing || selectedPages.size === 0}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? <><span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span><span>{statusMsg}</span></> : <><Scissors size={20} /><span>แยกไฟล์ PDF (สร้างไฟล์ใหม่)</span></>}
                </button>

                {resultPdf && (
                  <div className="space-y-4 animate-fade-in">
                    <div className="p-4 bg-green-50 border border-green-100 rounded-xl flex items-center gap-2 font-bold text-green-700">
                      <Check size={20} /> <span>เรียบร้อย!</span>
                    </div>
                    <a href={resultPdf} download={`split-${file.name}`} className="block w-full bg-gray-900 text-white font-medium py-3 rounded-xl hover:bg-gray-800 transition-all text-center">ดาวน์โหลดไฟล์ใหม่</a>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// 12. PDF Watermark
const PdfWatermark = () => {
  const [file, setFile] = useState(null);
  const [text, setText] = useState('สำเนาถูกต้อง');
  const [fontSize, setFontSize] = useState(24);
  const [opacity, setOpacity] = useState(0.5);
  const [dragPos, setDragPos] = useState({ x: 0.5, y: 0.5 });
  const mapRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [resultPdf, setResultPdf] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const previewTimer = useRef(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pdfAspectRatio, setPdfAspectRatio] = useState(1 / 1.414);

  const updateDragPos = (e) => {
    if (!mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    
    let clientX = e.clientX;
    let clientY = e.clientY;
    
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    
    let x = (clientX - rect.left) / rect.width;
    let y = (clientY - rect.top) / rect.height;
    
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    setDragPos({ x, y });
  };

  const handlePointerDown = (e) => {
    setIsDragging(true);
    updateDragPos(e);
    if (e.target && e.target.setPointerCapture && e.pointerId) {
      try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
    }
  };

  const handlePointerMove = (e) => {
    if (isDragging) updateDragPos(e);
  };

  const handlePointerUp = (e) => {
    setIsDragging(false);
    if (e.target && e.target.releasePointerCapture && e.pointerId) {
      try { e.target.releasePointerCapture(e.pointerId); } catch(err) {}
    }
  };

  const applyWatermarkToPdf = async (pdfDoc) => {
    pdfDoc.registerFontkit(fontkit);
    const fontUrl = './THSarabunPSK.ttf';
    const fontBytes = await fetch(fontUrl).then((res) => res.arrayBuffer());
    const customFont = await pdfDoc.embedFont(fontBytes);

    const pages = pdfDoc.getPages();
    if (pages.length === 0) return;

    for (const page of pages) {
      const { width, height } = page.getSize();
      
      const lines = text.split('\n');
      const textWidth = Math.max(...lines.map(line => customFont.widthOfTextAtSize(line, fontSize)));
      const fontHeight = customFont.heightAtSize(fontSize);
      const lineHeight = fontHeight * 1.2;
      const textHeight = lineHeight * lines.length;
      
      const centerX = width * dragPos.x;
      const centerY = height * (1 - dragPos.y);
      
      const x = centerX - (textWidth / 2);
      const y = centerY + (textHeight / 2) - fontHeight;

      page.drawText(text, {
        x,
        y,
        size: fontSize,
        font: customFont,
        color: rgb(0, 0, 0),
        opacity: opacity,
        lineHeight: lineHeight,
      });
    }
  };

  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setResultPdf(null);
      setPreviewUrl(null);
      setPreviewPage(1);

      try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuffer);
        
        setTotalPages(pdfDoc.getPageCount());
        if (pdfDoc.getPageCount() > 0) {
          const { width, height } = pdfDoc.getPages()[0].getSize();
          setPdfAspectRatio(width / height);
        }
      } catch (err) {
        console.error("Failed to parse PDF dimensions", err);
      }
    }
  };

  const generatePreview = async () => {
    if (!file || !text.trim()) return;
    setIsPreviewLoading(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      
      await applyWatermarkToPdf(pdfDoc);

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (error) {
      console.error("Preview error:", error);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      generatePreview();
    }, 500); // 500ms debounce
    return () => clearTimeout(previewTimer.current);
  }, [file, text, fontSize, opacity, dragPos]);



  const processPdf = async () => {
    if (!file) return;
    setIsProcessing(true);
    setStatusMsg('กำลังประมวลผล PDF...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      
      await applyWatermarkToPdf(pdfDoc);

      setStatusMsg('กำลังบันทึกไฟล์...');
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setResultPdf(url);
      setStatusMsg('เสร็จสิ้น!');
    } catch (error) {
      console.error(error);
      setStatusMsg('เกิดข้อผิดพลาดในการประมวลผล');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden h-full flex flex-col">
      <div className="p-6 border-b border-gray-100 bg-gray-50/50">
        <h2 className="text-xl font-bold flex items-center gap-2"><Type className="text-indigo-600" /> ใส่ข้อความบน PDF (Watermark)</h2>
        <p className="text-sm text-gray-500 mt-1">ใส่ข้อความ "สำเนาถูกต้อง" (หรือข้อความอื่น) ลงในทุกหน้าของไฟล์ PDF</p>
      </div>
      <div className="p-6 flex-1 overflow-y-auto">
        {!file ? (
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:bg-gray-50 transition-colors">
            <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" id="pdf-watermark-upload" />
            <label htmlFor="pdf-watermark-upload" className="cursor-pointer flex flex-col items-center">
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-4"><Upload size={32} /></div>
              <span className="text-lg font-medium">อัปโหลดไฟล์ PDF</span>
              <span className="text-sm text-gray-500 mt-1">คลิกที่นี่เพื่อเลือกไฟล์</span>
            </label>
          </div>
        ) : (
          <div className="h-full flex flex-col lg:flex-row gap-6">
            <div className="flex-1 space-y-6 lg:max-w-md">
              <div className="bg-gray-50 p-4 rounded-xl flex items-center justify-between border border-gray-100">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileType className="text-indigo-600 shrink-0" size={24} />
                  <span className="font-medium truncate">{file.name}</span>
                  <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full">{formatSize(file.size)}</span>
                </div>
                <button onClick={() => { setFile(null); setResultPdf(null); setPreviewUrl(null); }} className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={18} /></button>
              </div>

              {!resultPdf ? (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">ข้อความ (หลายบรรทัดได้)</label>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none resize-y"
                      rows="3"
                      placeholder={"สำเนาถูกต้อง\n1 มกราคม 2567"}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          ขนาดตัวอักษร: {fontSize} pt
                        </label>
                        <input
                          type="range"
                          min="16"
                          max="60"
                          value={fontSize}
                          onChange={(e) => setFontSize(Number(e.target.value))}
                          className="w-full accent-indigo-600"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          ความโปร่งแสง: {Math.round(opacity * 100)}%
                        </label>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.1"
                          value={opacity}
                          onChange={(e) => setOpacity(Number(e.target.value))}
                          className="w-full accent-indigo-600"
                        />
                      </div>
                    </div>
                    
                    {/* Drag Map Area */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        ตำแหน่ง (ลากวางได้)
                      </label>
                      <div className="w-full aspect-[1/1.414] max-h-48 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 relative overflow-hidden mx-auto touch-none select-none"
                           ref={mapRef}
                           onPointerDown={handlePointerDown}
                           onPointerMove={handlePointerMove}
                           onPointerUp={handlePointerUp}
                           onPointerCancel={handlePointerUp}
                           style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                      >
                         <div className="absolute inset-0 flex flex-col items-center justify-center opacity-20 pointer-events-none">
                            <FileType size={32} />
                         </div>
                         <div 
                           className="absolute w-8 h-6 bg-indigo-500/80 rounded border-2 border-indigo-600 pointer-events-none flex items-center justify-center text-white"
                           style={{ 
                             left: `${dragPos.x * 100}%`, 
                             top: `${dragPos.y * 100}%`,
                             transform: 'translate(-50%, -50%)',
                             boxShadow: '0 0 0 2px rgba(255,255,255,0.5)'
                           }}
                         >
                            <Type size={12} />
                         </div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={processPdf}
                    disabled={isProcessing || !text.trim()}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                  >
                    {isProcessing ? <><span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span><span>{statusMsg}</span></> : <><Type size={20} /><span>ดำเนินการทุกหน้า</span></>}
                  </button>
                </div>
              ) : (
                <div className="space-y-4 animate-fade-in">
                  <div className="p-4 bg-green-50 border border-green-100 rounded-xl flex items-center justify-between font-bold text-green-700">
                    <div className="flex items-center gap-2"><Check size={20} /> <span>ประมวลผลเสร็จสิ้น!</span></div>
                  </div>
                  <div className="flex flex-col gap-4">
                      <a href={resultPdf} download={`watermark-${file.name}`} className="block w-full bg-indigo-600 text-white font-medium py-3 rounded-xl hover:bg-indigo-700 transition-all text-center flex justify-center items-center gap-2"><Download size={18} /> ดาวน์โหลดไฟล์ใหม่</a>
                      <button onClick={() => { setFile(null); setResultPdf(null); setPreviewUrl(null); }} className="block w-full bg-gray-100 text-gray-800 font-medium py-3 rounded-xl hover:bg-gray-200 transition-all text-center">ทำไฟล์อื่นต่อ</button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Live Preview Column */}
            <div className="flex-1 bg-gray-100 rounded-xl border border-gray-200 overflow-hidden flex flex-col h-[500px] lg:h-auto min-h-[400px]">
              <div className="p-3 bg-white border-b border-gray-200 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 flex items-center gap-2"><Eye size={16} className="text-gray-400"/> ภาพตัวอย่าง PDF</span>
                {isPreviewLoading && <span className="flex items-center gap-2 text-xs text-indigo-600"><span className="animate-spin rounded-full h-3 w-3 border-b-2 border-indigo-600"></span> กำลังเปลี่ยนหน้า...</span>}
              </div>
              
              <div className="flex-1 relative bg-gray-50/50">
                {previewUrl ? (
                  <iframe src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`} className="w-full h-full border-0" title="PDF Preview" />
                ) : (
                  <div className="absolute inset-0 flex flex-col gap-3 items-center justify-center text-gray-400">
                    <span className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></span>
                    <span>กำลังโหลดตัวอย่าง...</span>
                  </div>
                )}
              </div>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main Layout ---
const App = () => {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
  const [activeTab, setActiveTab] = useState('ocr');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingSnip, setPendingSnip] = useState(null);

  // Dark / Light Mode state
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('worktools_theme');
    return saved === 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('worktools_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('worktools_theme', 'light');
    }
  }, [darkMode]);

  // Auto-Update State (Portable & Desktop)
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [updateInfo, setUpdateInfo] = useState(null); // { hasUpdate, latestVersion, downloadUrl, releaseUrl }
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updatingProgress, setUpdatingProgress] = useState(null); // { percent, status }
  const [updateStatusMsg, setUpdateStatusMsg] = useState('');

  const handleCheckUpdate = async (silent = false) => {
    if (!silent) {
      setCheckingUpdate(true);
      setUpdateStatusMsg('');
    }
    try {
      if (isElectron && window.electronAPI?.checkForUpdates) {
        const res = await window.electronAPI.checkForUpdates();
        if (res?.currentVersion) setAppVersion(res.currentVersion);
        if (res?.hasUpdate) {
          setUpdateInfo(res);
          setUpdateStatusMsg(`พบเวอร์ชันใหม่ v${res.latestVersion}`);
        } else if (!silent) {
          setUpdateInfo(null);
          setUpdateStatusMsg('เป็นเวอร์ชันล่าสุดแล้ว');
          setTimeout(() => setUpdateStatusMsg(''), 3000);
        }
      } else {
        // Fallback check via GitHub API on Web
        const response = await fetch('https://api.github.com/repos/Malztt/my-tools-app/releases/latest');
        if (response.ok) {
          const data = await response.json();
          const latestVer = String(data.tag_name || '').replace(/^v/i, '');
          if (!silent) {
            setUpdateStatusMsg(latestVer ? `เวอร์ชันล่าสุด v${latestVer}` : 'เป็นเวอร์ชันล่าสุดแล้ว');
            setTimeout(() => setUpdateStatusMsg(''), 3000);
          }
        } else if (!silent) {
          setUpdateStatusMsg('เป็นเวอร์ชันล่าสุดแล้ว');
          setTimeout(() => setUpdateStatusMsg(''), 3000);
        }
      }
    } catch {
      if (!silent) {
        setUpdateStatusMsg('เป็นเวอร์ชันล่าสุดแล้ว');
        setTimeout(() => setUpdateStatusMsg(''), 3000);
      }
    } finally {
      if (!silent) setCheckingUpdate(false);
    }
  };

  const handleStartAutoUpdate = async () => {
    if (!updateInfo?.downloadUrl || !isElectron) return;
    setUpdatingProgress({ percent: 1, status: 'downloading' });
    setUpdateStatusMsg('กำลังดาวน์โหลดอัปเดต...');
    const res = await window.electronAPI.downloadAndInstallUpdate(updateInfo.downloadUrl);
    if (!res?.success) {
      setUpdatingProgress(null);
      setUpdateStatusMsg(res?.error || 'อัปเดตไม่สำเร็จ');
    }
  };

  useEffect(() => {
    if (isElectron) {
      window.electronAPI.getAppInfo?.().then((info) => {
        if (info?.version) setAppVersion(info.version);
      });
      handleCheckUpdate(true);

      const unsubProgress = window.electronAPI.onUpdateProgress?.((data) => {
        setUpdatingProgress(data);
        if (data.status === 'restarting') {
          setUpdateStatusMsg('ติดตั้งสำเร็จ กำลังเปิดโปรแกรมใหม่...');
        }
      });

      const unsubSnip = window.electronAPI.onSnipCaptured?.((payload) => {
        setActiveTab('ocr');
        setPendingSnip(payload);
      });

      return () => {
        if (typeof unsubProgress === 'function') unsubProgress();
        if (typeof unsubSnip === 'function') unsubSnip();
      };
    }
  }, [isElectron]);

  const tools = [
    { id: 'ocr', label: 'ดึงข้อความ OCR', icon: Zap },
    { id: 'pdf_watermark', label: 'ใส่ข้อความ PDF', icon: Type },
    { id: 'compress_pdf', label: 'บีบ PDF', icon: FileType },
    { id: 'pdf_merge', label: 'รวมไฟล์ PDF', icon: Files },
    { id: 'pdf_split', label: 'แยกไฟล์ PDF', icon: Scissors },
    { id: 'pdf_conv', label: 'แปลง PDF/รูปภาพ', icon: FileType2 },
    { id: 'compress_img', label: 'จัดการรูปภาพ', icon: FileImage },
    { id: 'xls_conv', label: 'แปลง Excel/CSV', icon: FileSpreadsheet },
    { id: 'qrcode', label: 'สร้าง QR Code', icon: QrCode },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900 flex transition-colors duration-200">
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 h-full flex flex-col justify-between">
          <div className="overflow-y-auto pr-1">
            {/* Brand Header with Custom Anvil Icon */}
            <div className="flex items-center justify-between mb-8 px-1">
              <div className="flex items-center gap-3">
                <img
                  src="./anvil.webp"
                  alt="WorkTools Icon"
                  className="w-11 h-11 object-contain drop-shadow-sm select-none"
                />
                <div>
                  <h1 className="font-bold text-xl leading-tight">WorkTools</h1>
                  <p className="text-[11px] text-gray-400 font-mono">v{appVersion} {isElectron ? 'Portable' : ''}</p>
                </div>
              </div>

              {/* Quick Theme Toggle Button */}
              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                title={darkMode ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
                className="p-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-600 transition-all"
              >
                {darkMode ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} />}
              </button>
            </div>

            {/* Unified Menu List (No Category Split) */}
            <nav className="space-y-1.5">
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => { setActiveTab(tool.id); setSidebarOpen(false); }}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab === tool.id
                    ? 'bg-indigo-50 text-indigo-600 shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                >
                  <tool.icon size={20} />
                  <span className="font-medium text-sm">{tool.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Sidebar Footer: Dark/Light Toggle & Portable Auto-Updater */}
          <div className="pt-4 border-t border-gray-100 space-y-2.5">
            {/* Dark/Light Mode Full Button */}
            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-xs font-medium text-gray-700 transition-all"
            >
              <span className="flex items-center gap-2">
                {darkMode ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-indigo-600" />}
                <span>{darkMode ? 'โหมดมืด (Dark Mode)' : 'โหมดสว่าง (Light Mode)'}</span>
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                สลับสี
              </span>
            </button>

            {/* Auto-Update Status & Trigger */}
            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">ระบบอัปเดตอัตโนมัติ</span>
                <button
                  type="button"
                  onClick={() => handleCheckUpdate(false)}
                  disabled={checkingUpdate || Boolean(updatingProgress)}
                  className="text-indigo-600 hover:underline flex items-center gap-1 font-medium disabled:opacity-50"
                >
                  <RefreshCw size={12} className={checkingUpdate ? 'animate-spin' : ''} />
                  <span>{checkingUpdate ? 'กำลังเช็ก...' : 'เช็กอัปเดต'}</span>
                </button>
              </div>

              {updateStatusMsg && (
                <p className="text-[11px] text-indigo-600 font-medium">{updateStatusMsg}</p>
              )}

              {updatingProgress ? (
                <div className="space-y-1">
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 transition-all duration-200"
                      style={{ width: `${updatingProgress.percent}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-right text-gray-500 font-mono">
                    {updatingProgress.percent}%
                  </div>
                </div>
              ) : updateInfo?.hasUpdate ? (
                <button
                  type="button"
                  onClick={handleStartAutoUpdate}
                  className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5"
                >
                  <RefreshCw size={13} />
                  <span>อัปเดตเป็น v{updateInfo.latestVersion} ทันที</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white border-b border-gray-200 p-3.5 flex items-center justify-between md:hidden">
          <div className="flex items-center">
            <button onClick={() => setSidebarOpen(true)} className="p-2"><Menu size={24} /></button>
            <img src="./anvil.webp" alt="WorkTools" className="w-7 h-7 object-contain ml-2" />
            <span className="ml-2 font-bold">WorkTools</span>
          </div>
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded-xl border border-gray-200 text-gray-600"
          >
            {darkMode ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} />}
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-5xl mx-auto">
            {activeTab === 'compress_img' && <ImageStudio />}
            {activeTab === 'compress_pdf' && <PdfOptimizer />}
            {activeTab === 'qrcode' && <QRCodeGenerator />}
            {activeTab === 'ocr' && <GeminiOCR pendingSnip={pendingSnip} onClearPendingSnip={() => setPendingSnip(null)} />}
            {activeTab === 'pdf_conv' && <PdfConverter />}
            {activeTab === 'pdf_merge' && <PdfMerger />}
            {activeTab === 'pdf_split' && <PdfSplitter />}
            {activeTab === 'pdf_watermark' && <PdfWatermark />}
            {activeTab === 'xls_conv' && <ExcelConverter />}
          </div>
        </div>
      </main>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }`}</style>
    </div>
  );
};

export default App;