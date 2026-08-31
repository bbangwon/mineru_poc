import React from 'react';
import { Brain, Download, Cpu } from 'lucide-react';

interface HeaderProps {
  hasData: boolean;
}

export const Header: React.FC<HeaderProps> = ({ hasData }) => {
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

        <div className="flex items-center space-x-3">
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 mr-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <Cpu className="w-3.5 h-3.5 mr-1" />
            Apple Silicon Metal
          </span>

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
            <span>RAG JSONL 다운로드</span>
          </a>
        </div>
      </div>
    </header>
  );
};
