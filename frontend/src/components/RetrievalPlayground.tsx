import React, { useState } from 'react';
import type { SearchResultItem, SearchTestResponse } from '../types';
import { searchTest } from '../api/client';

interface RetrievalPlaygroundProps {
  collectionName?: string;
  onOpenConfig?: () => void;
  onSelectChunk?: (chunkId: string) => void;
}

export const RetrievalPlayground: React.FC<RetrievalPlaygroundProps> = ({
  collectionName,
  onOpenConfig,
  onSelectChunk,
}) => {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchResponse, setSearchResponse] = useState<SearchTestResponse | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResultItem | null>(null);

  const sampleQueries = [
    '석면 해체 제거 작업 시 안전 보호구 착용 기준',
    '밀폐공간 출입 전 산소 농도 측정 방법',
    '석면 비산 방지 조치 계획 및 제출 서류',
    '작업 환경 측정 및 특수건강진단 주기',
  ];

  const handleSearch = async (targetQuery?: string) => {
    const q = (targetQuery !== undefined ? targetQuery : query).trim();
    if (!q) {
      setErrorMsg('검색 질의어를 입력해주세요.');
      return;
    }

    if (targetQuery !== undefined) {
      setQuery(targetQuery);
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSelectedResult(null);

    try {
      const res = await searchTest(q, limit, collectionName);
      setSearchResponse(res);
      if (res.results.length === 0) {
        setErrorMsg('검색된 청크가 없습니다. 먼저 상단 툴바의 [⚡ Qdrant 색인]을 실행했는지 확인해주세요.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || '하이브리드 검색 중 오류가 발생했습니다.');
      setSearchResponse(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">
      {/* 검색 바 영역 */}
      <div className="p-6 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
                <span>🔍 하이브리드 RRF 검색 플레이그라운드</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  BGE-m3-ko + Kiwi Modifier.IDF
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                인덱싱된 Qdrant 컬렉션에서 Dense 의미론적 검색과 Kiwi 형태소 키워드 검색을 RRF로 최적 융합합니다.
              </p>
            </div>
            {onOpenConfig && (
              <button
                type="button"
                onClick={onOpenConfig}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 transition flex items-center gap-1.5"
              >
                <span>⚙️ Qdrant 설정</span>
              </button>
            )}
          </div>

          {/* 검색 인풋 그룹 */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="한국어 자연어 질문 또는 핵심 키워드를 입력하세요... (예: 석면 해체 작업 계획서)"
                className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition shadow-inner"
              />
            </div>

            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
            </select>

            <button
              type="button"
              onClick={() => handleSearch()}
              disabled={isLoading}
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition disabled:opacity-50 flex items-center gap-2 shrink-0"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>검색 중...</span>
                </>
              ) : (
                <span>검색 실행</span>
              )}
            </button>
          </div>

          {/* 추천 샘플 질의 */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-[11px] text-slate-500">추천 질의:</span>
            {sampleQueries.map((sq, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSearch(sq)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 hover:text-white transition"
              >
                {sq}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 검색 결과 영역 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {errorMsg && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-xs text-rose-300 flex items-center justify-between">
              <span>{errorMsg}</span>
            </div>
          )}

          {searchResponse && (
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span>
                컬렉션 <strong className="text-slate-200 font-mono">{searchResponse.collection_name}</strong> 에서 총{' '}
                <strong className="text-indigo-400">{searchResponse.total_matches}개</strong> 청크 검색됨
              </span>
            </div>
          )}

          {/* 검색 결과 리스트 */}
          {searchResponse?.results.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedResult(item)}
              className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 transition shadow-sm hover:shadow-indigo-500/5 cursor-pointer group space-y-3"
            >
              {/* 상단 메타데이터 바 */}
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center text-xs border border-indigo-500/30">
                    {item.rank}
                  </span>
                  <span className="font-mono text-slate-300 font-semibold">{item.chunk_id}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                      item.chunk_type === 'table'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : item.chunk_type === 'article_clause'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    }`}
                  >
                    {item.chunk_type}
                  </span>
                  <span className="text-slate-500 text-[11px]">p.{item.page_idx + 1}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/60">
                    <span className="text-slate-400 text-[10px]">RRF Score:</span>
                    <span className="text-indigo-300 font-mono font-bold text-xs">{item.score.toFixed(4)}</span>
                  </div>
                  {onSelectChunk && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectChunk(item.chunk_id);
                      }}
                      className="text-[11px] text-slate-400 hover:text-indigo-300 hover:underline"
                    >
                      에디터에서 보기 →
                    </button>
                  )}
                </div>
              </div>

              {/* 브레드크럼 */}
              {item.heading_hierarchy && item.heading_hierarchy.length > 0 && (
                <div className="text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                  <span className="text-slate-500">📁</span>
                  {item.heading_hierarchy.map((h, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="text-slate-600">/</span>}
                      <span className="text-slate-300">{h}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* 텍스트 본문 */}
              <div className="text-xs text-slate-200 leading-relaxed bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 font-sans whitespace-pre-wrap max-h-36 overflow-y-auto">
                {item.text}
              </div>

              {/* 표 이미지 미리보기 */}
              {item.image_url && (
                <div className="mt-2 rounded-xl overflow-hidden border border-slate-800 max-w-sm">
                  <img src={item.image_url} alt="Chunk Media" className="w-full object-cover" />
                </div>
              )}
            </div>
          ))}

          {!searchResponse && !isLoading && (
            <div className="text-center py-20 text-slate-500 space-y-3">
              <div className="text-4xl">📚</div>
              <p className="text-sm">검색어를 입력하고 하이브리드 RRF 검색 성능을 테스트해보세요.</p>
              <p className="text-xs text-slate-600">
                BGE-m3-ko 1024차원 벡터와 Kiwi 형태소 기반의 Qdrant Modifier.IDF가 실시간 결합됩니다.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 결과 상세 모달 */}
      {selectedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-100 text-sm">청크 상세 정보</span>
                <span className="font-mono text-xs text-indigo-400">({selectedResult.chunk_id})</span>
              </div>
              <button
                onClick={() => setSelectedResult(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-800/50 rounded-xl">
                <div>
                  <span className="text-slate-400">RRF Score:</span>
                  <span className="ml-2 font-mono font-bold text-indigo-300">{selectedResult.score}</span>
                </div>
                <div>
                  <span className="text-slate-400">페이지:</span>
                  <span className="ml-2 text-slate-200">{selectedResult.page_idx + 1}</span>
                </div>
                <div>
                  <span className="text-slate-400">타입:</span>
                  <span className="ml-2 text-slate-200">{selectedResult.chunk_type}</span>
                </div>
                <div>
                  <span className="text-slate-400">추정 토큰 수:</span>
                  <span className="ml-2 text-slate-200">{selectedResult.token_count}</span>
                </div>
              </div>

              <div>
                <span className="block text-slate-400 font-semibold mb-1">본문 텍스트:</span>
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {selectedResult.text}
                </div>
              </div>

              {selectedResult.image_url && (
                <div>
                  <span className="block text-slate-400 font-semibold mb-1">표/이미지:</span>
                  <img src={selectedResult.image_url} alt="Media" className="rounded-xl border border-slate-800 max-h-60" />
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/80 flex justify-end">
              <button
                onClick={() => setSelectedResult(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
