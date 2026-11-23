import React, { useState, useRef, useEffect } from 'react';
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
} from 'lucide-react';
import { downloadBlob } from '../downloadManager';

export default function BackgroundRemover() {
  const [mode, setMode] = useState('ai'); // 'ai' (ISNet ONNX offline) | 'solid' (fast white/solid remover)
  const [sourceFile, setSourceFile] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [resultBlob, setResultBlob] = useState(null);
  const [resultUrl, setResultUrl] = useState('');

  // AI Mode state
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState('');

  // Solid / Signature Mode state
  const [targetColor, setTargetColor] = useState('#ffffff');
  const [tolerance, setTolerance] = useState(38);
  const [softness, setSoftness] = useState(14);

  // Output background preview & export
  const [outputBg, setOutputBg] = useState('transparent'); // transparent | white | custom
  const [customBgColor, setCustomBgColor] = useState('#ffffff');
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [sourceUrl, resultUrl]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);

    setSourceFile(file);
    setSourceUrl(URL.createObjectURL(file));
    setResultBlob(null);
    setResultUrl('');
    setError('');
    setProgressText('');
    setProgressPct(0);
    e.target.value = '';
  };

  const hexToRgb = (hex) => {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };

  // Mode 1: AI Offline Removal (ISNet ONNX via @imgly/background-removal)
  const runAiRemoval = async () => {
    if (!sourceFile) return;
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

      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultBlob(blob);
      setResultUrl(URL.createObjectURL(blob));
      setProgressPct(100);
      setProgressText('ลบพื้นหลังเสร็จสมบูรณ์!');
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
  const runSolidRemoval = async () => {
    if (!sourceUrl) return;
    setProcessing(true);
    setError('');

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = sourceUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

      ctx.putImageData(imgData, 0, 0);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultBlob(blob);
      setResultUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(`ตัดพื้นหลังไม่สำเร็จ: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // Build final export blob (with optional solid background color)
  const buildFinalBlob = async (format = 'png') => {
    if (!resultUrl) return null;
    if (outputBg === 'transparent' && format === 'png' && resultBlob) {
      return resultBlob;
    }

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = resultUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');

    if (outputBg === 'white' || format === 'jpeg') {
      ctx.fillStyle = outputBg === 'custom' ? customBgColor : '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (outputBg === 'custom') {
      ctx.fillStyle = customBgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(img, 0, 0);
    return new Promise((resolve) =>
      canvas.toBlob(resolve, format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.95)
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
          ลบพื้นหลังแบบออฟไลน์ในเครื่อง 100% ไม่ต้องใช้ API Key เลือกได้ทั้งโหมด <strong>AI (ISNet ONNX)</strong> สำหรับรูปคน/สินค้า และโหมด <strong>ตัดพื้นขาวไวพิเศษ</strong> สำหรับลายเซ็น/ตราประทับ
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
        <div className="space-y-5">
          {/* Controls Card */}
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
                      ? 'เริ่มลบพื้นหลังด้วย AI'
                      : 'ตัดพื้นหลังสีเรียบทันที'}
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
                    ความเข้มการตัดสี: {tolerance}%
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

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Before / After Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-2.5">
              <div className="text-xs font-bold text-gray-500">ภาพต้นฉบับ (Before)</div>
              <div className="aspect-square max-h-96 bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center p-2">
                <img src={sourceUrl} alt="Original" className="max-w-full max-h-full object-contain" />
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-gray-500">ผลลัพธ์หลังลบพื้นหลัง (After)</span>
                {resultUrl && (
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
                )}
              </div>

              <div
                className="aspect-square max-h-96 rounded-xl overflow-hidden flex items-center justify-center p-2 border border-gray-200"
                style={previewBgStyle}
              >
                {resultUrl ? (
                  <img src={resultUrl} alt="Removed Background" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-xs text-gray-400">
                    กดปุ่ม "{mode === 'ai' ? 'เริ่มลบพื้นหลังด้วย AI' : 'ตัดพื้นหลังสีเรียบทันที'}" ด้านบน
                  </span>
                )}
              </div>

              {resultUrl && (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleDownload('png')}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Download size={14} />
                    <span>ดาวน์โหลด PNG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload('jpeg')}
                    className="py-2.5 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download size={14} />
                    <span>JPG</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyImage}
                    className="py-2.5 px-3 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกรูป'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
