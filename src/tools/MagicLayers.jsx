import React, { useState, useRef, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import {
  Layers,
  Upload,
  Sparkles,
  Lasso,
  Move,
  Download,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  RefreshCw,
  AlertCircle,
  Crosshair,
  Scissors,
  FileArchive,
  X,
  Plus,
  Key,
  CheckCircle2,
} from 'lucide-react';
import { downloadBlob } from '../downloadManager';
import { segmentWithSamPoints, clearSamImageCache } from './samEngine';

// Fast Onion-Peel + Harmonic Diffusion Inpainting on a cropped region around the mask
// Runs offline in <100ms, smoothly fills solid/gradient/sky/wall/blurred backgrounds with zero seams
const inpaintBackgroundRegion = (bgCanvas, mask, maskW, maskH, dilateRadius = 3) => {
  const ctx = bgCanvas.getContext('2d', { willReadFrequently: true });
  const W = bgCanvas.width;
  const H = bgCanvas.height;

  // Find tight bounding box of mask
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    const my = Math.min(maskH - 1, Math.floor((y * maskH) / H));
    for (let x = 0; x < W; x++) {
      const mx = Math.min(maskW - 1, Math.floor((x * maskW) / W));
      if (mask[my * maskW + mx]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return;

  const pad = dilateRadius + 14;
  const rx = Math.max(0, minX - pad);
  const ry = Math.max(0, minY - pad);
  const rx2 = Math.min(W - 1, maxX + pad);
  const ry2 = Math.min(H - 1, maxY + pad);
  const rw = rx2 - rx + 1;
  const rh = ry2 - ry + 1;

  // Downscale ROI for fast harmonic diffusion if large
  const maxDim = 340;
  const scale = Math.min(1, maxDim / Math.max(rw, rh));
  const sw = Math.max(8, Math.round(rw * scale));
  const sh = Math.max(8, Math.round(rh * scale));

  // Extract ROI to small canvas
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = sw;
  smallCanvas.height = sh;
  const sctx = smallCanvas.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bgCanvas, rx, ry, rw, rh, 0, 0, sw, sh);
  const sData = sctx.getImageData(0, 0, sw, sh);
  const px = sData.data;

  // Build dilated mask at small resolution
  const rawMask = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const origY = ry + Math.min(rh - 1, Math.floor((y + 0.5) / scale));
    const my = Math.min(maskH - 1, Math.floor((origY * maskH) / H));
    for (let x = 0; x < sw; x++) {
      const origX = rx + Math.min(rw - 1, Math.floor((x + 0.5) / scale));
      const mx = Math.min(maskW - 1, Math.floor((origX * maskW) / W));
      if (mask[my * maskW + mx]) rawMask[y * sw + x] = 1;
    }
  }

  const dRad = Math.max(1, Math.round(dilateRadius * scale) + 1);
  const hole = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (!rawMask[y * sw + x]) continue;
      const y0 = Math.max(0, y - dRad);
      const y1 = Math.min(sh - 1, y + dRad);
      const x0 = Math.max(0, x - dRad);
      const x1 = Math.min(sw - 1, x + dRad);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          hole[yy * sw + xx] = 1;
        }
      }
    }
  }

  // Float RGB buffers
  const rBuf = new Float32Array(sw * sh);
  const gBuf = new Float32Array(sw * sh);
  const bBuf = new Float32Array(sw * sh);
  const known = new Uint8Array(sw * sh);
  const holeIndices = [];

  for (let i = 0; i < sw * sh; i++) {
    rBuf[i] = px[i * 4];
    gBuf[i] = px[i * 4 + 1];
    bBuf[i] = px[i * 4 + 2];
    if (hole[i]) {
      known[i] = 0;
      holeIndices.push(i);
    } else {
      known[i] = 1;
    }
  }

  // Step 1: Onion-peel inward fill from boundary pixels
  let frontier = [];
  const inFrontier = new Uint8Array(sw * sh);
  const dirs = [
    [-1, 0, 1.0],
    [1, 0, 1.0],
    [0, -1, 1.0],
    [0, 1, 1.0],
    [-1, -1, 0.7],
    [1, -1, 0.7],
    [-1, 1, 0.7],
    [1, 1, 0.7],
  ];

  for (let k = 0; k < holeIndices.length; k++) {
    const idx = holeIndices[k];
    const x = idx % sw;
    const y = (idx - x) / sw;
    for (let d = 0; d < 4; d++) {
      const nx = x + dirs[d][0];
      const ny = y + dirs[d][1];
      if (nx >= 0 && nx < sw && ny >= 0 && ny < sh && known[ny * sw + nx]) {
        frontier.push(idx);
        inFrontier[idx] = 1;
        break;
      }
    }
  }

  while (frontier.length > 0) {
    const nextFrontier = [];
    // Compute values for current frontier ring
    const valsR = new Float32Array(frontier.length);
    const valsG = new Float32Array(frontier.length);
    const valsB = new Float32Array(frontier.length);

    for (let i = 0; i < frontier.length; i++) {
      const idx = frontier[i];
      const x = idx % sw;
      const y = (idx - x) / sw;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let swSum = 0;
      for (let d = 0; d < dirs.length; d++) {
        const nx = x + dirs[d][0];
        const ny = y + dirs[d][1];
        if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
          const nIdx = ny * sw + nx;
          if (known[nIdx]) {
            const w = dirs[d][2];
            sr += rBuf[nIdx] * w;
            sg += gBuf[nIdx] * w;
            sb += bBuf[nIdx] * w;
            swSum += w;
          }
        }
      }
      if (swSum > 0) {
        valsR[i] = sr / swSum;
        valsG[i] = sg / swSum;
        valsB[i] = sb / swSum;
      }
    }

    for (let i = 0; i < frontier.length; i++) {
      const idx = frontier[i];
      rBuf[idx] = valsR[i];
      gBuf[idx] = valsG[i];
      bBuf[idx] = valsB[i];
      known[idx] = 1;

      const x = idx % sw;
      const y = (idx - x) / sw;
      for (let d = 0; d < 4; d++) {
        const nx = x + dirs[d][0];
        const ny = y + dirs[d][1];
        if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
          const nIdx = ny * sw + nx;
          if (!known[nIdx] && !inFrontier[nIdx]) {
            inFrontier[nIdx] = 1;
            nextFrontier.push(nIdx);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  // Step 2: Harmonic (Laplacian) relaxation inside hole for silky-smooth gradients
  const iterations = 16;
  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < holeIndices.length; k++) {
      const idx = holeIndices[k];
      const x = idx % sw;
      const y = (idx - x) / sw;
      if (x <= 0 || x >= sw - 1 || y <= 0 || y >= sh - 1) continue;
      const up = idx - sw;
      const dn = idx + sw;
      const lf = idx - 1;
      const rt = idx + 1;
      rBuf[idx] = 0.25 * (rBuf[up] + rBuf[dn] + rBuf[lf] + rBuf[rt]);
      gBuf[idx] = 0.25 * (gBuf[up] + gBuf[dn] + gBuf[lf] + gBuf[rt]);
      bBuf[idx] = 0.25 * (bBuf[up] + bBuf[dn] + bBuf[lf] + bBuf[rt]);
    }
  }

  for (let i = 0; i < sw * sh; i++) {
    px[i * 4] = Math.max(0, Math.min(255, Math.round(rBuf[i])));
    px[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(gBuf[i])));
    px[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(bBuf[i])));
    px[i * 4 + 3] = 255;
  }
  sctx.putImageData(sData, 0, 0);

  // Upscale filled patch back to ROI size
  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = rw;
  patchCanvas.height = rh;
  const pctx = patchCanvas.getContext('2d', { willReadFrequently: true });
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(smallCanvas, 0, 0, sw, sh, 0, 0, rw, rh);
  const patchData = pctx.getImageData(0, 0, rw, rh).data;

  // Composite ONLY inside dilated mask onto bgCanvas
  const origRoi = ctx.getImageData(rx, ry, rw, rh);
  const origPx = origRoi.data;

  // Build full-res dilated mask for crisp seam-free replacement
  const fullMask = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    const my = Math.min(maskH - 1, Math.floor(((ry + y) * maskH) / H));
    for (let x = 0; x < rw; x++) {
      const mx = Math.min(maskW - 1, Math.floor(((rx + x) * maskW) / W));
      if (mask[my * maskW + mx]) fullMask[y * rw + x] = 1;
    }
  }

  const rDil = Math.max(1, dilateRadius);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      let inside = fullMask[y * rw + x] === 1;
      if (!inside) {
        // Check within dilateRadius
        outer: for (let dy = -rDil; dy <= rDil; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= rh) continue;
          for (let dx = -rDil; dx <= rDil; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= rw) continue;
            if (fullMask[yy * rw + xx]) {
              inside = true;
              break outer;
            }
          }
        }
      }
      if (inside) {
        const i = (y * rw + x) * 4;
        origPx[i] = patchData[i];
        origPx[i + 1] = patchData[i + 1];
        origPx[i + 2] = patchData[i + 2];
        origPx[i + 3] = 255;
      }
    }
  }

  ctx.putImageData(origRoi, rx, ry);
};

