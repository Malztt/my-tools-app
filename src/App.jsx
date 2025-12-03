import React, { useState, useEffect, useRef } from 'react';
import {
  Link, FileImage, QrCode, FileText, Copy, Check, Upload,
  Download, Scissors, Menu, X, Zap, Layout, FileType,
  Key, Eye, EyeOff, AlertCircle
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

// 1. REAL URL Shortener (Using TinyURL API)
const UrlShortener = () => {
  const [url, setUrl] = useState('');
  const [shortUrl, setShortUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleShorten = async (e) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setError('');
    setShortUrl('');

    try {
      const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
      if (!response.ok) throw new Error('Network response was not ok');
      const result = await response.text();
      setShortUrl(result);
    } catch (err) {
      console.error(err);
      setError('ไม่สามารถย่อลิงก์ได้ (อาจติดปัญหา CORS หรือลิงก์ไม่ถูกต้อง)');
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
        <h2 className="text-2xl font-bold text-gray-800">ย่อลิงก์ (ใช้งานจริง)</h2>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <form onSubmit={handleShorten} className="space-y-4">
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
      const PDFLib = await import('pdf-lib');
      const pdfjs = await import('pdfjs-dist');

      // Set worker source (using CDN for simplicity and reliability)
      pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;

      const newPdfDoc = await PDFLib.PDFDocument.create();

      for (let i = 1; i <= numPages; i++) {
        setStatusMsg(`กำลังแปลงหน้า ${i} จาก ${numPages}...`);
        setProgress(Math.round((i / numPages) * 100));

        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 }); // Scale 1.5 for decent quality but smaller size
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        // Convert to JPEG with 0.7 quality
        const imgDataUrl = canvas.toDataURL('image/jpeg', 0.7);
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
                  {isProcessing ? <><span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span><span>{statusMsg} ({progress}%)</span></> : <><Zap size={20} /><span>เริ่มบีบอัด (แปลงเป็นภาพ)</span></>}
                </button>
                <p className="text-xs text-gray-400 text-center">ระบบจะแปลงทุกหน้าเป็นรูปภาพเพื่อลดขนาดไฟล์ (ข้อความจะไม่สามารถค้นหาได้)</p>
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

// 4. QR Code Generator (Real API)
const QRCodeGenerator = () => {
  const [text, setText] = useState('');
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;

  const downloadQR = async () => {
    try {
      const response = await fetch(qrUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'qrcode.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      alert('คลิกขวาที่รูปภาพเพื่อบันทึก');
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-800">สร้าง QR Code</h2>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <textarea rows="3" value={text} onChange={(e) => setText(e.target.value)} placeholder="กรอกข้อความที่นี่..." className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-200 outline-none resize-none" />
        {text && (
          <div className="flex flex-col items-center space-y-6 pt-4 animate-fade-in">
            <div className="p-4 bg-white border-2 border-indigo-100 rounded-xl shadow-sm"><img src={qrUrl} alt="QR" className="w-48 h-48 object-contain" /></div>
            <button onClick={downloadQR} className="w-full bg-indigo-600 text-white py-3 rounded-xl flex justify-center items-center gap-2"><Download size={20} /> บันทึก QR Code</button>
          </div>
        )}
      </div>
    </div>
  );
};

// 5. Gemini OCR (Real API + PDF Support)
const GeminiOCR = () => {
  const [apiKey, setApiKey] = useState('AIzaSyCtlgXxgZtDw3nC8j5k61ym2xknOg8Veyk');
  const [showKey, setShowKey] = useState(false);
  const [image, setImage] = useState(null);
  const [mimeType, setMimeType] = useState('');
  const [imageBase64, setImageBase64] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => localStorage.setItem('gemini_api_key', apiKey), [apiKey]);

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div onClick={() => !image && fileInputRef.current.click()} className={`bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center min-h-[250px] ${!image ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
          {!image ? <><FileText size={48} className="text-indigo-300 mb-4" /><p>อัปโหลด รูปภาพ หรือ PDF</p><input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFileUpload} className="hidden" /></> :
            <div className="w-full space-y-4">
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
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 min-h-[250px] flex flex-col">
          <div className="flex justify-between mb-4"><h3 className="font-medium text-gray-700">ผลลัพธ์</h3><button onClick={() => navigator.clipboard.writeText(text)} disabled={!text} className="text-indigo-600 text-sm flex gap-1"><Copy size={16} /> คัดลอก</button></div>
          {error ? <div className="text-red-500 text-center mt-10"><AlertCircle size={32} className="mx-auto mb-2" />{error}</div> : <textarea readOnly value={text} placeholder="..." className="flex-1 w-full p-4 bg-gray-50 rounded-xl border-gray-200 resize-none" />}
        </div>
      </div>
    </div>
  );
};

// --- Main Layout ---
const App = () => {
  const [activeTab, setActiveTab] = useState('ocr');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const tools = [
    { id: 'ocr', label: 'Gemini OCR', icon: Zap },
    { id: 'shorten', label: 'ย่อลิงก์ (Real)', icon: Link },
    { id: 'compress_img', label: 'บีบไฟล์ภาพ', icon: FileImage },
    { id: 'compress_pdf', label: 'จัดการ PDF', icon: FileType },
    { id: 'qrcode', label: 'สร้าง QR Code', icon: QrCode },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900 flex">
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 h-full flex flex-col">
          <div className="flex items-center gap-3 mb-10"><div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white"><Layout size={24} /></div><div><h1 className="font-bold text-xl">WorkTools</h1><p className="text-xs text-gray-400">Real & Functional</p></div></div>
          <nav className="space-y-2">{tools.map(t => <button key={t.id} onClick={() => { setActiveTab(t.id); setSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === t.id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}><t.icon size={20} /><span>{t.label}</span></button>)}</nav>
        </div>
      </aside>
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white border-b border-gray-200 p-4 flex items-center md:hidden"><button onClick={() => setSidebarOpen(true)} className="p-2"><Menu size={24} /></button><span className="ml-4 font-bold">WorkTools</span></header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8"><div className="max-w-5xl mx-auto">{activeTab === 'shorten' && <UrlShortener />}{activeTab === 'compress_img' && <ImageCompressor />}{activeTab === 'compress_pdf' && <PdfOptimizer />}{activeTab === 'qrcode' && <QRCodeGenerator />}{activeTab === 'ocr' && <GeminiOCR />}</div></div>
      </main>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }`}</style>
    </div>
  );
};

export default App;