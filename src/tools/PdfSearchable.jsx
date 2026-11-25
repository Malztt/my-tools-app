import React, { useState, useRef, useMemo } from 'react';
import {
  PDFDocument,
  PDFContentStream,
  rgb,
  degrees,
  TextRenderingMode,
  setTextRenderingMode,
  pushGraphicsState,
  popGraphicsState,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist';
import {
  FileSearch,
  Upload,
  Sparkles,
  Cpu,
  Check,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  FileText,
  Search,
  Copy,
  Square,
  ChevronLeft,
  ChevronRight,
  Layers,
  Edit3,
  Trash2,
} from 'lucide-react';
import { downloadBlob } from '../downloadManager';

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2)} ${sizes[i]}`;
};

// Parse page range expression like "1-3, 5, 8-10" into 1-based page number Set
const parsePageRange = (rangeStr, totalPages) => {
  const result = new Set();
  if (!rangeStr || !rangeStr.trim()) return result;
  const parts = rangeStr.split(',');
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map((s) => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        const lo = Math.max(1, Math.min(start, end));
        const hi = Math.min(totalPages, Math.max(start, end));
        for (let p = lo; p <= hi; p++) result.add(p);
      }
    } else {
      const num = parseInt(part, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= totalPages) {
        result.add(num);
      }
    }
  }
  return result;
};

// Sanitize text so fontkit/pdf-lib won't crash on unsupported glyphs (e.g. emojis)
const sanitizeTextForFont = (text, font) => {
  const base = String(text || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!base) return '';
  try {
    font.encodeText(base);
    return base;
  } catch {
    // Filter character-by-character keeping only glyphs supported by the embedded font
    let safe = '';
    for (const ch of Array.from(base)) {
      try {
        font.encodeText(ch);
        safe += ch;
      } catch {
        // skip unsupported glyph
      }
    }
    return safe.trim();
  }
};

// Draw a line of text at normalized visual coordinates (nx, ny, nw, nh) respecting PDF page rotation & CropBox
const drawNormalizedLine = (page, font, line, visibleDebug = false) => {
  const safeText = sanitizeTextForFont(line.text, font);
  if (!safeText) return;

  const cb = page.getCropBox();
  const cx = cb.x || 0;
  const cy = cb.y || 0;
  const cw = cb.width;
  const ch = cb.height;
  const rot = (((page.getRotation()?.angle || 0) % 360) + 360) % 360;

  let pdfX = 0;
  let pdfY = 0;
  let boxW = 0;
  let boxH = 0;
  let textRot = degrees(0);

  if (rot === 90) {
    boxW = line.nw * ch;
    boxH = line.nh * cw;
    pdfX = cx + (line.ny + line.nh) * cw - boxH * 0.15;
    pdfY = cy + line.nx * ch;
    textRot = degrees(90);
  } else if (rot === 180) {
    boxW = line.nw * cw;
    boxH = line.nh * ch;
    pdfX = cx + (1 - line.nx) * cw;
    pdfY = cy + (line.ny + line.nh) * ch - boxH * 0.15;
    textRot = degrees(180);
  } else if (rot === 270) {
    boxW = line.nw * ch;
    boxH = line.nh * cw;
    pdfX = cx + (1 - (line.ny + line.nh)) * cw + boxH * 0.15;
    pdfY = cy + (1 - line.nx) * ch;
    textRot = degrees(270);
  } else {
    boxW = line.nw * cw;
    boxH = line.nh * ch;
    pdfX = cx + line.nx * cw;
    pdfY = cy + (1 - (line.ny + line.nh)) * ch + boxH * 0.15;
    textRot = degrees(0);
  }

  let fontSize = Math.max(4, Math.min(72, boxH * 0.85));
  try {
    const measuredW = font.widthOfTextAtSize(safeText, fontSize);
    if (measuredW > boxW * 1.05 && boxW > 4) {
      fontSize = Math.max(4, fontSize * (boxW / measuredW));
    }
  } catch {
    // ignore width measurement error
  }

  if (visibleDebug) {
    page.drawText(safeText, {
      x: pdfX,
      y: pdfY,
      size: fontSize,
      font,
      color: rgb(0.15, 0.35, 0.9),
      opacity: 0.35,
      rotate: textRot,
    });
  } else {
    // Official PDF OCR standard: Text Rendering Mode 3 (Invisible) for reliable Ctrl+F & Copy/Paste in all viewers
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
    page.drawText(safeText, {
      x: pdfX,
      y: pdfY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
      rotate: textRot,
    });
    page.pushOperators(popGraphicsState());
  }
};

export default function PdfSearchable() {
  // Offline Tesseract OCR Language State
  const [tessLang, setTessLang] = useState('tha+eng'); // 'tha+eng' | 'tha' | 'eng'

  // File & Page Analysis State
  const [file, setFile] = useState(null);
  const [pdfBuffer, setPdfBuffer] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [pages, setPages] = useState([]);
  // page item: { pageNum, thumbUrl, existingTextLen, existingText, ocrLines: [] | null, ocrStatus: 'idle'|'running'|'done'|'skipped'|'error', ocrError: '' }

  // Processing Options
  const [pageScope, setPageScope] = useState('missing_only'); // 'missing_only' | 'all' | 'custom'
  const [customRange, setCustomRange] = useState('');
  const [renderScale, setRenderScale] = useState(2.0); // 1.5 (fast) | 2.0 (balanced) | 2.5 (high)
  const [visibleDebugLayer, setVisibleDebugLayer] = useState(false);

  // Run State
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const cancelRef = useRef(false);

  // Preview, Search Test & Inspector State
  const [selectedPageIdx, setSelectedPageIdx] = useState(0);
  const [showOverlayBoxes, setShowOverlayBoxes] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);

  const fileInputRef = useRef(null);

  // Load & analyze PDF pages
  const loadPdfFile = async (selectedFile) => {
    if (!selectedFile) return;
    if (selectedFile.type !== 'application/pdf' && !selectedFile.name.toLowerCase().endsWith('.pdf')) {
      setError('กรุณาเลือกไฟล์นามสกุล .pdf เท่านั้น');
      return;
    }

    setError('');
    setSuccessMsg('');
    setAnalyzing(true);
    setFile(selectedFile);
    setPages([]);
    setSelectedPageIdx(0);
    setSearchQuery('');

    try {
      const arrayBuf = await selectedFile.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuf);
      setPdfBuffer(uint8);

      const loadingTask = pdfjs.getDocument({ data: uint8.slice(0) });
      const pdf = await loadingTask.promise;
      const total = pdf.numPages;

      const analyzed = [];
      for (let i = 1; i <= total; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const existingText = textContent.items
          .map((item) => item.str || '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Render thumbnail
        const vp = page.getViewport({ scale: 0.45 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const thumbUrl = canvas.toDataURL('image/jpeg', 0.8);

        analyzed.push({
          pageNum: i,
          thumbUrl,
          existingTextLen: existingText.length,
          existingText,
          ocrLines: null,
          ocrStatus: 'idle',
          ocrError: '',
        });
      }

      setPages(analyzed);
      setCustomRange(`1-${total}`);

      // Default to 'all' if every page already has text, otherwise 'missing_only'
      const scannedCount = analyzed.filter((p) => p.existingTextLen < 15).length;
      setPageScope(scannedCount > 0 ? 'missing_only' : 'all');
    } catch (err) {
      console.error(err);
      setError(`ไม่สามารถอ่านไฟล์ PDF ได้: ${err?.message || 'ไฟล์อาจเสียหายหรือติดรหัสผ่าน'}`);
      setFile(null);
      setPdfBuffer(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileInputChange = (e) => {
    const f = e.target.files?.[0];
    if (f) loadPdfFile(f);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) loadPdfFile(f);
  };

  // Determine which 1-based page numbers are targeted for OCR
  const targetPageSet = useMemo(() => {
    if (!pages.length) return new Set();
    if (pageScope === 'all') {
      return new Set(pages.map((p) => p.pageNum));
    }
    if (pageScope === 'missing_only') {
      return new Set(pages.filter((p) => p.existingTextLen < 15).map((p) => p.pageNum));
    }
    return parsePageRange(customRange, pages.length);
  }, [pages, pageScope, customRange]);

  const scannedPagesCount = useMemo(
    () => pages.filter((p) => p.existingTextLen < 15).length,
    [pages]
  );

  const ocrCompletedCount = useMemo(
    () => pages.filter((p) => p.ocrStatus === 'done').length,
    [pages]
  );

  // Render a single PDF page to JPEG DataURL at high resolution for OCR
  const renderPageForOcr = async (pdfDocJs, pageNum, scale) => {
    const page = await pdfDocJs.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      width: canvas.width,
      height: canvas.height,
    };
  };

  // Run Tesseract OCR on a single page image using a shared worker
  const ocrPageWithTesseract = async (worker, dataUrl, imgW, imgH) => {
    const result = await worker.recognize(dataUrl, {}, { blocks: true });
    const lines = [];
    const blocks = result?.data?.blocks || [];

    for (const block of blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const text = String(line.text || '').replace(/\s+/g, ' ').trim();
          const b = line.bbox;
          if (!text || !b) continue;
          const nx = Math.max(0, Math.min(1, b.x0 / imgW));
          const ny = Math.max(0, Math.min(1, b.y0 / imgH));
          const nx2 = Math.max(nx + 0.005, Math.min(1, b.x1 / imgW));
          const ny2 = Math.max(ny + 0.005, Math.min(1, b.y1 / imgH));
          lines.push({
            text,
            nx,
            ny,
            nw: nx2 - nx,
            nh: ny2 - ny,
          });
        }
      }
    }

    // Fallback if blocks weren't populated
    if (lines.length === 0 && result?.data?.text?.trim()) {
      const rawLines = result.data.text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const step = 0.86 / Math.max(1, rawLines.length);
      rawLines.forEach((txt, idx) => {
        lines.push({
          text: txt,
          nx: 0.06,
          ny: 0.06 + idx * step,
          nw: 0.88,
          nh: Math.min(0.035, step * 0.85),
        });
      });
    }

    return lines;
  };

  // Main OCR Processing Loop (Offline Tesseract)
  const handleStartOcr = async () => {
    if (!pdfBuffer || pages.length === 0) {
      setError('กรุณาเลือกไฟล์ PDF ก่อน');
      return;
    }
    if (targetPageSet.size === 0) {
      setError('ไม่มีหน้าใดที่ถูกเลือกสำหรับทำ OCR กรุณาเปลี่ยนขอบเขตหน้า');
      return;
    }

    cancelRef.current = false;
    setIsProcessing(true);
    setError('');
    setSuccessMsg('');
    setProgressPct(0);

    let tessWorker = null;

    try {
      const pdfDocJs = await pdfjs.getDocument({ data: pdfBuffer.slice(0) }).promise;

      setProgressMsg(`กำลังโหลดโมเดลภาษาออฟไลน์ (${tessLang}) ครั้งแรกอาจใช้เวลาสักครู่...`);
      const Tesseract = await import('tesseract.js');
      tessWorker = await Tesseract.createWorker(tessLang, 1, {
        logger: (m) => {
          if (m.status === 'loading language traineddata' || m.status === 'initializing api') {
            setProgressMsg(`กำลังเตรียม Tesseract (${Math.round((m.progress || 0) * 100)}%)...`);
          }
        },
      });

      const targetList = Array.from(targetPageSet).sort((a, b) => a - b);
      let completed = 0;

      // Mark skipped pages upfront
      setPages((prev) =>
        prev.map((p) =>
          targetPageSet.has(p.pageNum)
            ? { ...p, ocrStatus: 'idle', ocrError: '' }
            : { ...p, ocrStatus: 'skipped', ocrError: '' }
        )
      );

      for (const pageNum of targetList) {
        if (cancelRef.current) break;

        setPages((prev) =>
          prev.map((p) => (p.pageNum === pageNum ? { ...p, ocrStatus: 'running', ocrError: '' } : p))
        );
        setProgressMsg(`กำลังอ่านข้อความหน้า ${pageNum} / ${pages.length} (${completed + 1} จาก ${targetList.length} หน้า)...`);

        try {
          const rendered = await renderPageForOcr(pdfDocJs, pageNum, renderScale);
          const detectedLines = await ocrPageWithTesseract(
            tessWorker,
            rendered.dataUrl,
            rendered.width,
            rendered.height
          );

          setPages((prev) =>
            prev.map((p) =>
              p.pageNum === pageNum
                ? { ...p, ocrLines: detectedLines, ocrStatus: 'done', ocrError: '' }
                : p
            )
          );
        } catch (pageErr) {
          console.error(`OCR failed on page ${pageNum}:`, pageErr);
          setPages((prev) =>
            prev.map((p) =>
              p.pageNum === pageNum
                ? { ...p, ocrStatus: 'error', ocrError: pageErr?.message || 'อ่านข้อความไม่สำเร็จ' }
                : p
            )
          );
        }

        completed += 1;
        setProgressPct(Math.round((completed / targetList.length) * 100));
      }

      if (cancelRef.current) {
        setSuccessMsg(`หยุดการทำงานแล้ว (ทำ OCR สำเร็จ ${completed} หน้า — ยังสามารถบันทึกผลลัพธ์ที่มีได้)`);
      } else {
        setSuccessMsg(`ทำ OCR ครบ ${targetList.length} หน้าเรียบร้อย! สามารถตรวจสอบ/แก้ไขข้อความและกดดาวน์โหลด Searchable PDF ได้ทันที`);
      }
    } catch (err) {
      console.error(err);
      setError(`เกิดข้อผิดพลาดระหว่างทำ OCR: ${err?.message || 'ไม่ทราบสาเหตุ'}`);
    } finally {
      if (tessWorker) {
        try {
          await tessWorker.terminate();
        } catch {
          // ignore
        }
      }
      setIsProcessing(false);
      setProgressMsg('');
    }
  };

  const handleStopOcr = () => {
    cancelRef.current = true;
    setProgressMsg('กำลังหยุดหลังจบหน้าปัจจุบัน...');
  };

  // Edit a detected OCR line text manually
  const handleEditLineText = (pageNum, lineIdx, nextText) => {
    setPages((prev) =>
      prev.map((p) => {
        if (p.pageNum !== pageNum || !p.ocrLines) return p;
        const nextLines = p.ocrLines.map((l, idx) => (idx === lineIdx ? { ...l, text: nextText } : l));
        return { ...p, ocrLines: nextLines };
      })
    );
  };

  const handleDeleteLine = (pageNum, lineIdx) => {
    setPages((prev) =>
      prev.map((p) => {
        if (p.pageNum !== pageNum || !p.ocrLines) return p;
        return { ...p, ocrLines: p.ocrLines.filter((_, idx) => idx !== lineIdx) };
      })
    );
  };

  // Export Searchable PDF with invisible Thai/English text layer
  const handleExportSearchablePdf = async () => {
    if (!pdfBuffer || !file) return;
    const hasAnyOcr = pages.some((p) => p.ocrLines && p.ocrLines.length > 0);
    if (!hasAnyOcr) {
      setError('ยังไม่มีข้อความจากการทำ OCR ให้ฝังลงไฟล์ กรุณากดเริ่มทำ OCR ก่อน');
      return;
    }

    setIsExporting(true);
    setError('');

    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer.slice(0), { ignoreEncryption: true });
      pdfDoc.registerFontkit(fontkit);

      const fontRes = await fetch('./THSarabunPSK.ttf');
      if (!fontRes.ok) throw new Error('ไม่พบไฟล์ฟอนต์ภาษาไทย THSarabunPSK.ttf');
      const fontBytes = await fontRes.arrayBuffer();
      const customFont = await pdfDoc.embedFont(fontBytes);

      const docPages = pdfDoc.getPages();
      for (const pageData of pages) {
        if (!pageData.ocrLines || pageData.ocrLines.length === 0) continue;
        const pdfPage = docPages[pageData.pageNum - 1];
        if (!pdfPage) continue;

        // Isolate existing page graphics state (CTM / clip paths from scanners) so OCR text aligns & stays selectable
        try {
          const startStream = pdfDoc.context.register(
            PDFContentStream.of(pdfDoc.context.obj({}), [pushGraphicsState()])
          );
          const endStream = pdfDoc.context.register(
            PDFContentStream.of(pdfDoc.context.obj({}), [popGraphicsState()])
          );
          pdfPage.node.wrapContentStreams(startStream, endStream);
        } catch {
          // ignore if page has no existing content streams
        }

        for (const line of pageData.ocrLines) {
          if (!line.text || !line.text.trim()) continue;
          drawNormalizedLine(pdfPage, customFont, line, visibleDebugLayer);
        }
      }

      const outBytes = await pdfDoc.save();
      const blob = new Blob([outBytes], { type: 'application/pdf' });
      const baseName = file.name.replace(/\.pdf$/i, '');
      await downloadBlob(blob, `${baseName}-searchable.pdf`, 'ทำ PDF ค้นหาได้ (OCR)');
      setSuccessMsg(`บันทึกไฟล์ ${baseName}-searchable.pdf เรียบร้อยแล้ว! ลองเปิดแล้วกด Ctrl+F ค้นหาข้อความได้เลย`);
    } catch (err) {
      console.error(err);
      setError(`สร้างไฟล์ Searchable PDF ไม่สำเร็จ: ${err?.message || 'เกิดข้อผิดพลาด'}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Copy / Download extracted text across all pages
  const combinedExtractedText = useMemo(() => {
    return pages
      .map((p) => {
        const pageTxt =
          p.ocrLines && p.ocrLines.length > 0
            ? p.ocrLines.map((l) => l.text).join('\n')
            : p.existingText || '';
        if (!pageTxt.trim()) return '';
        return `--- หน้า ${p.pageNum} ---\n${pageTxt}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }, [pages]);

  const handleCopyAllText = async () => {
    if (!combinedExtractedText) return;
    try {
      await navigator.clipboard.writeText(combinedExtractedText);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleDownloadTxt = async () => {
    if (!combinedExtractedText || !file) return;
    const blob = new Blob([combinedExtractedText], { type: 'text/plain;charset=utf-8' });
    const baseName = file.name.replace(/\.pdf$/i, '');
    await downloadBlob(blob, `${baseName}-ocr.txt`, 'ทำ PDF ค้นหาได้ (OCR)');
  };

  // Live Search across all pages (both OCR lines & existing text)
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = [];
    for (const p of pages) {
      if (p.ocrLines && p.ocrLines.length > 0) {
        const hitLines = p.ocrLines.filter((l) => l.text.toLowerCase().includes(q));
        if (hitLines.length > 0) {
          matches.push({ pageNum: p.pageNum, count: hitLines.length, sample: hitLines[0].text });
        }
      } else if (p.existingText && p.existingText.toLowerCase().includes(q)) {
        matches.push({ pageNum: p.pageNum, count: 1, sample: p.existingText.slice(0, 90) });
      }
    }
    return matches;
  }, [pages, searchQuery]);

  const activePage = pages[selectedPageIdx] || null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
            <FileSearch className="text-indigo-600" size={26} />
            <span>ทำ PDF ค้นหาข้อความได้ (Searchable PDF)</span>
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            แปลงไฟล์ PDF สแกน/รูปภาพ ให้สามารถกด Ctrl+F ค้นหา ลากคลุม และคัดลอกข้อความภาษาไทย-อังกฤษได้ โดยคงหน้าตาต้นฉบับ 100%
          </p>
        </div>

        {pages.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="px-3.5 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              <Upload size={14} />
              <span>เปลี่ยนไฟล์</span>
            </button>
          </div>
        )}
      </div>

      {/* Offline Tesseract OCR Bar */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <Cpu size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900">Tesseract OCR (ออฟไลน์ 100%)</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                ไม่จำกัดโควตา • ไม่ใช้ API Key
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              ประมวลผลในเครื่องทั้งหมด ปลอดภัย ไฟล์ไม่ออกนอกเครื่อง
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-600">ภาษา:</span>
          {[
            { id: 'tha+eng', label: 'ไทย + อังกฤษ' },
            { id: 'tha', label: 'ภาษาไทย' },
            { id: 'eng', label: 'ภาษาอังกฤษ' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={isProcessing}
              onClick={() => setTessLang(opt.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tessLang === opt.id
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Upload Dropzone (when no file loaded yet) */}
      {!file && !analyzing && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="bg-white border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-2xl p-10 text-center cursor-pointer transition-all hover:bg-gray-50/50 shadow-sm"
        >
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
            <Upload size={28} />
          </div>
          <p className="text-base font-bold text-gray-900">คลิกเลือก หรือลากไฟล์ PDF มาวางที่นี่</p>
          <p className="text-xs text-gray-500 mt-1">
            ระบบจะตรวจสอบให้อัตโนมัติว่าหน้าไหนเป็นภาพสแกนที่ยังค้นหาข้อความไม่ได้
          </p>
        </div>
      )}

      {/* Analyzing Loader */}
      {analyzing && (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
          <RefreshCw size={28} className="animate-spin text-indigo-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-800">กำลังวิเคราะห์โครงสร้างและสร้างตัวอย่างหน้า PDF...</p>
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Workspace when PDF is loaded */}
      {file && pages.length > 0 && !analyzing && (
        <div className="space-y-5">
          {/* File Summary & OCR Controls */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <FileText size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {formatBytes(file.size)} • ทั้งหมด {pages.length} หน้า •{' '}
                    <span className={scannedPagesCount > 0 ? 'text-amber-600 font-semibold' : 'text-emerald-600 font-semibold'}>
                      {scannedPagesCount > 0
                        ? `พบ ${scannedPagesCount} หน้าที่ยังไม่มีข้อความ (สแกน)`
                        : 'ทุกหน้ามีข้อความอยู่แล้ว'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!isProcessing ? (
                  <button
                    type="button"
                    onClick={handleStartOcr}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-sm flex items-center gap-2 transition-all"
                  >
                    <Sparkles size={16} />
                    <span>เริ่มทำ OCR ({targetPageSet.size} หน้า)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStopOcr}
                    className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-sm flex items-center gap-2 transition-all"
                  >
                    <Square size={14} />
                    <span>หยุด</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleExportSearchablePdf}
                  disabled={isProcessing || isExporting || ocrCompletedCount === 0}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm flex items-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isExporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                  <span>ดาวน์โหลด Searchable PDF</span>
                </button>
              </div>
            </div>

            {/* Settings Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">ขอบเขตหน้าที่ทำ OCR</label>
                <select
                  value={pageScope}
                  onChange={(e) => setPageScope(e.target.value)}
                  disabled={isProcessing}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-medium"
                >
                  <option value="missing_only">เฉพาะหน้าที่ยังไม่มีข้อความ ({scannedPagesCount} หน้า)</option>
                  <option value="all">ทุกหน้าใหม่ทั้งหมด ({pages.length} หน้า)</option>
                  <option value="custom">ระบุช่วงหน้าเอง (เช่น 1-3, 5)</option>
                </select>
                {pageScope === 'custom' && (
                  <input
                    type="text"
                    value={customRange}
                    onChange={(e) => setCustomRange(e.target.value)}
                    disabled={isProcessing}
                    placeholder="เช่น 1-3, 5, 8"
                    className="mt-2 w-full px-3 py-1.5 rounded-lg border border-gray-200 text-xs"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">ความละเอียดภาพก่อน OCR</label>
                <select
                  value={renderScale}
                  onChange={(e) => setRenderScale(Number(e.target.value))}
                  disabled={isProcessing}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-medium"
                >
                  <option value={1.5}>เร็ว (1.5x — เหมาะกับตัวอักษรใหญ่)</option>
                  <option value={2.0}>สมดุล (2.0x — แนะนำ)</option>
                  <option value={2.5}>คมชัดสูง (2.5x — เหมาะกับตัวหนังสือเล็กมาก)</option>
                </select>
              </div>

              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer bg-gray-50 px-3 py-2.5 rounded-xl border border-gray-200">
                  <input
                    type="checkbox"
                    checked={visibleDebugLayer}
                    onChange={(e) => setVisibleDebugLayer(e.target.checked)}
                    disabled={isProcessing}
                    className="rounded text-indigo-600"
                  />
                  <span>โหมดตรวจสอบ (แสดงตัวอักษรจางๆ ทับภาพ)</span>
                </label>
              </div>
            </div>

            {/* Progress Bar */}
            {isProcessing && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs font-semibold text-indigo-700">
                  <span className="flex items-center gap-1.5">
                    <RefreshCw size={13} className="animate-spin" />
                    {progressMsg || 'กำลังประมวลผล...'}
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-indigo-100 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Live Search Tester Bar */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ทดลองพิมพ์คำค้นหาในเอกสาร PDF นี้ (เช่น ชื่อ, เลขที่เอกสาร, คำภาษาไทย)..."
                  className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyAllText}
                  disabled={!combinedExtractedText}
                  className="px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5 disabled:opacity-40"
                >
                  {copiedAll ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span>{copiedAll ? 'คัดลอกแล้ว' : 'คัดลอกข้อความทั้งหมด'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadTxt}
                  disabled={!combinedExtractedText}
                  className="px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5 disabled:opacity-40"
                >
                  <FileText size={14} />
                  <span>บันทึก .TXT</span>
                </button>
              </div>
            </div>

            {searchQuery.trim() && (
              <div className="text-xs">
                {searchMatches.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-emerald-700">
                      พบคำว่า &ldquo;{searchQuery.trim()}&rdquo; ใน {searchMatches.length} หน้า:
                    </span>
                    {searchMatches.map((m) => (
                      <button
                        key={m.pageNum}
                        type="button"
                        onClick={() => setSelectedPageIdx(m.pageNum - 1)}
                        className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                          selectedPageIdx === m.pageNum - 1
                            ? 'bg-indigo-600 text-white'
                            : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        }`}
                      >
                        หน้า {m.pageNum} ({m.count})
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-500">ไม่พบคำว่า &ldquo;{searchQuery.trim()}&rdquo; ในข้อความที่อ่านได้ขณะนี้</span>
                )}
              </div>
            )}
          </div>

          {/* Two-column Inspector: Page Preview with Overlay + Editable OCR Lines */}
          {activePage && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left: Page List + Visual Preview */}
              <div className="lg:col-span-6 bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedPageIdx((i) => Math.max(0, i - 1))}
                      disabled={selectedPageIdx === 0}
                      className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span className="text-xs font-bold text-gray-800 px-2">
                      หน้า {activePage.pageNum} / {pages.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedPageIdx((i) => Math.min(pages.length - 1, i + 1))}
                      disabled={selectedPageIdx === pages.length - 1}
                      className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowOverlayBoxes((v) => !v)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      showOverlayBoxes
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <Layers size={13} />
                    <span>{showOverlayBoxes ? 'ซ่อนกรอบ OCR' : 'แสดงกรอบ OCR'}</span>
                  </button>
                </div>

                {/* Page Canvas + Bounding Box Overlay */}
                <div className="relative bg-gray-100 rounded-xl overflow-hidden border border-gray-200 flex items-center justify-center min-h-[340px]">
                  <div className="relative inline-block max-w-full">
                    <img
                      src={activePage.thumbUrl}
                      alt={`Page ${activePage.pageNum}`}
                      className="max-h-[480px] w-auto block select-none"
                    />
                    {showOverlayBoxes && activePage.ocrLines && activePage.ocrLines.length > 0 && (
                      <div className="absolute inset-0 pointer-events-none">
                        {activePage.ocrLines.map((line, idx) => {
                          const isMatch =
                            searchQuery.trim() &&
                            line.text.toLowerCase().includes(searchQuery.trim().toLowerCase());
                          return (
                            <div
                              key={idx}
                              title={line.text}
                              style={{
                                left: `${line.nx * 100}%`,
                                top: `${line.ny * 100}%`,
                                width: `${line.nw * 100}%`,
                                height: `${line.nh * 100}%`,
                              }}
                              className={`absolute border transition-colors ${
                                isMatch
                                  ? 'border-amber-500 bg-amber-400/40'
                                  : 'border-indigo-500/60 bg-indigo-500/15'
                              }`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Page Strip */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {pages.map((p, idx) => {
                    const isSelected = idx === selectedPageIdx;
                    let dotColor = 'bg-gray-300';
                    if (p.ocrStatus === 'done') dotColor = 'bg-emerald-500';
                    else if (p.ocrStatus === 'running') dotColor = 'bg-indigo-500 animate-pulse';
                    else if (p.ocrStatus === 'error') dotColor = 'bg-red-500';
                    else if (p.existingTextLen >= 15) dotColor = 'bg-sky-400';

                    return (
                      <button
                        key={p.pageNum}
                        type="button"
                        onClick={() => setSelectedPageIdx(idx)}
                        className={`shrink-0 px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                        <span>หน้า {p.pageNum}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right: Extracted / Editable OCR Lines */}
              <div className="lg:col-span-6 bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-100">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                      <Edit3 size={15} className="text-indigo-600" />
                      <span>ข้อความที่ฝังในหน้า {activePage.pageNum}</span>
                    </h3>
                    <p className="text-[11px] text-gray-500">
                      สามารถพิมพ์แก้ไขคำผิดได้โดยตรงก่อนกดดาวน์โหลด Searchable PDF
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                      activePage.ocrStatus === 'done'
                        ? 'bg-emerald-100 text-emerald-700'
                        : activePage.ocrStatus === 'running'
                          ? 'bg-indigo-100 text-indigo-700'
                          : activePage.ocrStatus === 'error'
                            ? 'bg-red-100 text-red-700'
                            : activePage.existingTextLen >= 15
                              ? 'bg-sky-100 text-sky-700'
                              : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {activePage.ocrStatus === 'done'
                      ? `OCR แล้ว (${activePage.ocrLines?.length || 0} บรรทัด)`
                      : activePage.ocrStatus === 'running'
                        ? 'กำลังอ่าน...'
                        : activePage.ocrStatus === 'error'
                          ? 'ผิดพลาด'
                          : activePage.existingTextLen >= 15
                            ? 'มีข้อความเดิมอยู่แล้ว'
                            : 'ยังไม่ได้ทำ OCR'}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto max-h-[460px] mt-3 space-y-2 pr-1">
                  {activePage.ocrError && (
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                      {activePage.ocrError}
                    </div>
                  )}

                  {activePage.ocrLines && activePage.ocrLines.length > 0 ? (
                    activePage.ocrLines.map((line, idx) => {
                      const isMatch =
                        searchQuery.trim() &&
                        line.text.toLowerCase().includes(searchQuery.trim().toLowerCase());
                      return (
                        <div
                          key={idx}
                          className={`flex items-center gap-2 p-1.5 rounded-xl border transition-all ${
                            isMatch
                              ? 'border-amber-400 bg-amber-50/70'
                              : 'border-gray-200 bg-gray-50/50'
                          }`}
                        >
                          <span className="text-[10px] font-mono text-gray-400 w-6 text-right shrink-0">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={line.text}
                            onChange={(e) => handleEditLineText(activePage.pageNum, idx, e.target.value)}
                            className="flex-1 px-2.5 py-1.5 rounded-lg border border-transparent focus:border-indigo-400 bg-white text-xs text-gray-900 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleDeleteLine(activePage.pageNum, idx)}
                            title="ลบบรรทัดนี้"
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })
                  ) : activePage.ocrStatus === 'done' ? (
                    <div className="text-center py-12 text-xs text-gray-500">
                      ไม่พบข้อความในหน้านี้
                    </div>
                  ) : activePage.existingTextLen >= 15 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-sky-700">ข้อความเดิมที่มีอยู่ในหน้านี้:</p>
                      <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {activePage.existingText}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-xs text-gray-500 space-y-1">
                      <p className="font-semibold text-gray-700">หน้านี้ยังไม่มีเลเยอร์ข้อความที่ค้นหาได้</p>
                      <p>กดปุ่ม &ldquo;เริ่มทำ OCR&rdquo; ด้านบนเพื่ออ่านข้อความและสร้างเลเยอร์ค้นหา</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
