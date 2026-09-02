import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { SidebarNav } from './components/SidebarNav';
import type { ActiveTab } from './components/SidebarNav';
import { ChunkStudio } from './components/ChunkStudio';
import { ControllerBar } from './components/ControllerBar';
import { StatCards } from './components/StatCards';
import { HierarchyTree } from './components/HierarchyTree';
import { ChunkExplorer } from './components/ChunkExplorer';
import { JsonlModal } from './components/JsonlModal';
import { ChunkEditModal } from './components/ChunkEditModal';
import {
  getPdfList,
  selectPdf,
  uploadPdf,
  getEtlSample,
  startEtlJob,
  getJobStatus,
  getActiveJob,
  saveEtlResult,
  resetEtlResult,
} from './api/client';
import { getNextChunkId, reindexEtlData, estimateKoreanTokens } from './utils/idUtils';
import { syncChunkPageMetadata } from './utils/pageUtils';
import type {
  PdfItem,
  HierarchicalEtlResult,
  ChildChunk,
  ParentChunk,
  SectionNode,
  JobStatusResponse,
} from './types';

/**
 * 백엔드 또는 이전 스키마 데이터를 3단계 정규 계층(Section - Parent - Child) 구조로 보정
 */
function normalizeEtlData(data: any): HierarchicalEtlResult {
  if (!data) return data;
  const sections: SectionNode[] = data.sections || data.parent_sections || [];
  const parent_chunks: ParentChunk[] = data.parent_chunks || [];
  const child_chunks: ChildChunk[] = (data.child_chunks || []).map((c: any) => ({
    ...c,
    parent_chunk_id: c.parent_chunk_id || c.parent_id || '',
    parent_id: c.parent_chunk_id || c.parent_id || '',
    section_id: c.section_id || '',
  }));
  return {
    ...data,
    sections,
    parent_sections: sections,
    parent_chunks,
    child_chunks,
  };
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [pdfList, setPdfList] = useState<PdfItem[]>([]);
  const [selectedPdf, setSelectedPdf] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);

  const [engine, setEngine] = useState('pipeline');
  const [method, setMethod] = useState('auto');
  const [formula, setFormula] = useState(true);
  const [strategy, setStrategy] = useState<string>('general');
  const [allPages, setAllPages] = useState(true);
  const [startPage, setStartPage] = useState(0);
  const [endPage, setEndPage] = useState(2);

  const [isParsing, setIsParsing] = useState(false);
  const [activeJob, setActiveJob] = useState<JobStatusResponse | null>(null);
  const [isLoadingEtl, setIsLoadingEtl] = useState(true);
  const [etlData, setEtlData] = useState<HierarchicalEtlResult | null>(null);

  // Edit and Persistence States
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [editingChunk, setEditingChunk] = useState<ChildChunk | null>(null);

  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [activeModalChunk, setActiveModalChunk] = useState<ChildChunk | null>(null);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);

  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 4000);
  };

  const isLegalDoc = (name: string) => /규정|지침|기준|법률|조례|훈령|전문/.test(name);

  // 1. Initial Data Fetching
  const fetchPdfs = useCallback(async () => {
    try {
      const data = await getPdfList();
      setPdfList(data.pdfs || []);
      if (data.current) {
        setSelectedPdf(data.current);
        if (isLegalDoc(data.current)) {
          setStrategy('legal');
        }
        const currentItem = (data.pdfs || []).find((p) => p.filename === data.current);
        if (currentItem) {
          setEndPage(Math.max(0, currentItem.total_pages - 1));
        }
      } else if (data.pdfs && data.pdfs.length > 0) {
        setSelectedPdf(data.pdfs[0].filename);
        if (isLegalDoc(data.pdfs[0].filename)) {
          setStrategy('legal');
        }
        setEndPage(Math.max(0, data.pdfs[0].total_pages - 1));
      }
    } catch (err: any) {
      console.error(err);
      showToast('PDF 목록을 불러오는 중 오류 발생', true);
    }
  }, []);

  const fetchSample = useCallback(async () => {
    setIsLoadingEtl(true);
    try {
      const data = await getEtlSample();
      const normalized = normalizeEtlData(data);
      setEtlData(normalized);
      const firstSec = normalized.sections?.find((s) => (s.child_chunk_ids?.length || 0) > 0) || normalized.sections?.[0];
      if (firstSec) {
        setSelectedSectionId(firstSec.id);
      }
      if (data.active_pdf) {
        setSelectedPdf(data.active_pdf);
      }
      if (data.strategy) {
        setStrategy(data.strategy);
      }
    } catch (err: any) {
      console.warn('ETL 기존 데이터 로드 건너뜀:', err.message);
    } finally {
      setIsLoadingEtl(false);
    }
  }, []);

  // Check if there is an active background task running on mount
  const checkActiveTask = useCallback(async () => {
    try {
      const runningJob = await getActiveJob();
      if (runningJob && (runningJob.status === 'running' || runningJob.status === 'pending')) {
        setActiveJob(runningJob);
        setIsParsing(true);
        if (runningJob.filename) {
          setSelectedPdf(runningJob.filename);
        }
        showToast(`기존 실행 중인 백그라운드 태스크(${runningJob.task_id})를 연결했습니다.`);
      }
    } catch (err) {
      console.warn('Active task check failed:', err);
    }
  }, []);

  useEffect(() => {
    fetchPdfs();
    fetchSample();
    checkActiveTask();
  }, [fetchPdfs, fetchSample, checkActiveTask]);

  // Polling loop for active background task
  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'running' && activeJob.status !== 'pending')) {
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        const job = await getJobStatus(activeJob.task_id);
        setActiveJob(job);

        if (job.status === 'completed') {
          setIsParsing(false);
          if (job.result) {
            const normalized = normalizeEtlData(job.result);
            setEtlData(normalized);
            const firstSec = normalized.sections?.find((s) => (s.child_chunk_ids?.length || 0) > 0) || normalized.sections?.[0];
            setSelectedSectionId(firstSec?.id || null);
            showToast(
              `🎉 백그라운드 ETL 완료! (소요: ${job.elapsed_time || 0}초, 청크: ${job.result.stats.total_child_chunks}개)`
            );
          }
          clearInterval(intervalId);
        } else if (job.status === 'failed') {
          setIsParsing(false);
          showToast(`❌ 태스크 실패: ${job.error || '파싱 중 오류 발생'}`, true);
          clearInterval(intervalId);
        }
      } catch (err: any) {
        console.error('Job polling error:', err);
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [activeJob?.task_id, activeJob?.status]);

  // 2. Select PDF Handler
  const handleSelectPdf = async (filename: string) => {
    setSelectedPdf(filename);
    if (isLegalDoc(filename)) {
      setStrategy('legal');
    }
    const item = pdfList.find((p) => p.filename === filename);
    if (item) {
      setEndPage(Math.max(0, item.total_pages - 1));
    }
    try {
      await selectPdf(filename);
    } catch (err: any) {
      console.error(err);
      showToast(err.message, true);
    }
  };

  // 3. Upload PDF Handler
  const handleUploadPdf = async (file: File) => {
    setIsUploading(true);
    try {
      const res = await uploadPdf(file);
      showToast(`PDF 업로드 성공: ${res.filename} (${res.total_pages}p)`);
      await fetchPdfs();
      setSelectedPdf(res.filename);
      if (isLegalDoc(res.filename)) {
        setStrategy('legal');
      }
      setEndPage(Math.max(0, res.total_pages - 1));
    } catch (err: any) {
      showToast(err.message || '업로드 실패', true);
    } finally {
      setIsUploading(false);
    }
  };

  // 4. Run ETL Pipeline via Asynchronous Background Task
  const handleRunEtl = async () => {
    if (!selectedPdf) {
      showToast('파싱할 PDF 문서를 선택해주세요.', true);
      return;
    }

    setIsParsing(true);
    try {
      const res = await startEtlJob({
        filename: selectedPdf,
        all_pages: allPages,
        start_page: allPages ? null : startPage,
        end_page: allPages ? null : endPage,
        backend: engine,
        method: method,
        formula: formula,
        strategy: strategy,
        lang: 'korean',
      });

      setActiveJob({
        task_id: res.task_id,
        status: 'running',
        progress_msg: '백그라운드 파싱 대기열 등록됨...',
        elapsed_time: 0,
        filename: selectedPdf,
      });

      showToast(`🚀 백그라운드 태스크 등록 완료! (ID: ${res.task_id})`);
    } catch (err: any) {
      setIsParsing(false);
      showToast(err.message || '태스크 등록 실패', true);
    }
  };

  // 5. Update Single Chunk Handler
  const handleUpdateChunk = (updatedChunk: ChildChunk, silent = false) => {
    if (!etlData) return;

    const finalChunk: ChildChunk = {
      ...updatedChunk,
      token_estimate: updatedChunk.token_estimate || estimateKoreanTokens(updatedChunk.text),
      parent_id: updatedChunk.parent_chunk_id || updatedChunk.parent_id || '',
      parent_chunk_id: updatedChunk.parent_chunk_id || updatedChunk.parent_id || '',
      metadata: syncChunkPageMetadata(
        updatedChunk.metadata,
        updatedChunk.page_number,
        updatedChunk.page_end
      ),
    };

    // 1) Update child_chunks array
    const updatedChunks = etlData.child_chunks.map((c) =>
      c.chunk_id === finalChunk.chunk_id ? finalChunk : c
    );

    const oldChunk = etlData.child_chunks.find((c) => c.chunk_id === finalChunk.chunk_id);
    const oldPid = oldChunk ? (oldChunk.parent_chunk_id || oldChunk.parent_id) : '';
    const newPid = finalChunk.parent_chunk_id || finalChunk.parent_id;

    // 2) Update parent_chunks
    const chunkMap = new Map<string, ChildChunk>();
    for (const c of updatedChunks) {
      chunkMap.set(c.chunk_id, c);
    }

    let updatedParents = [...(etlData.parent_chunks || [])];
    if (oldPid && oldPid !== newPid) {
      // Moved from old parent to new parent
      updatedParents = updatedParents
        .map((p) => {
          const pid = p.parent_chunk_id || p.id;
          if (pid === oldPid) {
            const filtered = p.child_chunk_ids.filter((id) => id !== finalChunk.chunk_id);
            const childObjects = filtered.map((id) => chunkMap.get(id)).filter(Boolean) as ChildChunk[];
            const pText = childObjects.map((c) => c.text).join('\n\n');
            const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
            const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];
            return {
              ...p,
              child_chunk_ids: filtered,
              text: pText,
              token_estimate: estimateKoreanTokens(pText),
              page_range: [minP, maxP] as [number, number],
              is_edited: true,
            };
          }
          if (pid === newPid) {
            const added = [...p.child_chunk_ids, finalChunk.chunk_id];
            const childObjects = added.map((id) => chunkMap.get(id)).filter(Boolean) as ChildChunk[];
            const pText = childObjects.map((c) => c.text).join('\n\n');
            const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
            const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];
            return {
              ...p,
              child_chunk_ids: added,
              text: pText,
              token_estimate: estimateKoreanTokens(pText),
              page_range: [minP, maxP] as [number, number],
              is_edited: true,
            };
          }
          return p;
        })
        .filter((p) => p.child_chunk_ids.length > 0); // Auto-prune empty parent
    } else if (newPid) {
      // Recompute same parent's text and tokens
      updatedParents = updatedParents.map((p) => {
        const pid = p.parent_chunk_id || p.id;
        if (pid === newPid) {
          const childObjects = p.child_chunk_ids.map((id) => chunkMap.get(id)).filter(Boolean) as ChildChunk[];
          const pText = childObjects.map((c) => c.text).join('\n\n');
          const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
          const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];
          return {
            ...p,
            text: pText,
            token_estimate: estimateKoreanTokens(pText),
            page_range: [minP, maxP] as [number, number],
            is_edited: true,
          };
        }
        return p;
      });
    }

    // 3) Synchronize sections if section_id or parent changed
    const sections = etlData.sections || etlData.parent_sections || [];
    let updatedSections = sections;
    if (oldChunk && (oldChunk.section_id !== finalChunk.section_id || oldChunk.parent_id !== finalChunk.parent_id)) {
      updatedSections = sections.map((sec) => {
        if (sec.id === oldChunk.section_id || sec.id === oldChunk.parent_id) {
          return {
            ...sec,
            child_chunk_ids: (sec.child_chunk_ids || []).filter((id) => id !== finalChunk.chunk_id),
          };
        }
        if (sec.id === finalChunk.section_id || sec.id === finalChunk.parent_id) {
          return {
            ...sec,
            child_chunk_ids: [...(sec.child_chunk_ids || []), finalChunk.chunk_id],
          };
        }
        return sec;
      });
    }

    // 4) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: updatedParents.length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_chunks: updatedParents,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });

    setIsDirty(true);
    if (!silent) {
      showToast(`청크(${updatedChunk.chunk_id}) 수정이 적용되었습니다.`);
    }
  };

  // 6. Inline Section Title Updater (Column 1)
  const handleUpdateSectionTitle = (sectionId: string, newTitle: string) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const oldSection = sections.find((s) => s.id === sectionId);
    if (!oldSection || oldSection.title === newTitle.trim()) return;

    const trimmed = newTitle.trim();
    const oldTitle = oldSection.title;

    // 1) Update sections and child breadcrumbs
    const updatedSections = sections.map((s) => {
      if (s.id === sectionId) {
        return { ...s, title: trimmed };
      }
      const newBreadcrumbs = s.breadcrumbs.map((b) => (b === oldTitle ? trimmed : b));
      return { ...s, breadcrumbs: newBreadcrumbs };
    });

    // 2) Update breadcrumbs in child chunks
    const updatedChunks = etlData.child_chunks.map((c) => {
      const newBreadcrumbs = (c.breadcrumbs || []).map((b) => (b === oldTitle ? trimmed : b));
      return { ...c, breadcrumbs: newBreadcrumbs };
    });

    setEtlData({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
      child_chunks: updatedChunks,
    });
    setIsDirty(true);
    showToast(`섹션 제목이 '${trimmed}'(으)로 변경되었습니다.`);
  };

  // 6-1. Delete Section Handler
  const handleDeleteSection = (sectionId: string, deleteChunks: boolean = false) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const targetSection = sections.find((s) => s.id === sectionId);
    if (!targetSection) return;

    // 1) Handle child chunks and parent chunks
    let updatedChunks = [...etlData.child_chunks];
    let updatedParents = [...(etlData.parent_chunks || [])];

    if (deleteChunks) {
      // Remove all chunks belonging to this section
      updatedChunks = updatedChunks.filter(
        (c) => c.section_id !== sectionId && c.parent_id !== sectionId
      );
      updatedParents = updatedParents.filter((p) => p.section_id !== sectionId);
    } else {
      // Reassign to fallback section if available
      const fallbackSection =
        sections.find((s) => s.id === targetSection.parent_section_id) ||
        sections.find((s) => s.id !== sectionId);
      if (fallbackSection) {
        updatedChunks = updatedChunks.map((c) => {
          if (c.section_id === sectionId || c.parent_id === sectionId) {
            return {
              ...c,
              section_id: fallbackSection.id,
              parent_id: fallbackSection.id,
              breadcrumbs: fallbackSection.breadcrumbs,
              is_edited: true,
            };
          }
          return c;
        });
        updatedParents = updatedParents.map((p) => {
          if (p.section_id === sectionId) {
            return {
              ...p,
              section_id: fallbackSection.id,
              is_edited: true,
            };
          }
          return p;
        });
      }
    }

    // 2) Remove section from sections
    const updatedSections = sections
      .filter((s) => s.id !== sectionId)
      .map((s) => {
        if (s.parent_section_id === sectionId) {
          return {
            ...s,
            parent_section_id: targetSection.parent_section_id,
          };
        }
        return s;
      });

    // 3) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_sections: updatedSections.length,
      total_parent_sections: updatedSections.length,
      total_parent_chunks: updatedParents.length,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause').length,
      total_words: totalWords,
    };

    if (selectedSectionId === sectionId) {
      setSelectedSectionId(null);
    }

    setEtlData({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
      parent_chunks: updatedParents,
      child_chunks: updatedChunks,
      stats: updatedStats,
    });
    setIsDirty(true);
    showToast(`'${targetSection.title}' 섹션이 삭제되었습니다.`);
  };

  // 6-2. Add Section Handler
  const handleAddSection = (sectionData: {
    title: string;
    parentSectionId?: string;
    level: number;
  }) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];

    const parentSec = sectionData.parentSectionId
      ? sections.find((s) => s.id === sectionData.parentSectionId)
      : null;

    const breadcrumbs = parentSec
      ? [...(parentSec.breadcrumbs || [parentSec.title]), sectionData.title]
      : [sectionData.title];

    const newId = `sec_manual_${Date.now()}`;
    const newSection: SectionNode = {
      id: newId,
      title: sectionData.title,
      level: sectionData.level,
      parent_section_id: sectionData.parentSectionId,
      breadcrumbs: breadcrumbs,
      parent_chunk_ids: [],
      child_chunk_ids: [],
      full_text: '',
      page_range: parentSec ? parentSec.page_range : [1, 1],
    };

    const updatedSections = [...sections, newSection];
    const updatedStats = {
      ...etlData.stats,
      total_sections: updatedSections.length,
      total_parent_sections: updatedSections.length,
    };

    setEtlData({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);
    setSelectedSectionId(newId);
    showToast(`새 섹션 '${newSection.title}'이(가) 추가되었습니다.`);
  };

  // 6-3. Batch Clean Empty Sections Handler (Exclude sections with child sections)
  const handleBatchCleanEmptySections = () => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];

    // 하위 섹션을 보유한 상위 부모 섹션 ID 집합
    const parentIdSet = new Set(
      sections
        .map((s) => s.parent_section_id)
        .filter((id): id is string => Boolean(id))
    );

    // 청크가 없고 AND 하위 섹션도 없는 리프 섹션만 필터링
    const emptySections = sections.filter(
      (s) =>
        (!s.parent_chunk_ids || s.parent_chunk_ids.length === 0) &&
        (!s.child_chunk_ids || s.child_chunk_ids.length === 0) &&
        !parentIdSet.has(s.id)
    );

    if (emptySections.length === 0) {
      showToast('정리할 빈 섹션(하위 섹션 및 청크가 모두 없는 섹션)이 없습니다.');
      return;
    }

    const confirmed = window.confirm(
      `청크와 하위 섹션이 모두 없는 ${emptySections.length}개의 빈 섹션을 일괄 삭제하시겠습니까?\n(하위 섹션을 보유한 상위 섹션은 안전하게 보존됩니다)`
    );
    if (!confirmed) return;

    const emptyIdSet = new Set(emptySections.map((s) => s.id));
    const updatedSections = sections.filter((s) => !emptyIdSet.has(s.id));

    if (selectedSectionId && emptyIdSet.has(selectedSectionId)) {
      setSelectedSectionId(null);
    }

    const updatedStats = {
      ...etlData.stats,
      total_sections: updatedSections.length,
      total_parent_sections: updatedSections.length,
    };

    setEtlData({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);
    showToast(`🧹 ${emptySections.length}개의 빈 섹션이 일괄 삭제되었습니다.`);
  };

  // 7. Toggle Chunk Ignore Status (Column 2 Quick Toggle)
  const handleToggleIgnoreChunk = (chunkId: string) => {
    if (!etlData) return;
    const chunk = etlData.child_chunks.find((c) => c.chunk_id === chunkId);
    if (!chunk) return;

    const updatedChunk: ChildChunk = {
      ...chunk,
      is_ignored: !chunk.is_ignored,
      is_edited: true,
    };
    handleUpdateChunk(updatedChunk, false);
  };

  // 8. Split Chunk Handler (3-Tier Hierarchical)
  const handleSplitChunk = (
    targetChunkId: string,
    part1Text: string,
    part2Text: string,
    page1?: number,
    page2?: number
  ) => {
    if (!etlData) return;
    const targetIndex = etlData.child_chunks.findIndex((c) => c.chunk_id === targetChunkId);
    if (targetIndex === -1) return;
    const target = etlData.child_chunks[targetIndex];

    // 청크 1은 기존 ID 유지, 청크 2는 다음 시퀀스 번호(c043 등) 채번하여 ID 길이 팽창 방지
    const id1 = targetChunkId;
    const id2 = getNextChunkId(etlData.child_chunks, etlData.doc_id);

    const words1 = estimateKoreanTokens(part1Text);
    const words2 = estimateKoreanTokens(part2Text);

    const p1 = page1 || target.page_number || 1;
    const p2 = page2 || target.page_end || target.page_number || 1;

    const cleanMetadata = target.metadata ? { ...target.metadata } : undefined;
    if (cleanMetadata) {
      delete cleanMetadata.is_split;
      delete cleanMetadata.split_from;
      delete cleanMetadata.split_part;
      delete cleanMetadata.is_merged;
      delete cleanMetadata.merged_from;
      delete cleanMetadata.merged_count;
    }

    const chunk1Meta = syncChunkPageMetadata(cleanMetadata, p1);
    const chunk2Meta = syncChunkPageMetadata(cleanMetadata, p2);

    const targetParentId = target.parent_chunk_id || target.parent_id || '';
    const targetSectionId = target.section_id || '';

    const chunk1: ChildChunk = {
      ...target,
      chunk_id: id1,
      parent_chunk_id: targetParentId,
      parent_id: targetParentId,
      section_id: targetSectionId,
      text: part1Text,
      token_estimate: words1,
      page_number: p1,
      page_end: undefined,
      metadata: chunk1Meta,
      is_edited: true,
    };

    const chunk2: ChildChunk = {
      ...target,
      chunk_id: id2,
      parent_chunk_id: targetParentId,
      parent_id: targetParentId,
      section_id: targetSectionId,
      text: part2Text,
      token_estimate: words2,
      page_number: p2,
      page_end: undefined,
      metadata: chunk2Meta,
      is_edited: true,
    };

    // 1) Replace target chunk in child_chunks with [chunk1, chunk2]
    const updatedChunks = [...etlData.child_chunks];
    updatedChunks.splice(targetIndex, 1, chunk1, chunk2);

    const chunkMap = new Map<string, ChildChunk>();
    for (const c of updatedChunks) {
      chunkMap.set(c.chunk_id, c);
    }

    // 2) Update parent_chunks: inherit parent_chunk_id and recompute parent text & tokens
    const updatedParents = (etlData.parent_chunks || []).map((p) => {
      const pid = p.parent_chunk_id || p.id;
      if (pid === targetParentId) {
        const newChildIds: string[] = [];
        for (const cid of p.child_chunk_ids) {
          if (cid === targetChunkId) {
            newChildIds.push(chunk1.chunk_id, chunk2.chunk_id);
          } else {
            newChildIds.push(cid);
          }
        }
        const childObjects = newChildIds.map((cid) => chunkMap.get(cid)).filter(Boolean) as ChildChunk[];
        const parentText = childObjects.map((c) => c.text).join('\n\n');
        const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
        const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];

        return {
          ...p,
          child_chunk_ids: newChildIds,
          text: parentText,
          token_estimate: estimateKoreanTokens(parentText),
          page_range: [minP, maxP] as [number, number],
          is_edited: true,
        };
      }
      return p;
    });

    // 3) Update sections: update child_chunk_ids if present
    const sectionsToUpdate = etlData.sections || etlData.parent_sections || [];
    const updatedSections = sectionsToUpdate.map((sec) => {
      if (sec.id === targetSectionId || sec.id === target.parent_id) {
        const newIds: string[] = [];
        for (const cid of (sec.child_chunk_ids || [])) {
          if (cid === targetChunkId) {
            newIds.push(chunk1.chunk_id, chunk2.chunk_id);
          } else {
            newIds.push(cid);
          }
        }
        return {
          ...sec,
          child_chunk_ids: newIds,
        };
      }
      return sec;
    });

    // 4) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: updatedParents.length,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause').length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_chunks: updatedParents,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);
    showToast(`청크(${targetChunkId})가 2개(p.${chunk1.page_number} / p.${chunk2.page_number})로 분할되고 상위 Parent(${targetParentId})가 실시간 동기화되었습니다.`);
  };

  // 9. Merge Chunks Handler (3-Tier Hierarchical with Auto-pruning)
  const handleMergeChunks = (
    chunkIds: string[],
    mergedText: string,
    customMergedId?: string,
    pageStart?: number,
    pageEnd?: number
  ) => {
    if (!etlData || chunkIds.length < 2) return;

    const selectedChunks = chunkIds
      .map((id) => etlData.child_chunks.find((c) => c.chunk_id === id))
      .filter((c): c is ChildChunk => Boolean(c));

    if (selectedChunks.length < 2) return;

    const firstChunk = selectedChunks[0];
    const primaryParentId = firstChunk.parent_chunk_id || firstChunk.parent_id || '';
    const primarySectionId = firstChunk.section_id || '';

    let mergedId = customMergedId?.trim() || firstChunk.chunk_id;
    if (
      etlData.child_chunks.some(
        (c) => c.chunk_id === mergedId && !chunkIds.includes(c.chunk_id)
      )
    ) {
      mergedId = getNextChunkId(etlData.child_chunks, etlData.doc_id);
    }

    const words = estimateKoreanTokens(mergedText);
    const minPage = pageStart || Math.min(...selectedChunks.map((c) => c.page_number || 1));
    const maxPage = pageEnd || Math.max(...selectedChunks.map((c) => c.page_end || c.page_number || 1));
    const finalEnd = maxPage > minPage ? maxPage : undefined;

    const cleanMetadata = firstChunk.metadata ? { ...firstChunk.metadata } : undefined;
    if (cleanMetadata) {
      delete cleanMetadata.is_merged;
      delete cleanMetadata.merged_from;
      delete cleanMetadata.merged_count;
      delete cleanMetadata.is_split;
      delete cleanMetadata.split_from;
      delete cleanMetadata.split_part;
    }

    const mergedMeta = syncChunkPageMetadata(
      cleanMetadata,
      minPage,
      finalEnd
    );

    const mergedChunk: ChildChunk = {
      ...firstChunk,
      chunk_id: mergedId,
      parent_chunk_id: primaryParentId,
      parent_id: primaryParentId,
      section_id: primarySectionId,
      text: mergedText,
      token_estimate: words,
      page_number: minPage,
      page_end: finalEnd,
      metadata: mergedMeta,
      is_edited: true,
      is_ignored: false,
    };

    // 1) Replace first chunk with mergedChunk, remove other selected chunks from child_chunks
    const chunkIdsToRemove = new Set(chunkIds.slice(1));
    const updatedChunks: ChildChunk[] = [];
    for (let i = 0; i < etlData.child_chunks.length; i++) {
      const c = etlData.child_chunks[i];
      if (c.chunk_id === firstChunk.chunk_id) {
        updatedChunks.push(mergedChunk);
      } else if (!chunkIdsToRemove.has(c.chunk_id)) {
        updatedChunks.push(c);
      }
    }

    const chunkMap = new Map<string, ChildChunk>();
    for (const c of updatedChunks) {
      chunkMap.set(c.chunk_id, c);
    }

    // 2) Update parent_chunks with Auto-pruning (자식 0개 Parent 자동 삭제)
    const prunedParentIds = new Set<string>();
    const survivingParents: ParentChunk[] = [];

    for (const p of (etlData.parent_chunks || [])) {
      const pid = p.parent_chunk_id || p.id || '';
      let newChildIds = p.child_chunk_ids.filter((cid) => !chunkIdsToRemove.has(cid));

      if (pid === primaryParentId || p.child_chunk_ids.includes(firstChunk.chunk_id)) {
        newChildIds = newChildIds.map((cid) => (cid === firstChunk.chunk_id ? mergedChunk.chunk_id : cid));
        if (!newChildIds.includes(mergedChunk.chunk_id)) {
          newChildIds.push(mergedChunk.chunk_id);
        }
      }

      // Auto-pruning check:
      if (newChildIds.length === 0) {
        prunedParentIds.add(pid);
        continue;
      }

      const childObjects = newChildIds.map((cid) => chunkMap.get(cid)).filter(Boolean) as ChildChunk[];
      const parentText = childObjects.map((c) => c.text).join('\n\n');
      const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
      const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];

      survivingParents.push({
        ...p,
        child_chunk_ids: newChildIds,
        text: parentText,
        token_estimate: estimateKoreanTokens(parentText),
        page_range: [minP, maxP] as [number, number],
        is_edited: true,
      });
    }

    // 3) Update sections: remove prunedParentIds and update child_chunk_ids
    const allSelectedSet = new Set(chunkIds);
    const sectionsToUpdate = etlData.sections || etlData.parent_sections || [];
    const updatedSections = sectionsToUpdate.map((sec) => {
      const newParentIds = (sec.parent_chunk_ids || []).filter((pid) => !prunedParentIds.has(pid));

      let containsFirst = false;
      const filteredChildren = (sec.child_chunk_ids || []).filter((id) => {
        if (id === firstChunk.chunk_id) {
          containsFirst = true;
          return true;
        }
        return !allSelectedSet.has(id);
      });

      let finalChildren = filteredChildren;
      if (containsFirst || sec.id === primarySectionId) {
        const replaced = filteredChildren.map((id) => (id === firstChunk.chunk_id ? mergedChunk.chunk_id : id));
        if (!replaced.includes(mergedChunk.chunk_id)) {
          replaced.push(mergedChunk.chunk_id);
        }
        finalChildren = replaced;
      }

      return {
        ...sec,
        parent_chunk_ids: newParentIds,
        child_chunk_ids: finalChildren,
      };
    });

    // 4) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: survivingParents.length,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause').length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_chunks: survivingParents,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);

    const pruneMsg = prunedParentIds.size > 0 ? ` (자식 청크가 0개인 Parent ${prunedParentIds.size}개 자동 정리됨)` : '';
    showToast(`${chunkIds.length}개 청크가 성공적으로 병합되었습니다 (${mergedChunk.chunk_id}).${pruneMsg}`);
  };

  // 9-1. Delete Chunks Handler (Multi-parent Support, Parent Text Shrinking, Auto-pruning)
  const handleDeleteChunks = (chunkIds: string[]) => {
    if (!etlData || chunkIds.length === 0) return;

    const chunkIdsToRemove = new Set(chunkIds);
    const updatedChunks = etlData.child_chunks.filter((c) => !chunkIdsToRemove.has(c.chunk_id));

    const chunkMap = new Map<string, ChildChunk>();
    for (const c of updatedChunks) {
      chunkMap.set(c.chunk_id, c);
    }

    // 2) Update parent_chunks with Auto-pruning & text re-computation
    const prunedParentIds = new Set<string>();
    const survivingParents: ParentChunk[] = [];

    for (const p of (etlData.parent_chunks || [])) {
      const pid = p.parent_chunk_id || p.id || '';
      const newChildIds = p.child_chunk_ids.filter((cid) => !chunkIdsToRemove.has(cid));

      // Auto-pruning: 자식 청크가 0개가 된 Parent는 자동 삭제
      if (newChildIds.length === 0) {
        prunedParentIds.add(pid);
        continue;
      }

      // 자식 청크가 남아있고 일부가 삭제된 경우 본문 텍스트 및 토큰 축소 재계산
      const hasChanged = newChildIds.length !== p.child_chunk_ids.length;
      if (hasChanged) {
        const childObjects = newChildIds.map((cid) => chunkMap.get(cid)).filter(Boolean) as ChildChunk[];
        const parentText = childObjects.map((c) => c.text).join('\n\n');
        const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
        const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];

        survivingParents.push({
          ...p,
          child_chunk_ids: newChildIds,
          text: parentText,
          token_estimate: estimateKoreanTokens(parentText),
          page_range: [minP, maxP] as [number, number],
          is_edited: true,
        });
      } else {
        survivingParents.push(p);
      }
    }

    // 3) Update sections: remove prunedParentIds and remove deleted chunkIds
    const sectionsToUpdate = etlData.sections || etlData.parent_sections || [];
    const updatedSections = sectionsToUpdate.map((sec) => {
      const newParentIds = (sec.parent_chunk_ids || []).filter((pid) => !prunedParentIds.has(pid));
      const newChildIds = (sec.child_chunk_ids || []).filter((id) => !chunkIdsToRemove.has(id));

      return {
        ...sec,
        parent_chunk_ids: newParentIds,
        child_chunk_ids: newChildIds,
      };
    });

    // 4) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: survivingParents.length,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause').length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_chunks: survivingParents,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);

    const pruneMsg = prunedParentIds.size > 0 ? ` (빈 Parent ${prunedParentIds.size}개 자동 정리)` : '';
    showToast(`🗑️ ${chunkIds.length}개 청크가 삭제되었습니다.${pruneMsg}`);
  };

  // 10. Parent Reassign Section Handler (Cascading Sync to Children)
  const handleReassignParentSection = (parentChunkId: string, newSectionId: string) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const parentChunks = etlData.parent_chunks || [];
    const childChunks = etlData.child_chunks || [];

    const targetParent = parentChunks.find(
      (p) => (p.parent_chunk_id === parentChunkId) || (p.id === parentChunkId)
    );
    if (!targetParent) {
      showToast(`대상 Parent 청크(${parentChunkId})를 찾을 수 없습니다.`, true);
      return;
    }

    const oldSectionId = targetParent.section_id;
    if (oldSectionId === newSectionId) return;

    const newSection = sections.find((s) => s.id === newSectionId);
    if (!newSection) {
      showToast(`지정할 신규 섹션(${newSectionId})을 찾을 수 없습니다.`, true);
      return;
    }

    const pid = targetParent.parent_chunk_id || targetParent.id || '';

    // 1) Update target parent chunk's section_id
    const updatedParents = parentChunks.map((p) => {
      if ((p.parent_chunk_id || p.id) === pid) {
        return {
          ...p,
          section_id: newSectionId,
          is_edited: true,
        };
      }
      return p;
    });

    // 2) Cascading Sync: Update all child chunks belonging to targetParent
    const targetChildIdSet = new Set(targetParent.child_chunk_ids);
    const updatedChildren = childChunks.map((c) => {
      const belongs =
        targetChildIdSet.has(c.chunk_id) ||
        c.parent_chunk_id === pid ||
        c.parent_id === pid;

      if (belongs) {
        const newBreadcrumbs = targetParent.title
          ? [...(newSection.breadcrumbs || [newSection.title]), targetParent.title]
          : [...(newSection.breadcrumbs || [newSection.title])];

        return {
          ...c,
          section_id: newSectionId,
          breadcrumbs: newBreadcrumbs,
          is_edited: true,
        };
      }
      return c;
    });

    // 3) Update sections: parent_chunk_ids & child_chunk_ids
    const updatedSections = sections.map((sec) => {
      if (sec.id === oldSectionId) {
        return {
          ...sec,
          parent_chunk_ids: (sec.parent_chunk_ids || []).filter((id) => id !== pid),
          child_chunk_ids: (sec.child_chunk_ids || []).filter((id) => !targetChildIdSet.has(id)),
        };
      }
      if (sec.id === newSectionId) {
        const pIds = [...(sec.parent_chunk_ids || [])];
        if (!pIds.includes(pid)) pIds.push(pid);

        const cIds = [...(sec.child_chunk_ids || [])];
        for (const cid of targetParent.child_chunk_ids) {
          if (!cIds.includes(cid)) cIds.push(cid);
        }

        return {
          ...sec,
          parent_chunk_ids: pIds,
          child_chunk_ids: cIds,
        };
      }
      return sec;
    });

    setEtlData({
      ...etlData,
      parent_chunks: updatedParents,
      child_chunks: updatedChildren,
      sections: updatedSections,
      parent_sections: updatedSections,
    });
    setIsDirty(true);
    showToast(
      `Parent(${pid}) 및 하위 ${targetParent.child_chunk_ids.length}개 청크의 상위 섹션이 '${newSection.title}'(으)로 재지정되었습니다.`
    );
  };

  // 11. Batch Clean Empty Chunks Handler (Phase 3)
  const handleBatchCleanEmptyChunks = () => {
    if (!etlData) return;
    const emptyChunks = etlData.child_chunks.filter(
      (c) =>
        (!c.text || !c.text.trim()) &&
        (!c.raw_html || !c.raw_html.trim()) &&
        !c.is_ignored
    );

    if (emptyChunks.length === 0) {
      showToast('정리할 빈 청크가 없습니다.');
      return;
    }

    const confirmed = window.confirm(
      `내용이 없는 ${emptyChunks.length}개의 빈 청크를 임베딩 제외(Ignore) 처리하시겠습니까?`
    );
    if (!confirmed) return;

    const emptyIdSet = new Set(emptyChunks.map((c) => c.chunk_id));
    const updatedChunks = etlData.child_chunks.map((c) => {
      if (emptyIdSet.has(c.chunk_id)) {
        return { ...c, is_ignored: true, is_edited: true };
      }
      return c;
    });

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
    });
    setIsDirty(true);
    showToast(`🧹 ${emptyChunks.length}개의 빈 청크를 임베딩 제외 처리했습니다.`);
  };

  // 12. Re-index All IDs Handler (3-Tier ID 일괄 물리적 순서 재정렬)
  const handleReindexIds = () => {
    if (!etlData) return;
    const secCount = (etlData.sections || etlData.parent_sections || []).length;
    const parentCount = (etlData.parent_chunks || []).length;
    const childCount = etlData.child_chunks.length;
    const confirmed = window.confirm(
      `전체 계층(Section s01~, Parent p001~, Child c001~) ID를 문서 물리적 순서대로 일괄 재정렬하시겠습니까?\n(총 ${secCount}개 섹션, ${parentCount}개 Parent, ${childCount}개 Child)\n\n※ 분할/병합/섹션 재지정 후 불연속해진 번호가 깨끗하게 순차적으로 정돈됩니다.`
    );
    if (!confirmed) return;

    const reindexed = reindexEtlData(etlData);
    setEtlData(reindexed);
    setIsDirty(true);
    showToast('전체 계층(Section/Parent/Child) ID가 물리적 순서대로 성공적으로 재정렬되었습니다.');
  };

  // 13. Save ETL Result to Backend & Disk
  const handleSaveEtl = async () => {
    if (!etlData) return;
    setIsSaving(true);
    try {
      const res = await saveEtlResult(etlData);
      setIsDirty(false);
      showToast(`🎉 ${res.message || '수정본이 파일(rag_chunks_edited.json)에 성공적으로 저장되었습니다.'}`);
    } catch (err: any) {
      console.error('Save error:', err);
      showToast(err.message || '수정본 저장 중 오류가 발생했습니다.', true);
    } finally {
      setIsSaving(false);
    }
  };

  // 14. Reset ETL Result to Original
  const handleResetEtl = async () => {
    const confirmed = window.confirm('모든 수정 내용을 폐기하고 원본 파싱 결과로 복원하시겠습니까?');
    if (!confirmed) return;

    setIsResetting(true);
    try {
      const original = await resetEtlResult(strategy);
      const normalized = normalizeEtlData(original);
      setEtlData(normalized);
      setIsDirty(false);
      const firstSec = normalized.sections?.find((s) => (s.child_chunk_ids?.length || 0) > 0) || normalized.sections?.[0];
      setSelectedSectionId(firstSec?.id || null);
      showToast('🔄 원본 파싱 데이터로 초기화되었습니다.');
    } catch (err: any) {
      console.error('Reset error:', err);
      showToast(err.message || '초기화 중 오류가 발생했습니다.', true);
    } finally {
      setIsResetting(false);
    }
  };

  const totalChunksCount = etlData?.child_chunks.length || 0;
  const editedChunksCount = etlData?.child_chunks.filter((c) => c.is_edited).length || 0;
  const ignoredChunksCount = etlData?.child_chunks.filter((c) => c.is_ignored).length || 0;

  return (
    <div className="bg-slate-50 text-slate-800 h-screen flex font-sans overflow-hidden">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 border transition-all animate-bounce ${
            toast.isError
              ? 'bg-rose-50 border-rose-200 text-rose-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span>{toast.message}</span>
        </div>
      )}

      {/* Left Slim Navigation Sidebar */}
      <SidebarNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        totalChunks={totalChunksCount}
        editedChunksCount={editedChunksCount}
        ignoredChunksCount={ignoredChunksCount}
        isDirty={isDirty}
        activePdf={selectedPdf}
      />

      {/* Right Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Navbar */}
        <Header
          hasData={!!(etlData && etlData.child_chunks.length > 0)}
          activeTab={activeTab}
          activePdf={selectedPdf}
          isDirty={isDirty}
          isSaving={isSaving}
          isResetting={isResetting}
          onSave={handleSaveEtl}
          onReset={handleResetEtl}
          onReindex={handleReindexIds}
        />

        {activeTab === 'dashboard' ? (
          /* Dashboard Mode: Scrollable Overview & Parser */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="max-w-7xl mx-auto space-y-6">
              {/* PDF Controller Bar */}
              <ControllerBar
                pdfList={pdfList}
                selectedPdf={selectedPdf}
                onSelectPdf={handleSelectPdf}
                onUploadPdf={handleUploadPdf}
                isUploading={isUploading}
                engine={engine}
                setEngine={setEngine}
                method={method}
                setMethod={setMethod}
                formula={formula}
                setFormula={setFormula}
                strategy={strategy}
                setStrategy={setStrategy}
                allPages={allPages}
                setAllPages={setAllPages}
                startPage={startPage}
                setStartPage={setStartPage}
                endPage={endPage}
                setEndPage={setEndPage}
                onRunEtl={handleRunEtl}
                isParsing={isParsing}
                activeJob={activeJob}
              />

              {/* Statistics Scoreboard */}
              <StatCards stats={etlData?.stats} />

              {/* Hierarchy Tree + Chunk Explorer Workspace */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: Heading Hierarchy Tree */}
                <div className="lg:col-span-4">
                  <HierarchyTree
                    sections={etlData?.sections || etlData?.parent_sections || []}
                    parentChunks={etlData?.parent_chunks || []}
                    selectedSectionId={selectedSectionId}
                    onSelectSection={setSelectedSectionId}
                    isLoading={isLoadingEtl}
                  />
                </div>

                {/* Right: Chunk Viewer & Inspector */}
                <div className="lg:col-span-8">
                  <ChunkExplorer
                    chunks={etlData?.child_chunks || []}
                    parentSections={etlData?.sections || etlData?.parent_sections || []}
                    selectedSectionId={selectedSectionId}
                    onClearSectionFilter={() => setSelectedSectionId(null)}
                    onOpenJsonlModal={setActiveModalChunk}
                    onEditChunk={setEditingChunk}
                    onDeleteChunk={(id) => handleDeleteChunks([id])}
                    isLoading={isLoadingEtl}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Chunk Studio Mode: 3-Column Focus IDE Workspace */
          <div className="flex-1 overflow-hidden p-3 sm:p-4 flex flex-col min-h-0">
            <ChunkStudio
              parentSections={etlData?.sections || etlData?.parent_sections || []}
              childChunks={etlData?.child_chunks || []}
              parentChunks={etlData?.parent_chunks || []}
              selectedSectionId={selectedSectionId}
              onSelectSection={setSelectedSectionId}
              onUpdateChunk={handleUpdateChunk}
              onUpdateSectionTitle={handleUpdateSectionTitle}
              onDeleteSection={handleDeleteSection}
              onAddSection={handleAddSection}
              onBatchCleanEmptySections={handleBatchCleanEmptySections}
              onToggleIgnoreChunk={handleToggleIgnoreChunk}
              onOpenJsonlModal={setActiveModalChunk}
              onSplitChunk={handleSplitChunk}
              onMergeChunks={handleMergeChunks}
              onDeleteChunks={handleDeleteChunks}
              onReassignParentSection={handleReassignParentSection}
              onBatchCleanEmptyChunks={handleBatchCleanEmptyChunks}
              onReindexIds={handleReindexIds}
              isLoading={isLoadingEtl}
            />
          </div>
        )}
      </div>

      {/* JSONL Record Modal */}
      <JsonlModal
        chunk={activeModalChunk}
        parentSections={etlData?.sections || etlData?.parent_sections || []}
        parentChunks={etlData?.parent_chunks || []}
        onClose={() => setActiveModalChunk(null)}
      />

      {/* Chunk Edit Modal (Dashboard compatible) */}
      <ChunkEditModal
        chunk={editingChunk}
        parentSections={etlData?.sections || etlData?.parent_sections || []}
        parentChunks={etlData?.parent_chunks || []}
        onClose={() => setEditingChunk(null)}
        onSave={handleUpdateChunk}
        onReassignParentSection={handleReassignParentSection}
      />
    </div>
  );
}

export default App;
