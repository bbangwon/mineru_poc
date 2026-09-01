import React from 'react';
import { Brain, Download, Cpu, Save, RotateCcw, Loader2 } from 'lucide-react';

interface HeaderProps {
  hasData: boolean;
  isDirty?: boolean;
  isSaving?: boolean;
  isResetting?: boolean;
  onSave?: () => void;
  onReset?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  hasData,
  isDirty = false,
  isSaving = false,
  isResetting = false,
  onSave,
  onReset,
}) => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-indigo-600 to-violet-600 text-white p-2.5 rounded-xl shadow-md shadow-indigo-100 flex items-center justify-center">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 leading-tight">MinerU RAG ETL Studio</h1>
              <span className="text-[11px] bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded border border-indigo-200">
                v2.0 ETL
              </span>
            </div>
            <p className="text-xs text-slate-500">부모-자식 계층 청킹 & 원형 보존 표 파싱 파이프라인</p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <span className="hidden lg:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 mr-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <Cpu className="w-3.5 h-3.5 mr-1" />
            Apple Silicon Metal
          </span>

          {/* Reset to Original Button */}
          {hasData && onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={isResetting || isSaving}
              className="text-xs font-medium px-3 py-2 rounded-lg transition border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
              title="수정본을 삭제하고 원본 파싱 결과로 복원"
            >
              {isResetting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>초기화</span>
            </button>
          )}

          {/* Save Edited Result Button */}
          {hasData && onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving || isResetting}
              className={`text-xs font-semibold px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                isDirty
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-900 text-white'
              } disabled:opacity-50`}
              title="현재 수정한 청크 및 섹션 데이터를 백엔드에 영속 저장"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{isDirty ? '수정본 저장*' : '수정본 저장'}</span>
            </button>
          )}

          {/* Download JSONL Button */}
          <a
            href="/api/etl/export/jsonl"
            download="rag_chunks.jsonl"
            className={`text-xs font-medium px-3.5 py-2 rounded-lg transition shadow-xs flex items-center gap-1.5 ${
              hasData
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-slate-200 text-slate-400 pointer-events-none'
            }`}
            title="RAG 표준 JSONL 파일 다운로드"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">RAG JSONL 다운로드</span>
            <span className="sm:hidden">JSONL</span>
          </a>
        </div>
      </div>
    </header>
  );
};
