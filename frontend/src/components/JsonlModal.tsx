import React, { useState } from 'react';
import { Code2, X, Copy, Check } from 'lucide-react';
import type { ChildChunk, ParentSection } from '../types';

interface JsonlModalProps {
  chunk: ChildChunk | null;
  parentSections: ParentSection[];
  onClose: () => void;
}

export const JsonlModal: React.FC<JsonlModalProps> = ({
  chunk,
  parentSections,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!chunk) return null;

  const parent = parentSections.find((p) => p.id === chunk.parent_id);

  const record: Record<string, any> = {
    id: chunk.chunk_id,
    parent_id: chunk.parent_id,
    parent_title: parent?.title || '',
    chunk_type: chunk.chunk_type,
    text: chunk.text,
    page: chunk.page_number,
    breadcrumbs: chunk.breadcrumbs,
    breadcrumbs_str: (chunk.breadcrumbs || []).join(' > '),
    bbox: chunk.bbox,
    metadata: {
      ...(chunk.metadata || {}),
      parent_breadcrumbs: chunk.breadcrumbs,
      is_atomic_table: chunk.chunk_type === 'table',
    },
  };

  if (chunk.chunk_type === 'table') {
    record.raw_html = chunk.raw_html || '';
    record.image_path = chunk.image_path || '';
  }

  const jsonString = JSON.stringify(record, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-slate-800 text-sm">RAG JSONL 레코드 미리보기</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition cursor-pointer p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Vector DB나 RAG 파이프라인(LangChain, LlamaIndex 등)에 그대로 적재되는 표준 JSONL 형태의 단일 레코드입니다.
        </p>

        {/* Content Box */}
        <div className="relative">
          <pre className="bg-slate-900 text-emerald-400 p-4 rounded-xl text-xs font-mono overflow-x-auto max-h-96 whitespace-pre-wrap break-all select-all">
            {jsonString}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold px-3 py-2 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-600">복사 완료!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>레코드 복사</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs bg-slate-800 hover:bg-slate-900 text-white font-semibold px-4 py-2 rounded-lg transition cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
