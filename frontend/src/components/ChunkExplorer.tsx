import React, { useState, useMemo } from 'react';
import { Layers, Table2, AlignLeft, Filter, Search, X } from 'lucide-react';
import type { ChildChunk, ParentSection } from '../types';
import { ChunkCard } from './ChunkCard';

interface ChunkExplorerProps {
  chunks: ChildChunk[];
  parentSections: ParentSection[];
  selectedSectionId: string | null;
  onClearSectionFilter: () => void;
  onOpenJsonlModal: (chunk: ChildChunk) => void;
  onEditChunk?: (chunk: ChildChunk) => void;
  isLoading: boolean;
}

export const ChunkExplorer: React.FC<ChunkExplorerProps> = ({
  chunks,
  parentSections,
  selectedSectionId,
  onClearSectionFilter,
  onOpenJsonlModal,
  onEditChunk,
  isLoading,
}) => {
  const [typeFilter, setTypeFilter] = useState<'all' | 'table' | 'paragraph'>('all');
  const [query, setQuery] = useState('');

  const parentMap = useMemo(() => {
    const map = new Map<string, ParentSection>();
    parentSections.forEach((p) => map.set(p.id, p));
    return map;
  }, [parentSections]);

  const activeSection = selectedSectionId ? parentMap.get(selectedSectionId) : null;

  const filteredChunks = useMemo(() => {
    let result = chunks;

    // Filter by selected parent section
    if (selectedSectionId) {
      result = result.filter((c) => c.parent_id === selectedSectionId);
    }

    // Filter by type
    if (typeFilter !== 'all') {
      result = result.filter((c) => c.chunk_type === typeFilter);
    }

    // Filter by query text
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (c) =>
          c.text.toLowerCase().includes(q) ||
          c.chunk_id.toLowerCase().includes(q) ||
          (c.table_caption && c.table_caption.toLowerCase().includes(q))
      );
    }

    return result;
  }, [chunks, selectedSectionId, typeFilter, query]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col h-[780px]">
      {/* Top Header */}
      <div className="p-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/50 rounded-t-xl">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-indigo-600" />
            <span>청크 뷰어 (Chunk Viewer)</span>
          </h3>

          {/* Active section badge */}
          {activeSection ? (
            <span className="inline-flex items-center gap-1 text-[11px] bg-indigo-100 text-indigo-800 font-semibold px-2 py-0.5 rounded">
              <span className="max-w-[200px] truncate">섹션: {activeSection.title}</span>
              <button
                type="button"
                onClick={onClearSectionFilter}
                className="hover:text-indigo-950 cursor-pointer"
                title="섹션 필터 해제"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ) : (
            <span className="text-[11px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">
              전체 청크
            </span>
          )}
        </div>

        {/* Type Filter Buttons */}
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition cursor-pointer ${
              typeFilter === 'all'
                ? 'bg-indigo-100 text-indigo-800 font-semibold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter('table')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition flex items-center gap-1 cursor-pointer ${
              typeFilter === 'table'
                ? 'bg-indigo-100 text-indigo-800 font-semibold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Table2 className="w-3.5 h-3.5 text-indigo-600" />
            <span>표만 보기</span>
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter('paragraph')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition flex items-center gap-1 cursor-pointer ${
              typeFilter === 'paragraph'
                ? 'bg-indigo-100 text-indigo-800 font-semibold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <AlignLeft className="w-3.5 h-3.5 text-slate-400" />
            <span>문단만 보기</span>
          </button>
        </div>
      </div>

      {/* Filter / Search Sub-bar */}
      <div className="p-2.5 border-b border-slate-100 bg-white flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="청크 내용 검색..."
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none placeholder-slate-400"
          />
        </div>
        <div className="text-[11px] text-slate-500 font-mono">
          총 <strong className="text-slate-800">{filteredChunks.length}</strong>개 청크
        </div>
      </div>

      {/* Chunk List Container */}
      <div className="p-4 overflow-y-auto flex-1 space-y-4 bg-slate-50/50">
        {isLoading ? (
          <div className="text-slate-400 text-center py-20">청크 데이터를 불러오는 중...</div>
        ) : filteredChunks.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
            <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">조건에 일치하는 청크가 없습니다.</p>
          </div>
        ) : (
          filteredChunks.map((chunk) => (
            <ChunkCard
              key={chunk.chunk_id}
              chunk={chunk}
              parentSection={parentMap.get(chunk.parent_id)}
              onOpenJsonlModal={onOpenJsonlModal}
              onEditChunk={onEditChunk}
            />
          ))
        )}
      </div>
    </div>
  );
};
