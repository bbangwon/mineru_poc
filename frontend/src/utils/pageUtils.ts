import type { ChildChunk } from '../types';

/**
 * 청크의 페이지 번호/범위를 읽기 쉬운 문자열로 포맷팅합니다. (예: "p.3", "p.3~p.5")
 */
export function formatChunkPage(chunk: Pick<ChildChunk, 'page_number' | 'page_end'>): string {
  const start = chunk.page_number || 1;
  const end = chunk.page_end;
  if (end && end > start) {
    return `p.${start}~p.${end}`;
  }
  return `p.${start}`;
}

/**
 * 청크의 페이지 번호/범위를 "Page 3" 또는 "Page 3~5" 형식으로 포맷팅합니다.
 */
export function formatChunkPageFull(chunk: Pick<ChildChunk, 'page_number' | 'page_end'>): string {
  const start = chunk.page_number || 1;
  const end = chunk.page_end;
  if (end && end > start) {
    return `Page ${start}~${end}`;
  }
  return `Page ${start}`;
}

/**
 * 시작 페이지와 끝 페이지 사이의 연속된 페이지 번호 배열을 반환합니다.
 */
export function getChunkPageList(startPage: number, endPage?: number): number[] {
  const start = startPage || 1;
  const end = endPage && endPage >= start ? endPage : start;
  const pages: number[] = [];
  for (let p = start; p <= end; p++) {
    pages.push(p);
  }
  return pages;
}

/**
 * 청크의 최상위 page_number와 page_end를 metadata 내부에 일관되게 동기화합니다.
 * - page: 단일 검색 호환 (시작 페이지)
 * - page_start: 범위 시작 페이지
 * - page_end: 범위 끝 페이지
 * - pages: 다중 페이지 매칭 검색용 배열
 */
export function syncChunkPageMetadata(
  metadata: Record<string, any> | undefined,
  pageNumber: number,
  pageEnd?: number
): Record<string, any> {
  const start = pageNumber || 1;
  const end = pageEnd && pageEnd >= start ? pageEnd : start;
  const pages = getChunkPageList(start, end);

  const updated = { ...(metadata || {}) };
  updated.page = start;
  updated.page_start = start;
  updated.page_end = end;
  updated.pages = pages;

  return updated;
}
