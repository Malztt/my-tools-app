import React, { useState } from 'react';
import {
  Key,
  Eye,
  EyeOff,
  Check,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Zap,
  FileSearch,
} from 'lucide-react';

export default function ApiKeySettings({ geminiApiKey, onSaveGeminiApiKey }) {
  const [inputKey, setInputKey] = useState(geminiApiKey || '');
  const [showKeyText, setShowKeyText] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const hasKey = Boolean(geminiApiKey && geminiApiKey.trim());

  const handleSave = (e) => {
    e.preventDefault();
    onSaveGeminiApiKey(inputKey.trim());
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleClear = () => {
    setInputKey('');
    onSaveGeminiApiKey('');
    setSavedNotice(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
          <Key className="text-indigo-600" size={26} />
          <span>ตั้งค่า API Key</span>
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          จัดการ API Key จากจุดเดียว ทุกเมนูที่ต้องใช้งาน AI จะดึงไปใช้อัตโนมัติโดยไม่ต้องกรอกซ้ำ
        </p>
      </div>

      {/* Gemini API Key Card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Key size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Google Gemini API Key</h3>
              <p className="text-xs text-gray-500">ใช้สำหรับประมวลผล AI &amp; OCR (โมเดล gemini-2.5-flash)</p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
              hasKey
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            {hasKey ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span>{hasKey ? 'ตั้งค่าแล้ว (พร้อมใช้งาน)' : 'ยังไม่มี API Key'}</span>
          </span>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-700">
              กรอก Gemini API Key
            </label>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:underline flex items-center gap-1 font-medium"
            >
              <span>ขอรับฟรีที่ Google AI Studio</span>
              <ExternalLink size={12} />
            </a>
          </div>

          <div className="relative">
            <input
              type={showKeyText ? 'text' : 'password'}
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="วาง Gemini API Key ของคุณที่นี่ (AIzaSy...)"
              className="w-full pl-4 pr-11 py-2.5 text-sm rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKeyText((v) => !v)}
              title={showKeyText ? 'ซ่อน Key' : 'แสดง Key'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showKeyText ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
            >
              {savedNotice ? <Check size={15} /> : <Key size={15} />}
              <span>{savedNotice ? 'บันทึกเรียบร้อยแล้ว' : 'บันทึก API Key'}</span>
            </button>

            {hasKey && (
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition-all flex items-center gap-1.5"
              >
                <Trash2 size={14} />
                <span>ลบ Key ออก</span>
              </button>
            )}
          </div>
        </form>

        {/* Privacy note */}
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-600">
          <ShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
          <span>
            API Key จะถูกบันทึกไว้เฉพาะในเครื่องของคุณ (<code className="font-mono">localStorage</code>) ไม่มีการส่งไปยังเซิร์ฟเวอร์อื่นนอกจากเรียกใช้งาน Google Gemini API โดยตรง
          </span>
        </div>

        {/* Tools using this key */}
        <div className="pt-2 border-t border-gray-100 space-y-2">
          <p className="text-xs font-semibold text-gray-700">ฟังก์ชันที่ใช้ Gemini API Key นี้:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-xs">
              <Zap size={15} className="text-indigo-600 shrink-0" />
              <span className="font-medium text-gray-800">ดึงข้อความ OCR</span>
            </div>
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-xs">
              <FileSearch size={15} className="text-indigo-600 shrink-0" />
              <span className="font-medium text-gray-800">ทำ PDF ค้นหาได้ (OCR)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
