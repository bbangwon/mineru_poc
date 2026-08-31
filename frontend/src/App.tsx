import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { ControllerBar } from './components/ControllerBar';
import { StatCards } from './components/StatCards';
import { HierarchyTree } from './components/HierarchyTree';
import { ChunkExplorer } from './components/ChunkExplorer';
import { JsonlModal } from './components/JsonlModal';
import { getPdfList, selectPdf, uploadPdf, getEtlSample, runEtlParse } from './api/client';
import type { PdfItem, EtlResult, ChildChunk } from './types';

export function App() {
  const [pdfList, setPdfList] = useState<PdfItem[]>([]);
  const [selectedPdf, setSelectedPdf] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);

  const [engine, setEngine] = useState('pipeline');
  const [allPages, setAllPages] = useState(true);
  const [startPage, setStartPage] = useState(0);
  const [endPage, setEndPage] = useState(2);

  const [isParsing, setIsParsing] = useState(false);
  const [isLoadingEtl, setIsLoadingEtl] = useState(true);
  const [etlData, setEtlData] = useState<EtlResult | null>(null);

  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [activeModalChunk, setActiveModalChunk] = useState<ChildChunk | null>(null);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);

  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 4000);
  };

  // 1. Initial Data Fetching
  const fetchPdfs = useCallback(async () => {
    try {
      const data = await getPdfList();
      setPdfList(data.pdfs || []);
      if (data.current) {
        setSelectedPdf(data.current);
        const currentItem = (data.pdfs || []).find((p) => p.filename === data.current);
        if (currentItem) {
          setEndPage(Math.max(0, currentItem.total_pages - 1));
        }
      } else if (data.pdfs && data.pdfs.length > 0) {
        setSelectedPdf(data.pdfs[0].filename);
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
    } catch (err: any) {
      console.warn('ETL 기존 데이터 로드 건너뜀:', err.message);
    } finally {
      setIsLoadingEtl(false);
    }
  }, []);

  useEffect(() => {
    fetchPdfs();
    fetchSample();
  }, [fetchPdfs, fetchSample]);

  // 2. Select PDF Handler
  const handleSelectPdf = async (filename: string) => {
    setSelectedPdf(filename);
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
      setEndPage(Math.max(0, res.total_pages - 1));
    } catch (err: any) {
      showToast(err.message || '업로드 실패', true);
    } finally {
      setIsUploading(false);
    }
  };

  // 4. Run ETL Pipeline Handler
  const handleRunEtl = async () => {
    if (!selectedPdf) {
      showToast('파싱할 PDF 문서를 선택해주세요.', true);
      return;
    }

    setIsParsing(true);
    try {
      const result = await runEtlParse({
        filename: selectedPdf,
        all_pages: allPages,
        start_page: allPages ? null : startPage,
        end_page: allPages ? null : endPage,
        backend: engine,
        lang: 'korean',
      });
      setEtlData(result);
      setSelectedSectionId(null);
      showToast(
        `파싱 및 계층 청킹 완료! (소요: ${result.elapsed_time || 0}초, 청크: ${result.stats.total_child_chunks}개)`
      );
    } catch (err: any) {
      showToast(err.message || 'ETL 실행 실패', true);
    } finally {
      setIsParsing(false);
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
      <Header hasData={!!(etlData && etlData.child_chunks.length > 0)} />

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
          allPages={allPages}
          setAllPages={setAllPages}
          startPage={startPage}
          setStartPage={setStartPage}
          endPage={endPage}
          setEndPage={setEndPage}
          onRunEtl={handleRunEtl}
          isParsing={isParsing}
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
    </div>
  );
}

export default App;
