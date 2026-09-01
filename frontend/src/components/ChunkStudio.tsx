import React, { useState, useMemo } from 'react';
import {
  Network,
  BookOpen,
  Folder,
  FileText,
  Search,
  Layers,
  Table2,
  AlignLeft,
  Scale,
  EyeOff,
  Eye,
  CheckCircle2,
  Edit2,
  Check,
  X,
  FileCode2,
  Tag,
  Plus,
  AlertTriangle,
  FolderTree,
  ChevronRight,
  ShieldCheck,
  Sparkles,
  Info,
  Scissors,
  Merge,
  Square,
  CheckSquare,
  Trash2,
} from 'lucide-react';
import type { ChildChunk, ParentSection } from '../types';
import { ChunkSplitModal } from './ChunkSplitModal';
import { ChunkMergeModal } from './ChunkMergeModal';
import { AddSectionModal } from './AddSectionModal';

interface ChunkStudioProps {
  parentSections: ParentSection[];
  childChunks: ChildChunk[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onUpdateChunk: (updatedChunk: ChildChunk, silent?: boolean) => void;
  onUpdateSectionTitle: (sectionId: string, newTitle: string) => void;
  onDeleteSection?: (sectionId: string, deleteChunks: boolean) => void;
  onAddSection?: (sectionData: {
    title: string;
    parentSectionId?: string;
    level: number;
  }) => void;
  onBatchCleanEmptySections?: () => void;
  onToggleIgnoreChunk: (chunkId: string) => void;
  onOpenJsonlModal: (chunk: ChildChunk) => void;
  onSplitChunk?: (chunkId: string, part1Text: string, part2Text: string) => void;
  onMergeChunks?: (chunkIds: string[], mergedText: string, customMergedId?: string) => void;
  onBatchCleanEmptyChunks?: () => void;
  isLoading: boolean;
}

export const ChunkStudio: React.FC<ChunkStudioProps> = ({
  parentSections,
  childChunks,
  selectedSectionId,
  onSelectSection,
  onUpdateChunk,
  onUpdateSectionTitle,
  onDeleteSection,
  onAddSection,
  onBatchCleanEmptySections,
  onToggleIgnoreChunk,
  onOpenJsonlModal,
  onSplitChunk,
  onMergeChunks,
  onBatchCleanEmptyChunks,
  isLoading,
}) => {
  // 1. Column 1 State (Hierarchy Tree)
  const [sectionSearch, setSectionSearch] = useState('');
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionTitle, setEditingSectionTitle] = useState('');

  // 2. Column 2 State (Chunk Timeline & Selection & Linter)
  const [chunkQuery, setChunkQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'table' | 'paragraph' | 'article'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'edited' | 'ignored' | 'linter' | 'empty'>('all');
  const [selectedChunkIds, setSelectedChunkIds] = useState<Set<string>>(new Set());

  // 3. Modals State
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isAddSectionModalOpen, setIsAddSectionModalOpen] = useState(false);

  // 4. Column 3 State (Focus Editor)
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<'text' | 'raw_html' | 'preview'>('text');
  const [newMetaKey, setNewMetaKey] = useState('');
  const [newMetaVal, setNewMetaVal] = useState('');

  // Parent Section Quick Lookup Map
  const parentMap = useMemo(() => {
    const map = new Map<string, ParentSection>();
    parentSections.forEach((p) => map.set(p.id, p));
    return map;
  }, [parentSections]);

  // Filtered Sections for Column 1
  const filteredSections = useMemo(() => {
    if (!sectionSearch.trim()) return parentSections;
    const term = sectionSearch.toLowerCase();
    return parentSections.filter((s) => s.title.toLowerCase().includes(term));
  }, [parentSections, sectionSearch]);

  // Linter statistics for the entire document
  const linterStats = useMemo(() => {
    let emptyCount = 0;
    let overCount = 0;
    let underCount = 0;
    for (const c of childChunks) {
      const words = c.token_estimate || (c.text ? c.text.trim().split(/\s+/).length : 0);
      const isEmpty = (!c.text || !c.text.trim()) && (!c.raw_html || !c.raw_html.trim());
      if (isEmpty) {
        emptyCount++;
      } else if (words > 800) {
        overCount++;
      } else if (words < 20) {
        underCount++;
      }
    }
    return { emptyCount, overCount, underCount, totalWarnings: emptyCount + overCount + underCount };
  }, [childChunks]);

