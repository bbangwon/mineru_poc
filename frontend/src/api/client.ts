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

export async function getEtlSample(): Promise<EtlResult> {
  const res = await fetch('/api/etl/sample');
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
