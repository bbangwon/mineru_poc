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
} from 'lucide-react';
import type { ActiveTab } from './SidebarNav';

interface HeaderProps {
  hasData: boolean;
  activeTab?: ActiveTab;
  activePdf?: string;
  isDirty?: boolean;
  isSaving?: boolean;
  isResetting?: boolean;
  isIndexingQdrant?: boolean;
  qdrantIndexProgress?: { msg: string; pct: number } | null;
  onSave?: () => void;
  onReset?: () => void;
  onReindex?: () => void;
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
  onSave,
  onReset,
  onReindex,
  onOpenQdrantConfig,
  onIndexQdrant,
}) => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
      <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
              activeTab === 'studio'
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : activeTab === 'search'
                ? 'bg-purple-50 border-purple-200 text-purple-700'
                : 'bg-slate-100 border-slate-200 text-slate-700'
            }`}>
              {activeTab === 'studio' ? (
                <>
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
                  <span>청크 에디터 스튜디오</span>
                </>
              ) : activeTab === 'search' ? (
                <>
                  <Search className="w-3.5 h-3.5 text-purple-600" />
                  <span>하이브리드 검색</span>
                </>
              ) : (
                <>
                  <LayoutDashboard className="w-3.5 h-3.5 text-slate-600" />
                  <span>파싱 대시보드</span>
                </>
              )}
            </span>

            {activePdf && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-slate-600 font-medium px-2 py-0.5 rounded bg-slate-50 border border-slate-200 max-w-xs truncate" title={activePdf}>
                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{activePdf}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <span className="hidden lg:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
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
              className="text-xs font-medium px-3 py-2 rounded-lg transition border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100 text-indigo-700 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
              title="전체 섹션(s01~)과 청크(c001~) ID를 문서 순서대로 일괄 재정렬"
            >
              <ListOrdered className="w-3.5 h-3.5 text-indigo-600" />
              <span>ID 재정렬</span>
            </button>
          )}

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

          {/* Qdrant Indexing Button */}
          {hasData && onIndexQdrant && (
            <button
              type="button"
              onClick={onIndexQdrant}
              disabled={isIndexingQdrant || isSaving || isResetting}
              className={`text-xs font-semibold px-3 py-2 rounded-lg transition border flex items-center gap-1.5 cursor-pointer shadow-xs ${
                isIndexingQdrant
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 animate-pulse'
                  : 'bg-indigo-50 border-indigo-200 hover:bg-indigo-100 text-indigo-700'
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
                  <Zap className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Qdrant 색인</span>
                </>
              )}
            </button>
          )}

          {/* Qdrant Config Modal Button */}
          {onOpenQdrantConfig && (
            <button
              type="button"
              onClick={onOpenQdrantConfig}
              className="text-xs font-medium px-2.5 py-2 rounded-lg transition border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-1 cursor-pointer shadow-2xs"
              title="Qdrant 연결 및 컬렉션 설정 (로컬 파일 DB / 원격 서버)"
            >
              <Database className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden xl:inline">Qdrant 설정</span>
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
