import React, { useState } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Upload,
  RotateCw,
  RotateCcw,
  Trash2,
  Undo2,
  Download,
  GripVertical,
  RefreshCw,
  FileText,
  ArrowUpDown,
  AlertCircle,
} from 'lucide-react';
import { downloadBlob } from '../downloadManager';

const SortablePageCard = ({ page, index, onRotate, onToggleDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-2xl border bg-white p-2.5 shadow-sm transition-all flex flex-col ${
        isDragging ? 'ring-2 ring-indigo-500 shadow-xl opacity-90' : 'border-gray-200 hover:border-indigo-300'
      } ${page.deleted ? 'opacity-45 bg-red-50/40 border-red-200' : ''}`}
    >
      {/* Top Drag Handle & Page Badge */}
      <div className="flex items-center justify-between gap-1 mb-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="ลากเพื่อสลับลำดับหน้า"
          className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-indigo-600 cursor-grab active:cursor-grabbing px-1 py-0.5 rounded"
        >
          <GripVertical size={14} />
          <span>หน้า {index + 1}</span>
        </button>
        <span className="text-[10px] font-mono text-gray-400">
          เดิม #{page.originalIndex + 1}
          {page.rotation !== 0 ? ` • ${page.rotation}°` : ''}
        </span>
      </div>

      {/* Thumbnail Preview */}
      <div className="relative aspect-[3/4] bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center mb-2.5 border border-gray-100">
        <img
          src={page.thumbUrl}
          alt={`Page ${page.originalIndex + 1}`}
          className="max-w-full max-h-full object-contain transition-transform duration-200 select-none"
          style={{ transform: `rotate(${page.rotation}deg)` }}
          draggable={false}
        />
        {page.deleted && (
          <div className="absolute inset-0 bg-red-900/35 flex items-center justify-center">
            <span className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-[11px] font-bold shadow">
              จะถูกลบ
            </span>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-1 mt-auto">
        <button
          type="button"
          onClick={() => onRotate(page.id, -90)}
          disabled={page.deleted}
          title="หมุนซ้าย 90°"
          className="py-1.5 rounded-lg bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 text-gray-600 flex items-center justify-center transition-all disabled:opacity-30"
        >
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          onClick={() => onRotate(page.id, 90)}
          disabled={page.deleted}
          title="หมุนขวา 90°"
          className="py-1.5 rounded-lg bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 text-gray-600 flex items-center justify-center transition-all disabled:opacity-30"
        >
          <RotateCw size={14} />
        </button>
        <button
          type="button"
          onClick={() => onToggleDelete(page.id)}
          title={page.deleted ? 'กู้คืนหน้านี้' : 'ลบหน้านี้'}
          className={`py-1.5 rounded-lg flex items-center justify-center transition-all ${
            page.deleted
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              : 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
          }`}
        >
          {page.deleted ? <Undo2 size={14} /> : <Trash2 size={14} />}
        </button>
      </div>
    </div>
  );
};

export default function PdfOrganizer() {
  const [file, setFile] = useState(null);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleFileChange = async (e) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setError('');
    setLoading(true);
    setFile(selected);
    setPages([]);

    try {
      const buf = await selected.arrayBuffer();
      const copyForLib = buf.slice(0);
      setPdfBytes(copyForLib);

      const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
      const rendered = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.45 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        rendered.push({
          id: `page_${i}_${Date.now()}`,
          originalIndex: i - 1,
          rotation: 0,
          deleted: false,
          thumbUrl: canvas.toDataURL('image/jpeg', 0.72),
        });
      }
      setPages(rendered);
    } catch (err) {
      console.error(err);
      setError('ไม่สามารถอ่านไฟล์ PDF ได้ (ไฟล์อาจถูกล็อกรหัสผ่านอยู่ ให้ใช้เมนู ล็อก/ปลดล็อก PDF ก่อน)');
      setFile(null);
      setPdfBytes(null);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPages((items) => {
      const oldIndex = items.findIndex((p) => p.id === active.id);
      const newIndex = items.findIndex((p) => p.id === over.id);
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const handleRotate = (id, delta) => {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + delta + 360) % 360 } : p))
    );
  };

  const handleRotateAll = (delta) => {
    setPages((prev) =>
      prev.map((p) => (p.deleted ? p : { ...p, rotation: (p.rotation + delta + 360) % 360 }))
    );
  };

  const handleToggleDelete = (id) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, deleted: !p.deleted } : p)));
  };

  const handleReverseOrder = () => {
    setPages((prev) => [...prev].reverse());
  };

  const handleResetAll = () => {
    setPages((prev) =>
      [...prev]
        .sort((a, b) => a.originalIndex - b.originalIndex)
        .map((p) => ({ ...p, rotation: 0, deleted: false }))
    );
  };

  const activeCount = pages.filter((p) => !p.deleted).length;

  const handleExportPdf = async () => {
    if (!pdfBytes || activeCount === 0) return;
    setSaving(true);
    setError('');
    try {
      const srcDoc = await PDFDocument.load(pdfBytes.slice(0), { ignoreEncryption: true });
      const outDoc = await PDFDocument.create();

      const keptPages = pages.filter((p) => !p.deleted);
      const indices = keptPages.map((p) => p.originalIndex);
      const copiedPages = await outDoc.copyPages(srcDoc, indices);

      copiedPages.forEach((copied, i) => {
        const extraRot = keptPages[i].rotation;
        if (extraRot !== 0) {
          const currentRot = copied.getRotation().angle || 0;
          copied.setRotation(degrees((currentRot + extraRot) % 360));
        }
        outDoc.addPage(copied);
      });

      const outBytes = await outDoc.save();
      const blob = new Blob([outBytes], { type: 'application/pdf' });
      const baseName = (file?.name || 'document.pdf').replace(/\.pdf$/i, '');
      await downloadBlob(blob, `${baseName}-organized.pdf`, 'จัดเรียง/หมุน/ลบหน้า PDF');
    } catch (err) {
      console.error(err);
      setError(`สร้างไฟล์ PDF ไม่สำเร็จ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">จัดเรียง / หมุน / ลบหน้า PDF</h2>
          <p className="text-sm text-gray-500 mt-1">
            ลากสลับลำดับหน้า, หมุนหน้าเอียง 90°/180°, หรือลบหน้าไม่ต้องการ แล้วส่งออกเป็นไฟล์ PDF ใหม่ได้ทันที
          </p>
        </div>

        {file && (
          <label className="px-3.5 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer inline-flex items-center gap-1.5 self-start sm:self-auto">
            <Upload size={14} />
            <span>เปลี่ยนไฟล์ PDF</span>
            <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />
          </label>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!file && !loading && (
        <label className="block bg-white p-12 rounded-2xl border-2 border-dashed border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/20 transition-all text-center cursor-pointer">
          <input type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4">
            <FileText size={32} />
          </div>
          <p className="text-base font-semibold text-gray-800">คลิกเพื่อเลือกไฟล์ PDF</p>
          <p className="text-xs text-gray-500 mt-1">รองรับการลากสลับหน้า หมุนทีละหน้า/ทั้งหมด และลบหน้าไม่ต้องการ</p>
        </label>
      )}

      {loading && (
        <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center space-y-3">
          <RefreshCw size={28} className="animate-spin text-indigo-600 mx-auto" />
          <p className="text-sm font-medium text-gray-700">กำลังสร้างภาพตัวอย่างทุกหน้าของ PDF...</p>
        </div>
      )}

      {!loading && pages.length > 0 && (
        <>
          {/* Sticky Action Toolbar */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700">
                คงเหลือ {activeCount} / {pages.length} หน้า
              </span>
              <button
                type="button"
                onClick={() => handleRotateAll(-90)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-medium text-gray-700 flex items-center gap-1"
              >
                <RotateCcw size={13} />
                <span>หมุนซ้ายทั้งหมด</span>
              </button>
              <button
                type="button"
                onClick={() => handleRotateAll(90)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-medium text-gray-700 flex items-center gap-1"
              >
                <RotateCw size={13} />
                <span>หมุนขวาทั้งหมด</span>
              </button>
              <button
                type="button"
                onClick={handleReverseOrder}
                className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-medium text-gray-700 flex items-center gap-1"
              >
                <ArrowUpDown size={13} />
                <span>กลับลำดับหน้า</span>
              </button>
              <button
                type="button"
                onClick={handleResetAll}
                className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-medium text-gray-500 flex items-center gap-1"
              >
                <Undo2 size={13} />
                <span>รีเซ็ต</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportPdf}
              disabled={saving || activeCount === 0}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm flex items-center gap-2 transition-all disabled:opacity-50"
            >
              {saving ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
              <span>{saving ? 'กำลังบันทึก PDF...' : `บันทึก PDF ใหม่ (${activeCount} หน้า)`}</span>
            </button>
          </div>

          {/* Draggable Page Grid */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                {pages.map((page, idx) => (
                  <SortablePageCard
                    key={page.id}
                    page={page}
                    index={idx}
                    onRotate={handleRotate}
                    onToggleDelete={handleToggleDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}
    </div>
  );
}
