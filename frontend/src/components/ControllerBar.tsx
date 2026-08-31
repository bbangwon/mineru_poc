import React, { useRef } from 'react';
import { FileText, Upload, Zap, Layers, Loader2 } from 'lucide-react';
import type { PdfItem } from '../types';

interface ControllerBarProps {
  pdfList: PdfItem[];
  selectedPdf: string;
  onSelectPdf: (filename: string) => void;
  onUploadPdf: (file: File) => Promise<void>;
  isUploading: boolean;
  engine: string;
  setEngine: (engine: string) => void;
  allPages: boolean;
  setAllPages: (all: boolean) => void;
  startPage: number;
  setStartPage: (p: number) => void;
  endPage: number;
  setEndPage: (p: number) => void;
  onRunEtl: () => void;
  isParsing: boolean;
}

export const ControllerBar: React.FC<ControllerBarProps> = ({
  pdfList,
  selectedPdf,
  onSelectPdf,
  onUploadPdf,
  isUploading,
  engine,
  setEngine,
  allPages,
  setAllPages,
  startPage,
  setStartPage,
  endPage,
  setEndPage,
  onRunEtl,
  isParsing,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentItem = pdfList.find((p) => p.filename === selectedPdf);
  const totalPages = currentItem?.total_pages || 0;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onUploadPdf(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
      {/* Row 1: Document Selection & Upload */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                대상 PDF 문서:
              </span>
              <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[11px] font-mono font-semibold">
                {totalPages} Pages
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <select
                value={selectedPdf}
                onChange={(e) => onSelectPdf(e.target.value)}
                className="text-sm font-bold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 focus:ring-2 focus:ring-indigo-500 focus:outline-none max-w-md truncate"
              >
                {pdfList.length === 0 && <option value="">PDF 목록 로딩 중...</option>}
                {pdfList.map((p) => (
                  <option key={p.filename} value={p.filename}>
                    {p.filename} ({p.total_pages}p)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Upload Button */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="text-xs bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg border border-slate-300 transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isUploading ? (
              <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 text-indigo-600" />
            )}
            <span>{isUploading ? '업로드 중...' : '새 PDF 업로드'}</span>
          </button>
        </div>
      </div>

      {/* Row 2: Parsing Engine & Page Range Configuration */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-3">
          {/* Engine Select */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="font-medium text-slate-500">엔진:</span>
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-300 rounded px-2 py-1 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="pipeline">Pipeline (한국어 최적화)</option>
              <option value="hybrid-engine">Hybrid-Engine (VLM 레이아웃)</option>
            </select>
          </div>

          {/* All Pages Toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded border border-indigo-200 transition">
            <input
              type="checkbox"
              checked={allPages}
              onChange={(e) => setAllPages(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
            />
            <Layers className="w-3.5 h-3.5 text-indigo-600" />
            <span>전체 페이지 파싱</span>
          </label>

          {/* Page Range Inputs */}
          <div
            className={`flex items-center gap-1.5 text-xs transition ${
              allPages ? 'opacity-50 pointer-events-none' : 'opacity-100'
            }`}
          >
            <span className="text-slate-500">범위:</span>
            <input
              type="number"
              min={0}
              max={Math.max(0, totalPages - 1)}
              value={startPage}
              disabled={allPages}
              onChange={(e) => setStartPage(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-12 px-1.5 py-1 bg-white border border-slate-300 rounded text-center font-mono text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100"
            />
            <span className="text-slate-400">~</span>
            <input
              type="number"
              min={0}
              max={Math.max(0, totalPages - 1)}
              value={endPage}
              disabled={allPages}
              onChange={(e) => setEndPage(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-12 px-1.5 py-1 bg-white border border-slate-300 rounded text-center font-mono text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-100"
            />
            <span className="text-[10px] text-slate-400">(0-based)</span>
          </div>
        </div>

        {/* Run Button */}
        <button
          type="button"
          disabled={isParsing || !selectedPdf}
          onClick={onRunEtl}
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-lg transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isParsing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          <span>{isParsing ? '파싱 및 계층 청킹 중...' : 'ETL 실행 & 계층 청킹'}</span>
        </button>
      </div>
    </div>
  );
};
