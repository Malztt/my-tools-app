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
  PanelLeftOpen, PanelRightOpen, PanelRightClose, Type
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
    clckru: { name: 'Clck.ru', url: 'https://clck.ru/--?url=', limit: 'ไม่ระบุ (Unspecified)', useProxy: true },
  };

  const handleShorten = async (e) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setError('');
    setShortUrl('');

    try {
      let targetUrl = providers[provider].url + encodeURIComponent(url);

      // Use proxy if required by provider
      if (providers[provider].useProxy) {
        targetUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      }

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
                {(() => {
                  const isSmaller = fileInfo.compressedSize < fileInfo.originalSize;
                  const diffPercent = Math.abs(Math.round(((fileInfo.originalSize - fileInfo.compressedSize) / fileInfo.originalSize) * 100));
                  return (
                    <>
                      <p className={`text-sm font-medium ${isSmaller ? 'text-green-600' : 'text-red-600'}`}>
                        บีบอัดแล้ว ({formatSize(fileInfo.compressedSize)})
                        <span className={`ml-2 text-xs ${isSmaller ? 'bg-green-100' : 'bg-red-100'} px-2 py-0.5 rounded-full`}>
                          {isSmaller ? '-' : '+'}{diffPercent}%
                        </span>
                      </p>
                      {!isSmaller && <p className="text-xs text-red-500">ไฟล์ใหญ่ขึ้น! ต้นฉบับอาจถูกบีบอัดมาดีแล้ว</p>}
                    </>
                  );
                })()}
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

// 4. Advanced QR Code Generator (QRCode Monkey Style)
const QRCodeGenerator = () => {
  const [url, setUrl] = useState('https://example.com');
  const [fileExt, setFileExt] = useState('png');
  const [qrCode] = useState(new QRCodeStyling({
    width: 300,
    height: 300,
    type: 'svg',
    data: 'https://example.com',
    image: null,
    dotsOptions: { color: '#000000', type: 'square' },
    backgroundOptions: { color: '#ffffff' },
    imageOptions: { crossOrigin: 'anonymous', margin: 10 }
  }));
  const ref = useRef(null);

  // Customization States
  const [activeTab, setActiveTab] = useState('content'); // content, colors, logo, design
  const [size, setSize] = useState(1024);

  // Design Options
  const [shape, setShape] = useState('square'); // NEW: square, circle
  const [dotType, setDotType] = useState('square');
  const [cornerSquareType, setCornerSquareType] = useState('square');
  const [cornerDotType, setCornerDotType] = useState('square');

  // Color Options
  const [bgColor, setBgColor] = useState('#ffffff');
  const [fgType, setFgType] = useState('single'); // single, gradient
  const [fgColor, setFgColor] = useState('#111d47');
  const [gradientColor1, setGradientColor1] = useState('#000000');
  const [gradientColor2, setGradientColor2] = useState('#0000ff');
  const [gradientType, setGradientType] = useState('linear');
  const [rotation, setRotation] = useState(0);

  // Logo Options
  const [logo, setLogo] = useState(null);
  const [logoSize, setLogoSize] = useState(0.4);
  const [logoMargin, setLogoMargin] = useState(10);

  useEffect(() => {
    if (ref.current) {
      qrCode.append(ref.current);
    }
  }, [qrCode, ref]);

  useEffect(() => {
    const dotsOptions = {
      type: dotType,
      color: fgType === 'single' ? fgColor : undefined,
      gradient: fgType === 'gradient' ? {
        type: gradientType,
        rotation: rotation * (Math.PI / 180),
        colorStops: [{ offset: 0, color: gradientColor1 }, { offset: 1, color: gradientColor2 }]
      } : undefined
    };

    qrCode.update({
      shape: shape, // NEW
      data: url,
      image: logo,
      dotsOptions: dotsOptions,
      backgroundOptions: { color: bgColor },
      cornersSquareOptions: { type: cornerSquareType, color: fgType === 'single' ? fgColor : gradientColor1 },
      cornersDotOptions: { type: cornerDotType, color: fgType === 'single' ? fgColor : gradientColor1 },
      imageOptions: { imageSize: logoSize, margin: logoMargin }
    });
  }, [url, logo, shape, dotType, cornerSquareType, cornerDotType, bgColor, fgType, fgColor, gradientColor1, gradientColor2, gradientType, rotation, logoSize, logoMargin]);

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setLogo(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const onDownloadClick = () => {
    // 1. Update to high resolution
    qrCode.update({
      width: size,
      height: size
    });

    // 2. Wait for render (short delay to ensuring simple race condition fix)
    setTimeout(() => {
      // 3. Download using selected extension
      qrCode.download({
        extension: fileExt,
        name: 'my-qrcode'
      });

      // 4. Revert preview size after download triggered
      setTimeout(() => {
        qrCode.update({ width: 300, height: 300 });
      }, 500);
    }, 100);
  };

  // Helper to render shape preview
  const renderShapePreview = (type, isFrame = false) => {
    const commonClass = "bg-gray-800";
    if (isFrame) {
      switch (type) {
        case 'square': return <div className="w-5 h-5 border-2 border-gray-800"></div>;
        case 'dots': return <div className="w-5 h-5 border-2 border-gray-800 rounded-full"></div>; // 'dots' as frame is usually circle
        case 'rounded': return <div className="w-5 h-5 border-2 border-gray-800 rounded-md"></div>;
        case 'extra-rounded': return <div className="w-5 h-5 border-2 border-gray-800 rounded-lg"></div>;
        case 'classy': return <div className="w-5 h-5 border-2 border-gray-800 rounded-tr-lg rounded-bl-lg"></div>;
        case 'classy-rounded': return <div className="w-5 h-5 border-2 border-gray-800 rounded-tr-lg rounded-bl-lg rounded-tl-sm rounded-br-sm"></div>;
        default: return <div className="w-5 h-5 border-2 border-gray-800"></div>;
      }
    } else {
      switch (type) {
        case 'square': return <div className={`w-4 h-4 ${commonClass}`}></div>;
        case 'dots': return <div className={`w-4 h-4 ${commonClass} rounded-full`}></div>;
        case 'rounded': return <div className={`w-4 h-4 ${commonClass} rounded-md`}></div>;
        case 'extra-rounded': return <div className={`w-4 h-4 ${commonClass} rounded-lg`}></div>;
        case 'classy': return <div className={`w-4 h-4 ${commonClass} rounded-tr-lg rounded-bl-lg`}></div>;
        case 'classy-rounded': return <div className={`w-4 h-4 ${commonClass} rounded-tr-lg rounded-bl-lg rounded-tl-sm rounded-br-sm`}></div>;
        default: return <div className={`w-4 h-4 ${commonClass}`}></div>;
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold text-gray-800">สร้าง QR Code</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Control Panel */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-gray-100 overflow-x-auto">
              <button onClick={() => setActiveTab('content')} className={`flex-1 py-4 px-4 font-medium whitespace-nowrap transition-colors ${activeTab === 'content' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50'}`}>1. เนื้อหา</button>
              <button onClick={() => setActiveTab('colors')} className={`flex-1 py-4 px-4 font-medium whitespace-nowrap transition-colors ${activeTab === 'colors' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50'}`}>2. สี</button>
              <button onClick={() => setActiveTab('logo')} className={`flex-1 py-4 px-4 font-medium whitespace-nowrap transition-colors ${activeTab === 'logo' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50'}`}>3. โลโก้</button>
              <button onClick={() => setActiveTab('design')} className={`flex-1 py-4 px-4 font-medium whitespace-nowrap transition-colors ${activeTab === 'design' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50'}`}>4. ดีไซน์</button>
            </div>

            <div className="p-6 min-h-[400px]">
              {/* Tab 1: Content */}
              {activeTab === 'content' && (
                <div className="space-y-4 animate-fade-in">
                  <label className="block text-sm font-medium text-gray-700">URL เว็บไซต์</label>
                  <div className="relative">
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://www.example.com"
                      className="w-full pl-4 pr-10 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
                    />
                    <div className="absolute right-3 top-3 text-gray-400"><Link size={20} /></div>
                  </div>
                  <p className="text-xs text-gray-500">กรอกลิงก์ที่คุณต้องการให้สแกนแล้วเปิด</p>
                </div>
              )}

              {/* Tab 2: Colors */}
              {activeTab === 'colors' && (
                <div className="space-y-6 animate-fade-in">

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-700">สีพื้นหลัง (Background)</label>
                    <div className="flex items-center gap-3">
                      <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-10 w-16 p-1 rounded border cursor-pointer" />
                      <input
                        type="text"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        placeholder="#FFFFFF"
                        className="flex-1 p-2 rounded border border-gray-200 outline-none uppercase font-mono text-sm"
                      />
                    </div>
                  </div>

                  <hr className="border-gray-100" />

                  <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-700">สีของ QR Code (Foreground)</label>
                    <div className="flex gap-4 mb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="fgType" checked={fgType === 'single'} onChange={() => setFgType('single')} className="text-indigo-600 focus:ring-indigo-500" />
                        <span className="text-sm">สีเดียว</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="fgType" checked={fgType === 'gradient'} onChange={() => setFgType('gradient')} className="text-indigo-600 focus:ring-indigo-500" />
                        <span className="text-sm">ไล่สี (Gradient)</span>
                      </label>
                    </div>

                    {fgType === 'single' ? (
                      <div className="flex items-center gap-3">
                        <input type="color" value={fgColor} onChange={(e) => setFgColor(e.target.value)} className="h-10 w-16 p-1 rounded border cursor-pointer" />
                        <input
                          type="text"
                          value={fgColor}
                          onChange={(e) => setFgColor(e.target.value)}
                          placeholder="#000000"
                          className="flex-1 p-2 rounded border border-gray-200 outline-none uppercase font-mono text-sm"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex gap-4">
                          <div className="flex-1">
                            <span className="text-xs text-gray-500 block mb-1">สีเริ่ม</span>
                            <div className="flex items-center gap-2">
                              <input type="color" value={gradientColor1} onChange={(e) => setGradientColor1(e.target.value)} className="h-10 w-12 p-1 rounded border cursor-pointer" />
                              <input
                                type="text"
                                value={gradientColor1}
                                onChange={(e) => setGradientColor1(e.target.value)}
                                className="w-full p-2 rounded border border-gray-200 outline-none uppercase font-mono text-xs"
                              />
                            </div>
                          </div>
                          <div className="flex-1">
                            <span className="text-xs text-gray-500 block mb-1">สีจบ</span>
                            <div className="flex items-center gap-2">
                              <input type="color" value={gradientColor2} onChange={(e) => setGradientColor2(e.target.value)} className="h-10 w-12 p-1 rounded border cursor-pointer" />
                              <input
                                type="text"
                                value={gradientColor2}
                                onChange={(e) => setGradientColor2(e.target.value)}
                                className="w-full p-2 rounded border border-gray-200 outline-none uppercase font-mono text-xs"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <select value={gradientType} onChange={(e) => setGradientType(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
                            <option value="linear">Linear (เส้นตรง)</option>
                            <option value="radial">Radial (วงกลม)</option>
                          </select>
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-xs text-gray-500">ทิศทาง: {rotation}°</span>
                            <input type="range" min="0" max="360" value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Logo */}
              {activeTab === 'logo' && (
                <div className="space-y-6 animate-fade-in">
                  <div className="space-y-4">
                    <label className="text-sm font-medium text-gray-700 block">เลือกโลโก้มาตรฐาน</label>
                    <div className="flex gap-3">
                      {['/default-logo-1.png', '/default-logo-2.png'].map((l, i) => (
                        <button
                          key={i}
                          onClick={() => setLogo(l)}
                          className="w-16 h-16 border border-gray-200 rounded-lg p-2 hover:border-indigo-500 hover:bg-indigo-50 transition-all bg-white"
                        >
                          <img src={l} className="w-full h-full object-contain" alt="Default Logo" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">หรือ อัปโหลดโลโก้</label>
                    <div className="relative overflow-hidden bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl w-full p-6 text-center hover:bg-gray-100 transition-all cursor-pointer">
                      <input type="file" accept="image/*" onChange={handleLogoUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Upload size={32} className="text-gray-400" />
                        <span className="text-gray-600">{logo ? 'เปลี่ยนรูปโลโก้' : 'คลิกเพื่อเลือกไฟล์รูปภาพ'}</span>
                      </div>
                    </div>
                  </div>

                  {logo && (
                    <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl">
                      <img src={logo} className="w-16 h-16 object-contain bg-white rounded shadow-sm" />
                      <div className="flex-1 space-y-4">
                        <button onClick={() => setLogo(null)} className="text-red-500 text-sm hover:underline">ลบโลโก้</button>

                        {/* Logo Size and Margin */}
                        <div>
                          <label className="text-xs font-medium text-gray-700 block mb-1">ขนาดโลโก้</label>
                          <input
                            type="range"
                            min="0.1"
                            max="1.0"
                            step="0.05"
                            value={logoSize}
                            onChange={(e) => setLogoSize(Number(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-700 block mb-1">ระยะห่างรอบโลโก้</label>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            step="1"
                            value={logoMargin}
                            onChange={(e) => setLogoMargin(Number(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                          />
                        </div>

                      </div>
                    </div>
                  )}
                  {!logo && <p className="text-center text-sm text-gray-400">ยังไม่ได้เลือกรูปภาพ</p>}
                </div>
              )}

              {/* Tab 4: Design */}
              {activeTab === 'design' && (
                <div className="space-y-6 animate-fade-in content-center">

                  {/* Overall Shape */}
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-3">รูปทรง QR Code (Shape)</label>
                    <div className="grid grid-cols-2 gap-4">
                      {['square', 'circle'].map(type => (
                        <button
                          key={type}
                          onClick={() => setShape(type)}
                          className={`py-3 px-4 rounded-xl border-2 flex items-center justify-center gap-2 font-medium transition-all ${shape === type ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                          <div className={`w-5 h-5 bg-current ${type === 'circle' ? 'rounded-full' : 'rounded-sm'}`}></div>
                          <span className="capitalize">{type}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <hr className="border-gray-100" />

                  {/* Body Shape */}
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-3">รูปทรงจุด (Body Shape)</label>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {['square', 'dots', 'rounded', 'extra-rounded', 'classy', 'classy-rounded'].map(type => (
                        <button
                          key={type}
                          onClick={() => setDotType(type)}
                          className={`aspect-square rounded border-2 p-2 flex flex-col items-center justify-center gap-1 hover:bg-gray-50 transition-all ${dotType === type ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200'}`}
                          title={type}
                        >
                          {renderShapePreview(type, false)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <hr className="border-gray-100" />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {/* Eye Frame */}
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-3">กรอบตา (Eye Frame)</label>
                      <div className="grid grid-cols-3 gap-2">
                        {['square', 'dot', 'extra-rounded'].map(type => (
                          <button
                            key={type}
                            onClick={() => setCornerSquareType(type)}
                            className={`aspect-square rounded border-2 p-1 flex items-center justify-center hover:bg-gray-50 transition-all ${cornerSquareType === type ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200'}`}
                            title={type}
                          >
                            {renderShapePreview(type, true)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Eye Ball */}
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-3">ลูกตา (Eye Ball)</label>
                      <div className="grid grid-cols-3 gap-2">
                        {['square', 'dots', 'rounded', 'extra-rounded', 'classy', 'classy-rounded'].map(type => (
                          <button
                            key={type}
                            onClick={() => setCornerDotType(type)}
                            className={`aspect-square rounded border-2 p-1 flex items-center justify-center hover:bg-gray-50 transition-all ${cornerDotType === type ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200'}`}
                            title={type}
                          >
                            {renderShapePreview(type, false)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Preview Panel */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-6">
            <div className="flex justify-center mb-6">
              <div ref={ref} className="bg-white p-4 rounded-xl shadow-inner border border-gray-100" />
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">ความละเอียด (Resolution): {size}px</label>
                <input
                  type="range"
                  min="200"
                  max="2000"
                  step="100"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <div className="flex justify-between text-xs text-gray-400">
                  <span>200px</span>
                  <span>1000px</span>
                  <span>2000px</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setFileExt('png')} className={`flex-1 py-2 text-sm rounded-lg border ${fileExt === 'png' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-gray-200 hover:bg-gray-50'}`}>PNG</button>
                <button onClick={() => setFileExt('jpeg')} className={`flex-1 py-2 text-sm rounded-lg border ${fileExt === 'jpeg' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-gray-200 hover:bg-gray-50'}`}>JPEG</button>
                <button onClick={() => setFileExt('svg')} className={`flex-1 py-2 text-sm rounded-lg border ${fileExt === 'svg' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-gray-200 hover:bg-gray-50'}`}>SVG</button>
              </div>

              <button onClick={onDownloadClick} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 flex justify-center items-center gap-2">
                <Download size={20} /> ดาวน์โหลด QR Code
              </button>
            </div>
          </div>
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
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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
    const fontUrl = '/THSarabunPSK.ttf';
    const fontBytes = await fetch(fontUrl).then((res) => res.arrayBuffer());
    const customFont = await pdfDoc.embedFont(fontBytes);

    const pages = pdfDoc.getPages();
    if (pages.length === 0) return;

    for (const page of pages) {
      const { width, height } = page.getSize();
      
      const lines = text.split('\n');
      const textWidth = Math.max(...lines.map(line => customFont.widthOfTextAtSize(line, fontSize)));
      const lineHeight = customFont.heightAtSize(fontSize) * 1.2;
      const textHeight = lineHeight * lines.length;
      
      const padding = 20;
      
      const maxX = Math.max(0, width - textWidth - (padding * 2));
      const x = padding + (maxX * dragPos.x);
      
      const maxTopY = height - padding - lineHeight;
      const maxBottomY = padding + textHeight - lineHeight;
      const y = maxTopY - ((maxTopY - maxBottomY) * dragPos.y);

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

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResultPdf(null);
      setPreviewUrl(null);
      setPreviewPage(1);
    }
  };

  const generatePreview = async () => {
    if (!file || !text.trim()) return;
    setIsPreviewLoading(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      
      setTotalPages(pdfDoc.getPageCount());
      if (pdfDoc.getPageCount() > 0) {
        const { width, height } = pdfDoc.getPages()[0].getSize();
        setPdfAspectRatio(width / height);
      }

      const pageCount = pdfDoc.getPageCount();
      const targetIndex = previewPage - 1;
      for (let i = pageCount - 1; i >= 0; i--) {
        if (i !== targetIndex) {
          pdfDoc.removePage(i);
        }
      }
      
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
  }, [file, text, fontSize, opacity, dragPos, previewPage]);

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
                {isPreviewLoading && <span className="flex items-center gap-2 text-xs text-indigo-600"><span className="animate-spin rounded-full h-3 w-3 border-b-2 border-indigo-600"></span> กำลังอัปเดต...</span>}
              </div>
              
              {file && (
                <div className="bg-white px-3 py-2 border-b border-gray-200 flex items-center justify-center gap-4">
                  <button 
                    onClick={() => setPreviewPage(p => Math.max(1, p - 1))}
                    disabled={previewPage <= 1 || isPreviewLoading}
                    className="px-3 py-1 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    ก่อนหน้า
                  </button>
                  <span className="text-sm font-medium text-gray-700">หน้าที่ {previewPage} / {totalPages}</span>
                  <button 
                    onClick={() => setPreviewPage(p => Math.min(totalPages, p + 1))}
                    disabled={previewPage >= totalPages || isPreviewLoading}
                    className="px-3 py-1 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    ถัดไป
                  </button>
                </div>
              )}

              <div className="flex-1 relative bg-gray-200 flex items-center justify-center p-4">
                {previewUrl ? (
                  <div 
                    className="relative bg-white shadow-lg touch-none"
                    style={{ 
                      aspectRatio: pdfAspectRatio, 
                      maxHeight: '100%', 
                      maxWidth: '100%',
                      cursor: isDragging ? 'grabbing' : 'crosshair'
                    }}
                    ref={mapRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    <iframe 
                      src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`} 
                      className="absolute inset-0 w-full h-full border-0 pointer-events-none" 
                      title="PDF Preview" 
                    />
                    
                    {/* Draggable Target Indicator */}
                    <div 
                      className="absolute w-8 h-6 bg-indigo-500/80 rounded border-2 border-indigo-600 pointer-events-none flex items-center justify-center text-white z-10 transition-transform"
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
  const [activeTab, setActiveTab] = useState('ocr');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const tools = [
    // PDF & Image Tools
    { id: 'pdf_watermark', label: 'ใส่ข้อความ PDF', icon: Type, category: 'PDF & รูปภาพ' },
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