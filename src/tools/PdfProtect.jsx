import React, { useState } from 'react';
import { PDFDocument } from '@cantoo/pdf-lib';
import {
  Lock,
  Unlock,
  Upload,
  Eye,
  EyeOff,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { downloadBlob } from '../downloadManager';

export default function PdfProtect() {
  const [mode, setMode] = useState('lock'); // lock | unlock
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Permissions when locking
  const [allowPrint, setAllowPrint] = useState(true);
  const [allowCopy, setAllowCopy] = useState(false);
  const [allowModify, setAllowModify] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleFileSelect = (e) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setError('');
    setSuccessMsg('');
    e.target.value = '';
  };

  const handleProcess = async () => {
    if (!file) {
      setError('กรุณาเลือกไฟล์ PDF ก่อน');
      return;
    }

    if (mode === 'lock') {
      if (!password.trim()) {
        setError('กรุณากำหนดรหัสผ่านสำหรับเปิดไฟล์ PDF');
        return;
      }
      if (password !== confirmPassword) {
        setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
        return;
      }
    }

    setProcessing(true);
    setError('');
    setSuccessMsg('');

    try {
      const arrayBuf = await file.arrayBuffer();
      const baseName = file.name.replace(/\.pdf$/i, '');

      if (mode === 'lock') {
        const pdfDoc = await PDFDocument.load(arrayBuf, { ignoreEncryption: true });
        await pdfDoc.encrypt({
          userPassword: password,
          ownerPassword: ownerPassword.trim() || password,
          permissions: {
            printing: allowPrint ? 'highResolution' : false,
            modifying: allowModify,
            copying: allowCopy,
            annotating: allowModify,
            fillingForms: allowModify,
            contentAccessibility: allowCopy,
            documentAssembly: allowModify,
          },
        });
        const outBytes = await pdfDoc.save();
        const blob = new Blob([outBytes], { type: 'application/pdf' });
        await downloadBlob(blob, `${baseName}-protected.pdf`, 'ล็อก/ปลดล็อก PDF');
        setSuccessMsg('เข้ารหัสและบันทึกล็อกรหัสผ่าน PDF เรียบร้อยแล้ว');
      } else {
        // Unlock mode
        const pdfDoc = await PDFDocument.load(arrayBuf, {
          password: password || undefined,
          ignoreEncryption: !password,
        });
        const outBytes = await pdfDoc.save();
        const blob = new Blob([outBytes], { type: 'application/pdf' });
        await downloadBlob(blob, `${baseName}-unlocked.pdf`, 'ล็อก/ปลดล็อก PDF');
        setSuccessMsg('ปลดล็อกรหัสผ่านและบันทึกไฟล์ PDF ใหม่เรียบร้อยแล้ว');
      }
    } catch (err) {
      console.error(err);
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypt')) {
        setError('รหัสผ่านไม่ถูกต้อง หรือไฟล์นี้ใช้การเข้ารหัสที่ต้องใส่รหัสผ่านที่ถูกต้อง');
      } else {
        setError(`ดำเนินการไม่สำเร็จ: ${msg || 'เกิดข้อผิดพลาดกับไฟล์ PDF'}`);
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
          <ShieldCheck className="text-indigo-600" size={26} />
          <span>ล็อก / ปลดล็อกรหัสผ่าน PDF</span>
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          ใส่รหัสผ่านก่อนส่งเอกสารสำคัญ หรือปลดรหัสไฟล์ PDF ที่มีรหัสผ่านอยู่แล้ว (ประมวลผลในเครื่อง 100%)
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-2 gap-3 bg-white p-2 rounded-2xl border border-gray-200 shadow-sm">
        <button
          type="button"
          onClick={() => {
            setMode('lock');
            setError('');
            setSuccessMsg('');
          }}
          className={`py-3 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
            mode === 'lock'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Lock size={17} />
          <span>ล็อกรหัสผ่าน PDF</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('unlock');
            setError('');
            setSuccessMsg('');
          }}
          className={`py-3 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
            mode === 'unlock'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Unlock size={17} />
          <span>ปลดล็อกรหัสผ่าน PDF</span>
        </button>
      </div>

      {/* File Upload Card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-5">
        <label className="block border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-2xl p-6 text-center cursor-pointer transition-all hover:bg-gray-50/50">
          <input type="file" accept="application/pdf" onChange={handleFileSelect} className="hidden" />
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-2.5">
            {file ? <FileText size={24} /> : <Upload size={24} />}
          </div>
          {file ? (
            <div>
              <p className="text-sm font-semibold text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {(file.size / 1024 / 1024).toFixed(2)} MB • คลิกเพื่อเปลี่ยนไฟล์
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-gray-800">คลิกเพื่อเลือกไฟล์ PDF</p>
              <p className="text-xs text-gray-500 mt-0.5">ไฟล์ไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์ ปลอดภัย 100%</p>
            </div>
          )}
        </label>

        {/* Password Inputs */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              {mode === 'lock' ? 'รหัสผ่านสำหรับเปิดไฟล์ (User Password)' : 'รหัสผ่านเดิมของไฟล์ PDF'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'lock' ? 'ตั้งรหัสผ่านที่ต้องการ...' : 'กรอกรหัสผ่านของไฟล์ (เว้นว่างถ้าติดแค่ล็อกสิทธิ์พิมพ์)'}
                className="w-full pr-11 pl-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {mode === 'lock' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  ยืนยันรหัสผ่านอีกครั้ง
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="กรอกรหัสผ่านให้ตรงกัน..."
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  รหัสผ่านผู้ดูแลสิทธิ์ (Owner Password - ไม่บังคับ)
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder="เว้นว่างไว้เพื่อใช้รหัสเดียวกับด้านบน"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              {/* Permissions */}
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-2.5">
                <div className="text-xs font-semibold text-gray-700">กำหนดสิทธิ์ผู้รับไฟล์</div>
                <label className="flex items-center gap-2.5 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowPrint}
                    onChange={(e) => setAllowPrint(e.target.checked)}
                    className="rounded accent-indigo-600"
                  />
                  <span>อนุญาตให้สั่งพิมพ์ (Print)</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowCopy}
                    onChange={(e) => setAllowCopy(e.target.checked)}
                    className="rounded accent-indigo-600"
                  />
                  <span>อนุญาตให้คัดลอกข้อความ/รูปภาพ (Copy)</span>
                </label>
                <label className="flex items-center gap-2.5 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowModify}
                    onChange={(e) => setAllowModify(e.target.checked)}
                    className="rounded accent-indigo-600"
                  />
                  <span>อนุญาตให้แก้ไขเอกสาร (Modify)</span>
                </label>
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleProcess}
          disabled={!file || processing}
          className={`w-full py-3 rounded-xl text-white font-semibold text-sm shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${
            mode === 'lock'
              ? 'bg-indigo-600 hover:bg-indigo-700'
              : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {processing ? (
            <RefreshCw size={17} className="animate-spin" />
          ) : mode === 'lock' ? (
            <Lock size={17} />
          ) : (
            <Download size={17} />
          )}
          <span>
            {processing
              ? 'กำลังประมวลผล...'
              : mode === 'lock'
              ? 'เข้ารหัสและบันทึกไฟล์ PDF'
              : 'ปลดล็อกและบันทึกไฟล์ PDF'}
          </span>
        </button>
      </div>
    </div>
  );
}
