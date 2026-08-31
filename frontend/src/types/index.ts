export interface PdfItem {
  filename: string;
  size_bytes: number;
  total_pages: number;
  is_current: boolean;
}

export interface ParentSection {
  id: string;
  title: string;
  level: number;
  parent_section_id?: string;
  breadcrumbs: string[];
  child_chunk_ids: string[];
  full_text: string;
  page_range: [number, number];
  bbox?: number[];
}

export interface ChildChunk {
  chunk_id: string;
  parent_id: string;
  chunk_type: 'paragraph' | 'table';
  text: string;
  page_number: number;
  bbox?: number[];
  breadcrumbs: string[];
  token_estimate: number;
  raw_html?: string;
  table_caption?: string;
  table_footnote?: string;
  image_path?: string;
  image_url?: string;
  table_type?: string;
  metadata?: Record<string, any>;
}

export interface EtlStats {
  total_parent_sections: number;
  total_child_chunks: number;
  paragraph_chunks: number;
  table_chunks: number;
  total_words: number;
}

export interface EtlResult {
  doc_id: string;
  doc_title: string;
  stats: EtlStats;
  parent_sections: ParentSection[];
  child_chunks: ChildChunk[];
  elapsed_time?: number;
  active_pdf?: string;
  total_pages?: number;
}

export interface ParseRequestParams {
  filename?: string;
  all_pages?: boolean;
  start_page?: number | null;
  end_page?: number | null;
  lang?: string;
  backend?: string;
}