  // Filtered Chunks for Column 2
  const filteredChunks = useMemo(() => {
    let result = childChunks;

    if (selectedSectionId) {
      result = result.filter((c) => c.parent_id === selectedSectionId);
    }

    if (typeFilter !== 'all') {
      result = result.filter((c) => c.chunk_type === typeFilter);
    }

    if (statusFilter === 'edited') {
      result = result.filter((c) => Boolean(c.is_edited));
    } else if (statusFilter === 'ignored') {
      result = result.filter((c) => Boolean(c.is_ignored));
    } else if (statusFilter === 'linter') {
      result = result.filter((c) => {
        const words = c.token_estimate || (c.text ? c.text.trim().split(/\s+/).length : 0);
        const isEmpty = (!c.text || !c.text.trim()) && (!c.raw_html || !c.raw_html.trim());
        return words > 800 || (words > 0 && words < 20) || isEmpty;
      });
    } else if (statusFilter === 'empty') {
      result = result.filter((c) => (!c.text || !c.text.trim()) && (!c.raw_html || !c.raw_html.trim()));
    }

    if (chunkQuery.trim()) {
      const q = chunkQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.text.toLowerCase().includes(q) ||
          c.chunk_id.toLowerCase().includes(q) ||
          (c.table_caption && c.table_caption.toLowerCase().includes(q))
      );
    }

    return result;
  }, [childChunks, selectedSectionId, typeFilter, statusFilter, chunkQuery]);

  // Multi-selection methods
  const toggleSelectChunk = (chunkId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedChunkIds((prev) => {
      const next = new Set(prev);
      if (next.has(chunkId)) {
        next.delete(chunkId);
      } else {
        next.add(chunkId);
      }
      return next;
    });
  };

  const clearSelectedChunks = () => {
    setSelectedChunkIds(new Set());
  };

  const selectAllFilteredChunks = () => {
    const next = new Set(selectedChunkIds);
    filteredChunks.forEach((c) => next.add(c.chunk_id));
    setSelectedChunkIds(next);
  };

  // Selected chunks sorted by original childChunks index order
  const selectedChunksList = useMemo(() => {
    return childChunks.filter((c) => selectedChunkIds.has(c.chunk_id));
  }, [childChunks, selectedChunkIds]);

  // Derived active chunk ID: fallback to first chunk in filtered list if not selected or filtered out
  const activeChunkId = selectedChunkId && filteredChunks.some((c) => c.chunk_id === selectedChunkId)
    ? selectedChunkId
    : filteredChunks[0]?.chunk_id || null;

  // Selected Chunk object for Column 3
  const activeChunk = useMemo(() => {
    if (!activeChunkId) return null;
    return childChunks.find((c) => c.chunk_id === activeChunkId) || null;
  }, [childChunks, activeChunkId]);

  // Handle section title inline editing
  const startEditSection = (sec: ParentSection, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingSectionId(sec.id);
    setEditingSectionTitle(sec.title);
  };

  const saveEditSection = (sectionId: string) => {
    if (editingSectionTitle.trim()) {
      onUpdateSectionTitle(sectionId, editingSectionTitle.trim());
    }
    setEditingSectionId(null);
  };

  const cancelEditSection = () => {
    setEditingSectionId(null);
  };

  // Map of parent section ID -> child sections
  const childSectionsMap = useMemo(() => {
    const map = new Map<string, ParentSection[]>();
    parentSections.forEach((s) => {
      if (s.parent_section_id) {
        const list = map.get(s.parent_section_id) || [];
        list.push(s);
        map.set(s.parent_section_id, list);
      }
    });
    return map;
  }, [parentSections]);

  // Count empty sections (0 child chunks AND 0 child sections)
  const emptySectionsCount = useMemo(() => {
    return parentSections.filter((s) => {
      const hasChunks = s.child_chunk_ids && s.child_chunk_ids.length > 0;
      const hasChildSections = childSectionsMap.has(s.id);
      return !hasChunks && !hasChildSections;
    }).length;
  }, [parentSections, childSectionsMap]);

  // Handle section deletion with safety confirmation
  const handleDeleteSectionClick = (sec: ParentSection, e: React.MouseEvent) => {
    e.stopPropagation();
    const chunkCount = sec.child_chunk_ids.length;
    const childSecs = childSectionsMap.get(sec.id) || [];
    const childSecCount = childSecs.length;

    if (chunkCount === 0 && childSecCount === 0) {
      // 1) 리프 빈 섹션
      const ok = window.confirm(`'${sec.title}' 섹션을 삭제하시겠습니까?`);
      if (ok) {
        onDeleteSection?.(sec.id, false);
      }
    } else if (childSecCount > 0) {
      // 2) 하위 섹션이 존재하는 상위 섹션
      const ok = window.confirm(
        `⚠️ 주의: '${sec.title}' 섹션에는 ${childSecCount}개의 하위 섹션` +
          (chunkCount > 0 ? ` 및 ${chunkCount}개의 소속 청크` : '') +
          `이 존재합니다.\n\n` +
          (chunkCount > 0 ? `• 소속된 ${chunkCount}개의 청크는 함께 영구 삭제됩니다.\n` : '') +
          `• ${childSecCount}개의 하위 섹션은 상위 계층으로 승격됩니다.\n\n` +
          `정말 삭제하시겠습니까?`
      );
      if (ok) {
        onDeleteSection?.(sec.id, chunkCount > 0);
      }
    } else {
      // 3) 하위 섹션은 없으나 청크가 포함된 섹션
      const ok = window.confirm(
        `⚠️ 경고: '${sec.title}' 섹션에는 ${chunkCount}개의 청크가 포함되어 있습니다.\n\n` +
          `섹션을 삭제하면 소속된 ${chunkCount}개의 청크도 함께 영구 삭제됩니다.\n\n` +
          `정말 삭제하시겠습니까?`
      );
      if (ok) {
        onDeleteSection?.(sec.id, true);
      }
    }
  };

  // Column 3 real-time field updater
  const handleFieldChange = (field: keyof ChildChunk, value: any) => {
    if (!activeChunk) return;

    let updated: ChildChunk = {
      ...activeChunk,
      [field]: value,
      is_edited: true,
    };

    // If parent_id changed, recompute breadcrumbs
    if (field === 'parent_id') {
      const targetParent = parentSections.find((p) => p.id === value);
      if (targetParent) {
        if (activeChunk.chunk_type === 'article' && activeChunk.metadata?.article_no) {
          const artDisplay = activeChunk.metadata?.article_title
            ? `${activeChunk.metadata.article_no}(${activeChunk.metadata.article_title})`
            : activeChunk.metadata.article_no;
          updated.breadcrumbs = [...targetParent.breadcrumbs, artDisplay];
        } else {
          updated.breadcrumbs = [...targetParent.breadcrumbs];
        }
      }
    }

    // Recompute word/token estimate if text or raw_html changed
    if (field === 'text' || field === 'raw_html') {
      const textToCount = field === 'text' ? value : updated.text;
      const count = textToCount && typeof textToCount === 'string' && textToCount.trim()
        ? textToCount.trim().split(/\s+/).length
        : 0;
      updated.token_estimate = count;
    }

    onUpdateChunk(updated, true);
  };

  // Add custom metadata tag
  const handleAddMetaTag = () => {
    if (!activeChunk || !newMetaKey.trim()) return;
    const currentMeta = activeChunk.metadata || {};
    const updatedMeta = {
      ...currentMeta,
      [newMetaKey.trim()]: newMetaVal.trim(),
    };
    handleFieldChange('metadata', updatedMeta);
    setNewMetaKey('');
    setNewMetaVal('');
  };

  // Delete custom metadata tag
  const handleDeleteMetaTag = (key: string) => {
    if (!activeChunk || !activeChunk.metadata) return;
    const updatedMeta = { ...activeChunk.metadata };
    delete updatedMeta[key];
    handleFieldChange('metadata', updatedMeta);
  };

  // Active section name for breadcrumb/filter
  const activeParent = activeChunk ? parentMap.get(activeChunk.parent_id) : null;
  const filterParent = selectedSectionId ? parentMap.get(selectedSectionId) : null;

  // Real-time character & token count
  const activeCharCount = activeChunk?.text?.length || 0;
  const activeWordCount = activeChunk?.token_estimate || 0;
  const isOverTokenLimit = activeWordCount > 800 || activeCharCount > 1000;
  const isUnderTokenLimit = activeWordCount > 0 && activeWordCount < 20;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-100/70 rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Studio Workspace 3-Column Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 min-h-0 overflow-hidden">
        
        {/* ======================================================== */}
        {/* COLUMN 1: 문서 위계 구조 (Hierarchy Tree Panel)         */}
        {/* ======================================================== */}
        <section className="lg:col-span-3 flex flex-col bg-white min-h-0 overflow-hidden">
          {/* Header */}
          <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 shrink-0">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-indigo-600" />
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                1열: 문서 계층 구조
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              {onAddSection && (
                <button
                  type="button"
                  onClick={() => setIsAddSectionModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-semibold transition cursor-pointer shadow-2xs"
                  title="새 섹션 추가"
                >
                  <Plus className="w-3 h-3" />
                  <span>섹션 추가</span>
                </button>
              )}
              {selectedSectionId && (
                <button
                  type="button"
                  onClick={() => onSelectSection(null)}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer px-1 py-0.5"
                  title="섹션 필터 해제"
                >
                  전체 보기
                </button>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="p-2 border-b border-slate-100 bg-white shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={sectionSearch}
                onChange={(e) => setSectionSearch(e.target.value)}
                placeholder="섹션 제목 검색..."
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-hidden placeholder-slate-400"
              />
            </div>
          </div>

          {/* Empty sections cleanup bar */}
          {emptySectionsCount > 0 && onBatchCleanEmptySections && (
            <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200/70 flex items-center justify-between text-[11px] text-amber-800 shrink-0">
              <div className="flex items-center gap-1.5 truncate">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="truncate">
                  청크 없는 빈 섹션 <strong>{emptySectionsCount}개</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={onBatchCleanEmptySections}
                className="text-[10px] px-1.5 py-0.5 bg-amber-200/90 hover:bg-amber-300 text-amber-900 font-bold rounded transition shrink-0 cursor-pointer shadow-2xs"
                title="청크가 없는 모든 빈 섹션 일괄 삭제"
              >
                일괄 정리
              </button>
            </div>
          )}

          {/* Quick Guide */}
          <div className="px-3 py-1.5 bg-indigo-50/40 border-b border-indigo-100/60 flex items-center gap-1.5 text-[11px] text-slate-500 shrink-0">
            <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="truncate">더블클릭 또는 연필로 수정, 휴지통으로 삭제</span>
          </div>

          {/* Section List */}
          <div className="flex-1 p-2 overflow-y-auto space-y-1 text-xs font-medium">
            {isLoading ? (
              <div className="text-slate-400 text-center py-16">계층 구조 분석 중...</div>
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
                const isEditingThis = editingSectionId === sec.id;

                return (
                  <div
                    key={sec.id}
                    onClick={() => {
                      if (!isEditingThis) onSelectSection(sec.id);
                    }}
                    onDoubleClick={(e) => startEditSection(sec, e)}
                    className={`group py-2 px-2.5 rounded-lg cursor-pointer flex items-center justify-between transition border-l-3 select-none ${indentClass} ${
                      isActive
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-900 font-semibold shadow-2xs'
                        : 'border-transparent text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {isEditingThis ? (
                      <div
                        className="flex items-center gap-1.5 w-full"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editingSectionTitle}
                          onChange={(e) => setEditingSectionTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditSection(sec.id);
                            if (e.key === 'Escape') cancelEditSection();
                          }}
                          autoFocus
                          className="flex-1 text-xs bg-white border border-indigo-500 rounded px-2 py-1 font-semibold focus:outline-hidden ring-1 ring-indigo-500 text-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => saveEditSection(sec.id)}
                          className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                          title="저장 (Enter)"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditSection}
                          className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                          title="취소 (Esc)"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 truncate pr-2">
                          {isRoot ? (
                            <BookOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          ) : sec.level <= 2 ? (
                            <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <span
                            className={`truncate ${isRoot ? 'font-bold text-slate-900' : ''}`}
                            title={sec.title}
                          >
                            {sec.title}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {/* Hover inline edit trigger */}
                          <button
                            type="button"
                            onClick={(e) => startEditSection(sec, e)}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-indigo-600 transition p-0.5 rounded hover:bg-slate-200/50 cursor-pointer"
                            title="섹션 제목 수정"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>

                          {/* Delete section trigger */}
                          {onDeleteSection && (() => {
                            const childSecs = childSectionsMap.get(sec.id) || [];
                            const isLeafEmpty = sec.child_chunk_ids.length === 0 && childSecs.length === 0;
                            const hasChildSecs = childSecs.length > 0;

                            return (
                              <button
                                type="button"
                                onClick={(e) => handleDeleteSectionClick(sec, e)}
                                className={`transition p-0.5 rounded hover:bg-rose-50 cursor-pointer ${
                                  isLeafEmpty
                                    ? 'opacity-80 text-amber-500 hover:text-rose-600'
                                    : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600'
                                }`}
                                title={
                                  isLeafEmpty
                                    ? '빈 섹션 삭제'
                                    : hasChildSecs
                                    ? `섹션(하위 섹션 ${childSecs.length}개 포함) 삭제`
                                    : `섹션 및 소속 청크(${sec.child_chunk_ids.length}개) 삭제`
                                }
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            );
                          })()}

                          {/* Chunk count badge */}
                          {(() => {
                            const childSecs = childSectionsMap.get(sec.id) || [];
                            const isLeafEmpty = sec.child_chunk_ids.length === 0 && childSecs.length === 0;
                            const hasChildSecs = childSecs.length > 0;

                            return (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                  isLeafEmpty
                                    ? 'bg-amber-100 text-amber-700 font-semibold border border-amber-200'
                                    : hasChildSecs && sec.child_chunk_ids.length === 0
                                    ? 'bg-slate-100 text-indigo-700 font-medium'
                                    : isActive
                                    ? 'bg-indigo-200/80 text-indigo-900'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                                title={
                                  isLeafEmpty
                                    ? '청크와 하위 섹션이 없는 빈 섹션'
                                    : hasChildSecs && sec.child_chunk_ids.length === 0
                                    ? `청크 0개 (하위 섹션 ${childSecs.length}개 보유)`
                                    : `${sec.child_chunk_ids.length}개 자식 청크`
                                }
                              >
                                {sec.child_chunk_ids.length}
                              </span>
                            );
                          })()}
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ======================================================== */}
        {/* COLUMN 2: 청크 타임라인 목록 (Chunk Timeline List)      */}
        {/* ======================================================== */}
        <section className="lg:col-span-4 flex flex-col bg-slate-50/50 min-h-0 overflow-hidden">
          {/* Header */}
          <div className="p-3 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                2열: 청크 타임라인 목록
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              총 <strong className="text-slate-900 font-semibold">{filteredChunks.length}</strong>개 청크
            </span>
          </div>

          {/* Active section indicator pill */}
          {filterParent && (
            <div className="px-3 py-1.5 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between text-xs text-indigo-800 shrink-0">
              <span className="truncate font-semibold flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span>필터: {filterParent.title}</span>
              </span>
              <button
                type="button"
                onClick={() => onSelectSection(null)}
                className="text-indigo-600 hover:text-indigo-900 p-0.5 rounded"
                title="필터 해제"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Search and Filters */}
          <div className="p-2.5 border-b border-slate-200 bg-white space-y-2 shrink-0">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={chunkQuery}
                onChange={(e) => setChunkQuery(e.target.value)}
                placeholder="청크 내용 / ID 검색..."
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-hidden placeholder-slate-400"
              />
            </div>

            {/* Type & Status Filter Buttons */}
            <div className="flex items-center justify-between gap-1">
              {/* Type Filters */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  className={`text-[11px] px-2 py-0.5 rounded font-medium transition cursor-pointer ${
                    typeFilter === 'all'
                      ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('paragraph')}
                  className={`text-[11px] px-2 py-0.5 rounded font-medium transition flex items-center gap-1 cursor-pointer ${
                    typeFilter === 'paragraph'
                      ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <AlignLeft className="w-3 h-3" />
                  문단
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('table')}
                  className={`text-[11px] px-2 py-0.5 rounded font-medium transition flex items-center gap-1 cursor-pointer ${
                    typeFilter === 'table'
                      ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Table2 className="w-3 h-3" />
                  표
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('article')}
                  className={`text-[11px] px-2 py-0.5 rounded font-medium transition flex items-center gap-1 cursor-pointer ${
                    typeFilter === 'article'
                      ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Scale className="w-3 h-3" />
                  조문
                </button>
              </div>

              {/* Status & Linter Filters */}
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === 'edited' ? 'all' : 'edited')}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition cursor-pointer ${
                    statusFilter === 'edited'
                      ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                  title="수정된 청크만 보기"
                >
                  수정됨
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === 'ignored' ? 'all' : 'ignored')}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition cursor-pointer ${
                    statusFilter === 'ignored'
                      ? 'bg-rose-100 text-rose-900 border-rose-300 font-bold'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                  title="제외된 청크만 보기"
                >
                  제외됨
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === 'linter' ? 'all' : 'linter')}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition cursor-pointer flex items-center gap-1 ${
                    statusFilter === 'linter'
                      ? 'bg-amber-500 text-white border-amber-600 font-bold shadow-2xs'
                      : linterStats.totalWarnings > 0
                      ? 'border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100'
                      : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                  }`}
                  title="토큰 초과/부족/공백 청크 필터링"
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  <span>품질경고</span>
                  {linterStats.totalWarnings > 0 && (
                    <span className="font-mono text-[9px] px-1 rounded bg-amber-200 text-amber-900">
                      {linterStats.totalWarnings}
                    </span>
                  )}
                </button>
                {linterStats.emptyCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter(statusFilter === 'empty' ? 'all' : 'empty')}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition cursor-pointer flex items-center gap-1 ${
                      statusFilter === 'empty'
                        ? 'bg-rose-600 text-white border-rose-700 font-bold shadow-2xs'
                        : 'border-rose-300 text-rose-800 bg-rose-50 hover:bg-rose-100'
                    }`}
                    title="공백만 있는 빈 청크 보기"
                  >
                    <span>빈 청크</span>
                    <span className="font-mono text-[9px] px-1 rounded bg-rose-200 text-rose-900">
                      {linterStats.emptyCount}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Empty Chunks Linter Banner */}
          {linterStats.emptyCount > 0 && onBatchCleanEmptyChunks && (
            <div className="px-3 py-2 bg-rose-50 border-b border-rose-200 flex items-center justify-between text-xs text-rose-900 shrink-0 animate-in fade-in">
              <span className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>공백만 있는 빈 청크 <strong>{linterStats.emptyCount}</strong>개 발견</span>
              </span>
              <button
                type="button"
                onClick={onBatchCleanEmptyChunks}
                className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 shadow-2xs"
                title="빈 청크를 임베딩 대상에서 일괄 제외 처리합니다."
              >
                <Sparkles className="w-3 h-3" />
                <span>일괄 정리</span>
              </button>
            </div>
          )}

          {/* Multi-Selection Merge Action Bar */}
          {selectedChunkIds.size > 0 && (
            <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between gap-2 shrink-0 animate-in fade-in">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-indigo-950 flex items-center gap-1">
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{selectedChunkIds.size}개 선택됨</span>
                </span>
                <button
                  type="button"
                  onClick={clearSelectedChunks}
                  className="text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
                >
                  해제
                </button>
                <button
                  type="button"
                  onClick={selectAllFilteredChunks}
                  className="text-[11px] text-indigo-700 hover:text-indigo-950 underline cursor-pointer"
                >
                  현재 목록 전체선택
                </button>
              </div>

              <button
                type="button"
                disabled={selectedChunkIds.size < 2 || !onMergeChunks}
                onClick={() => setIsMergeModalOpen(true)}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                title={
                  selectedChunkIds.size < 2
                    ? '2개 이상의 청크를 선택해야 병합할 수 있습니다.'
                    : '선택한 청크들을 하나로 병합합니다.'
                }
              >
                <Merge className="w-3.5 h-3.5" />
                <span>청크 병합 ({selectedChunkIds.size})</span>
              </button>
            </div>
          )}

          {/* Chunk Card List */}
          <div className="flex-1 p-3 overflow-y-auto space-y-2.5">
            {isLoading ? (
              <div className="text-slate-400 text-center py-20 text-xs">청크 불러오는 중...</div>
            ) : filteredChunks.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
                <Layers className="w-7 h-7 text-slate-300 mx-auto mb-1.5" />
                <p className="text-xs text-slate-400">조건에 맞는 청크가 없습니다.</p>
              </div>
            ) : (
              filteredChunks.map((chunk) => {
                const isSelected = activeChunkId === chunk.chunk_id;
                const isChecked = selectedChunkIds.has(chunk.chunk_id);
                const isTable = chunk.chunk_type === 'table';
                const isArticle = chunk.chunk_type === 'article';
                const isIgnored = Boolean(chunk.is_ignored);
                const isEdited = Boolean(chunk.is_edited);
                const parent = parentMap.get(chunk.parent_id);

                const cWords = chunk.token_estimate || (chunk.text ? chunk.text.trim().split(/\s+/).length : 0);
                const isCEmpty = (!chunk.text || !chunk.text.trim()) && (!chunk.raw_html || !chunk.raw_html.trim());
                const isCOver = cWords > 800;
                const isCUnder = !isCEmpty && cWords > 0 && cWords < 20;

                return (
                  <div
                    key={chunk.chunk_id}
                    onClick={() => setSelectedChunkId(chunk.chunk_id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer select-none text-xs relative ${
                      isChecked
                        ? 'bg-indigo-50/50 border-indigo-400 ring-2 ring-indigo-400/30 shadow-xs'
                        : isSelected
                        ? 'bg-white border-indigo-500 ring-2 ring-indigo-500/20 shadow-md'
                        : isIgnored
                        ? 'bg-slate-50/70 border-slate-200 opacity-60 hover:opacity-100 hover:bg-white'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-2xs'
                    }`}
                  >
                    {/* Top Row: Checkbox, Type, Page, ID, Status & Linter Badges */}
                    <div className="flex items-center justify-between gap-1.5 pb-1.5 border-b border-slate-100">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Checkbox for merge selection */}
                        <button
                          type="button"
                          onClick={(e) => toggleSelectChunk(chunk.chunk_id, e)}
                          className="text-slate-400 hover:text-indigo-600 transition p-0.5 rounded cursor-pointer shrink-0"
                          title={isChecked ? '선택 해제' : '병합 대상으로 선택'}
                        >
                          {isChecked ? (
                            <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-300 hover:text-slate-500" />
                          )}
                        </button>

                        {isTable ? (
                          <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Table2 className="w-3 h-3" />
                            표
                          </span>
                        ) : isArticle ? (
                          <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Scale className="w-3 h-3" />
                            조문
                          </span>
                        ) : (
                          <span className="bg-slate-100 text-slate-700 text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1">
                            <AlignLeft className="w-3 h-3 text-slate-400" />
                            문단
                          </span>
                        )}

                        <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-semibold">
                          {chunk.chunk_id}
                        </span>

                        <span className="text-[10px] text-slate-400 font-mono">
                          p.{chunk.page_number}
                        </span>

                        {isEdited && (
                          <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5 text-amber-500" />
                            수정됨
                          </span>
                        )}

                        {isIgnored && (
                          <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                            <EyeOff className="w-2.5 h-2.5 text-rose-500" />
                            제외됨
                          </span>
                        )}

                        {/* Linter Badges */}
                        {isCEmpty ? (
                          <span className="bg-rose-100 text-rose-800 border border-rose-200 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5 text-rose-600" />
                            빈 청크
                          </span>
                        ) : isCOver ? (
                          <span className="bg-amber-50 text-amber-800 border border-amber-300 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                            800+ words
                          </span>
                        ) : isCUnder ? (
                          <span className="bg-sky-50 text-sky-800 border border-sky-200 text-[9px] font-medium px-1.5 py-0.2 rounded flex items-center gap-0.5">
                            <Info className="w-2.5 h-2.5 text-sky-600" />
                            &lt;20 words
                          </span>
                        ) : null}
                      </div>

                      {/* Quick Ignore Toggle Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleIgnoreChunk(chunk.chunk_id);
                        }}
                        className={`p-1 rounded transition cursor-pointer ${
                          isIgnored
                            ? 'text-rose-600 hover:bg-rose-100 bg-rose-50'
                            : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                        title={isIgnored ? '임베딩 포함으로 변경' : '임베딩 제외로 변경'}
                      >
                        {isIgnored ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {/* Text Snippet (Line Clamped) */}
                    <div className="pt-2 text-slate-700 leading-snug line-clamp-2 text-[11px]">
                      {isTable && chunk.table_caption
                        ? `[표] ${chunk.table_caption}`
                        : chunk.text || (chunk.raw_html ? 'HTML 표 데이터' : '(빈 청크)')}
                    </div>

                    {/* Footer Row: Parent Section & Token count */}
                    <div className="pt-2 mt-1.5 border-t border-slate-50 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span className="truncate max-w-[170px]" title={parent?.title}>
                        {parent?.title || chunk.parent_id}
                      </span>
                      <span>~{chunk.token_estimate} words</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ======================================================== */}
        {/* COLUMN 3: 포커스 에디터 패널 (Focus Editor Panel)       */}
        {/* ======================================================== */}
        <section className="lg:col-span-5 flex flex-col bg-white min-h-0 overflow-hidden">
          {activeChunk ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Editor Top Bar */}
              <div className="p-3 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                    {activeChunk.chunk_type === 'table' ? (
                      <Table2 className="w-4 h-4" />
                    ) : activeChunk.chunk_type === 'article' ? (
                      <Scale className="w-4 h-4 text-purple-600" />
                    ) : (
                      <AlignLeft className="w-4 h-4 text-slate-600" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-xs font-bold text-slate-900">3열: 포커스 에디터</h2>
                      <span className="font-mono text-[11px] font-bold px-1.5 py-0.2 bg-slate-200 text-slate-800 rounded">
                        {activeChunk.chunk_id}
                      </span>
                      {activeChunk.is_edited && (
                        <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-300 font-bold px-1.5 py-0.2 rounded">
                          수정됨
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Page {activeChunk.page_number} · 실시간 자동 동기화
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {onSplitChunk && activeChunk.chunk_type !== 'table' && (
                    <button
                      type="button"
                      onClick={() => setIsSplitModalOpen(true)}
                      className="text-xs text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 font-semibold cursor-pointer shadow-2xs"
                      title="긴 청크를 2개로 분할"
                    >
                      <Scissors className="w-3.5 h-3.5 text-amber-600" />
                      <span>청크 분할</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onOpenJsonlModal(activeChunk)}
                    className="text-xs text-slate-600 hover:text-indigo-600 bg-white border border-slate-200 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 font-medium cursor-pointer shadow-2xs"
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                    <span>JSONL</span>
                  </button>
                </div>
              </div>

              {/* Real-time Quality & Token Warning Banner */}
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 text-xs shrink-0 font-mono">
                <div className="flex items-center gap-3">
                  <span>
                    글자 수: <strong className="text-slate-800 font-semibold">{activeCharCount}</strong>자
                  </span>
                  <span>
                    추정 토큰/단어: <strong className="text-indigo-600 font-semibold">~{activeWordCount}</strong> words
                  </span>
                </div>

                {isOverTokenLimit ? (
                  <div className="flex items-center gap-1.5 font-sans">
                    <span className="text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px] flex items-center gap-1 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      800자 초과 (분할 권장)
                    </span>
                    {onSplitChunk && activeChunk.chunk_type !== 'table' && (
                      <button
                        type="button"
                        onClick={() => setIsSplitModalOpen(true)}
                        className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                        title="분할 도구 열기"
                      >
                        <Scissors className="w-3 h-3" />
                        <span>지금 분할하기</span>
                      </button>
                    )}
                  </div>
                ) : isUnderTokenLimit ? (
                  <span className="text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded font-sans text-[11px] flex items-center gap-1 font-medium">
                    <Info className="w-3.5 h-3.5 text-sky-600" />
                    20단어 미만 (2열에서 병합 권장)
                  </span>
                ) : (
                  <span className="text-emerald-700 font-sans text-[11px] flex items-center gap-1 font-medium">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    임베딩 최적 길이
                  </span>
                )}
              </div>

              {/* Exclude notice if ignored */}
              {activeChunk.is_ignored && (
                <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium shrink-0">
                  <EyeOff className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>이 청크는 RAG Vector DB 임베딩 및 JSONL 다운로드에서 제외됩니다.</span>
                </div>
              )}

              {/* Scrollable Editor Body */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                
                {/* 1. Parent Section & Exclude Setting Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  {/* Parent Section Reassign */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                      <FolderTree className="w-3.5 h-3.5 text-indigo-600" />
                      부모 섹션 재할당
                    </label>
                    <select
                      value={activeChunk.parent_id}
                      onChange={(e) => handleFieldChange('parent_id', e.target.value)}
                      className="w-full text-xs font-medium bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    >
                      {parentSections.map((sec) => (
                        <option key={sec.id} value={sec.id}>
                          {sec.title} (L{sec.level})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Embedding Exclude Toggle */}
                  <div className="flex flex-col justify-end">
                    <label className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-300 cursor-pointer hover:bg-slate-50 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(activeChunk.is_ignored)}
                        onChange={(e) => handleFieldChange('is_ignored', e.target.checked)}
                        className="w-4 h-4 text-rose-600 rounded border-slate-300 focus:ring-rose-500 cursor-pointer"
                      />
                      <div className="text-xs">
                        <span className={`font-semibold ${activeChunk.is_ignored ? 'text-rose-700' : 'text-slate-700'}`}>
                          임베딩 대상에서 제외
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Breadcrumbs Display */}
                <div className="text-[11px] text-slate-500 flex items-center flex-wrap gap-1 bg-slate-50/50 p-2 rounded-lg border border-slate-200">
                  <span className="font-semibold text-slate-700">위계 맥락:</span>
                  {(activeChunk.breadcrumbs || []).length > 0 ? (
                    activeChunk.breadcrumbs.map((b, idx) => (
                      <React.Fragment key={idx}>
                        <span className={idx === activeChunk.breadcrumbs.length - 1 ? 'font-semibold text-indigo-700' : 'text-slate-500'}>
                          {b}
                        </span>
                        {idx < activeChunk.breadcrumbs.length - 1 && (
                          <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                        )}
                      </React.Fragment>
                    ))
                  ) : (
                    <span>{activeParent?.title || '루트'}</span>
                  )}
                </div>

                {/* Table Specific Fields & Tabs */}
                {activeChunk.chunk_type === 'table' && (
                  <div className="space-y-3 p-3.5 bg-indigo-50/40 rounded-xl border border-indigo-100">
                    <div className="flex items-center justify-between border-b border-indigo-200/60 pb-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditorTab('text')}
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                            editorTab === 'text'
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          표 텍스트
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorTab('raw_html')}
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                            editorTab === 'raw_html'
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          표 HTML 원형
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorTab('preview')}
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                            editorTab === 'preview'
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          HTML 미리보기
                        </button>
                      </div>

                      <span className="text-[10px] text-emerald-700 font-medium flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        원형 보존 표
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">표 제목 (Caption)</label>
                        <input
                          type="text"
                          value={activeChunk.table_caption || ''}
                          onChange={(e) => handleFieldChange('table_caption', e.target.value)}
                          placeholder="예: [표 1] 세부기준"
                          className="w-full text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">표 각주 (Footnote)</label>
                        <input
                          type="text"
                          value={activeChunk.table_footnote || ''}
                          onChange={(e) => handleFieldChange('table_footnote', e.target.value)}
                          placeholder="예: ※ 기준치 초과 시 재검사"
                          className="w-full text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Main Textarea / Code / Preview */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800">
                      {activeChunk.chunk_type === 'table' && editorTab === 'raw_html'
                        ? '표 HTML 원형 코드 (raw_html)'
                        : activeChunk.chunk_type === 'table' && editorTab === 'preview'
                        ? '표 렌더링 미리보기 (HTML Preview)'
                        : '청크 본문 텍스트 (Text) 편집'}
                    </label>
                    <span className="text-[11px] text-slate-400">수정 즉시 2열 목록에 반영됩니다.</span>
                  </div>

                  {activeChunk.chunk_type === 'table' && editorTab === 'preview' ? (
                    <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200 min-h-[220px] max-h-[360px] overflow-y-auto">
                      <div
                        className="prose-custom text-xs"
                        dangerouslySetInnerHTML={{
                          __html: activeChunk.raw_html || activeChunk.text || '<p>표 내용 없음</p>',
                        }}
                      />
                    </div>
                  ) : activeChunk.chunk_type === 'table' && editorTab === 'raw_html' ? (
                    <textarea
                      value={activeChunk.raw_html || ''}
                      onChange={(e) => handleFieldChange('raw_html', e.target.value)}
                      rows={11}
                      className="w-full font-mono text-xs p-3.5 bg-slate-900 text-emerald-400 rounded-xl border border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y"
                      placeholder="<table>...</table>"
                    />
                  ) : (
                    <textarea
                      value={activeChunk.text || ''}
                      onChange={(e) => handleFieldChange('text', e.target.value)}
                      rows={11}
                      className="w-full text-xs p-3.5 bg-white rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed text-slate-800 resize-y font-sans shadow-2xs"
                      placeholder="청크 본문 텍스트를 입력하세요..."
                    />
                  )}
                </div>

                {/* Custom Metadata Tags Editor */}
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-indigo-600" />
                      <span>임베딩 커스텀 메타데이터 (Custom Metadata Tags)</span>
                    </label>
                    <span className="text-[10px] text-slate-400">RAG 검색 시 메타 필터링 활용</span>
                  </div>

                  {/* Existing Tags */}
                  <div className="flex flex-wrap gap-1.5 min-h-[30px] items-center">
                    {activeChunk.metadata && Object.keys(activeChunk.metadata).length > 0 ? (
                      Object.entries(activeChunk.metadata).map(([key, val]) => (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1.5 text-xs bg-white text-slate-800 border border-slate-300 px-2 py-1 rounded-md shadow-2xs font-mono"
                        >
                          <span className="font-semibold text-indigo-700">{key}:</span>
                          <span className="text-slate-600">{String(val)}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteMetaTag(key)}
                            className="text-slate-400 hover:text-rose-600 cursor-pointer ml-0.5"
                            title="태그 삭제"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">등록된 커스텀 태그가 없습니다.</span>
                    )}
                  </div>

                  {/* Add Tag Inputs */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newMetaKey}
                      onChange={(e) => setNewMetaKey(e.target.value)}
                      placeholder="Key (예: category)"
                      className="w-1/3 text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                    />
                    <input
                      type="text"
                      value={newMetaVal}
                      onChange={(e) => setNewMetaVal(e.target.value)}
                      placeholder="Value (예: safety_rules)"
                      className="flex-1 text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={handleAddMetaTag}
                      disabled={!newMetaKey.trim()}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>태그 추가</span>
                    </button>
                  </div>
                </div>

              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/50">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-800 mb-1">선택된 청크가 없습니다</h3>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                2열 청크 타임라인 목록에서 청크를 클릭하면 본문 텍스트, 메타데이터, 부모 섹션을 집중적으로 편집할 수 있습니다.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Chunk Split Modal */}
      {isSplitModalOpen && activeChunk && onSplitChunk && (
        <ChunkSplitModal
          chunk={activeChunk}
          onClose={() => setIsSplitModalOpen(false)}
          onConfirmSplit={(id, p1, p2) => {
            onSplitChunk(id, p1, p2);
            setIsSplitModalOpen(false);
          }}
        />
      )}

      {/* Chunk Merge Modal */}
      {isMergeModalOpen && selectedChunksList.length >= 2 && onMergeChunks && (
        <ChunkMergeModal
          selectedChunks={selectedChunksList}
          parentSections={parentSections}
          onClose={() => setIsMergeModalOpen(false)}
          onConfirmMerge={(ids, text, newId) => {
            onMergeChunks(ids, text, newId);
            clearSelectedChunks();
            setIsMergeModalOpen(false);
          }}
        />
      )}

      {/* Add Section Modal */}
      {onAddSection && (
        <AddSectionModal
          isOpen={isAddSectionModalOpen}
          onClose={() => setIsAddSectionModalOpen(false)}
          parentSections={parentSections}
          onAddSection={onAddSection}
        />
      )}
    </div>
  );
};
