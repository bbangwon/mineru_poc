import React from 'react';
import { Table2, AlignLeft, FileCode2, ChevronRight, MapPin, ShieldCheck, Image as ImageIcon, ExternalLink, Scale, Edit3, EyeOff, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import type { ChildChunk, ParentSection } from '../types';
import { formatChunkPageFull } from '../utils/pageUtils';
import { estimateKoreanTokens } from '../utils/idUtils';

interface ChunkCardProps {
  chunk: ChildChunk;
  parentSection?: ParentSection;
  onOpenJsonlModal: (chunk: ChildChunk) => void;
  onEditChunk?: (chunk: ChildChunk) => void;
}

export const ChunkCard: React.FC<ChunkCardProps> = ({
  chunk,
  parentSection,
  onOpenJsonlModal,
  onEditChunk,
}) => {
  const isTable = chunk.chunk_type === 'table' || Boolean(chunk.is_atomic_table);
  const isArticle = chunk.chunk_type === 'article' || chunk.chunk_type === 'article_clause';
  const isIgnored = Boolean(chunk.is_ignored);
  const isEdited = Boolean(chunk.is_edited);
  const breadcrumbs = chunk.breadcrumbs || [];

  const wordCount = chunk.token_estimate || (chunk.text ? estimateKoreanTokens(chunk.text) : 0);
  const isEmpty = (!chunk.text || !chunk.text.trim()) && (!chunk.raw_html || !chunk.raw_html.trim());
  const isOverTokenLimit = !isTable && wordCount > 512;
  const isUnderTokenLimit = !isTable && !isEmpty && wordCount > 0 && wordCount < 20;

  return (
    <div
      className={`p-4 rounded-xl border shadow-xs transition relative ${
        isIgnored
          ? 'bg-slate-50/70 border-slate-300 opacity-65'
          : isTable
          ? 'border-indigo-300 ring-1 ring-indigo-200/60 bg-white'
          : isArticle
          ? 'border-purple-300 ring-1 ring-purple-200/60 bg-white'
          : 'border-slate-200 hover:border-slate-300 bg-white'
      }`}
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isTable ? (
            <span className="bg-indigo-600 text-white text-[11px] font-bold px-2.5 py-0.5 rounded shadow-xs flex items-center gap-1">
              <Table2 className="w-3.5 h-3.5" />
              ATOMIC TABLE (원형 보존)
            </span>
          ) : isArticle ? (
            <span className="bg-purple-600 text-white text-[11px] font-bold px-2.5 py-0.5 rounded shadow-xs flex items-center gap-1">
              <Scale className="w-3.5 h-3.5" />
              {chunk.metadata?.article_no ? `${chunk.metadata.article_no} 조문 완결 청크` : '조문 완결 청크'}
            </span>
          ) : (
            <span className="bg-slate-100 text-slate-600 text-[11px] font-medium px-2 py-0.5 rounded flex items-center gap-1">
              <AlignLeft className="w-3 h-3 text-slate-400" />
              문단
            </span>
          )}

          {/* Edited Status Badge */}
          {isEdited && (
            <span className="bg-amber-50 text-amber-700 border border-amber-300 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-amber-500" />
              수정됨
            </span>
          )}

          {/* Ignored Status Badge */}
          {isIgnored && (
            <span className="bg-rose-50 text-rose-700 border border-rose-300 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
              <EyeOff className="w-3 h-3 text-rose-500" />
              임베딩 제외
            </span>
          )}

          {/* Linter Warning Badges */}
          {isEmpty ? (
            <span className="bg-rose-100 text-rose-800 border border-rose-200 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-rose-600" />
              빈 청크
            </span>
          ) : isOverTokenLimit ? (
            <span className="bg-amber-50 text-amber-800 border border-amber-300 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-600" />
              512+ tokens (분할 권장)
            </span>
          ) : isUnderTokenLimit ? (
            <span className="bg-sky-50 text-sky-800 border border-sky-200 text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1">
              <Info className="w-3 h-3 text-sky-600" />
              &lt;20 tokens (병합 권장)
            </span>
          ) : null}

          <span className="font-mono text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            {chunk.chunk_id}
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            {formatChunkPageFull(chunk)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onEditChunk && (
            <button
              type="button"
              onClick={() => onEditChunk(chunk)}
              className="text-[11px] text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded transition flex items-center gap-1 font-semibold cursor-pointer border border-indigo-200/80"
              title="청크 내용 및 부모 섹션 수정"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>수정</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onOpenJsonlModal(chunk)}
            className="text-[11px] text-slate-600 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 px-2.5 py-1 rounded transition flex items-center gap-1 font-medium cursor-pointer"
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>JSONL</span>
          </button>
        </div>
      </div>

      {/* Breadcrumb Path */}
      <div className="mt-2.5 text-[11px] text-slate-500 flex items-center flex-wrap gap-1">
        <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
        {breadcrumbs.length > 0 ? (
          breadcrumbs.map((b, idx) => (
            <React.Fragment key={idx}>
              <span
                className={
                  idx === breadcrumbs.length - 1
                    ? 'font-semibold text-slate-700'
                    : 'text-slate-400'
                }
              >
                {b}
              </span>
              {idx < breadcrumbs.length - 1 && (
                <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
              )}
            </React.Fragment>
          ))
        ) : (
          <span className="text-slate-400">{parentSection?.title || '루트 문서'}</span>
        )}
      </div>

      {/* Content */}
      {isTable ? (
        <div className="space-y-2 mt-2.5">
          <div
            className="prose-custom overflow-x-auto bg-slate-50/70 p-3 rounded-lg border border-slate-200"
            dangerouslySetInnerHTML={{ __html: chunk.raw_html || chunk.text }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
            <span className="flex items-center gap-1.5 text-emerald-700">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>잘림 없는 독립 엔티티 (RAG 검색 시 Multi-Vector / 요약 인덱싱 지원)</span>
            </span>
            {chunk.image_url && (
              <a
                href={chunk.image_url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 font-medium"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>원본 표 이미지 보기</span>
                <ExternalLink className="w-3 h-3 text-indigo-400" />
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-700 leading-relaxed mt-2.5 whitespace-pre-line bg-slate-50/50 p-3 rounded-lg border border-slate-100 font-sans">
          {chunk.text}
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-mono">
        <span>
          Parent: <strong className="text-slate-600">{chunk.parent_chunk_id || chunk.parent_id}</strong>
          {chunk.section_id && ` | Section: ${chunk.section_id}`}
          {parentSection && ` (${parentSection.title})`}
        </span>
        <span>추정 토큰: ~{wordCount} tokens</span>
      </div>
    </div>
  );
};
