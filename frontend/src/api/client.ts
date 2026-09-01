import type { EtlResult, PdfItem, ParseRequestParams } from '../types';

export async function getPdfList(): Promise<{ pdfs: PdfItem[]; current: string | null }> {
  const res = await fetch('/api/pdf/list');
  if (!res.ok) {
    throw new Error('PDF 목록을 불러오지 못했습니다.');
  }
  return res.json();
}

export async function selectPdf(filename: string): Promise<{ success: boolean; current: string; total_pages: number }> {
  const res = await fetch('/api/pdf/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });
  if (!res.ok) {
    throw new Error('PDF 선택 변경에 실패했습니다.');
  }
  return res.json();
}

export async function uploadPdf(file: File): Promise<{
  success: boolean;
  filename: string;
  total_pages: number;
  size_bytes: number;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/pdf/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'PDF 업로드에 실패했습니다.');
  }
  return res.json();
}

export async function getEtlSample(strategy: string = 'general'): Promise<EtlResult> {
  const res = await fetch(`/api/etl/sample?strategy=${encodeURIComponent(strategy)}`);
  if (!res.ok) {
    throw new Error('ETL 분석 샘플을 불러오지 못했습니다.');
  }
  return res.json();
}

export async function runEtlParse(params: ParseRequestParams): Promise<EtlResult> {
  const res = await fetch('/api/etl/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'ETL 파이프라인 실행 중 오류가 발생했습니다.');
  }
  return res.json();
}

export async function startEtlJob(params: ParseRequestParams): Promise<{ success: boolean; task_id: string; status: string; message: string }> {
  const res = await fetch('/api/etl/parse-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '백그라운드 태스크 등록에 실패했습니다.');
  }
  return res.json();
}

export async function getJobStatus(taskId: string): Promise<import('../types').JobStatusResponse> {
  const res = await fetch(`/api/etl/jobs/${encodeURIComponent(taskId)}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '태스크 상태 조회 실패');
  }
  return res.json();
}

export async function getActiveJob(): Promise<import('../types').JobStatusResponse | null> {
  try {
    const res = await fetch('/api/etl/jobs/active');
    if (!res.ok) return null;
    const data = await res.json();
    return data.active === false ? null : data;
  } catch {
    return null;
  }
}

export async function saveEtlResult(data: EtlResult): Promise<import('../types').SaveEtlResponse> {
  const res = await fetch('/api/etl/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '수정본 저장에 실패했습니다.');
  }
  return res.json();
}

export async function resetEtlResult(strategy: string = 'general'): Promise<EtlResult> {
  const res = await fetch('/api/etl/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '원본 데이터 초기화에 실패했습니다.');
  }
  return res.json();
}

export async function reindexEtlResult(data?: EtlResult): Promise<EtlResult> {
  const res = await fetch('/api/etl/reindex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : JSON.stringify({}),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'ID 재정렬에 실패했습니다.');
  }
  return res.json();
}
