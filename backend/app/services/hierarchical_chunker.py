import re
import uuid
import json
from typing import List, Dict, Any, Optional

class HierarchicalChunker:
    """
    MinerU 파싱 결과(content_list 또는 content_list_v2)를 입력받아
    문서의 제목 계층 구조(Heading Hierarchy)를 파악하고,
    부모-자식(Parent-Child) 청크를 생성하며,
    표(Table)는 원형 그대로 완벽히 보존하는 RAG ETL 청킹 엔진.
    """

    def __init__(self, doc_id: Optional[str] = None, filter_headers_footers: bool = True):
        self.doc_id = doc_id or "doc_" + uuid.uuid4().hex[:8]
        self.filter_headers_footers = filter_headers_footers

    def chunk_content_list(self, content_list: List[Any], doc_title: str = "Document") -> Dict[str, Any]:
        """
        MinerU의 content_list를 순회하며 Parent Section과 Child Chunk(Paragraph, Table)를 추출합니다.
        v2(2차원 페이지 리스트) 및 v1(1차원 블록 리스트) 형식을 모두 자동 감지하여 지원합니다.
        """
        if not content_list:
            return {
                "doc_id": self.doc_id,
                "doc_title": doc_title,
                "stats": {"total_parent_sections": 0, "total_child_chunks": 0, "paragraph_chunks": 0, "table_chunks": 0, "total_words": 0},
                "parent_sections": [],
                "child_chunks": [],
            }

        # v1 형식(1차원 딕셔너리 리스트)인 경우 v2 스타일(페이지별 2차원 리스트)로 정규화
        normalized_pages: List[List[Dict[str, Any]]] = []
        if isinstance(content_list[0], dict):
            # v1: page_idx 필드 기준으로 페이지 그룹화
            max_page = max((b.get("page_idx", 0) for b in content_list if isinstance(b, dict)), default=0)
            pages_dict: Dict[int, List[Dict[str, Any]]] = {p: [] for p in range(max_page + 1)}
            for item in content_list:
                if not isinstance(item, dict):
                    continue
                p_idx = item.get("page_idx", 0)
                # v1 포맷을 v2 표준 블록으로 변환
                b_type = item.get("type", "text")
                text_val = item.get("text", "")
                level = item.get("text_level")
                
                if b_type == "text" and level is not None:
                    block = {
                        "type": "title",
                        "content": {"title_content": [{"type": "text", "content": text_val}], "level": int(level)},
                        "bbox": item.get("bbox", [])
                    }
                elif b_type == "table":
                    block = {
                        "type": "table",
                        "content": {
                            "html": item.get("table_body", "") or item.get("html", ""),
                            "table_caption": [{"type": "text", "content": item.get("table_caption", "")}],
                            "image_source": {"path": item.get("img_path", "")}
                        },
                        "bbox": item.get("bbox", [])
                    }
                else:
                    block = {
                        "type": b_type,
                        "content": {"paragraph_content": [{"type": "text", "content": text_val}]},
                        "bbox": item.get("bbox", [])
                    }
                pages_dict.setdefault(p_idx, []).append(block)
            normalized_pages = [pages_dict[p] for p in sorted(pages_dict.keys())]
        else:
            normalized_pages = content_list

        parent_sections: List[Dict[str, Any]] = []
        child_chunks: List[Dict[str, Any]] = []

        root_section_id = f"{self.doc_id}_root"
        current_root_section = {
            "id": root_section_id,
            "title": doc_title,
            "level": 0,
            "breadcrumbs": [doc_title],
            "child_chunk_ids": [],
            "full_text": "",
            "page_range": [1, 1],
        }
        parent_sections.append(current_root_section)
        heading_stack = [(0, doc_title, root_section_id)]

        chunk_counter = 0
        section_counter = 0

        # normalized_pages 처리: 리스트의 각 원소는 한 페이지의 블록 리스트임
        for page_idx, page_blocks in enumerate(normalized_pages, start=1):
            if not isinstance(page_blocks, list):
                continue

            for block in page_blocks:
                b_type = block.get("type", "").lower()
                b_content = block.get("content", {})
                b_bbox = block.get("bbox", [])

                # 1. 헤더/푸터 노이즈 제거
                if self.filter_headers_footers and b_type in ["page_header", "page_footer", "header", "footer"]:
                    continue

                # 2. 제목(Title / Heading) 블록 처리 -> 부모 섹션 갱신
                if b_type == "title":
                    title_text = self._extract_text_from_content(b_content.get("title_content", []))
                    if not title_text.strip():
                        continue

                    level = b_content.get("level", 1)
                    section_counter += 1
                    sec_id = f"{self.doc_id}_sec_{section_counter:03d}"

                    # 스택 조정: 현재 레벨보다 깊거나 같은 레벨은 pop
                    while heading_stack and heading_stack[-1][0] >= level:
                        heading_stack.pop()

                    breadcrumbs = [h[1] for h in heading_stack] + [title_text]
                    parent_sec_id = heading_stack[-1][2] if heading_stack else root_section_id
                    heading_stack.append((level, title_text, sec_id))

                    new_section = {
                        "id": sec_id,
                        "title": title_text,
                        "level": level,
                        "parent_section_id": parent_sec_id,
                        "breadcrumbs": breadcrumbs,
                        "child_chunk_ids": [],
                        "full_text": f"[{title_text}]\n",
                        "page_range": [page_idx, page_idx],
                        "bbox": b_bbox,
                    }
                    parent_sections.append(new_section)

                # 3. 본문 문단(Paragraph) 블록 처리 -> 자식 청크 생성
                elif b_type in ["paragraph", "text"]:
                    para_text = self._extract_text_from_content(b_content.get("paragraph_content", []))
                    if not para_text.strip():
                        if isinstance(b_content, str):
                            para_text = b_content
                        elif isinstance(b_content.get("content"), str):
                            para_text = b_content.get("content")

                    if not para_text.strip():
                        continue

                    chunk_counter += 1
                    chunk_id = f"{self.doc_id}_c_{chunk_counter:04d}"
                    current_sec_id = heading_stack[-1][2] if heading_stack else root_section_id
                    current_breadcrumbs = [h[1] for h in heading_stack]

                    child_chunk = {
                        "chunk_id": chunk_id,
                        "parent_id": current_sec_id,
                        "chunk_type": "paragraph",
                        "text": para_text.strip(),
                        "page_number": page_idx,
                        "bbox": b_bbox,
                        "breadcrumbs": current_breadcrumbs,
                        "token_estimate": len(para_text.split()),
                        "metadata": {
                            "doc_title": doc_title,
                            "type": "text",
                            "page": page_idx,
                        }
                    }
                    child_chunks.append(child_chunk)
                    self._link_chunk_to_section(parent_sections, current_sec_id, chunk_id, para_text, page_idx)

                # 4. 표(Table) 블록 처리 -> 원형 100% 보존 자식 청크 생성!
                elif b_type == "table":
                    html_table = b_content.get("html", "")
                    table_caption = self._extract_text_from_content(b_content.get("table_caption", []))
                    table_footnote = self._extract_text_from_content(b_content.get("table_footnote", []))
                    img_path = b_content.get("image_source", {}).get("path", "")
                    table_type = b_content.get("table_type", "simple_table")

                    chunk_counter += 1
                    chunk_id = f"{self.doc_id}_table_{chunk_counter:04d}"
                    current_sec_id = heading_stack[-1][2] if heading_stack else root_section_id
                    current_breadcrumbs = [h[1] for h in heading_stack]

                    table_display = []
                    if table_caption:
                        table_display.append(f"<caption>{table_caption}</caption>")
                    if html_table:
                        table_display.append(html_table)
                    if table_footnote:
                        table_display.append(f"<small>{table_footnote}</small>")
                    full_table_str = "\n".join(table_display) if table_display else html_table

                    child_chunk = {
                        "chunk_id": chunk_id,
                        "parent_id": current_sec_id,
                        "chunk_type": "table",
                        "text": full_table_str,
                        "raw_html": html_table,
                        "table_caption": table_caption,
                        "table_footnote": table_footnote,
                        "image_path": img_path,
                        "table_type": table_type,
                        "page_number": page_idx,
                        "bbox": b_bbox,
                        "breadcrumbs": current_breadcrumbs,
                        "token_estimate": len(full_table_str.split()),
                        "metadata": {
                            "doc_title": doc_title,
                            "type": "table",
                            "is_table": True,
                            "has_image": bool(img_path),
                            "page": page_idx,
                        }
                    }
                    child_chunks.append(child_chunk)
                    self._link_chunk_to_section(parent_sections, current_sec_id, chunk_id, f"[표] {table_caption or ''}\n{html_table}", page_idx)

        # 통계 계산
        stats = {
            "total_parent_sections": len(parent_sections),
            "total_child_chunks": len(child_chunks),
            "paragraph_chunks": sum(1 for c in child_chunks if c["chunk_type"] == "paragraph"),
            "table_chunks": sum(1 for c in child_chunks if c["chunk_type"] == "table"),
            "total_words": sum(c["token_estimate"] for c in child_chunks),
        }

        return {
            "doc_id": self.doc_id,
            "doc_title": doc_title,
            "stats": stats,
            "parent_sections": parent_sections,
            "child_chunks": child_chunks,
        }

    def export_to_jsonl(self, etl_result: Dict[str, Any]) -> str:
        lines = []
        parent_map = {p["id"]: p for p in etl_result.get("parent_sections", [])}

        for chunk in etl_result.get("child_chunks", []):
            parent = parent_map.get(chunk["parent_id"], {})
            record = {
                "id": chunk["chunk_id"],
                "parent_id": chunk["parent_id"],
                "parent_title": parent.get("title", ""),
                "chunk_type": chunk["chunk_type"],
                "text": chunk["text"],
                "page": chunk["page_number"],
                "breadcrumbs": chunk["breadcrumbs"],
                "breadcrumbs_str": " > ".join(chunk["breadcrumbs"]),
                "bbox": chunk["bbox"],
                "metadata": {
                    **chunk["metadata"],
                    "parent_breadcrumbs": chunk["breadcrumbs"],
                    "is_atomic_table": (chunk["chunk_type"] == "table"),
                }
            }
            if chunk["chunk_type"] == "table":
                record["raw_html"] = chunk.get("raw_html", "")
                record["image_path"] = chunk.get("image_path", "")
                record["table_caption"] = chunk.get("table_caption", "")

            lines.append(json.dumps(record, ensure_ascii=False))

        return "\n".join(lines)

    def _extract_text_from_content(self, content_items: Any) -> str:
        if isinstance(content_items, str):
            return content_items
        if not isinstance(content_items, list):
            return ""

        parts = []
        for item in content_items:
            if isinstance(item, dict):
                text = item.get("content", "")
                if text:
                    parts.append(str(text))
            elif isinstance(item, str):
                parts.append(item)
        return " ".join(parts).strip()

    def _link_chunk_to_section(self, sections: List[Dict[str, Any]], sec_id: str, chunk_id: str, text: str, page: int):
        for sec in sections:
            if sec["id"] == sec_id:
                sec["child_chunk_ids"].append(chunk_id)
                sec["full_text"] += f"\n{text}"
                sec["page_range"][1] = max(sec["page_range"][1], page)
                break
