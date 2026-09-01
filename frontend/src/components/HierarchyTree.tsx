import React, { useState, useMemo } from 'react';
import { Network, BookOpen, Folder, FileText, Info, Search } from 'lucide-react';
import type { ParentSection } from '../types';

interface HierarchyTreeProps {
  sections: ParentSection[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  isLoading: boolean;
}

export const HierarchyTree: React.FC<HierarchyTreeProps> = ({
  sections,
  selectedSectionId,
  onSelectSection,
  isLoading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSections = useMemo(() => {
    if (!searchTerm.trim()) return sections;
    const term = searchTerm.toLowerCase();
    return sections.filter((s) => s.title.toLowerCase().includes(term));
  }, [sections, searchTerm]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col h-[780px]">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50 rounded-t-xl">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-indigo-600" />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            문서 계층 구조 (Tree)
          </h3>
        </div>
        <button
          type="button"
          onClick={() => onSelectSection(null)}
          className={`text-[11px] font-medium transition cursor-pointer ${
            selectedSectionId === null
              ? 'text-slate-400 cursor-default'
              : 'text-indigo-600 hover:underline'
          }`}
        >
          전체 보기
        </button>
      </div>

      {/* Info sub-bar */}
      <div className="p-2.5 border-b border-slate-100 bg-slate-50 flex items-center text-[11px] text-slate-500 gap-1.5">
        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="truncate">섹션을 클릭하면 해당 부모의 자식 청크만 필터링됩니다.</span>
      </div>

      {/* Search within tree */}
      <div className="p-2 border-b border-slate-100 bg-white">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="제목 / 섹션 검색..."
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none placeholder-slate-400"
          />
        </div>
      </div>

      {/* Tree list */}
      <div className="p-2 overflow-y-auto flex-1 space-y-1 text-xs font-medium">
        {isLoading ? (
          <div className="text-slate-400 text-center py-16">계층 구조를 분석하는 중...</div>
        ) : filteredSections.length === 0 ? (
          <div className="text-slate-400 text-center py-16">표시할 섹션이 없습니다.</div>
        ) : (
          filteredSections.map((sec) => {
            const isRoot = sec.level === 0;
            const indentClass =
              sec.level === 0
                ? 'pl-2'
                : sec.level === 1
                ? 'pl-4'
                : sec.level === 2
                ? 'pl-6'
                : 'pl-8';

            const isActive = selectedSectionId === sec.id;

            return (
              <div
                key={sec.id}
                onClick={() => onSelectSection(sec.id)}
                className={`py-2 px-2.5 rounded-lg cursor-pointer flex items-center justify-between transition border-l-3 ${indentClass} ${
                  isActive
                    ? 'bg-indigo-50/80 border-indigo-600 text-indigo-900 font-semibold shadow-xs'
                    : 'border-transparent text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  {isRoot ? (
                    <BookOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  ) : sec.level <= 2 ? (
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span className={`truncate ${isRoot ? 'font-bold text-slate-900' : ''}`}>
                    {sec.title}
                  </span>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                    sec.child_chunk_ids.length === 0
                      ? 'bg-amber-50 text-amber-700 font-semibold border border-amber-200'
                      : isActive
                      ? 'bg-indigo-200/70 text-indigo-900'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                  title={
                    sec.child_chunk_ids.length === 0
                      ? '청크가 없는 빈 섹션'
                      : `${sec.child_chunk_ids.length}개 자식 청크`
                  }
                >
                  {sec.child_chunk_ids.length}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
