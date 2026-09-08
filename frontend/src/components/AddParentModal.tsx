import React, { useState, useEffect } from 'react';
import { X, Layers, HelpCircle, FileText, BookOpen, AlertCircle } from 'lucide-react';
import type { SectionNode } from '../types';

interface AddParentModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: SectionNode[];
  defaultSectionId?: string | null;
  onAddParent: (data: {
    sectionId: string;
    title: string;
    pageNumber: number;
    initialChildText: string;
    chunkType: 'paragraph' | 'table' | 'article_clause' | 'article';
  }) => void;
}

export const AddParentModal: React.FC<AddParentModalProps> = ({
  isOpen,
  onClose,
  sections,
  defaultSectionId,
  onAddParent,
}) => {
  const [sectionId, setSectionId] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [chunkType, setChunkType] = useState<'paragraph' | 'article_clause' | 'table'>('paragraph');
  const [childText, setChildText] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      const initialSec = defaultSectionId && sections.some((s) => s.id === defaultSectionId)
        ? defaultSectionId
        : (sections.length > 0 ? sections[0].id : '');
      setSectionId(initialSec);

      // 해당 섹션의 시작 페이지를 기본 페이지로 설정
      const foundSec = sections.find((s) => s.id === initialSec);
      const defaultPage = foundSec?.page_range?.[0] || 1;

      setTitle('');
      setPageNumber(defaultPage);
      setChunkType('paragraph');
      setChildText('');
      setError('');
    }
  }, [isOpen, defaultSectionId, sections]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedText = childText.trim();

    if (!sectionId) {
      setError('소속될 섹션을 선택해주세요.');
      return;
    }
    if (!trimmedTitle) {
      setError('Parent(부모 문맥) 제목을 입력해주세요.');
      return;
    }
    if (!trimmedText) {
      setError('누락된 본문 텍스트(최초 Child 청크)를 입력해주세요.');
      return;
    }
    if (pageNumber < 1) {
      setError('유효한 페이지 번호(1 이상)를 입력해주세요.');
      return;
    }

    onAddParent({
      sectionId,
      title: trimmedTitle,
      pageNumber,
      initialChildText: trimmedText,
      chunkType,
    });

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-purple-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">새 Parent(부모 청크) 추가</h3>
              <p className="text-xs text-slate-500">
                누락된 본문을 위한 부모 문맥과 최초 자식 청크를 함께 생성합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Target Section */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">
              소속 섹션 (Section) <span className="text-rose-500">*</span>
            </label>
            <select
              value={sectionId}
              onChange={(e) => {
                setSectionId(e.target.value);
                const foundSec = sections.find((s) => s.id === e.target.value);
                if (foundSec?.page_range?.[0]) {
                  setPageNumber(foundSec.page_range[0]);
                }
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-slate-800 font-medium cursor-pointer"
            >
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.breadcrumbs && sec.breadcrumbs.length > 0
                    ? sec.breadcrumbs.join(' > ')
                    : sec.title} (L{sec.level})
                </option>
              ))}
            </select>
          </div>

          {/* Parent Title & Page Number */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="block font-semibold text-slate-700">
                Parent 제목 / 소제목 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (error) setError('');
                }}
                placeholder="예: 제3조 (용어의 정의), 2.2 운영 지침"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-slate-900 placeholder-slate-400 font-medium"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-700 flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                페이지 번호
              </label>
              <input
                type="number"
                min="1"
                value={pageNumber}
                onChange={(e) => setPageNumber(parseInt(e.target.value, 10) || 1)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-slate-900 font-mono font-medium"
              />
            </div>
          </div>

          {/* Chunk Type Selector */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">청크 유형</label>
            <div className="flex items-center gap-2">
              {[
                { id: 'paragraph', label: '일반 문단 (Paragraph)' },
                { id: 'article_clause', label: '법률/조항 (Article)' },
                { id: 'table', label: '표/테이블 (Table)' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setChunkType(t.id as any)}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                    chunkType === t.id
                      ? 'bg-purple-50 border-purple-500 text-purple-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Initial Child Chunk Text */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-slate-700 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-purple-600" />
                누락된 본문 텍스트 (최초 Child 청크) <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] text-slate-400 font-mono">
                {childText.length}자
              </span>
            </div>
            <textarea
              rows={5}
              value={childText}
              onChange={(e) => {
                setChildText(e.target.value);
                if (error) setError('');
              }}
              placeholder="누락되었던 본문 내용을 여기에 입력하거나 붙여넣으세요. (이 내용이 부모 및 첫 번째 자식 청크의 본문이 됩니다)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-slate-900 placeholder-slate-400 font-sans leading-relaxed text-xs resize-y"
            />
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <HelpCircle className="w-3 h-3 shrink-0" />
              부모 청크 생성 시 최소 1개의 자식 청크가 필수이므로 함께 등록됩니다. 생성 후 자식을 추가할 수 있습니다.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Parent 생성</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
