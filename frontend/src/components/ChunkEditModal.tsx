import React, { useState, useEffect } from 'react';
import { X, Save, AlertTriangle, EyeOff, Table2, AlignLeft, Scale, Check, FolderTree } from 'lucide-react';
import type { ChildChunk, ParentSection } from '../types';

interface ChunkEditModalProps {
  chunk: ChildChunk | null;
  parentSections: ParentSection[];
  onClose: () => void;
  onSave: (updatedChunk: ChildChunk) => void;
}

export const ChunkEditModal: React.FC<ChunkEditModalProps> = ({
  chunk,
  parentSections,
  onClose,
  onSave,
}) => {
  const [text, setText] = useState(chunk?.text || '');
  const [parentId, setParentId] = useState(chunk?.parent_id || '');
  const [isIgnored, setIsIgnored] = useState(Boolean(chunk?.is_ignored));
  const [activeTab, setActiveTab] = useState<'text' | 'raw_html'>('text');

  // Table specific state
  const isTable = chunk?.chunk_type === 'table';
  const isArticle = chunk?.chunk_type === 'article';
  const [rawHtml, setRawHtml] = useState(chunk?.raw_html || '');
  const [tableCaption, setTableCaption] = useState(chunk?.table_caption || '');
  const [tableFootnote, setTableFootnote] = useState(chunk?.table_footnote || '');

  useEffect(() => {
    if (!chunk) return;
    setText(chunk.text || '');
    setParentId(chunk.parent_id || '');
    setIsIgnored(Boolean(chunk.is_ignored));
    setRawHtml(chunk.raw_html || '');
    setTableCaption(chunk.table_caption || '');
    setTableFootnote(chunk.table_footnote || '');
    setActiveTab('text');
  }, [chunk]);

  if (!chunk) return null;

  // Real-time word / token estimate
  const currentTextToCount = activeTab === 'text' ? text : rawHtml;
  const wordCount = currentTextToCount.trim() ? currentTextToCount.trim().split(/\s+/).length : 0;
  const charCount = currentTextToCount.length;

  const handleApply = () => {
    // Determine updated breadcrumbs if parent changed
    const targetParent = parentSections.find((p) => p.id === parentId);
    let updatedBreadcrumbs = chunk.breadcrumbs || [];
    if (targetParent) {
      if (isArticle && chunk.metadata?.article_no) {
        const artDisplay = chunk.metadata?.article_title
          ? `${chunk.metadata.article_no}(${chunk.metadata.article_title})`
          : chunk.metadata.article_no;
        updatedBreadcrumbs = [...targetParent.breadcrumbs, artDisplay];
      } else {
        updatedBreadcrumbs = [...targetParent.breadcrumbs];
      }
    }

    const updated: ChildChunk = {
      ...chunk,
      text: text,
      parent_id: parentId,
      breadcrumbs: updatedBreadcrumbs,
      is_ignored: isIgnored,
      is_edited: true,
      token_estimate: wordCount,
    };

    if (isTable) {
      updated.raw_html = rawHtml;
      updated.table_caption = tableCaption;
      updated.table_footnote = tableFootnote;
    }

    onSave(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              {isTable ? (
                <Table2 className="w-5 h-5" />
              ) : isArticle ? (
                <Scale className="w-5 h-5 text-purple-600" />
              ) : (
                <AlignLeft className="w-5 h-5 text-slate-600" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">청크 내용 & 메타데이터 편집</h3>
                <span className="font-mono text-xs px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-semibold">
                  {chunk.chunk_id}
                </span>
                {chunk.is_edited && (
                  <span className="text-[11px] bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded border border-amber-200">
                    기존 수정됨
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                페이지 {chunk.page_number} · {isTable ? '원형 보존 표 청크' : isArticle ? '조문 청크' : '일반 문단 청크'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Top Options Row: Parent Section Selector & Embedding Exclude Toggle */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            {/* Parent Section Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-indigo-600" />
                소속 부모 섹션 (Hierarchy Section)
              </label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="w-full text-xs font-medium bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {parentSections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.title} (Level {sec.level}, ID: {sec.id})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                부모 섹션을 변경하면 검색 인덱싱 시 상위 브레드크럼 컨텍스트가 갱신됩니다.
              </p>
            </div>

            {/* Embedding Ignore Option */}
            <div className="flex flex-col justify-between">
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5 text-rose-500" />
                임베딩 및 인덱싱 필터링
              </label>
              <label className="flex items-center gap-2.5 p-2 bg-white rounded-lg border border-slate-300 cursor-pointer hover:bg-slate-50 transition">
                <input
                  type="checkbox"
                  checked={isIgnored}
                  onChange={(e) => setIsIgnored(e.target.checked)}
                  className="w-4 h-4 text-rose-600 rounded border-slate-300 focus:ring-rose-500 cursor-pointer"
                />
                <div className="text-xs">
                  <span className={`font-semibold ${isIgnored ? 'text-rose-700' : 'text-slate-700'}`}>
                    RAG Vector DB 임베딩 대상에서 제외
                  </span>
                  <p className="text-[11px] text-slate-400">
                    목차, 면책조항, 머리글 등 검색 노이즈 청크를 JSONL 내보내기 시 제외합니다.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Table Special Fields */}
          {isTable && (
            <div className="space-y-3 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
              <div className="flex items-center gap-2 border-b border-indigo-200/60 pb-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('text')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                    activeTab === 'text'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-indigo-700 hover:bg-indigo-100'
                  }`}
                >
                  본문 표시 텍스트
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('raw_html')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                    activeTab === 'raw_html'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-indigo-700 hover:bg-indigo-100'
                  }`}
                >
                  표 HTML 원형 (raw_html)
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">표 제목 (Caption)</label>
                  <input
                    type="text"
                    value={tableCaption}
                    onChange={(e) => setTableCaption(e.target.value)}
                    placeholder="예: [표 1] 검사항목별 세부기준"
                    className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">표 각주 (Footnote)</label>
                  <input
                    type="text"
                    value={tableFootnote}
                    onChange={(e) => setTableFootnote(e.target.value)}
                    placeholder="예: ※ 1일 기준 최대 허용치"
                    className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Main Text / HTML Editor Area */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                {isTable && activeTab === 'raw_html' ? '표 원형 HTML 편집' : '청크 본문 텍스트 (Text) 편집'}
              </label>
              <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                <span>글자 수: <strong className="text-slate-700">{charCount}</strong>자</span>
                <span>추정 토큰/단어: <strong className="text-indigo-600">~{wordCount}</strong> words</span>
                {wordCount > 500 && (
                  <span className="text-amber-600 flex items-center gap-1 font-sans text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    토큰 초과 주의 (분할 권장)
                  </span>
                )}
              </div>
            </div>

            {isTable && activeTab === 'raw_html' ? (
              <textarea
                value={rawHtml}
                onChange={(e) => setRawHtml(e.target.value)}
                rows={12}
                className="w-full font-mono text-xs p-3.5 bg-slate-900 text-emerald-400 rounded-xl border border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y"
                placeholder="<table>...</table>"
              />
            ) : (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                className="w-full text-xs p-3.5 bg-white rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed text-slate-800 resize-y"
                placeholder="청크 본문 내용을 입력하세요..."
              />
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {isIgnored ? (
              <span className="text-rose-600 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                이 청크는 RAG JSONL 다운로드 시 제외됩니다.
              </span>
            ) : (
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                정상 임베딩 대상 청크
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs flex items-center gap-1.5 transition"
            >
              <Save className="w-4 h-4" />
              <span>수정사항 적용</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
