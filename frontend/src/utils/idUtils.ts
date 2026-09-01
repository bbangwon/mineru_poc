import type { EtlResult, ChildChunk } from '../types';

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
 * 문서 내 전체 섹션과 청크의 ID를 처음부터 끝까지 순서대로 정규화/재정렬합니다.
 * - 섹션 ID: {doc_id}_s01, {doc_id}_s02... (루트는 s00)
 * - 청크 ID: {doc_id}_c001, {doc_id}_c002...
 * - 부모-자식 상호 참조(parent_section_id, child_chunk_ids, parent_id) 일괄 치환
 */
export function reindexEtlData(etl: EtlResult): EtlResult {
  const docId = etl.doc_id || 'doc';

  // 1. 섹션 ID 매핑
  const sectionIdMap: Record<string, string> = {};
  let secIdx = 1;
  const newSections = etl.parent_sections.map((sec) => {
    let newSecId: string;
    if (sec.level === 0 || sec.id.endsWith('_root') || sec.id.endsWith('_s00')) {
      newSecId = `${docId}_s00`;
    } else {
      newSecId = `${docId}_s${String(secIdx++).padStart(2, '0')}`;
    }
    sectionIdMap[sec.id] = newSecId;
    return { ...sec, id: newSecId };
  });

  // 2. 청크 ID 매핑
  const chunkIdMap: Record<string, string> = {};
  let chunkIdx = 1;
  const newChunks = etl.child_chunks.map((chunk) => {
    const newChunkId = `${docId}_c${String(chunkIdx++).padStart(3, '0')}`;
    chunkIdMap[chunk.chunk_id] = newChunkId;
    return {
      ...chunk,
      chunk_id: newChunkId,
      metadata: {
        ...(chunk.metadata || {}),
        original_chunk_id: chunk.metadata?.original_chunk_id || chunk.chunk_id,
      },
    };
  });

  // 3. 섹션 내 부모 섹션 및 자식 청크 참조 일괄 갱신
  const finalSections = newSections.map((sec) => ({
    ...sec,
    parent_section_id: sec.parent_section_id ? (sectionIdMap[sec.parent_section_id] || sec.parent_section_id) : undefined,
    child_chunk_ids: sec.child_chunk_ids.map((cid) => chunkIdMap[cid] || cid).filter(Boolean),
  }));

  // 4. 청크 내 부모 섹션 참조 일괄 갱신
  const finalChunks = newChunks.map((chunk) => ({
    ...chunk,
    parent_id: sectionIdMap[chunk.parent_id] || chunk.parent_id,
  }));

  return {
    ...etl,
    parent_sections: finalSections,
    child_chunks: finalChunks,
  };
}
