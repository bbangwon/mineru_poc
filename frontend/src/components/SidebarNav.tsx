import React from 'react';
import {
  LayoutDashboard,
  SlidersHorizontal,
  FileCode2,
  Sparkles,
  Layers,
  CheckCircle2,
  FileText,
} from 'lucide-react';

export type ActiveTab = 'dashboard' | 'studio';

interface SidebarNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  totalChunks: number;
  editedChunksCount: number;
  ignoredChunksCount: number;
  isDirty: boolean;
  activePdf?: string;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeTab,
  setActiveTab,
  totalChunks,
  editedChunksCount,
  ignoredChunksCount,
  isDirty,
  activePdf,
}) => {
  return (
    <aside className="w-16 sm:w-60 bg-slate-900 text-slate-300 flex flex-col shrink-0 border-r border-slate-800 transition-all select-none">
      {/* Top Brand Header */}
      <div className="h-16 px-4 flex items-center gap-3 border-b border-slate-800/80 bg-slate-950/40">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="hidden sm:block overflow-hidden">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm text-white tracking-tight">MinerU Studio</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-indigo-500/20 text-indigo-300 font-mono rounded border border-indigo-500/30">
              v2.0
            </span>
          </div>
          <p className="text-[11px] text-slate-400 truncate">RAG 계층 청킹 파이프라인</p>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="p-3 space-y-1.5 flex-1">
        <div className="hidden sm:block px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          워크스페이스
        </div>

        {/* Dashboard Tab */}
        <button
          type="button"
          onClick={() => setActiveTab('dashboard')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'dashboard'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="대시보드 (PDF 선택 & 파싱)"
        >
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          <div className="hidden sm:flex flex-1 items-center justify-between">
            <span>대시보드</span>
            <span className="text-[10px] opacity-70 font-normal">개요/파싱</span>
          </div>
        </button>

        {/* Chunk Studio Tab */}
        <button
          type="button"
          onClick={() => setActiveTab('studio')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer relative ${
            activeTab === 'studio'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="청크 스튜디오 (3단 계층 & 청크 에디터)"
        >
          <div className="relative">
            <SlidersHorizontal className="w-4 h-4 shrink-0" />
            {isDirty && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full animate-ping" />
            )}
          </div>
          <div className="hidden sm:flex flex-1 items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span>청크 스튜디오</span>
              {isDirty && (
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" title="저장되지 않은 변경사항" />
              )}
            </div>
            {totalChunks > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                  activeTab === 'studio'
                    ? 'bg-indigo-700/80 text-white'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {totalChunks}
              </span>
            )}
          </div>
        </button>

        {/* Section Divider */}
        <div className="pt-4 hidden sm:block">
          <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            임베딩 통계
          </div>
          <div className="px-2.5 py-2 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                전체 청크
              </span>
              <span className="font-mono text-slate-200 font-semibold">{totalChunks}</span>
            </div>

            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                수정된 청크
              </span>
              <span className="font-mono text-amber-300 font-semibold">{editedChunksCount}</span>
            </div>

            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <FileCode2 className="w-3.5 h-3.5 text-rose-400" />
                임베딩 제외
              </span>
              <span className="font-mono text-rose-300 font-semibold">{ignoredChunksCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Footer: Active PDF Status */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
        <div className="hidden sm:block">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1">
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>현재 작업 문서</span>
          </div>
          <p className="text-xs text-slate-200 truncate font-medium" title={activePdf || '문서 미선택'}>
            {activePdf || '문서 미선택'}
          </p>
        </div>
        <div className="sm:hidden flex justify-center text-slate-400">
          <FileText className="w-4 h-4 text-indigo-400" />
        </div>
      </div>
    </aside>
  );
};
