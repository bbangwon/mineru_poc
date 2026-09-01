import re
import uuid
import json
from typing import List, Dict, Any, Optional

class HierarchicalChunker:
    """
    MinerU 파싱 결과(content_list 또는 content_list_v2)를 입력받아
    문서의 제목 계층 구조(Heading Hierarchy) 또는 법률/규정(장·조·항) 체계를 파악하고,
    부모-자식(Parent-Child) 청크를 생성하며,
    표(Table)는 원형 그대로 완벽히 보존하는 RAG ETL 청킹 엔진.
    """

    # 법률/규정 단위 인식 정규표현식
    RE_PART = re.compile(r'^\s*(제\s*\d+\s*편\b(?:\s+[^\n]+)?)')
    RE_CHAPTER = re.compile(r'^\s*(제\s*\d+\s*장\b(?:\s+[^\n]+)?)')
    RE_SECTION = re.compile(r'^\s*(제\s*\d+\s*절\b(?:\s+[^\n]+)?)')
    RE_SUBSECTION = re.compile(r'^\s*(제\s*\d+\s*관\b(?:\s+[^\n]+)?)')
    RE_ADDENDUM = re.compile(r'^\s*(부\s*칙\b(?:\s+[^\n]+)?)')
    RE_ARTICLE = re.compile(r'^\s*(제\s*\d+\s*조(?:의\s*\d+)?)(?:\s*\(([^)]+)\))?')
    RE_APPENDIX = re.compile(r'^\s*(\[(?:별표|별지)(?:\s*제?\d+호?(?:의\d+)?)?\]|\b별표\s*\d+|\b별지\s*제?\d+호(?:\s*서식)?)')

    def __init__(self, doc_id: Optional[str] = None, filter_headers_footers: bool = True):
        self.doc_id = doc_id or "doc_" + uuid.uuid4().hex[:8]
        self.filter_headers_footers = filter_headers_footers

    def chunk_content_list(self, content_list: List[Any], doc_title: str = "Document", strategy: str = "general") -> Dict[str, Any]:
        """
        MinerU의 content_list를 순회하며 Parent Section과 Child Chunk를 추출합니다.
        strategy:
          - "general": 기존 제목(Title Heading level) 기반 계층 청킹 (보고서, 일반 논문 등)
          - "legal": 법률/규정(장, 절, 관, 조, 항, 호) 기반 계층 청킹 (규정, 지침, 법률 문서 등)
        """
        if not content_list:
            return {
                "doc_id": self.doc_id,
                "doc_title": doc_title,
                "strategy": strategy,
                "stats": {
                    "total_parent_sections": 0,
                    "total_child_chunks": 0,
                    "paragraph_chunks": 0,
                    "table_chunks": 0,
                    "article_chunks": 0,
                    "total_words": 0,
                },
                "parent_sections": [],
                "child_chunks": [],
            }

        # v1 형식(1차원 딕셔너리 리스트)인 경우 v2 스타일(페이지별 2차원 리스트)로 정규화
        normalized_pages = self._normalize_content_list(content_list)

        if strategy == "legal":
            return self._chunk_legal_content(normalized_pages, doc_title)
        return self._chunk_general_content(normalized_pages, doc_title)

    def _normalize_content_list(self, content_list: List[Any]) -> List[List[Dict[str, Any]]]:
        """v1 (1차원 평탄화 리스트) 및 v2 (2차원 페이지 리스트) 구조를 표준 2차원 리스트로 정규화"""
        if not content_list:
            return []

        if isinstance(content_list[0], dict):
            max_page = max((b.get("page_idx", 0) for b in content_list if isinstance(b, dict)), default=0)
            pages_dict: Dict[int, List[Dict[str, Any]]] = {p: [] for p in range(max_page + 1)}
            for item in content_list:
                if not isinstance(item, dict):
                    continue
                p_idx = item.get("page_idx", 0)
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
            return [pages_dict[p] for p in sorted(pages_dict.keys())]
        return content_list

    def _chunk_general_content(
        self,
        normalized_pages: List[List[Dict[str, Any]]],
        doc_title: str
    ) -> Dict[str, Any]:
        """일반 문서용 헤딩(Title Heading) 기반 계층 청킹"""
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

        for page_idx, page_blocks in enumerate(normalized_pages, start=1):
            if not isinstance(page_blocks, list):
                continue

            for block in page_blocks:
                b_type = block.get("type", "").lower()
                b_content = block.get("content", {})
                b_bbox = block.get("bbox", [])

                if self.filter_headers_footers and b_type in ["page_header", "page_footer", "header", "footer"]:
                    continue

                if b_type == "title":
                    title_text = self._extract_text_from_content(b_content.get("title_content", []))
                    if not title_text.strip():
                        continue

                    level = b_content.get("level", 1)
                    section_counter += 1
                    sec_id = f"{self.doc_id}_sec_{section_counter:03d}"

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

        stats = {
            "total_parent_sections": len(parent_sections),
            "total_child_chunks": len(child_chunks),
            "paragraph_chunks": sum(1 for c in child_chunks if c["chunk_type"] == "paragraph"),
            "table_chunks": sum(1 for c in child_chunks if c["chunk_type"] == "table"),
            "article_chunks": 0,
            "total_words": sum(c["token_estimate"] for c in child_chunks),
        }

        return {
            "doc_id": self.doc_id,
            "doc_title": doc_title,
            "strategy": "general",
            "stats": stats,
            "parent_sections": parent_sections,
            "child_chunks": child_chunks,
        }

    def _chunk_legal_content(
        self,
        normalized_pages: List[List[Dict[str, Any]]],
        doc_title: str
    ) -> Dict[str, Any]:
        """
        법률/규정 문서용 계층 청킹 (장 > 절 > 관 > 조문 > 항·호)
        - 장, 절, 관, 부칙, 별표 등을 계층형 Parent Section으로 등록
        - 각 조문(제N조)은 하나의 완결된 Child Chunk(article)로 결합하여 문맥 보존
        - 조문 단위 섹션을 부모 트리에 등록하여 좌측 트리에서 조문별 바로가기 탐색 지원
        - 표(Table)는 원형 그대로 독립 청크로 보존
        """
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

        hierarchy_stack = [(0, doc_title, root_section_id)]
        chunk_counter = 0
        section_counter = 0

        current_article: Optional[Dict[str, Any]] = None

        def commit_current_article():
            nonlocal chunk_counter, current_article
            if not current_article:
                return

            article_text = "\n".join(current_article["paragraphs"]).strip()
            if not article_text:
                current_article = None
                return

            chunk_counter += 1
            chunk_id = f"{self.doc_id}_art_{chunk_counter:04d}"

            context_header = f"[{' > '.join(current_article['breadcrumbs'])}]"
            full_chunk_text = f"{context_header}\n{article_text}"

            child_chunk = {
                "chunk_id": chunk_id,
                "parent_id": current_article["section_id"],
                "chunk_type": "article",
                "text": full_chunk_text,
                "page_number": current_article["page_number"],
                "bbox": current_article.get("bbox", []),
                "breadcrumbs": current_article["breadcrumbs"] + [current_article["article_display"]],
                "token_estimate": len(full_chunk_text.split()),
                "metadata": {
                    "doc_title": doc_title,
                    "type": "article",
                    "article_no": current_article["article_no"],
                    "article_title": current_article["article_title"],
                    "page": current_article["page_number"],
                    "strategy": "legal",
                }
            }
            child_chunks.append(child_chunk)
            self._link_chunk_to_section(
                parent_sections,
                current_article["section_id"],
                chunk_id,
                full_chunk_text,
                current_article["page_number"]
            )
            current_article = None

        for page_idx, page_blocks in enumerate(normalized_pages, start=1):
            if not isinstance(page_blocks, list):
                continue

            for block in page_blocks:
                b_type = block.get("type", "").lower()
                b_content = block.get("content", {})
                b_bbox = block.get("bbox", [])

                if self.filter_headers_footers and b_type in ["page_header", "page_footer", "header", "footer"]:
                    continue

                if b_type == "title":
                    raw_text = self._extract_text_from_content(b_content.get("title_content", []))
                elif b_type in ["paragraph", "text"]:
                    raw_text = self._extract_text_from_content(b_content.get("paragraph_content", []))
                    if not raw_text.strip():
                        if isinstance(b_content, str):
                            raw_text = b_content
                        elif isinstance(b_content.get("content"), str):
                            raw_text = b_content.get("content")
                elif b_type == "table":
                    raw_text = ""
                else:
                    raw_text = ""

                clean_text = raw_text.strip()

                # 1. 표(Table) 처리
                if b_type == "table":
                    html_table = b_content.get("html", "")
                    table_caption = self._extract_text_from_content(b_content.get("table_caption", []))
                    table_footnote = self._extract_text_from_content(b_content.get("table_footnote", []))
                    img_path = b_content.get("image_source", {}).get("path", "")
                    table_type = b_content.get("table_type", "simple_table")

                    chunk_counter += 1
                    chunk_id = f"{self.doc_id}_table_{chunk_counter:04d}"

                    current_sec_id = (
                        current_article["section_id"]
                        if current_article
                        else (hierarchy_stack[-1][2] if hierarchy_stack else root_section_id)
                    )
                    current_breadcrumbs = [h[1] for h in hierarchy_stack]

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
                            "strategy": "legal",
                            "article_no": current_article["article_no"] if current_article else None,
                        }
                    }
                    child_chunks.append(child_chunk)
                    self._link_chunk_to_section(
                        parent_sections,
                        current_sec_id,
                        chunk_id,
                        f"[표] {table_caption or ''}\n{html_table}",
                        page_idx
                    )
                    continue

                if not clean_text:
                    continue

                # 2. 법률 위계 패턴 검사
                level: Optional[int] = None
                matched_title: Optional[str] = None

                m_part = self.RE_PART.match(clean_text)
                m_chap = self.RE_CHAPTER.match(clean_text)
                m_sec = self.RE_SECTION.match(clean_text)
                m_subsec = self.RE_SUBSECTION.match(clean_text)
                m_addendum = self.RE_ADDENDUM.match(clean_text)
                m_appendix = self.RE_APPENDIX.match(clean_text)

                if m_part:
                    level = 1
                    matched_title = clean_text.split("\n")[0]
                elif m_chap:
                    level = 2
                    matched_title = clean_text.split("\n")[0]
                elif m_addendum:
                    level = 2
                    matched_title = clean_text.split("\n")[0]
                elif m_sec:
                    level = 3
                    matched_title = clean_text.split("\n")[0]
                elif m_subsec:
                    level = 4
                    matched_title = clean_text.split("\n")[0]
                elif m_appendix:
                    level = 3
                    matched_title = clean_text.split("\n")[0]

                if level is not None and matched_title:
                    commit_current_article()

                    section_counter += 1
                    sec_id = f"{self.doc_id}_sec_{section_counter:03d}"

                    while hierarchy_stack and hierarchy_stack[-1][0] >= level:
                        hierarchy_stack.pop()

                    parent_sec_id = hierarchy_stack[-1][2] if hierarchy_stack else root_section_id
                    breadcrumbs = [h[1] for h in hierarchy_stack] + [matched_title]
                    hierarchy_stack.append((level, matched_title, sec_id))

                    new_section = {
                        "id": sec_id,
                        "title": matched_title,
                        "level": level,
                        "parent_section_id": parent_sec_id,
                        "breadcrumbs": breadcrumbs,
                        "child_chunk_ids": [],
                        "full_text": f"[{matched_title}]\n",
                        "page_range": [page_idx, page_idx],
                        "bbox": b_bbox,
                    }
                    parent_sections.append(new_section)
                    continue

                # 3. 조문(Article: 제N조) 감지
                m_art = self.RE_ARTICLE.match(clean_text)
                if m_art:
                    commit_current_article()

                    art_label = m_art.group(1).replace(" ", "")
                    art_title = m_art.group(2).strip() if m_art.group(2) else ""
                    art_display = f"{art_label}({art_title})" if art_title else art_label

                    section_counter += 1
                    sec_id = f"{self.doc_id}_artsec_{section_counter:03d}"

                    while hierarchy_stack and hierarchy_stack[-1][0] >= 5:
                        hierarchy_stack.pop()

                    parent_sec_id = hierarchy_stack[-1][2] if hierarchy_stack else root_section_id
                    breadcrumbs = [h[1] for h in hierarchy_stack] + [art_display]
                    hierarchy_stack.append((5, art_display, sec_id))

                    art_section = {
                        "id": sec_id,
                        "title": art_display,
                        "level": 5,
                        "parent_section_id": parent_sec_id,
                        "breadcrumbs": breadcrumbs,
                        "child_chunk_ids": [],
                        "full_text": f"[{art_display}]\n",
                        "page_range": [page_idx, page_idx],
                        "bbox": b_bbox,
                    }
                    parent_sections.append(art_section)

                    current_article = {
                        "section_id": sec_id,
                        "article_no": art_label,
                        "article_title": art_title,
                        "article_display": art_display,
                        "breadcrumbs": [h[1] for h in hierarchy_stack[:-1]],
                        "paragraphs": [clean_text],
                        "page_number": page_idx,
                        "bbox": b_bbox,
                    }
                    continue

                # 4. 일반 문단 / 항·호 텍스트
                if current_article:
                    current_article["paragraphs"].append(clean_text)
                    current_article["page_number"] = page_idx
                else:
                    chunk_counter += 1
                    chunk_id = f"{self.doc_id}_c_{chunk_counter:04d}"
                    current_sec_id = hierarchy_stack[-1][2] if hierarchy_stack else root_section_id
                    current_breadcrumbs = [h[1] for h in hierarchy_stack]

                    child_chunk = {
                        "chunk_id": chunk_id,
                        "parent_id": current_sec_id,
                        "chunk_type": "paragraph",
                        "text": clean_text,
                        "page_number": page_idx,
                        "bbox": b_bbox,
                        "breadcrumbs": current_breadcrumbs,
                        "token_estimate": len(clean_text.split()),
                        "metadata": {
                            "doc_title": doc_title,
                            "type": "text",
                            "page": page_idx,
                            "strategy": "legal",
                        }
                    }
                    child_chunks.append(child_chunk)
                    self._link_chunk_to_section(parent_sections, current_sec_id, chunk_id, clean_text, page_idx)

        commit_current_article()

        stats = {
            "total_parent_sections": len(parent_sections),
            "total_child_chunks": len(child_chunks),
            "article_chunks": sum(1 for c in child_chunks if c["chunk_type"] == "article"),
            "paragraph_chunks": sum(1 for c in child_chunks if c["chunk_type"] == "paragraph"),
            "table_chunks": sum(1 for c in child_chunks if c["chunk_type"] == "table"),
            "total_words": sum(c["token_estimate"] for c in child_chunks),
        }

        return {
            "doc_id": self.doc_id,
            "doc_title": doc_title,
            "strategy": "legal",
            "stats": stats,
            "parent_sections": parent_sections,
            "child_chunks": child_chunks,
        }

    def export_to_jsonl(self, etl_result: Dict[str, Any]) -> str:
        """RAG Vector DB 적재용 표준 JSONL 생성"""
        lines = []
        parent_map = {p["id"]: p for p in etl_result.get("parent_sections", [])}

        for chunk in etl_result.get("child_chunks", []):
            if chunk.get("is_ignored"):
                continue
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
