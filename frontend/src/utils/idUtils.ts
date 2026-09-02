import type { HierarchicalEtlResult, ChildChunk, ParentChunk, SectionNode } from '../types';
import { syncChunkPageMetadata } from './pageUtils';

/**
 * 한국어 서브워드/BPE 특성을 반영한 표준 토큰 추정 공식:
 * token_estimate = max(floor(len(text) / 2.0), floor(len(text.split()) * 2.2))
 */
export function estimateKoreanTokens(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const charTokens = Math.floor(trimmed.length / 2.0);
  const wordTokens = Math.floor(trimmed.split(/\s+/).length * 2.2);
  return Math.max(charTokens, wordTokens);
}

/**
 * 문서명을 6자리 짧은 해시 기반 식별자(d_xxxxxx)로 변환
 */
export function generateDocId(name?: string): string {
  if (!name) return 'doc';
  const clean = name.trim();
  if (clean.startsWith('d_') && clean.length <= 10) {
    return clean;
  }
  // 간단한 문자열 해시 (32비트 -> 6자리 16진수)
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(6, '0').slice(0, 6);
  return `d_${hex}`;
}

/**
 * 주어진 청크 목록에서 사용된 c 번호 중 최댓값 + 1을 채번하여 새 청크 ID를 생성합니다.
 * 형식: {doc_id}_c{다음번호 3자리}
 */
