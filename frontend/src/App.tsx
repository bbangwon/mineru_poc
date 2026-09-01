import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
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
  const handleUpdateChunk = (updatedChunk: ChildChunk) => {
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
    showToast(`청크(${updatedChunk.chunk_id}) 수정이 적용되었습니다. 상단의 [수정본 저장]을 눌러 파일에 저장하세요.`);
  };

  // 6. Save ETL Result to Backend & Disk
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

  // 7. Reset ETL Result to Original
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

  return (
    <div className="bg-slate-50 text-slate-800 min-h-screen flex flex-col font-sans">
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

      {/* Top Navbar */}
      <Header
        hasData={!!(etlData && etlData.child_chunks.length > 0)}
        isDirty={isDirty}
        isSaving={isSaving}
        isResetting={isResetting}
        onSave={handleSaveEtl}
        onReset={handleResetEtl}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
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
      </main>

      {/* JSONL Record Modal */}
      <JsonlModal
        chunk={activeModalChunk}
        parentSections={etlData?.parent_sections || []}
        onClose={() => setActiveModalChunk(null)}
      />

      {/* Chunk Edit Modal */}
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
