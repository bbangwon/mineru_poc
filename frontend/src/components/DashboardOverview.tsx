import React, { useState, useMemo, useRef } from 'react';
import {
  FileText,
  CheckCircle2,
  Layers,
  Database,
  Search,
  UploadCloud,
  RefreshCw,
  SlidersHorizontal,
  Play,
  Download,
  Clock,
  Table as TableIcon,
  Sparkles,
  AlertCircle,
  FolderOpen,
  Check,
  FileCode2,
  ChevronRight,
  Settings2,
} from 'lucide-react';
import type { PdfItem, GlobalStats, JobStatusResponse } from '../types';

interface DashboardOverviewProps {
  pdfList: PdfItem[];
  globalStats?: GlobalStats;
  selectedPdf: string;
  onSelectPdf: (filename: string) => Promise<void>;
  onSelectAndOpenStudio: (filename: string) => Promise<void>;
  onUploadPdf: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDropUploadPdf: (file: File) => Promise<void>;
  isUploading: boolean;
  onRunEtl: (filename?: string) => Promise<void>;
  isParsing: boolean;
  activeJob: JobStatusResponse | null;
  onRefreshList: () => Promise<void>;
  onOpenQdrantModal: () => void;
  // Parser settings pass-through
  engine: string;
  setEngine: (v: string) => void;
  strategy: string;
  setStrategy: (v: string) => void;
  allPages: boolean;
  setAllPages: (v: boolean) => void;
  startPage: number;
  setStartPage: (v: number) => void;
  endPage: number;
  setEndPage: (v: number) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  pdfList,
  globalStats,
  selectedPdf,
  onSelectPdf,
  onSelectAndOpenStudio,
  onUploadPdf,
  onDropUploadPdf,
  isUploading,
  onRunEtl,
  isParsing,
  activeJob,
  onRefreshList,
  onOpenQdrantModal,
  engine,
  setEngine,
  strategy,
  setStrategy,
  allPages,
  setAllPages,
  startPage,
  setStartPage,
  endPage,
  setEndPage,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'running' | 'not_started' | 'embedded'>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File size formatter
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Filtered documents
  const filteredList = useMemo(() => {
    return pdfList.filter((item) => {
      const matchName = item.filename.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchName) return false;

      if (statusFilter === 'all') return true;
      if (statusFilter === 'completed') return item.etl_status === 'completed';
      if (statusFilter === 'running') return item.etl_status === 'running';
      if (statusFilter === 'not_started') return item.etl_status === 'not_started';
      if (statusFilter === 'embedded') return !!item.is_embedded;
      return true;
    });
  }, [pdfList, searchQuery, statusFilter]);

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.pdf')) {
        await onDropUploadPdf(file);
      }
    }
  };

  // Aggregated KPIs
  const metrics = useMemo(() => {
    const totalPdfs = pdfList.length;
    const parsedPdfs = pdfList.filter((p) => p.etl_status === 'completed').length;
    const embeddedPdfs = pdfList.filter((p) => p.is_embedded).length;
    const totalChunks = globalStats?.total_chunks ?? pdfList.reduce((acc, cur) => acc + (cur.stats?.total_chunks || 0), 0);
    const totalSections = pdfList.reduce((acc, cur) => acc + (cur.stats?.parent_sections || 0), 0);

    return {
      totalPdfs,
      parsedPdfs,
      embeddedPdfs,
      totalChunks,
      totalSections,
    };
  }, [pdfList, globalStats]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 relative transition-colors"
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={onUploadPdf}
        disabled={isUploading}
      />

      {/* Drag overlay notice */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-indigo-950/80 backdrop-blur-sm border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center text-white pointer-events-none animate-in fade-in duration-150">
          <UploadCloud className="w-16 h-16 text-indigo-400 animate-bounce mb-3" />
          <p className="text-xl font-bold">PDF 문서를 이곳에 놓아 즉시 업로드하세요</p>
          <p className="text-sm text-indigo-200 mt-1">자동으로 파일이 등록되며 ETL 파이프라인에 추가됩니다.</p>
        </div>
      )}

      {/* Top Banner: Header + Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xs transition-colors">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                문서 ETL & RAG 파이프라인 현황
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                MinerU 파싱, 계층 청킹 정제 및 Qdrant 하이브리드 벡터 색인 통합 관제
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all flex items-center gap-2 cursor-pointer shadow-2xs ${
              showSettings
                ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
            title="파싱 엔진 및 기본 파라미터 설정"
          >
            <Settings2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>파서 옵션 설정</span>
          </button>

          <button
            type="button"
            onClick={() => onRefreshList()}
            className="p-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors cursor-pointer shadow-2xs"
            title="상태 새로고침"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
          >
            <UploadCloud className="w-4 h-4" />
            <span>{isUploading ? '업로드 중...' : '신규 PDF 등록'}</span>
          </button>
        </div>
      </div>

      {/* Parser Settings Panel (Collapsible) */}
      {showSettings && (
        <div className="bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-2xl p-4 sm:p-5 shadow-md transition-colors animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 font-semibold">
            <span className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <SlidersHorizontal className="w-4 h-4" />
              신규 파싱 기본 옵션 (MinerU Engine & Chunking Strategy)
            </span>
            <span className="text-[11px] text-slate-500">각 문서의 'ETL 실행' 버튼 클릭 시 적용됩니다</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">MinerU 엔진</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="pipeline">Pipeline (MLX / 고속 파이프라인)</option>
                <option value="vlm">VLM (Vision-Language Model)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">청킹 전략 (Strategy)</label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="general">일반 문서 (General Markdown/Structure)</option>
                <option value="legal">규정 및 법률 문서 (조/항/호 계층 파싱)</option>
                <option value="report">학술/기술 보고서 (표/수식 집중)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">페이지 범위 모드</label>
              <div className="flex items-center gap-2 pt-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allPages}
                    onChange={(e) => setAllPages(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700"
                  />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">문서 전체 파싱 (권장)</span>
                </label>
              </div>
            </div>

            {!allPages ? (
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">페이지 범위 (0-indexed)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={startPage}
                    onChange={(e) => setStartPage(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-center font-medium"
                    placeholder="시작"
                  />
                  <span className="text-slate-400">~</span>
                  <input
                    type="number"
                    min={startPage}
                    value={endPage}
                    onChange={(e) => setEndPage(Math.max(startPage, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-center font-medium"
                    placeholder="끝"
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-end pb-2 text-slate-500 dark:text-slate-400 text-[11px]">
                <span>문서의 1페이지부터 마지막 페이지까지 전체를 파싱합니다.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global KPI Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total PDFs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 shadow-2xs transition-colors">
          <div className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">전체 등록 문서</p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-mono">{metrics.totalPdfs}</span>
              <span className="text-xs text-slate-500">개 PDF</span>
            </div>
          </div>
        </div>

        {/* Card 2: Parsed PDFs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 shadow-2xs transition-colors">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">ETL 파싱 완료</p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{metrics.parsedPdfs}</span>
              <span className="text-xs text-slate-500">/ {metrics.totalPdfs} 문서</span>
            </div>
          </div>
        </div>

        {/* Card 3: Total Extracted Chunks */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 shadow-2xs transition-colors">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">총 생성 청크 수</p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-bold text-indigo-600 dark:text-indigo-300 font-mono">
                {metrics.totalChunks.toLocaleString()}
              </span>
              <span className="text-xs text-slate-500">개 자식 청크</span>
            </div>
          </div>
        </div>

        {/* Card 4: Qdrant Indexed */}
        <div
          onClick={onOpenQdrantModal}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-500/50 rounded-2xl p-4 flex items-center gap-3.5 shadow-2xs cursor-pointer transition-all group"
          title="Qdrant 연결 및 컬렉션 설정 열기"
        >
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 group-hover:bg-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 transition-colors">
            <Database className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Qdrant 색인 완료</p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-bold text-amber-600 dark:text-amber-300 font-mono">{metrics.embeddedPdfs}</span>
              <span className="text-xs text-slate-500">개 문서 색인됨</span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Job Real-time Monitor Banner */}
      {(isParsing || (activeJob && (activeJob.status === 'running' || activeJob.status === 'pending'))) && (
        <div className="bg-gradient-to-r from-indigo-50 dark:from-indigo-950 via-slate-50 dark:via-slate-900 to-indigo-50 dark:to-indigo-950 border border-indigo-200 dark:border-indigo-500/40 rounded-2xl p-4 sm:p-5 shadow-md relative overflow-hidden transition-colors">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-600/20 dark:bg-indigo-600/30 border border-indigo-400/50 flex items-center justify-center text-indigo-600 dark:text-indigo-300 shrink-0 animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                    백그라운드 ETL 작업 실행 중
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 rounded font-mono border border-indigo-500/30">
                    {activeJob?.task_id || 'Task in progress'}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                  {activeJob?.filename || selectedPdf}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                  <span>{activeJob?.progress_msg || 'MinerU 파이프라인 엔진으로 문서 파싱 중...'}</span>
                  {activeJob?.elapsed_time ? (
                    <span className="text-slate-500 dark:text-slate-400 font-mono">({activeJob.elapsed_time}s 경과)</span>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <span className="text-xs text-indigo-600 dark:text-indigo-300 font-mono font-semibold animate-pulse">
                파싱 및 계층 청킹 진행 중...
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Document Pipeline Management Table Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs transition-colors">
        {/* Table Toolbar & Filters */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3.5">
          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              전체 ({pdfList.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('completed')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'completed'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              파싱 완료 ({pdfList.filter((p) => p.etl_status === 'completed').length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('embedded')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'embedded'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Qdrant 색인됨 ({pdfList.filter((p) => p.is_embedded).length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('not_started')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'not_started'
                  ? 'bg-slate-700 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              미변환 ({pdfList.filter((p) => p.etl_status === 'not_started').length})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative w-full md:w-64 shrink-0">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="문서명 검색..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-medium"
            />
          </div>
        </div>

        {/* Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800 select-none">
                <th className="py-3 px-4 w-2/5">PDF 문서 정보</th>
                <th className="py-3 px-3">ETL 파싱 상태</th>
                <th className="py-3 px-3">추출 청크 & 구조</th>
                <th className="py-3 px-3">검수/저장</th>
                <th className="py-3 px-3">Qdrant 색인</th>
                <th className="py-3 px-4 text-right">파이프라인 액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">검색 조건에 맞는 PDF 문서가 없습니다.</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">상단의 '신규 PDF 등록' 버튼을 눌러 새 문서를 추가하세요.</p>
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => {
                  const isCurrent = item.filename === selectedPdf;
                  const isRunningThis =
                    isParsing && (activeJob?.filename === item.filename || selectedPdf === item.filename);

                  return (
                    <tr
                      key={item.filename}
                      className={`group transition-colors ${
                        isCurrent
                          ? 'bg-indigo-50/60 dark:bg-indigo-950/20 hover:bg-indigo-50 dark:hover:bg-indigo-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                      }`}
                    >
                      {/* 1. PDF Info */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                              isCurrent
                                ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`font-semibold truncate max-w-sm sm:max-w-md ${
                                  isCurrent ? 'text-indigo-600 dark:text-indigo-300 font-bold' : 'text-slate-900 dark:text-slate-200'
                                }`}
                                title={item.filename}
                              >
                                {item.filename}
                              </span>
                              {isCurrent && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 font-semibold shrink-0">
                                  현재 작업 중
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              <span>{formatBytes(item.size_bytes)}</span>
                              <span>•</span>
                              <span>{item.total_pages} 페이지</span>
                              {item.last_modified && (
                                <>
                                  <span>•</span>
                                  <span className="text-slate-400 dark:text-slate-500">수정 {item.last_modified}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. ETL Parsing Status */}
                      <td className="py-3.5 px-3">
                        {isRunningThis || item.etl_status === 'running' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 animate-pulse">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            파싱 중...
                          </span>
                        ) : item.etl_status === 'completed' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                            <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            파싱 완료
                          </span>
                        ) : item.etl_status === 'failed' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                            <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                            파싱 실패
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            미변환 (대기)
                          </span>
                        )}
                      </td>

                      {/* 3. Extracted Chunks & Hierarchy */}
                      <td className="py-3.5 px-3">
                        {item.stats ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-200">
                                {item.stats.total_chunks}
                              </span>
                              <span className="text-slate-500 dark:text-slate-400 text-[11px]">청크</span>
                              {item.stats.tables_count > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                  <TableIcon className="w-2.5 h-2.5" />
                                  표 {item.stats.tables_count}개
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500">
                              {item.stats.parent_sections}개 섹션 • ~{item.stats.estimated_tokens.toLocaleString()} 토큰
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">-</span>
                        )}
                      </td>

                      {/* 4. Edit / Review Status */}
                      <td className="py-3.5 px-3">
                        {item.has_saved_edit ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 font-semibold">
                            <FileCode2 className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                            수정본 저장됨
                          </span>
                        ) : item.etl_status === 'completed' ? (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">기본 파싱 원형</span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">-</span>
                        )}
                      </td>

                      {/* 5. Qdrant Indexed Status */}
                      <td className="py-3.5 px-3">
                        {item.is_embedded ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            색인 완료
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                            <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700 inline-block" />
                            미색인
                          </span>
                        )}
                      </td>

                      {/* 6. Pipeline Action Buttons */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Open in Studio Button (Primary) */}
                          <button
                            type="button"
                            onClick={() => onSelectAndOpenStudio(item.filename)}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-2xs flex items-center gap-1 transition-all cursor-pointer"
                            title="이 문서의 계층 트리와 청크를 에디터에서 열기"
                          >
                            <span>스튜디오에서 열기</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>

                          {/* ETL Parse Button */}
                          <button
                            type="button"
                            onClick={async () => {
                              if (item.filename !== selectedPdf) {
                                await onSelectPdf(item.filename);
                              }
                              await onRunEtl(item.filename);
                            }}
                            disabled={isParsing}
                            className={`p-1.5 rounded-xl border transition-all cursor-pointer disabled:opacity-40 shadow-2xs ${
                              item.etl_status === 'completed'
                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'
                                : 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-500'
                            }`}
                            title={item.etl_status === 'completed' ? '재파싱 실행' : 'ETL 파싱 시작'}
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>

                          {/* Direct JSONL Export Button */}
                          {item.etl_status === 'completed' && (
                            <a
                              href="/api/etl/export/jsonl"
                              onClick={async (e) => {
                                if (item.filename !== selectedPdf) {
                                  e.preventDefault();
                                  await onSelectPdf(item.filename);
                                  window.location.href = '/api/etl/export/jsonl';
                                }
                              }}
                              className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors shadow-2xs"
                              title="RAG 표준 JSONL 다운로드"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
