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
import type { PdfItem, EtlResult, ChildChunk, JobStatusResponse } from './types';

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
  const [etlData, setEtlData] = useState<EtlResult | null>(null);

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
      setEtlData(data);
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
            setEtlData(job.result);
            setSelectedSectionId(null);
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

    // 1) Update child_chunks array
    const updatedChunks = etlData.child_chunks.map((c) =>
      c.chunk_id === updatedChunk.chunk_id ? updatedChunk : c
    );

    // 2) Synchronize parent sections if parent_id was changed
    const oldChunk = etlData.child_chunks.find((c) => c.chunk_id === updatedChunk.chunk_id);
    let updatedSections = [...etlData.parent_sections];

    if (oldChunk && oldChunk.parent_id !== updatedChunk.parent_id) {
      updatedSections = updatedSections.map((sec) => {
        if (sec.id === oldChunk.parent_id) {
          // Remove from old parent
          return {
            ...sec,
            child_chunk_ids: sec.child_chunk_ids.filter((id) => id !== updatedChunk.chunk_id),
          };
        }
        if (sec.id === updatedChunk.parent_id) {
          // Add to new parent
          return {
            ...sec,
            child_chunk_ids: [...sec.child_chunk_ids, updatedChunk.chunk_id],
          };
        }
        return sec;
      });
    }

    // 3) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
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
    const oldSection = etlData.parent_sections.find((s) => s.id === sectionId);
    if (!oldSection || oldSection.title === newTitle.trim()) return;

    const trimmed = newTitle.trim();
    const oldTitle = oldSection.title;

    // 1) Update parent sections and child breadcrumbs
    const updatedSections = etlData.parent_sections.map((s) => {
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
      parent_sections: updatedSections,
      child_chunks: updatedChunks,
    });
    setIsDirty(true);
    showToast(`섹션 제목이 '${trimmed}'(으)로 변경되었습니다.`);
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

  // 8. Split Chunk Handler (Phase 3)
  const handleSplitChunk = (targetChunkId: string, part1Text: string, part2Text: string) => {
    if (!etlData) return;
    const targetIndex = etlData.child_chunks.findIndex((c) => c.chunk_id === targetChunkId);
    if (targetIndex === -1) return;
    const target = etlData.child_chunks[targetIndex];

    let baseId = targetChunkId;
    let id1 = `${baseId}_split1`;
    let id2 = `${baseId}_split2`;
    let counter = 1;
    while (etlData.child_chunks.some((c) => c.chunk_id === id1 || c.chunk_id === id2)) {
      counter++;
      id1 = `${baseId}_s${counter}_1`;
      id2 = `${baseId}_s${counter}_2`;
    }

    const words1 = part1Text.trim() ? part1Text.trim().split(/\s+/).length : 0;
    const words2 = part2Text.trim() ? part2Text.trim().split(/\s+/).length : 0;

    const chunk1: ChildChunk = {
      ...target,
      chunk_id: id1,
      text: part1Text,
      token_estimate: words1,
      metadata: {
        ...(target.metadata || {}),
        is_split: true,
        split_from: targetChunkId,
        split_part: 1,
      },
      is_edited: true,
    };

    const chunk2: ChildChunk = {
      ...target,
      chunk_id: id2,
      text: part2Text,
      token_estimate: words2,
      metadata: {
        ...(target.metadata || {}),
        is_split: true,
        split_from: targetChunkId,
        split_part: 2,
      },
      is_edited: true,
    };

    // 1) Replace target chunk in child_chunks with [chunk1, chunk2]
    const updatedChunks = [...etlData.child_chunks];
    updatedChunks.splice(targetIndex, 1, chunk1, chunk2);

    // 2) Update parent section child_chunk_ids
    const updatedSections = etlData.parent_sections.map((sec) => {
      if (sec.id === target.parent_id) {
        const newIds: string[] = [];
        for (const cid of sec.child_chunk_ids) {
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

    // 3) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article').length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);
    showToast(`청크(${targetChunkId})가 2개(${chunk1.chunk_id}, ${chunk2.chunk_id})로 분할되었습니다.`);
  };

  // 9. Merge Chunks Handler (Phase 3)
  const handleMergeChunks = (chunkIds: string[], mergedText: string, customMergedId?: string) => {
    if (!etlData || chunkIds.length < 2) return;

    const selectedChunks = chunkIds
      .map((id) => etlData.child_chunks.find((c) => c.chunk_id === id))
      .filter((c): c is ChildChunk => Boolean(c));

    if (selectedChunks.length < 2) return;

    const firstChunk = selectedChunks[0];

    let mergedId = customMergedId?.trim() || `${firstChunk.chunk_id}_merged`;
    let counter = 1;
    while (
      etlData.child_chunks.some(
        (c) => c.chunk_id === mergedId && !chunkIds.includes(c.chunk_id)
      )
    ) {
      counter++;
      mergedId = `${firstChunk.chunk_id}_merged${counter}`;
    }

    const words = mergedText.trim() ? mergedText.trim().split(/\s+/).length : 0;
    const minPage = Math.min(...selectedChunks.map((c) => c.page_number));

    const mergedChunk: ChildChunk = {
      ...firstChunk,
      chunk_id: mergedId,
      text: mergedText,
      token_estimate: words,
      page_number: minPage,
      metadata: {
        ...(firstChunk.metadata || {}),
        is_merged: true,
        merged_from: chunkIds,
        merged_count: chunkIds.length,
      },
      is_edited: true,
      is_ignored: false,
    };

    // 1) Replace first chunk with mergedChunk, remove other selected chunks
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

    // 2) Update parent sections child_chunk_ids
    const allSelectedSet = new Set(chunkIds);
    const updatedSections = etlData.parent_sections.map((sec) => {
      let containsFirst = false;
      const filtered = sec.child_chunk_ids.filter((id) => {
        if (id === firstChunk.chunk_id) {
          containsFirst = true;
          return true;
        }
        return !allSelectedSet.has(id);
      });

      if (containsFirst || sec.id === firstChunk.parent_id) {
        const replaced = filtered.map((id) => (id === firstChunk.chunk_id ? mergedChunk.chunk_id : id));
        if (!replaced.includes(mergedChunk.chunk_id)) {
          replaced.push(mergedChunk.chunk_id);
        }
        return {
          ...sec,
          child_chunk_ids: replaced,
        };
      }

      return {
        ...sec,
        child_chunk_ids: filtered,
      };
    });

    // 3) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article').length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);
    showToast(`${chunkIds.length}개 청크가 성공적으로 병합되었습니다 (${mergedChunk.chunk_id}).`);
  };

  // 10. Batch Clean Empty Chunks Handler (Phase 3)
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

  // 11. Save ETL Result to Backend & Disk
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

  // 12. Reset ETL Result to Original
  const handleResetEtl = async () => {
    const confirmed = window.confirm('모든 수정 내용을 폐기하고 원본 파싱 결과로 복원하시겠습니까?');
    if (!confirmed) return;

    setIsResetting(true);
    try {
      const original = await resetEtlResult(strategy);
      setEtlData(original);
      setIsDirty(false);
      setSelectedSectionId(null);
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
                    sections={etlData?.parent_sections || []}
                    selectedSectionId={selectedSectionId}
                    onSelectSection={setSelectedSectionId}
                    isLoading={isLoadingEtl}
                  />
                </div>

                {/* Right: Chunk Viewer & Inspector */}
                <div className="lg:col-span-8">
                  <ChunkExplorer
                    chunks={etlData?.child_chunks || []}
                    parentSections={etlData?.parent_sections || []}
                    selectedSectionId={selectedSectionId}
                    onClearSectionFilter={() => setSelectedSectionId(null)}
                    onOpenJsonlModal={setActiveModalChunk}
                    onEditChunk={setEditingChunk}
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
              parentSections={etlData?.parent_sections || []}
              childChunks={etlData?.child_chunks || []}
              selectedSectionId={selectedSectionId}
              onSelectSection={setSelectedSectionId}
              onUpdateChunk={handleUpdateChunk}
              onUpdateSectionTitle={handleUpdateSectionTitle}
              onToggleIgnoreChunk={handleToggleIgnoreChunk}
              onOpenJsonlModal={setActiveModalChunk}
              onSplitChunk={handleSplitChunk}
              onMergeChunks={handleMergeChunks}
              onBatchCleanEmptyChunks={handleBatchCleanEmptyChunks}
              isLoading={isLoadingEtl}
            />
          </div>
        )}
      </div>

      {/* JSONL Record Modal */}
      <JsonlModal
        chunk={activeModalChunk}
        parentSections={etlData?.parent_sections || []}
        onClose={() => setActiveModalChunk(null)}
      />

      {/* Chunk Edit Modal (Dashboard compatible) */}
      <ChunkEditModal
        chunk={editingChunk}
        parentSections={etlData?.parent_sections || []}
        onClose={() => setEditingChunk(null)}
        onSave={handleUpdateChunk}
      />
    </div>
  );
}

export default App;