export function getNextChunkId(childChunks: ChildChunk[], docId: string): string {
  let maxSeq = 0;
  const seqRegex = /_c(\d+)$/;

  for (const chunk of childChunks) {
    const match = chunk.chunk_id.match(seqRegex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `${docId}_c${String(nextSeq).padStart(3, '0')}`;
}

/**
 * 주어진 Parent 청크 목록에서 사용된 p 번호 중 최댓값 + 1을 채번하여 새 Parent ID를 생성합니다.
 * 형식: {doc_id}_p{다음번호 3자리}
 */
export function getNextParentChunkId(parentChunks: ParentChunk[], docId: string): string {
  let maxSeq = 0;
  const seqRegex = /_p(\d+)$/;

  for (const parent of parentChunks) {
    const pid = parent.parent_chunk_id || parent.id || '';
    const match = pid.match(seqRegex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `${docId}_p${String(nextSeq).padStart(3, '0')}`;
}

/**
 * 주어진 섹션 목록에서 사용된 s 번호 중 최댓값 + 1을 채번하여 새 Section ID를 생성합니다.
 * 형식: {doc_id}_s{다음번호 2자리}
 */
export function getNextSectionId(sections: SectionNode[], docId: string): string {
  let maxSeq = 0;
  const seqRegex = /_s(\d+)$/;

  for (const sec of sections) {
    const match = sec.id.match(seqRegex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `${docId}_s${String(nextSeq).padStart(2, '0')}`;
}

/**
 * 문서 물리적 등장 순서(Page & Block Position)를 기준으로
 * 3단계 계층(Section - Parent - Child)의 전체 ID를 순차적으로 일괄 재정렬(Re-index)합니다.
 * - Section ID: {doc_id}_s00 (루트), {doc_id}_s01, s02...
 * - Parent ID:  {doc_id}_p001, p002, p003...
 * - Child ID:   {doc_id}_c001, c002, c003...
 * - 3단계 간 양방향 참조(parent_section_id, parent_chunk_ids, child_chunk_ids, section_id 등) 일괄 동기화
 */
export function reindexEtlData(etl: HierarchicalEtlResult): HierarchicalEtlResult {
  const docId = etl.doc_id || generateDocId(etl.doc_title);

  const rawSections = (etl.sections && etl.sections.length > 0)
    ? etl.sections
    : (etl.parent_sections || []);
  const rawParents = etl.parent_chunks || [];
  const rawChildren = etl.child_chunks || [];

  // 1. 물리적 페이지 순서 기반 정렬 (안정 정렬)
  let rootSec: SectionNode | null = null;
  const normalSections: SectionNode[] = [];
  for (const s of rawSections) {
    if (s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')) {
      rootSec = s;
    } else {
      normalSections.push(s);
    }
  }

  normalSections.sort((a, b) => {
    const pA = a.page_range ? a.page_range[0] : 1;
    const pB = b.page_range ? b.page_range[0] : 1;
    return pA - pB;
  });
  const sortedSections = rootSec ? [rootSec, ...normalSections] : normalSections;

  const sortedParents = [...rawParents].sort((a, b) => {
    const pA = a.page_range ? a.page_range[0] : 1;
    const pB = b.page_range ? b.page_range[0] : 1;
    return pA - pB;
  });

  const sortedChildren = [...rawChildren].sort((a, b) => {
    const pA = a.page_number || 1;
    const pB = b.page_number || 1;
    return pA - pB;
  });

  // 2. 신규 ID 매핑 생성
  const sectionIdMap: Record<string, string> = {};
  let secIdx = 1;
  const newSections = sortedSections.map((sec) => {
    let newSecId: string;
    if (sec.level === 0 || sec.id.endsWith('_s00') || sec.id.endsWith('_root')) {
      newSecId = `${docId}_s00`;
    } else {
      newSecId = `${docId}_s${String(secIdx++).padStart(2, '0')}`;
    }
    sectionIdMap[sec.id] = newSecId;
    return { ...sec, id: newSecId };
  });

  const parentIdMap: Record<string, string> = {};
  let parentIdx = 1;
  const newParents = sortedParents.map((parent) => {
    const oldPid = parent.parent_chunk_id || parent.id || '';
    const newPid = `${docId}_p${String(parentIdx++).padStart(3, '0')}`;
    if (oldPid) {
      parentIdMap[oldPid] = newPid;
    }
    return {
      ...parent,
      parent_chunk_id: newPid,
      id: newPid,
    };
  });

  const childIdMap: Record<string, string> = {};
  let childIdx = 1;
  const newChildren = sortedChildren.map((child) => {
    const oldCid = child.chunk_id;
    const newCid = `${docId}_c${String(childIdx++).padStart(3, '0')}`;
    childIdMap[oldCid] = newCid;

    const startPage = child.page_number || 1;
    const endPage = child.page_end || startPage;
    const finalEnd = endPage > startPage ? endPage : undefined;

    const meta = { ...(child.metadata || {}) };
    delete (meta as Record<string, any>).original_chunk_id;
    const synchronizedMeta = syncChunkPageMetadata(
      meta,
      startPage,
      finalEnd
    );

    return {
      ...child,
      chunk_id: newCid,
      metadata: synchronizedMeta,
    };
  });

  // 3. 상호 참조 ID 일괄 갱신
  const finalSections: SectionNode[] = newSections.map((sec) => ({
    ...sec,
    parent_section_id: sec.parent_section_id ? (sectionIdMap[sec.parent_section_id] || sec.parent_section_id) : undefined,
    parent_chunk_ids: (sec.parent_chunk_ids || []).map((pid) => parentIdMap[pid] || pid).filter(Boolean),
    child_chunk_ids: (sec.child_chunk_ids || []).map((cid) => childIdMap[cid] || cid).filter(Boolean),
  }));

  const finalParents: ParentChunk[] = newParents.map((parent) => ({
    ...parent,
    section_id: sectionIdMap[parent.section_id] || parent.section_id,
    child_chunk_ids: parent.child_chunk_ids.map((cid) => childIdMap[cid] || cid).filter(Boolean),
  }));

  const finalChildren: ChildChunk[] = newChildren.map((child) => {
    const oldPid = child.parent_chunk_id || child.parent_id || '';
    const newPid = parentIdMap[oldPid] || oldPid;
    const oldSid = child.section_id;
    const newSid = sectionIdMap[oldSid] || oldSid;

    return {
      ...child,
      parent_chunk_id: newPid,
      parent_id: newPid,
      section_id: newSid,
    };
  });

  return {
    ...etl,
    doc_id: docId,
    sections: finalSections,
    parent_sections: finalSections,
    parent_chunks: finalParents,
    child_chunks: finalChildren,
  };
}
