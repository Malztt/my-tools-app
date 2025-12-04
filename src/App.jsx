import React, { useState, useEffect, useRef, useMemo } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { PDFDocument } from 'pdf-lib';
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
  PanelLeftOpen, PanelRightOpen, PanelRightClose
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

// 1. REAL URL Shortener (Multi-Provider)
// 1. REAL URL Shortener (Multi-Provider)
const UrlShortener = () => {
  const [url, setUrl] = useState('');
  const [shortUrl, setShortUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState('tinyurl');

  const providers = {
    tinyurl: { name: 'TinyURL', url: 'https://tinyurl.com/api-create.php?url=', limit: 'ไม่จำกัด (Unlimited)' },
    isgd: { name: 'Is.gd', url: 'https://is.gd/create.php?format=simple&url=', limit: '50 ครั้ง/วัน (ต่อ IP)' },
    vgd: { name: 'v.gd', url: 'https://v.gd/create.php?format=simple&url=', limit: '50 ครั้ง/วัน (ต่อ IP)' },
    clckru: { name: 'Clck.ru', url: 'https://clck.ru/--?url=', limit: 'ไม่ระบุ (Unspecified)' },
  };

  const handleShorten = async (e) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setError('');
    setShortUrl('');

    try {
      const targetUrl = providers[provider].url + encodeURIComponent(url);
      const response = await fetch(targetUrl);

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      const result = await response.text();
      setShortUrl(result);
    } catch (err) {
      console.error(err);
      setError(`ไม่สามารถย่อลิงก์ได้ (${providers[provider].name}): อาจติดปัญหา CORS หรือลิงก์ผิด`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">ย่อลิงก์</h2>
        <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-mono">v1.5.2</span>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <form onSubmit={handleShorten} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เลือกผู้ให้บริการ</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full p-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all bg-white"
            >
              {Object.entries(providers).map(([key, data]) => (
                <option key={key} value={key}>{data.name} {data.requireKey ? '(API Key)' : '(Free)'}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1 ml-1">
              <span className="font-semibold">ข้อจำกัด:</span> {providers[provider].limit}
            </p>
          </div>



          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL ปลายทาง</label>
            <div className="relative">
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/very-long..."
                className="w-full pl-4 pr-10 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
              />
              <div className="absolute right-3 top-3 text-gray-400"><Link size={20} /></div>
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 flex justify-center items-center gap-2">
            {loading ? <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span> : <><Scissors size={20} /><span>สร้างลิงก์ย่อ</span></>}
          </button>
        </form>

        {error && <p className="text-red-500 text-sm text-center mt-2">{error}</p>}

        {shortUrl && (
          <div className="mt-6 p-4 bg-indigo-50 rounded-xl border border-indigo-100 flex items-center justify-between animate-fade-in">
            <a href={shortUrl} target="_blank" rel="noreferrer" className="truncate mr-4 text-indigo-700 font-medium underline">{shortUrl}</a>
            <button onClick={copyToClipboard} className={`p-2 rounded-lg transition-all ${copied ? 'bg-green-500 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-100'}`}>
              {copied ? <Check size={20} /> : <Copy size={20} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// 2. Image Compressor (Real - Browser Canvas)
const ImageCompressor = () => {
  const [originalImage, setOriginalImage] = useState(null);
  const [compressedImage, setCompressedImage] = useState(null);
  const [quality, setQuality] = useState(0.7);
  const [fileInfo, setFileInfo] = useState({ name: '', originalSize: 0, compressedSize: 0 });

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setOriginalImage(event.target.result);
        setFileInfo(prev => ({ ...prev, name: file.name, originalSize: file.size }));
        compressImage(event.target.result, quality);
      };
      reader.readAsDataURL(file);
    }
  };

  const compressImage = (base64Str, q) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const newBase64 = canvas.toDataURL('image/jpeg', q);
      setCompressedImage(newBase64);
      const sizeInBytes = Math.ceil((newBase64.length * 3) / 4);
      setFileInfo(prev => ({ ...prev, compressedSize: sizeInBytes }));
    };
  };

  const handleQualityChange = (e) => {
    const q = parseFloat(e.target.value);
    setQuality(q);
    if (originalImage) compressImage(originalImage, q);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">บีบอัดรูปภาพ</h2>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        {!originalImage ? (
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:bg-gray-50 transition-colors relative cursor-pointer group">
            <input type="file" accept="image/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            <div className="bg-indigo-100 text-indigo-600 rounded-full p-4 w-16 h-16 mx-auto mb-4 group-hover:scale-110 transition-transform flex items-center justify-center"><Upload size={32} /></div>
            <p className="font-medium text-gray-700">คลิกเพื่อเลือกรูปภาพ</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-500">ต้นฉบับ ({formatSize(fileInfo.originalSize)})</p>
                <img src={originalImage} alt="Original" className="w-full h-48 object-cover rounded-lg border" />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-green-600">บีบอัดแล้ว ({formatSize(fileInfo.compressedSize)}) <span className="ml-2 text-xs bg-green-100 px-2 py-0.5 rounded-full">-{Math.round(((fileInfo.originalSize - fileInfo.compressedSize) / fileInfo.originalSize) * 100)}%</span></p>
                <img src={compressedImage} alt="Compressed" className="w-full h-48 object-cover rounded-lg border" />
              </div>
            </div>
            <div className="bg-gray-50 p-4 rounded-xl">
              <label className="block text-sm font-medium text-gray-700 mb-2">คุณภาพ: {Math.round(quality * 100)}%</label>
              <input type="range" min="0.1" max="1.0" step="0.1" value={quality} onChange={handleQualityChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setOriginalImage(null)} className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50">เริ่มใหม่</button>
              <a href={compressedImage} download={`compressed-${fileInfo.name}`} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 flex justify-center items-center gap-2 shadow-lg shadow-indigo-200"><Download size={20} /> ดาวน์โหลด</a>
            </div>
          </div>
        )}
      </div>
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
  const [compressionLevel, setCompressionLevel] = useState('medium'); // low, medium, high

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setFile(e.target.files[0]);
      setProcessedPdf(null);
      setStatusMsg('');
      setProgress(0);
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

        // Determine scale and quality based on compression level
        let scale = 1.0;
        let quality = 0.7;

        if (compressionLevel === 'low') {
          scale = 1.5;
          quality = 0.8;
        } else if (compressionLevel === 'high') {
          scale = 0.75;
          quality = 0.5;
        }

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
                <p className="text-sm text-gray-500">{formatSize(file.size)}</p>
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
                  <p className="text-sm font-medium text-gray-700">ระดับการบีบอัด (คุณภาพ vs ขนาด)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => setCompressionLevel('low')} className={`text-sm py-2 rounded-lg border transition-all ${compressionLevel === 'low' ? 'bg-indigo-100 border-indigo-500 text-indigo-700 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      ต่ำ (ชัด)
                    </button>
                    <button onClick={() => setCompressionLevel('medium')} className={`text-sm py-2 rounded-lg border transition-all ${compressionLevel === 'medium' ? 'bg-indigo-100 border-indigo-500 text-indigo-700 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      กลาง (สมดุล)
                    </button>
                    <button onClick={() => setCompressionLevel('high')} className={`text-sm py-2 rounded-lg border transition-all ${compressionLevel === 'high' ? 'bg-indigo-100 border-indigo-500 text-indigo-700 font-medium' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      สูง (เล็กสุด)
                    </button>
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

// 4. QR Code Generator (with Logo)
const QRCodeGenerator = () => {
  const [text, setText] = useState('https://example.com');
  const [logo, setLogo] = useState(null);
  const [logoSize, setLogoSize] = useState(60); // Default logo size
  const qrRef = useRef(null);

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setLogo(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const downloadQR = () => {
    const canvas = qrRef.current.querySelector('canvas');
    if (canvas) {
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      link.download = 'qrcode-with-logo.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">สร้าง QR Code (ใส่โลโก้ได้)</h2>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">ข้อความ / ลิงก์</label>
          <textarea
            rows="2"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="กรอกข้อความที่นี่..."
            className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-200 outline-none resize-none"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">โลโก้ตรงกลาง (ถ้ามี)</label>
          <div className="flex items-center gap-4">
            <div className="relative overflow-hidden bg-gray-50 border border-gray-200 rounded-lg w-full">
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
              <div className="p-3 text-center text-sm text-gray-500 hover:text-indigo-600 transition-colors flex items-center justify-center gap-2">
                <Upload size={16} /> {logo ? 'เปลี่ยนรูปโลโก้' : 'อัปโหลดรูปโลโก้'}
              </div>
            </div>
            {logo && <button onClick={() => setLogo(null)} className="text-red-500 hover:text-red-700 p-2"><X size={20} /></button>}
          </div>
        </div>

        {logo && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">ขนาดโลโก้: {logoSize}px</label>
            <input
              type="range"
              min="20"
              max="100"
              value={logoSize}
              onChange={(e) => setLogoSize(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>
        )}

        <div className="flex flex-col items-center space-y-6 pt-4 border-t border-gray-100">
          <div ref={qrRef} className="p-4 bg-white border-2 border-indigo-100 rounded-xl shadow-sm">
            <QRCodeCanvas
              value={text}
              size={256}
              level={"H"} // High error correction for logos
              imageSettings={logo ? {
                src: logo,
                x: undefined,
                y: undefined,
                height: logoSize,
                width: logoSize,
                excavate: true,
              } : undefined}
            />
          </div>
          <button onClick={downloadQR} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl flex justify-center items-center gap-2 transition-all shadow-lg shadow-indigo-200">
            <Download size={20} /> บันทึก QR Code
          </button>
        </div>
      </div>
    </div>
  );
};

// 5. Gemini OCR (Real API + PDF Support)
const GeminiOCR = () => {
  const [apiKey] = useState(() => {
    let key = localStorage.getItem('gemini_api_key');
    // Fix: Purge known bad key from previous version
    if (key === 'AIzaSyCtlgXxgZtDw3nC8j5k61ym2xknOg8Veyk') {
      localStorage.removeItem('gemini_api_key');
      key = null;
    }
    return key || import.meta.env.VITE_GEMINI_API_KEY || '';
  });
  const [image, setImage] = useState(null);
  const [mimeType, setMimeType] = useState('');
  const [imageBase64, setImageBase64] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result);
        setMimeType(file.type);
        setImageBase64(reader.result.replace("data:", "").replace(/^.+,/, ""));
      };
      reader.readAsDataURL(file);
      setText(''); setError('');
    }
  };

  const handleExtractText = async () => {
    if (!apiKey) { setError('กรุณากรอก API Key'); return; }
    if (!imageBase64) return;
    setLoading(true); setError(''); setText('');

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "Extract all text from this file (Image/PDF). Please preserve the original language (Thai/English)." },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }
            ]
          }]
        })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      setText(data.candidates?.[0]?.content?.parts?.[0]?.text || 'No text found');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2"><h2 className="text-2xl font-bold text-gray-800">Gemini OCR (AI)</h2></div>

      <div className="space-y-6">
        <div onClick={() => !image && fileInputRef.current.click()} className={`bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center min-h-[200px] ${!image ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
          {!image ? <><FileText size={48} className="text-indigo-300 mb-4" /><p>อัปโหลด รูปภาพ หรือ PDF</p><input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFileUpload} className="hidden" /></> :
            <div className="w-full max-w-md mx-auto space-y-4">
              <div className="relative h-48 bg-gray-900 rounded-xl overflow-hidden flex justify-center items-center">
                {mimeType === 'application/pdf' ? (
                  <div className="text-white flex flex-col items-center">
                    <FileType size={48} className="text-red-400 mb-2" />
                    <span className="text-sm">PDF Document Selected</span>
                  </div>
                ) : (
                  <img src={image} className="h-full object-contain" />
                )}
                <button onClick={() => setImage(null)} className="absolute top-2 right-2 bg-black/50 text-white p-1 rounded-full"><X size={16} /></button>
              </div>
              <button onClick={handleExtractText} disabled={loading} className="w-full bg-indigo-600 text-white py-3 rounded-xl flex justify-center items-center gap-2">{loading ? 'กำลังอ่าน...' : 'เริ่มอ่านข้อความ'}</button>
            </div>
          }
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
          <div className="flex justify-between mb-4"><h3 className="font-medium text-gray-700">ผลลัพธ์ข้อความ</h3><button onClick={() => navigator.clipboard.writeText(text)} disabled={!text} className="text-indigo-600 text-sm flex gap-1"><Copy size={16} /> คัดลอก</button></div>
          {error ? <div className="text-red-500 text-center mt-10"><AlertCircle size={32} className="mx-auto mb-2" />{error}</div> : <textarea readOnly value={text} placeholder="ข้อความที่ดึงได้จะปรากฏที่นี่..." className="w-full p-4 bg-gray-50 rounded-xl border-gray-200 resize-none min-h-[300px] text-base leading-relaxed" />}
        </div>
      </div>
    </div>
  );
};

// 6. OCSC Accreditation Search (External Link)
const OcscSearch = () => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center animate-fade-in p-6">
      <div className="text-center space-y-6 max-w-lg">
        <div className="bg-indigo-50 w-24 h-24 rounded-full flex items-center justify-center mx-auto text-indigo-600 mb-6">
          <Search size={48} />
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-gray-800">ค้นหาหลักสูตร (ก.พ.)</h2>
          <p className="text-gray-500 leading-relaxed">
            เนื่องจากระบบความปลอดภัยของเว็บไซต์ ก.พ. (Security Policy) <br />
            ไม่อนุญาตให้แสดงผลผ่านแอพอื่นโดยตรง
          </p>
        </div>
        <a
          href="https://accreditation.ocsc.go.th/accreditation/search/curriculum"
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-4 rounded-xl transition-all shadow-lg shadow-indigo-200 flex justify-center items-center gap-2 hover:scale-105 transform duration-200"
        >
          <ExternalLink size={20} />
          <span>เปิดหน้าค้นหาในแท็บใหม่</span>
        </a>
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
  const [mode, setMode] = useState('xls_to_csv'); // xls_to_csv, csv_to_xls
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [result, setResult] = useState(null);

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
      setStatusMsg('');
    }
  };

  const processFile = async () => {
    if (!file) return;
    setIsProcessing(true);
    setStatusMsg('กำลังประมวลผล...');

    try {
      const XLSX = await import('xlsx');
      const arrayBuffer = await file.arrayBuffer();

      if (mode === 'xls_to_csv') {
        const workbook = XLSX.read(arrayBuffer);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const csv = XLSX.utils.sheet_to_csv(worksheet);

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        setResult({ url, name: file.name.replace(/\.[^/.]+$/, "") + ".csv" });
      } else {
        // CSV to XLS
        // Need to read as string for CSV
        const text = await file.text();
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet(
          text.split('\n').map(row => row.split(',')) // Simple CSV parser, might need more robust one for complex CSVs but XLSX.read usually handles it better if we pass type: string
        );
        // Better approach for CSV to Sheet using XLSX read
        const wb = XLSX.read(text, { type: 'string', raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];

        const xlsxBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([xlsxBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        setResult({ url, name: file.name.replace(/\.[^/.]+$/, "") + ".xlsx" });
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
        <h2 className="text-2xl font-bold text-gray-800">แปลงไฟล์ Excel / CSV</h2>
      </div>

      <div className="flex justify-center gap-4 mb-6">
        <button onClick={() => { setMode('xls_to_csv'); setFile(null); setResult(null); }} className={`px-4 py-2 rounded-lg font-medium transition-all ${mode === 'xls_to_csv' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>Excel เป็น CSV</button>
        <button onClick={() => { setMode('csv_to_xls'); setFile(null); setResult(null); }} className={`px-4 py-2 rounded-lg font-medium transition-all ${mode === 'csv_to_xls' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>CSV เป็น Excel</button>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div className="space-y-6">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative cursor-pointer group">
            <input
              type="file"
              accept={mode === 'xls_to_csv' ? ".xlsx, .xls" : ".csv"}
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="bg-green-100 text-green-600 rounded-full p-4 w-16 h-16 mx-auto mb-4 group-hover:scale-110 transition-transform flex items-center justify-center">
              <FileSpreadsheet size={32} />
            </div>
            <p className="font-medium text-gray-700">
              {file ? file.name : (mode === 'xls_to_csv' ? "อัปโหลดไฟล์ Excel" : "อัปโหลดไฟล์ CSV")}
            </p>
          </div>

          <button
            onClick={processFile}
            disabled={isProcessing || !file}
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
              <a href={result.url} download={result.name} className="block w-full bg-gray-900 text-white font-medium py-3 rounded-xl hover:bg-gray-800 transition-all text-center">ดาวน์โหลดไฟล์ใหม่</a>
            </div>
          )}
        </div>
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

// --- Main Layout ---
const App = () => {
  const [activeTab, setActiveTab] = useState('ocr');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const tools = [
    // PDF & Image Tools
    { id: 'compress_pdf', label: 'บีบ PDF', icon: FileType, category: 'PDF & รูปภาพ' },
    { id: 'pdf_merge', label: 'รวมไฟล์ PDF', icon: Files, category: 'PDF & รูปภาพ' },
    { id: 'pdf_split', label: 'แยกไฟล์ PDF', icon: Scissors, category: 'PDF & รูปภาพ' },
    { id: 'pdf_conv', label: 'แปลง PDF/รูปภาพ', icon: FileType2, category: 'PDF & รูปภาพ' },
    { id: 'compress_img', label: 'บีบไฟล์ภาพ', icon: FileImage, category: 'PDF & รูปภาพ' },
    { id: 'ocr', label: 'ดึงข้อความจากไฟล์', icon: Zap, category: 'PDF & รูปภาพ' },

    // General Tools
    { id: 'xls_conv', label: 'แปลง Excel/CSV', icon: FileSpreadsheet, category: 'เครื่องมือทั่วไป' },
    { id: 'qrcode', label: 'สร้าง QR Code', icon: QrCode, category: 'เครื่องมือทั่วไป' },
    { id: 'shorten', label: 'ย่อลิงก์', icon: Link, category: 'เครื่องมือทั่วไป' },
    { id: 'ocsc', label: 'ระบบรับรองคุณวุฒิ ก.พ.', icon: Search, category: 'เครื่องมือทั่วไป' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900 flex">
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 h-full flex flex-col">
          <div className="flex items-center gap-3 mb-10"><div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white"><Layout size={24} /></div><div><h1 className="font-bold text-xl">WorkTools</h1><p className="text-xs text-gray-400">Real & Functional</p></div></div>
          <nav className="space-y-6">
            {['PDF & รูปภาพ', 'เครื่องมือทั่วไป'].map((category) => (
              <div key={category}>
                <h3 className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {category}
                </h3>
                <div className="space-y-1">
                  {tools.filter(t => t.category === category).map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => { setActiveTab(tool.id); setSidebarOpen(false); }}
                      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab === tool.id
                        ? 'bg-indigo-50 text-indigo-600 shadow-sm'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                    >
                      <tool.icon size={20} />
                      <span className="font-medium">{tool.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white border-b border-gray-200 p-4 flex items-center md:hidden"><button onClick={() => setSidebarOpen(true)} className="p-2"><Menu size={24} /></button><span className="ml-4 font-bold">WorkTools</span></header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className={`max-w-5xl mx-auto ${activeTab === 'ocsc' ? 'h-full flex flex-col' : ''}`}>
            {activeTab === 'shorten' && <UrlShortener />}
            {activeTab === 'compress_img' && <ImageCompressor />}
            {activeTab === 'compress_pdf' && <PdfOptimizer />}
            {activeTab === 'qrcode' && <QRCodeGenerator />}
            {activeTab === 'ocr' && <GeminiOCR />}
            {activeTab === 'ocsc' && <OcscSearch />}
            {activeTab === 'pdf_conv' && <PdfConverter />}
            {activeTab === 'pdf_merge' && <PdfMerger />}
            {activeTab === 'pdf_split' && <PdfSplitter />}
            {activeTab === 'xls_conv' && <ExcelConverter />}
          </div>
        </div>
      </main>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }`}</style>
    </div>
  );
};

export default App;