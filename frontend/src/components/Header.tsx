import React from 'react';
import {
  Download,
  Cpu,
  Save,
  RotateCcw,
  Loader2,
  LayoutDashboard,
  SlidersHorizontal,
  FileText,
  ListOrdered,
  Database,
  Search,
  Zap,
  Bot,
} from 'lucide-react';
import type { ActiveTab } from './SidebarNav';
import { ThemeToggle } from './ThemeToggle';
import type { ThemeMode } from '../utils/useTheme';

interface HeaderProps {
  hasData: boolean;
  activeTab?: ActiveTab;
  activePdf?: string;
  isDirty?: boolean;
  isSaving?: boolean;
  isResetting?: boolean;
  isIndexingQdrant?: boolean;
  qdrantIndexProgress?: { msg: string; pct: number } | null;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  onSave?: () => void;
  onReset?: () => void;
  onReindex?: () => void;
  onOpenLLMConfig?: () => void;
  onOpenQdrantConfig?: () => void;
  onIndexQdrant?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  hasData,
  activeTab = 'dashboard',
  activePdf,
  isDirty = false,
  isSaving = false,
  isResetting = false,
  isIndexingQdrant = false,
  qdrantIndexProgress = null,
  theme,
  setTheme,
  onSave,
  onReset,
  onReindex,
  onOpenLLMConfig,
  onOpenQdrantConfig,
  onIndexQdrant,
}) => {
  return (
    <header className="bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-2xs backdrop-blur-md transition-colors">
      <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Left: Active Tab Badge & Current PDF name */}
        <div className="flex items-center space-x-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors shrink-0 ${
                activeTab === 'studio'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                  : activeTab === 'search'
                  ? 'bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300'
                  : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {activeTab === 'studio' ? (
                <>
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>청크 에디터 스튜디오</span>
                </>
              ) : activeTab === 'search' ? (
                <>
                  <Search className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>하이브리드 검색</span>
                </>
              ) : (
                <>
                  <LayoutDashboard className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                  <span>파싱 대시보드</span>
                </>
              )}
            </span>

            {activePdf && (
              <span
                className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 max-w-xs truncate"
                title={activePdf}
              >
                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{activePdf}</span>
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions and Theme Switcher */}
        <div className="flex items-center space-x-2 shrink-0">
          <span className="hidden xl:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
            <span className="w-2 h-2 mr-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <Cpu className="w-3.5 h-3.5 mr-1" />
            Apple Silicon Metal
          </span>

          {/* Reindex IDs Button */}
          {hasData && onReindex && (
            <button
              type="button"
              onClick={onReindex}
              disabled={isResetting || isSaving}
              className="text-xs font-semibold px-3 py-2 rounded-xl transition border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
              title="전체 섹션(s01~)과 청크(c001~) ID를 문서 순서대로 일괄 재정렬"
            >
              <ListOrdered className="w-3.5 h-3.5 text-indigo-500" />
              <span className="hidden lg:inline">ID 재정렬</span>
            </button>
          )}

          {/* Reset to Original Button */}
          {hasData && onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={isResetting || isSaving}
              className="text-xs font-semibold px-3 py-2 rounded-xl transition border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
              title="수정본을 삭제하고 원본 파싱 결과로 복원"
            >
              {isResetting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span className="hidden sm:inline">초기화</span>
            </button>
          )}

          {/* Save Edited Result Button */}
          {hasData && onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving || isResetting}
              className={`text-xs font-semibold px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                isDirty
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              } disabled:opacity-50`}
              title="현재 수정한 청크 및 섹션 데이터를 백엔드에 영속 저장"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{isDirty ? '저장*' : '저장'}</span>
            </button>
          )}

          {/* Qdrant Indexing Button */}
          {hasData && onIndexQdrant && (
            <button
              type="button"
              onClick={onIndexQdrant}
              disabled={isIndexingQdrant || isSaving || isResetting}
              className={`text-xs font-semibold px-3 py-2 rounded-xl transition border flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                isIndexingQdrant
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400 animate-pulse'
                  : 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300'
              } disabled:opacity-50`}
              title="현재 청크 데이터를 Dense(BGE-M3) & Sparse(Kiwi+IDF)로 인코딩하여 Qdrant에 색인"
            >
              {isIndexingQdrant ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                  <span>
                    색인 중{qdrantIndexProgress ? ` (${qdrantIndexProgress.pct}%)` : '...'}
                  </span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span className="hidden md:inline">Qdrant 색인</span>
                </>
              )}
            </button>
          )}

          {/* LLM Config Modal Button */}
          {onOpenLLMConfig && (
            <button
              type="button"
              onClick={onOpenLLMConfig}
              className="text-xs font-semibold px-2.5 py-2 rounded-xl transition border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="로컬 LLM(gemma4:12b-mlx 등) 기반 텍스트 자동 교정 및 OpenAI 호환 설정"
            >
              <Bot className="w-3.5 h-3.5 text-indigo-500" />
              <span className="hidden xl:inline">LLM 설정</span>
            </button>
          )}

          {/* Qdrant Config Modal Button */}
          {onOpenQdrantConfig && (
            <button
              type="button"
              onClick={onOpenQdrantConfig}
              className="text-xs font-semibold px-2.5 py-2 rounded-xl transition border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer shadow-2xs"
              title="Qdrant 연결 및 컬렉션 설정 (로컬 파일 DB / 원격 서버)"
            >
              <Database className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span className="hidden xl:inline">Qdrant 설정</span>
            </button>
          )}

          {/* Download JSONL Button */}
          <a
            href="/api/etl/export/jsonl"
            download="rag_chunks.jsonl"
            className={`text-xs font-semibold px-3 py-2 rounded-xl transition shadow-2xs flex items-center gap-1.5 border ${
              hasData
                ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                : 'bg-slate-100 dark:bg-slate-800/40 border-transparent text-slate-400 dark:text-slate-600 pointer-events-none'
            }`}
            title="RAG 표준 JSONL 파일 다운로드"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">JSONL</span>
          </a>

          {/* Theme Switcher in Header */}
          <div className="pl-1 border-l border-slate-200 dark:border-slate-800">
            <ThemeToggle theme={theme} setTheme={setTheme} compact />
          </div>
        </div>
      </div>
    </header>
  );
};