// Rasterize a polygon (Lasso) into a binary Uint8Array mask
const rasterizePolygonMask = (points, width, height) => {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  points.forEach((pt, idx) => {
    if (idx === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.closePath();
  ctx.fill();
  const data = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] > 128) mask[i] = 1;
  }
  return mask;
};

// Tight-crop a full-frame RGBA layer returned by Qwen-Image-Layered to its visible non-transparent bounds
const tightCropRgbaLayer = (imgEl, targetW, targetH) => {
  const full = document.createElement('canvas');
  full.width = targetW;
  full.height = targetH;
  const fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(imgEl, 0, 0, targetW, targetH);
  const data = fctx.getImageData(0, 0, targetW, targetH).data;

  let minX = targetW;
  let minY = targetH;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const a = data[(y * targetW + x) * 4 + 3];
      if (a > 16) {
        visiblePixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Skip completely empty/blank layers
  if (visiblePixels < 25 || maxX <= minX || maxY <= minY) return null;

  const pad = 2;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(targetW - 1, maxX + pad);
  const y1 = Math.min(targetH - 1, maxY + pad);
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;

  const cropped = document.createElement('canvas');
  cropped.width = tw;
  cropped.height = th;
  cropped.getContext('2d').drawImage(full, x0, y0, tw, th, 0, 0, tw, th);

  return {
    dataUrl: cropped.toDataURL('image/png'),
    minX: x0,
    minY: y0,
    width: tw,
    height: th,
  };
};

export default function MagicLayers({ hfToken = '', onOpenApiKeySettings }) {
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceDataUrl, setSourceDataUrl] = useState('');
  const [imageKey, setImageKey] = useState('');
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [targetLayerCount, setTargetLayerCount] = useState(4);

  // Editor Modes: 'sam' (AI Click Select) | 'lasso' (Freehand Select) | 'move' (Move/Resize/Rotate Layers)
  const [tool, setTool] = useState('move');
  const [samPointMode, setSamPointMode] = useState(1); // 1 = include (+), 0 = exclude (-)
  const [samPoints, setSamPoints] = useState([]);
  const [samBusy, setSamBusy] = useState(false);
  const [samStatus, setSamStatus] = useState('');
  const [autoSplitting, setAutoSplitting] = useState(false);
  const [autoSplitProgress, setAutoSplitProgress] = useState({ percent: 0, text: '' });
  const [lassoPoints, setLassoPoints] = useState([]);
  const [selectionMask, setSelectionMask] = useState(null); // { mask, width, height }

  const hasHfToken = Boolean(hfToken && hfToken.trim());

  // Fill behind grabbed object: true = auto inpaint, false = keep original background untouched (duplicate grab)
  const [autoInpaintBg, setAutoInpaintBg] = useState(true);
  const [bgVisible, setBgVisible] = useState(true);

  // Extracted Layers: [{ id, name, dataUrl, img, x, y, width, height, scale, rotation, flipX, opacity, visible }]
  // Note: x, y represent the CENTER of the layer in image coordinates for intuitive rotate & scale!
  const [layers, setLayers] = useState([]);
  const [selectedLayerId, setSelectedLayerId] = useState(null);

  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);

  const fileInputRef = useRef(null);
  const origCanvasRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const isDrawingLassoRef = useRef(false);
  const lassoRef = useRef([]);
  const dragOpRef = useRef(null); // { type: 'move'|'scale'|'rotate', layerId, startX, startY, origLayer, startDist, startAngle }
  const layerCounterRef = useRef(1);

  useEffect(() => {
    return () => {
      clearSamImageCache();
    };
  }, []);

  const selectedLayer = layers.find((l) => l.id === selectedLayerId) || null;

  // Convert pointer event to image pixel coordinates
  const getCanvasCoords = (e) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // Hit-test layers from topmost to bottommost (returns layer or null)
  const hitTestLayer = (px, py) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible) continue;
      // Transform point into layer local space
      const dx = px - l.x;
      const dy = py - l.y;
      const rad = (-l.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const lx = (dx * cos - dy * sin) / l.scale;
      const ly = (dx * sin + dy * cos) / l.scale;
      const halfW = l.width / 2;
      const halfH = l.height / 2;
      if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) {
        return l;
      }
    }
    return null;
  };

  // Compute handle positions (resize corner & rotate stem) in image coordinates for selected layer
  const getLayerHandles = (l) => {
    const rad = (l.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hw = (l.width * l.scale) / 2;
    const hh = (l.height * l.scale) / 2;
    const rotOffset = Math.max(26, imgSize.w * 0.035);

    // Bottom-right corner for resize
    const resizeX = l.x + hw * cos - hh * sin;
    const resizeY = l.y + hw * sin + hh * cos;

    // Top-center stem for rotate
    const rotX = l.x - -(hh + rotOffset) * sin;
    const rotY = l.y + -(hh + rotOffset) * cos;

    return { resizeX, resizeY, rotX, rotY };
  };

  // Render composite canvas (background + all layers + selection overlay / handles)
  const redrawCanvas = useCallback(() => {
    const display = displayCanvasRef.current;
    const bg = bgCanvasRef.current;
    if (!display || !bg || bg.width === 0 || bg.height === 0) return;

    if (display.width !== bg.width || display.height !== bg.height) {
      display.width = bg.width;
      display.height = bg.height;
    }

    const ctx = display.getContext('2d');
    ctx.clearRect(0, 0, display.width, display.height);

    // Draw background layer
    if (bgVisible) {
      ctx.drawImage(bg, 0, 0);
    }

    // Draw extracted layers in order
    for (const l of layers) {
      if (!l.visible || !l.img) continue;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.translate(l.x, l.y);
      ctx.rotate((l.rotation * Math.PI) / 180);
      ctx.scale(l.flipX ? -l.scale : l.scale, l.scale);
      ctx.drawImage(l.img, -l.width / 2, -l.height / 2, l.width, l.height);
      ctx.restore();
    }

    // Draw active selection mask overlay (in SAM / Lasso mode)
    if (selectionMask && (tool === 'sam' || tool === 'lasso')) {
      const { mask, width: mw, height: mh } = selectionMask;
      const overlay = document.createElement('canvas');
      overlay.width = mw;
      overlay.height = mh;
      const octx = overlay.getContext('2d');
      const oImg = octx.createImageData(mw, mh);
      const od = oImg.data;
      for (let i = 0; i < mw * mh; i++) {
        if (mask[i]) {
          const p = i * 4;
          od[p] = 79;
          od[p + 1] = 70;
          od[p + 2] = 229;
          od[p + 3] = 115;
        }
      }
      octx.putImageData(oImg, 0, 0);
      ctx.save();
      ctx.drawImage(overlay, 0, 0, display.width, display.height);
      ctx.restore();
    }

    // Draw SAM click markers
    if (tool === 'sam' && samPoints.length > 0) {
      const r = Math.max(6, display.width * 0.008);
      for (const pt of samPoints) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fillStyle = pt.label === 1 ? '#10b981' : '#ef4444';
        ctx.fill();
        ctx.lineWidth = Math.max(2, r * 0.35);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw active Lasso path
    if (tool === 'lasso' && lassoPoints.length > 1) {
      ctx.save();
      ctx.beginPath();
      lassoPoints.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = Math.max(2, display.width * 0.003);
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.restore();
    }

    // Draw bounding box + resize/rotate handles for selected layer in Move mode
    if (tool === 'move' && selectedLayer && selectedLayer.visible) {
      const l = selectedLayer;
      const strokeW = Math.max(2, display.width * 0.0025);
      const handleR = Math.max(8, display.width * 0.011);
      const rotOffset = Math.max(26, display.width * 0.035);

      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate((l.rotation * Math.PI) / 180);
      const hw = (l.width * l.scale) / 2;
      const hh = (l.height * l.scale) / 2;

      // Bounding rectangle
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = strokeW;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);

      // Rotation stem
      ctx.beginPath();
      ctx.moveTo(0, -hh);
      ctx.lineTo(0, -(hh + rotOffset));
      ctx.stroke();

      // Rotate handle (top circle)
      ctx.beginPath();
      ctx.arc(0, -(hh + rotOffset), handleR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = strokeW;
      ctx.stroke();

      // Resize handle (bottom-right circle)
      ctx.beginPath();
      ctx.arc(hw, hh, handleR, 0, Math.PI * 2);
      ctx.fillStyle = '#4f46e5';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = strokeW;
      ctx.stroke();

      ctx.restore();
    }
  }, [bgVisible, layers, selectionMask, tool, samPoints, lassoPoints, selectedLayer]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Helper to load a URL or DataURL into an HTMLImageElement (CORS-safe via fetch->blob when remote)
  const loadImageEl = async (url) => {
    let targetUrl = url;
    let revoke = false;
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`โหลดภาพเลเยอร์ไม่สำเร็จ (HTTP ${res.status})`);
      const blob = await res.blob();
      targetUrl = URL.createObjectURL(blob);
      revoke = true;
    }
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        if (revoke) URL.revokeObjectURL(targetUrl);
        resolve(im);
      };
      im.onerror = () => {
        if (revoke) URL.revokeObjectURL(targetUrl);
        resolve(null);
      };
      im.src = targetUrl;
    });
  };

  // Automatically decompose poster/graphic/photo into RGBA Layers using Qwen/Qwen-Image-Layered (Hugging Face Free ZeroGPU)
  const runAutoSplit = async (_key, dataUrl, layerCountOverride = targetLayerCount) => {
    if (!origCanvasRef.current || !bgCanvasRef.current || !dataUrl) return;
    setAutoSplitting(true);
    setError('');
    setSelectionMask(null);
    setSamPoints([]);
    setLassoPoints([]);
    setAutoSplitProgress({ percent: 10, text: 'กำลังเชื่อมต่อ Qwen-Image-Layered (Hugging Face Free GPU)...' });

    try {
      const orig = origCanvasRef.current;
      const bg = bgCanvasRef.current;
      const bgCtx = bg.getContext('2d');
      bgCtx.clearRect(0, 0, bg.width, bg.height);
      bgCtx.drawImage(orig, 0, 0);

      // Prepare crisp PNG blob (cap at 1024px max side for fast upload & optimal Qwen inference)
      const uploadScale = Math.min(1, 1024 / Math.max(orig.width, orig.height));
      const upCanvas = document.createElement('canvas');
      upCanvas.width = Math.max(64, Math.round(orig.width * uploadScale));
      upCanvas.height = Math.max(64, Math.round(orig.height * uploadScale));
      upCanvas.getContext('2d').drawImage(orig, 0, 0, upCanvas.width, upCanvas.height);
      const srcBlob = await new Promise((resolve) => upCanvas.toBlob(resolve, 'image/png'));

      const { Client } = await import('@gradio/client');
      const connectOpts = hfToken?.trim() ? { hf_token: hfToken.trim() } : undefined;
      const client = await Client.connect('Qwen/Qwen-Image-Layered', connectOpts);

      // Dynamically resolve exact endpoint name (currently "/infer_1")
      let endpointName = '/infer_1';
      try {
        const apiInfo = await client.view_api();
        const namedKeys = Object.keys(apiInfo?.named_endpoints || {});
        if (namedKeys.length > 0) endpointName = namedKeys[0];
      } catch {
        // fallback to /infer_1
      }

      setAutoSplitProgress({
        percent: 32,
        text: `กำลังส่งภาพให้ Qwen-Image-Layered แยกเป็น ${layerCountOverride} ชั้น (ใช้เวลาประมาณ 30–60 วินาที)...`,
      });

      const inputFile = new File([srcBlob], 'input.png', { type: 'image/png' });
      const result = await client.predict(endpointName, {
        input_image: inputFile,
        seed: 0,
        randomize_seed: true,
        prompt: '',
        neg_prompt: ' ',
        true_guidance_scale: 4.0,
        num_inference_steps: 32,
        layer: Number(layerCountOverride) || 4,
        cfg_norm: true,
        use_en_prompt: true,
      });

      const gallery = Array.isArray(result?.data?.[0]) ? result.data[0] : [];
      if (gallery.length === 0) {
        throw new Error('ไม่พบข้อมูลเลเยอร์ที่ส่งกลับมาจาก Qwen-Image-Layered');
      }

      setAutoSplitProgress({
        percent: 82,
        text: `ได้รับ ${gallery.length} เลเยอร์แล้ว กำลังจัดเตรียมลง Canvas...`,
      });

      // Extract image URLs from Gradio gallery items (ordered background -> foreground)
      const layerUrls = gallery
        .map((item) => item?.image?.url || item?.url || (typeof item === 'string' ? item : null))
        .filter(Boolean);

      if (layerUrls.length === 0) {
        throw new Error('ไม่สามารถอ่าน URL ของภาพเลเยอร์ได้');
      }

      // Layer 0 = reconstructed clean background layer
      const bgLayerImg = await loadImageEl(layerUrls[0]);
      if (bgLayerImg) {
        bgCtx.clearRect(0, 0, bg.width, bg.height);
        bgCtx.drawImage(bgLayerImg, 0, 0, bg.width, bg.height);
      }

      // Layers 1..N = foreground graphics, text, logos, icons, objects
      layerCounterRef.current = 1;
      const extracted = [];
      for (let i = 1; i < layerUrls.length; i++) {
        setAutoSplitProgress({
          percent: 82 + Math.round((i / Math.max(1, layerUrls.length - 1)) * 16),
          text: `กำลังโหลดและครอปเลเยอร์ที่ ${i}/${layerUrls.length - 1}...`,
        });

        const rawImg = await loadImageEl(layerUrls[i]);
        if (!rawImg) continue;
        const cropped = tightCropRgbaLayer(rawImg, orig.width, orig.height);
        if (!cropped) continue;
        const layerImg = await loadImageEl(cropped.dataUrl);
        if (!layerImg) continue;

        const id = `layer-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
        extracted.push({
          id,
          name: `เลเยอร์ #${layerCounterRef.current++}`,
          dataUrl: cropped.dataUrl,
          img: layerImg,
          x: cropped.minX + cropped.width / 2,
          y: cropped.minY + cropped.height / 2,
          origX: cropped.minX + cropped.width / 2,
          origY: cropped.minY + cropped.height / 2,
          width: cropped.width,
          height: cropped.height,
          scale: 1,
          rotation: 0,
          flipX: false,
          opacity: 1,
          visible: true,
        });
      }

      setLayers(extracted);
      if (extracted.length > 0) {
        setSelectedLayerId(extracted[extracted.length - 1].id);
        setTool('move');
      }
    } catch (err) {
      console.error(err);
      const rawMsg = String(err?.message || '');
      if (rawMsg.toLowerCase().includes('quota') || rawMsg.toLowerCase().includes('zerogpu')) {
        setError(
          'โควตาฟรี Hugging Face ZeroGPU ชั่วคราวเต็ม แนะนำใส่ Hugging Face Token ฟรีที่เมนู "ตั้งค่า API Key" เพื่อเพิ่มโควตา หรือใช้เครื่องมือ "AI จิ้มแยกเพิ่ม" / "Lasso" แทนได้ทันที'
        );
      } else {
        setError(`แยก Layer ด้วย Qwen AI ไม่สำเร็จ: ${rawMsg || 'ลองกดใหม่อีกครั้ง หรือใช้ AI จิ้มแยกเพิ่ม / Lasso แทนได้'}`);
      }
      setTool('sam');
    } finally {
      setAutoSplitting(false);
      setAutoSplitProgress({ percent: 0, text: '' });
    }
  };

  // Load uploaded image into original & background canvases, then auto-split immediately
  const loadImageFile = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP)');
      return;
    }
    setError('');
    setSourceFile(file);
    setLayers([]);
    setSelectedLayerId(null);
    setSamPoints([]);
    setSelectionMask(null);
    setLassoPoints([]);
    setTool('move');
    setBgVisible(true);
    layerCounterRef.current = 1;
    clearSamImageCache();

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const img = new Image();
      img.onload = () => {
        // Limit extreme resolution slightly for smooth interactive editing
        const maxSide = 1800;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));

        const orig = origCanvasRef.current;
        const bg = bgCanvasRef.current;
        orig.width = w;
        orig.height = h;
        bg.width = w;
        bg.height = h;
        orig.getContext('2d').drawImage(img, 0, 0, w, h);
        bg.getContext('2d').drawImage(img, 0, 0, w, h);

        const normalizedUrl = orig.toDataURL('image/png');
        const nextKey = `${file.name}-${file.size}-${Date.now()}`;
        setSourceDataUrl(normalizedUrl);
        setImageKey(nextKey);
        setImgSize({ w, h });

        // Immediately run Qwen-Image-Layered automatic decomposition!
        runAutoSplit(nextKey, normalizedUrl, targetLayerCount);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Run SlimSAM segmentation when user clicks a point
  const runSamWithPoints = async (nextPoints) => {
    if (!sourceDataUrl || nextPoints.length === 0) {
      setSelectionMask(null);
      return;
    }
    setSamBusy(true);
    setError('');
    try {
      const res = await segmentWithSamPoints(imageKey, sourceDataUrl, nextPoints, (p) => {
        if (p?.text) setSamStatus(p.text);
        else if (p?.stage === 'download') setSamStatus(`กำลังโหลดโมเดล SlimSAM (${p.percent || 0}%)...`);
      });
      if (res) {
        setSelectionMask(res);
      }
    } catch (err) {
      console.error(err);
      setError(`SlimSAM ทำงานไม่สำเร็จ: ${err?.message || 'ลองใช้เครื่องมือ Lasso วงเลือกเองแทนได้'}`);
    } finally {
      setSamBusy(false);
      setSamStatus('');
    }
  };

  // Extract active selectionMask into an independent movable Layer (+ auto-inpaint background)
  const handleGrabSelectionAsLayer = () => {
    if (!selectionMask || !origCanvasRef.current || !bgCanvasRef.current) return;
    const { mask, width: mw, height: mh } = selectionMask;
    const orig = origCanvasRef.current;
    const W = orig.width;
    const H = orig.height;

    // Find tight bounding box
    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < H; y++) {
      const my = Math.min(mh - 1, Math.floor((y * mh) / H));
      for (let x = 0; x < W; x++) {
        const mx = Math.min(mw - 1, Math.floor((x * mw) / W));
        if (mask[my * mw + mx]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX <= minX || maxY <= minY) {
      setError('พื้นที่ที่เลือกเล็กเกินไป กรุณาจิ้มเลือกวัตถุใหม่อีกครั้ง');
      return;
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;

    // Cut object pixels from original image with clean alpha
    const origData = orig.getContext('2d', { willReadFrequently: true }).getImageData(minX, minY, bw, bh);
    const od = origData.data;
    const cutCanvas = document.createElement('canvas');
    cutCanvas.width = bw;
    cutCanvas.height = bh;
    const cutCtx = cutCanvas.getContext('2d');
    const cutImgData = cutCtx.createImageData(bw, bh);
    const cd = cutImgData.data;

    for (let y = 0; y < bh; y++) {
      const my = Math.min(mh - 1, Math.floor(((minY + y) * mh) / H));
      for (let x = 0; x < bw; x++) {
        const mx = Math.min(mw - 1, Math.floor(((minX + x) * mw) / W));
        const p = (y * bw + x) * 4;
        if (mask[my * mw + mx]) {
          cd[p] = od[p];
          cd[p + 1] = od[p + 1];
          cd[p + 2] = od[p + 2];
          cd[p + 3] = od[p + 3];
        } else {
          cd[p + 3] = 0;
        }
      }
    }
    cutCtx.putImageData(cutImgData, 0, 0);
    const layerDataUrl = cutCanvas.toDataURL('image/png');

    // Auto-inpaint background behind grabbed object so moving it leaves no hole!
    if (autoInpaintBg) {
      inpaintBackgroundRegion(bgCanvasRef.current, mask, mw, mh, 3);
    }

    const layerImg = new Image();
    layerImg.onload = () => {
      const id = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const idxNum = layerCounterRef.current++;
      const newLayer = {
        id,
        name: `ชิ้นส่วน #${idxNum}`,
        dataUrl: layerDataUrl,
        img: layerImg,
        x: minX + bw / 2,
        y: minY + bh / 2,
        origX: minX + bw / 2,
        origY: minY + bh / 2,
        width: bw,
        height: bh,
        scale: 1,
        rotation: 0,
        flipX: false,
        opacity: 1,
        visible: true,
      };
      setLayers((prev) => [...prev, newLayer]);
      setSelectedLayerId(id);
      setSelectionMask(null);
      setSamPoints([]);
      setLassoPoints([]);
      setTool('move'); // Immediately allow dragging/resizing/rotating the grabbed piece!
    };
    layerImg.src = layerDataUrl;
  };

  // Restore background canvas to original un-inpainted photo
  const handleRestoreBackground = () => {
    if (!origCanvasRef.current || !bgCanvasRef.current) return;
    const bgCtx = bgCanvasRef.current.getContext('2d');
    bgCtx.clearRect(0, 0, bgCanvasRef.current.width, bgCanvasRef.current.height);
    bgCtx.drawImage(origCanvasRef.current, 0, 0);
    redrawCanvas();
  };

  // Pointer handlers on main canvas
  const handlePointerDown = (e) => {
    if (!sourceDataUrl) return;
    const pt = getCanvasCoords(e);

    if (tool === 'sam') {
      if (samBusy) return;
      const label = e.shiftKey ? 0 : samPointMode;
      const nextPts = [...samPoints, { x: Math.round(pt.x), y: Math.round(pt.y), label }];
      setSamPoints(nextPts);
      runSamWithPoints(nextPts);
      return;
    }

    if (tool === 'lasso') {
      isDrawingLassoRef.current = true;
      lassoRef.current = [pt];
      setLassoPoints([pt]);
      setSelectionMask(null);
      return;
    }

    if (tool === 'move') {
      // First check if clicking resize or rotate handle of currently selected layer
      if (selectedLayer && selectedLayer.visible) {
        const handles = getLayerHandles(selectedLayer);
        const hitRadius = Math.max(16, imgSize.w * 0.022);
        const distResize = Math.hypot(pt.x - handles.resizeX, pt.y - handles.resizeY);
        const distRot = Math.hypot(pt.x - handles.rotX, pt.y - handles.rotY);

        if (distResize <= hitRadius) {
          dragOpRef.current = {
            type: 'scale',
            layerId: selectedLayer.id,
            origScale: selectedLayer.scale,
            startDist: Math.max(10, Math.hypot(pt.x - selectedLayer.x, pt.y - selectedLayer.y)),
          };
          return;
        }
        if (distRot <= hitRadius) {
          dragOpRef.current = {
            type: 'rotate',
            layerId: selectedLayer.id,
            origRotation: selectedLayer.rotation,
            startAngle: Math.atan2(pt.y - selectedLayer.y, pt.x - selectedLayer.x),
          };
          return;
        }
      }

      // Otherwise hit-test layers
      const hit = hitTestLayer(pt.x, pt.y);
      if (hit) {
        setSelectedLayerId(hit.id);
        dragOpRef.current = {
          type: 'move',
          layerId: hit.id,
          startX: pt.x,
          startY: pt.y,
          origX: hit.x,
          origY: hit.y,
        };
      } else {
        setSelectedLayerId(null);
      }
    }
  };

  const handlePointerMove = (e) => {
    const pt = getCanvasCoords(e);

    if (tool === 'lasso' && isDrawingLassoRef.current) {
      lassoRef.current = [...lassoRef.current, pt];
      setLassoPoints(lassoRef.current);
      return;
    }

    if (tool === 'move' && dragOpRef.current) {
      const op = dragOpRef.current;
      if (op.type === 'move') {
        const dx = pt.x - op.startX;
        const dy = pt.y - op.startY;
        setLayers((prev) =>
          prev.map((l) => (l.id === op.layerId ? { ...l, x: op.origX + dx, y: op.origY + dy } : l))
        );
      } else if (op.type === 'scale') {
        setLayers((prev) =>
          prev.map((l) => {
            if (l.id !== op.layerId) return l;
            const curDist = Math.max(10, Math.hypot(pt.x - l.x, pt.y - l.y));
            const nextScale = Math.max(0.15, Math.min(3.5, op.origScale * (curDist / op.startDist)));
            return { ...l, scale: nextScale };
          })
        );
      } else if (op.type === 'rotate') {
        setLayers((prev) =>
          prev.map((l) => {
            if (l.id !== op.layerId) return l;
            const curAngle = Math.atan2(pt.y - l.y, pt.x - l.x);
            const deltaDeg = ((curAngle - op.startAngle) * 180) / Math.PI;
            let nextRot = (op.origRotation + deltaDeg) % 360;
            if (nextRot > 180) nextRot -= 360;
            if (nextRot < -180) nextRot += 360;
            return { ...l, rotation: Math.round(nextRot) };
          })
        );
      }
    }
  };

  const handlePointerUp = () => {
    if (tool === 'lasso' && isDrawingLassoRef.current) {
      isDrawingLassoRef.current = false;
      const pts = lassoRef.current;
      if (pts.length >= 3 && imgSize.w > 0 && imgSize.h > 0) {
        const mask = rasterizePolygonMask(pts, imgSize.w, imgSize.h);
        setSelectionMask({ mask, width: imgSize.w, height: imgSize.h });
      }
      setLassoPoints([]);
    }
    dragOpRef.current = null;
  };

  // Layer list actions
  const updateLayer = (id, patch) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const moveLayerOrder = (id, delta) => {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx === -1) return prev;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const duplicateLayer = (layer) => {
    const id = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const clone = {
      ...layer,
      id,
      name: `${layer.name} (สำเนา)`,
      x: layer.x + 24,
      y: layer.y + 24,
    };
    setLayers((prev) => [...prev, clone]);
    setSelectedLayerId(id);
    setTool('move');
  };

  const deleteLayer = (id) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  // Render clean final composite canvas (no UI overlays or handles)
  const buildCompositeCanvas = () => {
    const bg = bgCanvasRef.current;
    const out = document.createElement('canvas');
    out.width = bg.width;
    out.height = bg.height;
    const ctx = out.getContext('2d');
    if (bgVisible) {
      ctx.drawImage(bg, 0, 0);
    }
    for (const l of layers) {
      if (!l.visible || !l.img) continue;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.translate(l.x, l.y);
      ctx.rotate((l.rotation * Math.PI) / 180);
      ctx.scale(l.flipX ? -l.scale : l.scale, l.scale);
      ctx.drawImage(l.img, -l.width / 2, -l.height / 2, l.width, l.height);
      ctx.restore();
    }
    return out;
  };

  const handleDownloadComposite = async () => {
    if (!bgCanvasRef.current) return;
    const out = buildCompositeCanvas();
    const baseName = (sourceFile?.name || 'image').replace(/\.[^.]+$/, '');
    out.toBlob(async (blob) => {
      if (blob) await downloadBlob(blob, `${baseName}-magic-layers.png`, 'แยกชิ้นส่วนภาพ (Magic)');
    }, 'image/png');
  };

  const handleCopyComposite = async () => {
    if (!bgCanvasRef.current) return;
    const out = buildCompositeCanvas();
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

  const handleDownloadLayerPng = async (layer) => {
    const res = await fetch(layer.dataUrl);
    const blob = await res.blob();
    const safeName = layer.name.replace(/[^\w\u0E00-\u0E7F-]+/g, '_');
    await downloadBlob(blob, `${safeName}.png`, 'แยกชิ้นส่วนภาพ (Magic)');
  };

  const handleDownloadAllZip = async () => {
    if (!bgCanvasRef.current) return;
    setExportingZip(true);
    try {
      const zip = new JSZip();
      const baseName = (sourceFile?.name || 'image').replace(/\.[^.]+$/, '');

      // Background PNG
      const bgBlob = await new Promise((resolve) => bgCanvasRef.current.toBlob(resolve, 'image/png'));
      if (bgBlob) zip.file('00-background.png', bgBlob);

      // Composite PNG
      const compCanvas = buildCompositeCanvas();
      const compBlob = await new Promise((resolve) => compCanvas.toBlob(resolve, 'image/png'));
      if (compBlob) zip.file('00-composite.png', compBlob);

      // Each extracted layer PNG
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        const res = await fetch(l.dataUrl);
        const blob = await res.blob();
        const num = String(i + 1).padStart(2, '0');
        zip.file(`${num}-layer-${i + 1}.png`, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      await downloadBlob(zipBlob, `${baseName}-layers.zip`, 'แยกชิ้นส่วนภาพ (Magic)');
    } catch (err) {
      console.error(err);
      setError('ไม่สามารถสร้างไฟล์ ZIP ได้');
    } finally {
      setExportingZip(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Hidden offscreen working canvases */}
      <canvas ref={origCanvasRef} className="hidden" />
      <canvas ref={bgCanvasRef} className="hidden" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadImageFile(f);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
            <Layers className="text-indigo-600" size={26} />
            <span>แยกชิ้นส่วนภาพ (Magic Layers)</span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            อัปโหลดรูปแล้วระบบจะแยกองค์ประกอบในภาพออกมาเป็นชิ้นๆ ให้อัตโนมัติทันที พร้อมขยับ ย่อ-ขยาย หมุน โดยเก็บพื้นหลังเดิมไว้ครบ (ออฟไลน์ 100%)
          </p>
        </div>

        {sourceDataUrl && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={autoSplitting}
              onClick={() => runAutoSplit(imageKey, sourceDataUrl, targetLayerCount)}
              className="px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-xs font-bold text-indigo-700 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Sparkles size={14} className={autoSplitting ? 'animate-spin' : ''} />
              <span>แยก Layer ใหม่ ({targetLayerCount} ชั้น)</span>
            </button>
            <button
              type="button"
              disabled={autoSplitting}
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Upload size={14} />
              <span>เปลี่ยนรูป</span>
            </button>
            <button
              type="button"
              onClick={handleCopyComposite}
              className="px-3.5 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5"
            >
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกภาพ'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadComposite}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm flex items-center gap-1.5"
            >
              <Download size={14} />
              <span>บันทึกภาพรวม (PNG)</span>
            </button>
          </div>
        )}
      </div>

      {/* Qwen-Image-Layered Settings Bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-gray-900">Qwen-Image-Layered AI</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                Hugging Face ฟรี • เหมาะกับโปสเตอร์/กราฟิก/ข้อความ
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Key size={12} className={hasHfToken ? 'text-emerald-600' : 'text-gray-400'} />
                <span>HF Token:</span>
                {hasHfToken ? (
                  <span className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold">
                    <CheckCircle2 size={11} /> มีแล้ว (ได้โควตาเพิ่ม)
                  </span>
                ) : (
                  <span className="text-gray-600 font-medium">ใช้โควตาสาธารณะฟรี</span>
                )}
              </span>
              {onOpenApiKeySettings && (
                <button
                  type="button"
                  onClick={onOpenApiKeySettings}
                  className="text-indigo-600 hover:underline font-semibold"
                >
                  {hasHfToken ? 'จัดการ' : 'ใส่ HF Token ฟรีเพื่อเพิ่มโควตา'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-600">จำนวน Layer ที่แยก:</span>
          {[3, 4, 5, 6, 8].map((n) => (
            <button
              key={n}
              type="button"
              disabled={autoSplitting}
              onClick={() => setTargetLayerCount(n)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${
                targetLayerCount === n
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {n} ชั้น
            </button>
          ))}
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Upload Dropzone */}
      {!sourceDataUrl ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer?.files?.[0];
            if (f) loadImageFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="bg-white border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-2xl p-12 text-center cursor-pointer transition-all hover:bg-gray-50/50 shadow-sm"
        >
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
            <Layers size={28} />
          </div>
          <p className="text-base font-bold text-gray-900">คลิกเลือก หรือลากรูปภาพมาวางที่นี่</p>
          <p className="text-xs text-gray-500 mt-1">
            รองรับ PNG, JPG, WebP • อัปโหลดปุ๊บ AI แยกชิ้นส่วนเป็น Layer ขยับได้ให้อัตโนมัติทันที!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Toolbar + Interactive Canvas */}
          <div className="lg:col-span-8 space-y-3">
            {/* Toolbar */}
            <div className="bg-white rounded-2xl border border-gray-200 p-3 shadow-sm flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  disabled={autoSplitting}
                  onClick={() => {
                    setTool('move');
                    setSelectionMask(null);
                    setSamPoints([]);
                    setLassoPoints([]);
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 ${
                    tool === 'move'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Move size={14} />
                  <span>ขยับ / จัดวาง ({layers.length})</span>
                </button>

                <button
                  type="button"
                  disabled={autoSplitting}
                  onClick={() => {
                    setTool('sam');
                    setLassoPoints([]);
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 ${
                    tool === 'sam'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Crosshair size={14} />
                  <span>AI จิ้มแยกเพิ่ม</span>
                </button>

                <button
                  type="button"
                  disabled={autoSplitting}
                  onClick={() => {
                    setTool('lasso');
                    setSamPoints([]);
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 ${
                    tool === 'lasso'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <Lasso size={14} />
                  <span>วงเลือกเอง (Lasso)</span>
                </button>
              </div>

              {/* Grab Action CTA */}
              {selectionMask && (tool === 'sam' || tool === 'lasso') && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionMask(null);
                      setSamPoints([]);
                    }}
                    className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold"
                  >
                    ล้างที่เลือก
                  </button>
                  <button
                    type="button"
                    onClick={handleGrabSelectionAsLayer}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm flex items-center gap-1.5 animate-pulse"
                  >
                    <Scissors size={14} />
                    <span>แยกชิ้นเป็น Layer (Magic Grab)</span>
                  </button>
                </div>
              )}
            </div>

            {/* Sub-bar for SAM point mode & Inpaint toggle */}
            <div className="bg-white rounded-xl border border-gray-200 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              {tool === 'sam' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-600">โหมดจิ้ม:</span>
                  <button
                    type="button"
                    onClick={() => setSamPointMode(1)}
                    className={`px-2.5 py-1 rounded-lg font-semibold ${
                      samPointMode === 1 ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-400' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    + เพิ่มพื้นที่
                  </button>
                  <button
                    type="button"
                    onClick={() => setSamPointMode(0)}
                    className={`px-2.5 py-1 rounded-lg font-semibold ${
                      samPointMode === 0 ? 'bg-red-100 text-red-700 ring-1 ring-red-400' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    - หักพื้นที่ออก
                  </button>
                  {samBusy && (
                    <span className="inline-flex items-center gap-1.5 text-indigo-600 font-semibold">
                      <RefreshCw size={12} className="animate-spin" />
                      {samStatus || 'กำลังประมวลผล SlimSAM...'}
                    </span>
                  )}
                </div>
              ) : tool === 'lasso' ? (
                <span className="text-gray-600">ลากเมาส์วงรอบองค์ประกอบที่ต้องการแยก แล้วกดปุ่ม &ldquo;แยกชิ้นเป็น Layer&rdquo;</span>
              ) : (
                <span className="text-gray-600">คลิกที่ชิ้นส่วนเพื่อลากขยับ • ลากจุดน้ำเงินมุมล่างขวาเพื่อย่อ-ขยาย • ลากจุดบนเพื่อหมุน</span>
              )}

              <label className="inline-flex items-center gap-1.5 text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoInpaintBg}
                  onChange={(e) => setAutoInpaintBg(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                <span className="font-medium">เติมพื้นหลังตรงรูโบ๋อัตโนมัติ</span>
              </label>
            </div>

            {/* Main Interactive Canvas */}
            <div
              className="relative bg-gray-100 rounded-2xl border border-gray-200 overflow-hidden flex items-center justify-center p-3 min-h-[420px]"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
              }}
            >
              <canvas
                ref={displayCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                className={`max-w-full max-h-[620px] w-auto h-auto rounded-lg shadow-md touch-none select-none ${
                  tool === 'move' ? 'cursor-move' : 'cursor-crosshair'
                }`}
              />

              {/* Auto-Splitting Progress Overlay */}
              {autoSplitting && (
                <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px] flex items-center justify-center p-4 z-10">
                  <div className="bg-white rounded-2xl p-5 shadow-2xl border border-gray-200 w-full max-w-sm space-y-3 text-center">
                    <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                      <RefreshCw size={22} className="animate-spin" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">กำลังแยกองค์ประกอบอัตโนมัติ...</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {autoSplitProgress.text || 'กำลังประมวลผลด้วย SlimSAM AI'}
                      </p>
                    </div>
                    <div className="w-full h-2 rounded-full bg-indigo-100 overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 transition-all duration-200"
                        style={{ width: `${Math.max(6, autoSplitProgress.percent)}%` }}
                      />
                    </div>
                    <p className="text-[11px] font-mono text-indigo-600 font-bold">
                      {autoSplitProgress.percent}%
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Layers Panel & Transform Controls */}
          <div className="lg:col-span-4 space-y-4">
            {/* Selected Layer Properties */}
            {selectedLayer && (
              <div className="bg-white rounded-2xl border border-indigo-200 p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-indigo-700 flex items-center gap-1.5">
                    <Sparkles size={14} />
                    <span>ปรับแต่ง: {selectedLayer.name}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updateLayer(selectedLayer.id, { flipX: !selectedLayer.flipX })}
                      title="กลับด้านซ้าย-ขวา"
                      className="p-1.5 rounded-lg bg-gray-100 hover:bg-indigo-50 text-gray-700"
                    >
                      <FlipHorizontal size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateLayer(selectedLayer.id, {
                          x: selectedLayer.origX,
                          y: selectedLayer.origY,
                          scale: 1,
                          rotation: 0,
                          flipX: false,
                          opacity: 1,
                        })
                      }
                      title="รีเซ็ตตำแหน่งเดิม"
                      className="p-1.5 rounded-lg bg-gray-100 hover:bg-indigo-50 text-gray-700"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-600 font-medium">ขนาด (Scale)</span>
                      <span className="font-mono font-bold text-gray-800">{Math.round(selectedLayer.scale * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max="2.5"
                      step="0.02"
                      value={selectedLayer.scale}
                      onChange={(e) => updateLayer(selectedLayer.id, { scale: Number(e.target.value) })}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-600 font-medium flex items-center gap-1">
                        <RotateCw size={12} /> หมุน (Rotation)
                      </span>
                      <span className="font-mono font-bold text-gray-800">{selectedLayer.rotation}°</span>
                    </div>
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      step="1"
                      value={selectedLayer.rotation}
                      onChange={(e) => updateLayer(selectedLayer.id, { rotation: Number(e.target.value) })}
                      className="w-full accent-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-600 font-medium">ความทึบ (Opacity)</span>
                      <span className="font-mono font-bold text-gray-800">{Math.round(selectedLayer.opacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={selectedLayer.opacity}
                      onChange={(e) => updateLayer(selectedLayer.id, { opacity: Number(e.target.value) })}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Layers Stack Card */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                  <Layers size={16} className="text-indigo-600" />
                  <span>เลเยอร์ทั้งหมด ({layers.length + 1})</span>
                </h3>
                {layers.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadAllZip}
                    disabled={exportingZip}
                    className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold flex items-center gap-1"
                  >
                    <FileArchive size={12} />
                    <span>{exportingZip ? 'กำลังบีบอัด...' : 'โหลดแยกชิ้น (ZIP)'}</span>
                  </button>
                )}
              </div>

              {/* Extracted Layers (topmost first) */}
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {layers.length === 0 ? (
                  <div className="p-4 rounded-xl bg-gray-50 border border-dashed border-gray-200 text-center text-xs text-gray-500">
                    ยังไม่มีชิ้นส่วนที่แยกออกมา<br />
                    จิ้มที่วัตถุบนภาพแล้วกด <strong>&ldquo;แยกชิ้นเป็น Layer&rdquo;</strong>
                  </div>
                ) : (
                  [...layers].reverse().map((l, revIdx) => {
                    const actualIdx = layers.length - 1 - revIdx;
                    const isSel = l.id === selectedLayerId;
                    return (
                      <div
                        key={l.id}
                        onClick={() => {
                          setSelectedLayerId(l.id);
                          setTool('move');
                        }}
                        className={`p-2 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${
                          isSel
                            ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-400'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="w-11 h-11 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                          <img src={l.dataUrl} alt={l.name} className="max-w-full max-h-full object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            value={l.name}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateLayer(l.id, { name: e.target.value })}
                            className="w-full text-xs font-bold text-gray-900 bg-transparent border-b border-transparent focus:border-indigo-400 outline-none truncate"
                          />
                          <p className="text-[10px] text-gray-500">
                            {l.width}×{l.height}px • {Math.round(l.scale * 100)}%
                          </p>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => moveLayerOrder(l.id, 1)}
                            disabled={actualIdx === layers.length - 1}
                            title="เลื่อนขึ้นชั้นบน"
                            className="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-25"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveLayerOrder(l.id, -1)}
                            disabled={actualIdx === 0}
                            title="เลื่อนลงชั้นล่าง"
                            className="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-25"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateLayer(l.id, { visible: !l.visible })}
                            title={l.visible ? 'ซ่อน' : 'แสดง'}
                            className="p-1 text-gray-400 hover:text-gray-700"
                          >
                            {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateLayer(l)}
                            title="ทำซ้ำชิ้นนี้"
                            className="p-1 text-gray-400 hover:text-indigo-600"
                          >
                            <Plus size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadLayerPng(l)}
                            title="ดาวน์โหลดเฉพาะชิ้นนี้ (PNG)"
                            className="p-1 text-gray-400 hover:text-emerald-600"
                          >
                            <Download size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteLayer(l.id)}
                            title="ลบชิ้นนี้"
                            className="p-1 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Locked Background Layer at bottom */}
                <div className="p-2.5 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-gray-200 overflow-hidden shrink-0">
                      <img src={sourceDataUrl} alt="Background" className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">พื้นหลังเดิม (Background)</p>
                      <p className="text-[10px] text-gray-500">
                        {imgSize.w}×{imgSize.h}px
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={handleRestoreBackground}
                      title="คืนค่าพื้นหลังเดิมก่อนเติมรูโบ๋"
                      className="p-1.5 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-white"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setBgVisible((v) => !v)}
                      title={bgVisible ? 'ซ่อนพื้นหลัง' : 'แสดงพื้นหลัง'}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-white"
                    >
                      {bgVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
