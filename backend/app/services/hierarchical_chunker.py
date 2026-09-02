import re
import uuid
import json
import hashlib
from html.parser import HTMLParser
from typing import List, Dict, Any, Optional, Tuple


class _HTMLTableExtractor(HTMLParser):
    """표 HTML에서 컬럼 헤더와 상위 행 데이터를 검색 친화적 요약 텍스트로 추출하는 파서"""
    def __init__(self):
        super().__init__()
        self.rows: List[List[str]] = []
        self.current_row: List[str] = []
        self.current_cell: List[str] = []
        self.in_cell = False

    def handle_starttag(self, tag: str, attrs: Any):
        if tag in ("td", "th"):
            self.in_cell = True
            self.current_cell = []
        elif tag == "tr":
            self.current_row = []

    def handle_endtag(self, tag: str):
        if tag in ("td", "th"):
            self.in_cell = False
            cell_text = " ".join("".join(self.current_cell).split())
            self.current_row.append(cell_text)
        elif tag == "tr":
            if self.current_row:
                self.rows.append(self.current_row)

    def handle_data(self, data: str):
        if self.in_cell:
            self.current_cell.append(data)


class HierarchicalChunker:
    """
    MinerU 파싱 결과를 입력받아 3단계 계층 구조(Section - Parent - Child)로
    RAG 검색 및 LLM 생성에 최적화된 청크를 생성하는 엔진.
    - Level 1: Section (문서 구조/목차, 네비게이션)
    - Level 2: Parent Chunk (~2048 토큰, LLM 생성용 문맥)
    - Level 3: Child Chunk (~512 토큰 or 원자적 표, Vector DB 임베딩/검색용)
    """

    # 법률/규정 위계 정규식
    RE_PART = re.compile(r'^\s*(제\s*\d+\s*편\b(?:\s+[^\n]+)?)')
    RE_CHAPTER = re.compile(r'^\s*(제\s*\d+\s*장\b(?:\s+[^\n]+)?)')
    RE_SECTION = re.compile(r'^\s*(제\s*\d+\s*절\b(?:\s+[^\n]+)?)')
    RE_SUBSECTION = re.compile(r'^\s*(제\s*\d+\s*관\b(?:\s+[^\n]+)?)')
    RE_ADDENDUM = re.compile(r'^\s*(부\s*칙\b(?:\s+[^\n]+)?)')
    RE_ARTICLE = re.compile(r'^\s*(제\s*\d+\s*조(?:의\s*\d+)?)(?:\s*\(([^)]+)\))?')
    RE_APPENDIX = re.compile(r'^\s*(\[(?:별표|별지)(?:\s*제?\d+호?(?:의\d+)?)?\]|\b별표\s*\d+|\b별지\s*제?\d+호(?:\s*서식)?)')

    # 법률 조항/항·호 경계 정규식
    RE_LEGAL_SPLIT = re.compile(
        r'(?=[①-⑳])|'                              # 항 번호 경계
        r'(?<=\n)\s*(?=\d+\.\s|[가-하]\.\s)|'      # 줄바꿈 직후 호/목 번호
        r'(?<=[.:]\s)\s*(?=\d+\.\s|[가-하]\.\s)'   # 문장 종결/콜론 직후 호/목 번호
    )

    # 문장 종결 정규식 (인용부호/괄호 안 종결 제외)
    RE_KOREAN_SENTENCE_END = re.compile(r'(?<=(?:다|음|함|임|됨)\.)(?![")\'])\s+')
    RE_GENERAL_SENTENCE_END = re.compile(r'(?<=[.!?])(?![")\'])\s+(?=[A-Z가-힣0-9])')

    @staticmethod
    def generate_doc_id(name: Optional[str] = None) -> str:
        """문서명을 6자리 짧은 해시 기반 고유 식별자(d_xxxxxx)로 변환"""
        if not name:
            return f"d_{uuid.uuid4().hex[:6]}"
        clean = str(name).strip()
        if clean.startswith("d_") and len(clean) <= 10 and clean[2:].isalnum():
            return clean
        h = hashlib.md5(clean.encode("utf-8")).hexdigest()[:6]
        return f"d_{h}"

    @staticmethod
    def normalize_text_for_embedding(text: str) -> str:
        """
        임베딩 및 키워드 검색(Child Chunk) 대상 텍스트 정규화.
        줄바꿈과 연속 공백을 모두 단일 공백으로 치환하여 단어 잘림과 검색 왜곡을 방지합니다.
        1. 영문/숫자 하이픈 줄바꿈 복원: word-\\nbreak -> wordbreak
        2. 모든 줄바꿈(\\r, \\n) 및 연속 공백을 단일 공백(' ')으로 치환
        """
        if not text:
            return ""
        # 1. 영문 하이픈 줄바꿈 복원 (e.g., 'multi-\nlingual' -> 'multilingual')
        text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', text)
        # 2. 모든 개행 및 공백을 단일 공백으로 치환
        text = re.sub(r'\s+', ' ', text)
        return text.strip()

    @staticmethod
    def normalize_parent_text(text: str) -> str:
        """
        LLM 답변 생성용(Parent Chunk) 문맥 텍스트 정규화.
        - 문단 간 구분(\\n\\n) 및 목록 번호/조항 앞 개행은 보존
        - 문장 중간에 너비 한계로 인해 들어간 단순 줄바꿈은 단일 공백으로 연결
        """
        if not text:
            return ""
        # 1. 영문 하이픈 줄바꿈 복원
        text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', text)

        # 2. 단락 단위(\\n\\s*\\n)로 분할
        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
        cleaned_paragraphs = []

        for para in paragraphs:
            lines = [l.strip() for l in para.split('\n') if l.strip()]
            if not lines:
                continue

            para_parts = []
            for line in lines:
                # 목록 번호, 조항, 불릿, 헤딩으로 시작하는지 확인
                # 예: ①~⑳, 1., (1), [제1조], 제1조, -, *, •, # 등
                is_structural_line = bool(re.match(r'^(?:[①-⑳]|\d+\.|\(\d+\)|\[[^\]]+\]|제\s*\d+\s*조|[-*•※#])\s*', line))

                if is_structural_line and para_parts:
                    para_parts.append('\n' + line)
                else:
                    if para_parts and not para_parts[-1].endswith('\n'):
                        para_parts.append(' ' + line)
                    else:
                        para_parts.append(line)

            cleaned_paragraphs.append(''.join(para_parts).strip())

        return '\n\n'.join(cleaned_paragraphs).strip()

    @staticmethod
    def estimate_korean_tokens(text: str) -> int:
        """
        한국어 서브워드/BPE 특성을 반영한 표준 토큰 추정 공식:
        token_estimate = max(floor(len(text) / 2.0), floor(len(text.split()) * 2.2))
        """
        if not text:
            return 0
        char_tokens = int(len(text) / 2.0)
        word_tokens = int(len(text.split()) * 2.2)
        return max(char_tokens, word_tokens)

    @classmethod
    def split_text_into_units(cls, text: str, is_legal: bool = False, max_tokens: int = 512) -> List[str]:
        """
        텍스트를 문맥 손상 없이 최소 분할 단위(조항, 단락, 문장)로 정밀 분할합니다.
        우선순위:
          1. 법률 항(①~⑳), 호(1.), 목(가.) 경계 (legal 모드)
          2. 단락 경계 (\\n\\n)
          3. 줄바꿈 경계 (\\n)
          4. 한국어 및 일반 문장 종결 기호 (다., 음., ., !, ?)
          5. 단일 문장이 max_tokens 초과 시 최후의 수단으로 쉼표, 세미콜론, 공백 분할
        """
        clean_text = text.strip()
        if not clean_text:
            return []

        # 영문/숫자 하이픈 줄바꿈 사전 복원 (e.g. multi-\nlingual -> multilingual)
        clean_text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', clean_text)

        # 1단계: 법률 모드일 경우 항·호 단위 1차 분할
        if is_legal:
            preliminary_parts = [p.strip() for p in cls.RE_LEGAL_SPLIT.split(clean_text) if p.strip()]
        else:
            preliminary_parts = [clean_text]

        units: List[str] = []
        for part in preliminary_parts:
            # 2단계: 단락(\\n\\n) 단위 분할
            paragraphs = [p.strip() for p in re.split(r'\n\s*\n', part) if p.strip()]
            for para in paragraphs:
                # 3단계: 개조식 줄바꿈(\\n) 분할 (각 줄이 의미 있는 단위인 경우)
                lines = [l.strip() for l in para.split('\n') if l.strip()]
                for line in lines:
                    # 4단계: 문장 종결 기호 분할
                    korean_split = cls.RE_KOREAN_SENTENCE_END.split(line)
                    sentences: List[str] = []
                    for k_sent in korean_split:
                        k_clean = k_sent.strip()
                        if not k_clean:
                            continue
                        sub_sents = cls.RE_GENERAL_SENTENCE_END.split(k_clean)
                        sentences.extend(s.strip() for s in sub_sents if s.strip())

                    for sent in sentences:
                        # 5단계: 512 토큰 초과 시 최후의 수단 분할
                        if cls.estimate_korean_tokens(sent) > max_tokens:
                            sub_chunks = cls._force_split_large_sentence(sent, max_tokens)
                            units.extend(sub_chunks)
                        else:
                            units.append(sent)

        return units if units else [clean_text]

    @classmethod
    def _force_split_large_sentence(cls, sentence: str, max_tokens: int = 512) -> List[str]:
        """512 토큰을 초과하는 단일 초장문 문장을 쉼표, 세미콜론, 공백 단위로 안전 분할"""
        parts = re.split(r'(?<=[;,])\s+', sentence)
        result: List[str] = []
        curr = ""
        for p in parts:
            p_strip = p.strip()
            if not p_strip:
                continue
            cand = f"{curr} {p_strip}".strip() if curr else p_strip
            if cls.estimate_korean_tokens(cand) <= max_tokens:
                curr = cand
            else:
                if curr:
                    result.append(curr)
                if cls.estimate_korean_tokens(p_strip) > max_tokens:
                    words = p_strip.split()
                    w_curr = ""
                    for w in words:
                        w_cand = f"{w_curr} {w}".strip() if w_curr else w
                        if cls.estimate_korean_tokens(w_cand) <= max_tokens:
                            w_curr = w_cand
                        else:
                            if w_curr:
                                result.append(w_curr)
                            w_curr = w
                    if w_curr:
                        curr = w_curr
                    else:
                        curr = ""
                else:
                    curr = p_strip
        if curr:
            result.append(curr)
        return result

    @classmethod
    def generate_table_search_text(
        cls,
        raw_html: str,
        caption: str = "",
        footnote: str = "",
        max_tokens: int = 512
    ) -> str:
        """
        초대형 표도 소형 임베딩 모델(512 토큰)에 안전하게 적재될 수 있도록
        [표 캡션 + 컬럼 목록 + 상위 핵심 행 요약] 형태의 검색 요약 텍스트를 생성합니다.
        """
        parser = _HTMLTableExtractor()
        try:
            parser.feed(raw_html)
            rows = parser.rows
        except Exception:
            rows = []

        lines: List[str] = []
        if caption:
            lines.append(f"[표: {caption}]")
        else:
            lines.append("[표]")

        if rows:
            header_row = rows[0]
            header_str = " | ".join(header_row[:10])
            lines.append(f"컬럼: {header_str}")

            data_rows = rows[1:]
            if data_rows:
                lines.append("주요 데이터:")
                for r in data_rows[:6]:
                    row_str = " | ".join(r[:10])
                    cand = f"- {row_str}"
                    test_text = "\n".join(lines + [cand])
                    if footnote:
                        test_text += f"\n(주: {footnote})"
                    if cls.estimate_korean_tokens(test_text) > max_tokens:
                        break
                    lines.append(cand)
        elif raw_html:
            clean_html = re.sub(r'<[^>]+>', ' ', raw_html)
            clean_html = " ".join(clean_html.split())[:300]
            lines.append(f"내용 요약: {clean_html}")

        if footnote:
            lines.append(f"(주: {footnote})")

        res_text = "\n".join(lines).strip()
        return res_text

    def __init__(self, doc_id: Optional[str] = None, filter_headers_footers: bool = True):
        self.doc_id = self.generate_doc_id(doc_id)
        self.filter_headers_footers = filter_headers_footers

    def chunk_content_list(
        self,
        content_list: List[Any],
        doc_title: str = "Document",
        strategy: str = "general"
    ) -> Dict[str, Any]:
        """
        MinerU의 content_list를 순회하여 정규 3단계 계층 구조
        (Section - Parent Chunk - Child Chunk)를 생성합니다.
        """
        if not content_list:
            return {
                "doc_id": self.doc_id,
                "doc_title": doc_title,
                "strategy": strategy,
                "stats": {
                    "total_sections": 0,
                    "total_parent_sections": 0,
                    "total_parent_chunks": 0,
                    "total_child_chunks": 0,
                    "paragraph_chunks": 0,
                    "table_chunks": 0,
                    "total_words": 0,
                },
                "sections": [],
                "parent_sections": [],
                "parent_chunks": [],
                "child_chunks": [],
            }

        normalized_pages = self._normalize_content_list(content_list)
        if strategy == "legal":
            return self._chunk_legal_content(normalized_pages, doc_title)
        return self._chunk_general_content(normalized_pages, doc_title)

    def _normalize_content_list(self, content_list: List[Any]) -> List[List[Dict[str, Any]]]:
        """v1 및 v2 구조를 표준 2차원 리스트(페이지별 블록 목록)로 정규화"""
        if not content_list:
            return []

        # 만약 이미 2차원 리스트(v2 구조)라면 그대로 반환
        if isinstance(content_list[0], list):
            return content_list

        if isinstance(content_list[0], dict):
            max_page = max((b.get("page_idx", 0) for b in content_list if isinstance(b, dict)), default=0)
            pages_dict: Dict[int, List[Dict[str, Any]]] = {p: [] for p in range(max_page + 1)}
            for item in content_list:
                if not isinstance(item, dict):
                    continue
                p_idx = item.get("page_idx", 0)

                # 이미 MinerU content 블록 구조를 갖춘 경우
                if "content" in item and isinstance(item["content"], dict):
                    pages_dict.setdefault(p_idx, []).append(item)
                    continue

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
        """일반 문서용 헤딩(H1~H2 Section, H3/문단군 Parent, 문장/표 Child) 계층 청킹"""
        sections: List[Dict[str, Any]] = []
        root_section_id = f"{self.doc_id}_s00"
        root_section = {
            "id": root_section_id,
            "title": doc_title,
            "level": 0,
            "breadcrumbs": [doc_title],
            "parent_chunk_ids": [],
            "child_chunk_ids": [],
            "full_text": "",
            "page_range": [1, 1],
        }
        sections.append(root_section)
        heading_stack = [(0, doc_title, root_section_id)]

        section_counter = 0
        current_sec_id = root_section_id

        # 각 섹션별로 수집된 콘텐츠 항목들
        section_items: Dict[str, List[Dict[str, Any]]] = {root_section_id: []}

        for page_idx, page_blocks in enumerate(normalized_pages, start=1):
            if not isinstance(page_blocks, list):
                continue

            for block in page_blocks:
                b_type = block.get("type", "").lower()
                b_content = block.get("content", {})

                if self.filter_headers_footers and b_type in ["page_header", "page_footer", "header", "footer"]:
                    continue

                if b_type == "title":
                    title_text = self._extract_text_from_content(b_content.get("title_content", []))
                    if not title_text.strip():
                        continue
                    level = b_content.get("level", 1)

                    if level <= 2:
                        section_counter += 1
                        sec_id = f"{self.doc_id}_s{section_counter:02d}"

                        while heading_stack and heading_stack[-1][0] >= level:
                            heading_stack.pop()

                        parent_sec_id = heading_stack[-1][2] if heading_stack else root_section_id
                        breadcrumbs = [h[1] for h in heading_stack] + [title_text]
                        heading_stack.append((level, title_text, sec_id))

                        new_sec = {
                            "id": sec_id,
                            "title": title_text,
                            "level": level,
                            "parent_section_id": parent_sec_id,
                            "breadcrumbs": breadcrumbs,
                            "parent_chunk_ids": [],
                            "child_chunk_ids": [],
                            "full_text": f"[{title_text}]\n",
                            "page_range": [page_idx, page_idx],
                        }
                        sections.append(new_sec)
                        current_sec_id = sec_id
                        section_items[current_sec_id] = []
                    else:
                        # Level 3 이상은 Parent 제목 경계로 등록
                        current_breadcrumbs = [h[1] for h in heading_stack]
                        section_items.setdefault(current_sec_id, []).append({
                            "type": "heading_h3",
                            "title": title_text,
                            "page": page_idx,
                            "breadcrumbs": current_breadcrumbs,
                        })

                elif b_type in ["paragraph", "text"]:
                    para_text = self._extract_text_from_content(b_content.get("paragraph_content", []))
                    if not para_text.strip():
                        if isinstance(b_content, str):
                            para_text = b_content
                        elif isinstance(b_content.get("content"), str):
                            para_text = b_content.get("content")
                    if not para_text.strip():
                        continue

                    current_breadcrumbs = [h[1] for h in heading_stack]
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "text",
                        "text": para_text.strip(),
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })

                elif b_type == "table":
                    html_table = b_content.get("html", "")
                    caption = self._extract_text_from_content(b_content.get("table_caption", []))
                    footnote = self._extract_text_from_content(b_content.get("table_footnote", []))
                    img_path = b_content.get("image_source", {}).get("path", "")
                    table_type = b_content.get("table_type", "simple_table")

                    current_breadcrumbs = [h[1] for h in heading_stack]
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "table",
                        "raw_html": html_table,
                        "caption": caption,
                        "footnote": footnote,
                        "image_path": img_path,
                        "table_type": table_type,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })

        all_parent_chunks: List[Dict[str, Any]] = []
        all_child_chunks: List[Dict[str, Any]] = []

        child_counter = 0
        parent_counter = 0

        for sec in sections:
            sec_id = sec["id"]
            items = section_items.get(sec_id, [])
            if not items:
                continue

            sec_children, child_counter = self._pack_to_child_chunks(
                items=items,
                sec_id=sec_id,
                child_counter=child_counter,
                doc_title=doc_title,
                is_legal=False
            )

            sec_parents, parent_counter = self._pack_to_parent_chunks(
                child_chunks=sec_children,
                sec_id=sec_id,
                sec_title=sec["title"],
                parent_counter=parent_counter
            )

            all_child_chunks.extend(sec_children)
            all_parent_chunks.extend(sec_parents)

            sec["parent_chunk_ids"] = [p["parent_chunk_id"] for p in sec_parents]
            sec["child_chunk_ids"] = [c["chunk_id"] for c in sec_children]
            if sec_children:
                sec["page_range"] = [
                    min(c["page_number"] for c in sec_children),
                    max(c.get("page_end", c["page_number"]) for c in sec_children)
                ]
                sec["full_text"] = "\n\n".join(p["text"] for p in sec_parents)

        stats = self._calculate_stats(sections, all_parent_chunks, all_child_chunks)

        return {
            "doc_id": self.doc_id,
            "doc_title": doc_title,
            "strategy": "general",
            "stats": stats,
            "sections": sections,
            "parent_sections": sections,
            "parent_chunks": all_parent_chunks,
            "child_chunks": all_child_chunks,
        }

    def _chunk_legal_content(
        self,
        normalized_pages: List[List[Dict[str, Any]]],
        doc_title: str
    ) -> Dict[str, Any]:
        """
        법률/규정 문서용 3단계 계층 청킹:
        - Section: 편, 장, 절, 관, 부칙, 별표 등 헤딩 트리
        - Parent: 조문(제N조 및 제목) 또는 섹션 서두 문맥 (~2048 토큰)
        - Child: 조문 내 항(①, ②), 호(1., 2.), 목(가.), 원자적 표 (~512 토큰)
        """
        sections: List[Dict[str, Any]] = []
        root_section_id = f"{self.doc_id}_s00"
        root_section = {
            "id": root_section_id,
            "title": doc_title,
            "level": 0,
            "breadcrumbs": [doc_title],
            "parent_chunk_ids": [],
            "child_chunk_ids": [],
            "full_text": "",
            "page_range": [1, 1],
        }
        sections.append(root_section)
        hierarchy_stack = [(0, doc_title, root_section_id)]

        section_counter = 0
        current_sec_id = root_section_id

        section_items: Dict[str, List[Dict[str, Any]]] = {root_section_id: []}

        for page_idx, page_blocks in enumerate(normalized_pages, start=1):
            if not isinstance(page_blocks, list):
                continue

            for block in page_blocks:
                b_type = block.get("type", "").lower()
                b_content = block.get("content", {})

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
                    caption = self._extract_text_from_content(b_content.get("table_caption", []))
                    footnote = self._extract_text_from_content(b_content.get("table_footnote", []))
                    img_path = b_content.get("image_source", {}).get("path", "")
                    table_type = b_content.get("table_type", "simple_table")

                    current_breadcrumbs = [h[1] for h in hierarchy_stack]
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "table",
                        "raw_html": html_table,
                        "caption": caption,
                        "footnote": footnote,
                        "image_path": img_path,
                        "table_type": table_type,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })
                    continue

                if not clean_text:
                    continue

                # 2. 법률 위계(장·절·관·부칙·별표) 검사 -> Section 등록
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
                elif m_chap or m_addendum:
                    level = 2
                    matched_title = clean_text.split("\n")[0]
                elif m_sec or m_appendix:
                    level = 3
                    matched_title = clean_text.split("\n")[0]
                elif m_subsec:
                    level = 4
                    matched_title = clean_text.split("\n")[0]

                if level is not None and matched_title:
                    section_counter += 1
                    sec_id = f"{self.doc_id}_s{section_counter:02d}"

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
                        "parent_chunk_ids": [],
                        "child_chunk_ids": [],
                        "full_text": f"[{matched_title}]\n",
                        "page_range": [page_idx, page_idx],
                    }
                    sections.append(new_section)
                    current_sec_id = sec_id
                    section_items[current_sec_id] = []
                    continue

                # 3. 조문(제N조) 시작 감지
                m_art = self.RE_ARTICLE.match(clean_text)
                current_breadcrumbs = [h[1] for h in hierarchy_stack]

                if m_art:
                    art_label = m_art.group(1).replace(" ", "")
                    art_title = m_art.group(2).strip() if m_art.group(2) else ""
                    art_display = f"{art_label}({art_title})" if art_title else art_label

                    section_items.setdefault(current_sec_id, []).append({
                        "type": "article_start",
                        "article_no": art_label,
                        "article_title": art_title,
                        "article_display": art_display,
                        "text": clean_text,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs + [art_display],
                    })
                else:
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "text",
                        "text": clean_text,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })

        all_parent_chunks: List[Dict[str, Any]] = []
        all_child_chunks: List[Dict[str, Any]] = []

        child_counter = 0
        parent_counter = 0

        for sec in sections:
            sec_id = sec["id"]
            items = section_items.get(sec_id, [])
            if not items:
                continue

            sec_children, child_counter = self._pack_to_child_chunks(
                items=items,
                sec_id=sec_id,
                child_counter=child_counter,
                doc_title=doc_title,
                is_legal=True
            )

            sec_parents, parent_counter = self._pack_to_parent_chunks(
                child_chunks=sec_children,
                sec_id=sec_id,
                sec_title=sec["title"],
                parent_counter=parent_counter
            )

            all_child_chunks.extend(sec_children)
            all_parent_chunks.extend(sec_parents)

            sec["parent_chunk_ids"] = [p["parent_chunk_id"] for p in sec_parents]
            sec["child_chunk_ids"] = [c["chunk_id"] for c in sec_children]
            if sec_children:
                sec["page_range"] = [
                    min(c["page_number"] for c in sec_children),
                    max(c.get("page_end", c["page_number"]) for c in sec_children)
                ]
                sec["full_text"] = "\n\n".join(p["text"] for p in sec_parents)

        stats = self._calculate_stats(sections, all_parent_chunks, all_child_chunks)

        return {
            "doc_id": self.doc_id,
            "doc_title": doc_title,
            "strategy": "legal",
            "stats": stats,
            "sections": sections,
            "parent_sections": sections,
            "parent_chunks": all_parent_chunks,
            "child_chunks": all_child_chunks,
        }

    def _pack_to_child_chunks(
        self,
        items: List[Dict[str, Any]],
        sec_id: str,
        child_counter: int,
        doc_title: str,
        is_legal: bool = False
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        수집된 원시 블록들을 문장/조항 분할 후 512 토큰 한도 내로 Child Chunk로 패킹합니다.
        표(Table) 블록은 원자성을 보존하여 단독 Child Chunk로 생성합니다.
        """
        child_chunks: List[Dict[str, Any]] = []

        current_text_units: List[str] = []
        current_tokens = 0
        current_start_page: Optional[int] = None
        current_end_page: Optional[int] = None
        current_breadcrumbs: List[str] = []
        current_meta: Dict[str, Any] = {}
        current_chunk_type = "paragraph"

        def flush_child_chunk():
            nonlocal child_counter, current_text_units, current_tokens, current_start_page, current_end_page
            if not current_text_units:
                return

            full_child_text = self.normalize_text_for_embedding(" ".join(current_text_units))
            if not full_child_text:
                current_text_units = []
                current_tokens = 0
                current_start_page = None
                current_end_page = None
                return

            child_counter += 1
            cid = f"{self.doc_id}_c{child_counter:03d}"
            start_p = current_start_page if current_start_page is not None else 1
            end_p = current_end_page if current_end_page is not None else start_p
            if end_p < start_p:
                end_p = start_p
            pages_list = list(range(start_p, end_p + 1))

            meta = dict(current_meta)
            meta["doc_title"] = doc_title
            meta["page"] = start_p
            meta["page_start"] = start_p
            meta["page_end"] = end_p
            meta["pages"] = pages_list

            child_chunks.append({
                "chunk_id": cid,
                "parent_chunk_id": "",  # Parent 패킹 시 주입
                "parent_id": "",        # 하위 호환성 별칭
                "section_id": sec_id,
                "chunk_type": current_chunk_type,
                "text": full_child_text,
                "token_estimate": self.estimate_korean_tokens(full_child_text),
                "page_number": start_p,
                "page_end": end_p,
                "breadcrumbs": list(current_breadcrumbs),
                "is_table": False,
                "is_atomic_table": False,
                "metadata": meta,
            })

            current_text_units = []
            current_tokens = 0
            current_start_page = None
            current_end_page = None

        for item in items:
            i_type = item.get("type", "text")
            page_num = item.get("page", 1)
            breadcrumbs = item.get("breadcrumbs", [])

            if i_type == "table":
                flush_child_chunk()

                raw_html = item.get("raw_html", "")
                caption = item.get("caption", "")
                footnote = item.get("footnote", "")
                img_path = item.get("image_path", "")
                table_type = item.get("table_type", "simple_table")
                tbl_start_p = item.get("page", 1)
                tbl_end_p = item.get("page_end", tbl_start_p)
                if tbl_end_p < tbl_start_p:
                    tbl_end_p = tbl_start_p
                tbl_pages = list(range(tbl_start_p, tbl_end_p + 1))

                search_text = self.normalize_text_for_embedding(
                    self.generate_table_search_text(raw_html, caption, footnote)
                )

                child_counter += 1
                cid = f"{self.doc_id}_c{child_counter:03d}"

                child_chunks.append({
                    "chunk_id": cid,
                    "parent_chunk_id": "",
                    "parent_id": "",
                    "section_id": sec_id,
                    "chunk_type": "table",
                    "text": search_text,
                    "raw_html": raw_html,
                    "table_caption": caption,
                    "table_footnote": footnote,
                    "image_path": img_path,
                    "table_type": table_type,
                    "token_estimate": self.estimate_korean_tokens(search_text),
                    "page_number": tbl_start_p,
                    "page_end": tbl_end_p,
                    "breadcrumbs": list(breadcrumbs),
                    "is_table": True,
                    "is_atomic_table": True,
                    "metadata": {
                        "doc_title": doc_title,
                        "type": "table",
                        "is_table": True,
                        "is_atomic_table": True,
                        "has_image": bool(img_path),
                        "page": tbl_start_p,
                        "page_start": tbl_start_p,
                        "page_end": tbl_end_p,
                        "pages": tbl_pages,
                    }
                })
                continue

            if i_type == "article_start":
                flush_child_chunk()
                current_breadcrumbs = breadcrumbs
                current_chunk_type = "article_clause"
                current_meta = {
                    "type": "article",
                    "article_no": item.get("article_no", ""),
                    "article_title": item.get("article_title", ""),
                    "article_display": item.get("article_display", ""),
                }

                raw_art_text = item.get("text", "")
                units = self.split_text_into_units(raw_art_text, is_legal=True, max_tokens=512)
                for u in units:
                    u_tokens = self.estimate_korean_tokens(u)
                    if current_tokens + u_tokens > 512 and current_text_units:
                        flush_child_chunk()
                    if current_start_page is None:
                        current_start_page = page_num
                    current_end_page = page_num
                    current_text_units.append(u)
                    current_tokens += u_tokens
                continue

            if i_type == "heading_h3":
                flush_child_chunk()
                current_breadcrumbs = breadcrumbs + [item.get("title", "")]
                current_chunk_type = "paragraph"
                current_meta = {"heading": item.get("title", "")}
                continue

            raw_text = item.get("text", "")
            if not current_breadcrumbs:
                current_breadcrumbs = breadcrumbs

            units = self.split_text_into_units(raw_text, is_legal=is_legal, max_tokens=512)
            for u in units:
                u_tokens = self.estimate_korean_tokens(u)
                if current_tokens + u_tokens > 512 and current_text_units:
                    flush_child_chunk()
                if current_start_page is None:
                    current_start_page = page_num
                current_end_page = page_num
                current_text_units.append(u)
                current_tokens += u_tokens

        flush_child_chunk()
        return child_chunks, child_counter

    def _pack_to_parent_chunks(
        self,
        child_chunks: List[Dict[str, Any]],
        sec_id: str,
        sec_title: str,
        parent_counter: int
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        Child Chunk들을 2048 토큰 한도 내로 결합하여 완성도 높은 LLM 문맥용 Parent Chunk를 생성합니다.
        2048 토큰을 초과하는 초대형 표는 독립 Parent Chunk로 단독 승격합니다.
        """
        parent_chunks: List[Dict[str, Any]] = []
        if not child_chunks:
            return parent_chunks, parent_counter

        current_children: List[Dict[str, Any]] = []
        current_tokens = 0
        current_parent_title: Optional[str] = None

        def flush_parent():
            nonlocal parent_counter, current_children, current_tokens, current_parent_title
            if not current_children:
                return

            parent_counter += 1
            pid = f"{self.doc_id}_p{parent_counter:03d}"

            combined_texts = []
            for c in current_children:
                if c.get("chunk_type") == "table":
                    cap = c.get("table_caption")
                    cap_prefix = f"[표: {cap}]\n" if cap else "[표]\n"
                    table_content = c.get("raw_html") or c.get("text", "")
                    combined_texts.append(f"{cap_prefix}{table_content}".strip())
                else:
                    combined_texts.append(c.get("text", ""))

            body_text = "\n\n".join(combined_texts).strip()

            first_c = current_children[0]
            bc_str = " > ".join(first_c.get("breadcrumbs", [sec_title]))
            context_header = f"[{bc_str}]"
            raw_parent_text = f"{context_header}\n\n{body_text}".strip()
            parent_full_text = self.normalize_parent_text(raw_parent_text)

            title_val = current_parent_title or first_c.get("metadata", {}).get("article_display") or sec_title

            p_tokens = self.estimate_korean_tokens(parent_full_text)
            p_chunk = {
                "parent_chunk_id": pid,
                "id": pid,  # 호환성 별칭
                "section_id": sec_id,
                "title": title_val,
                "text": parent_full_text,
                "token_estimate": p_tokens,
                "child_chunk_ids": [c["chunk_id"] for c in current_children],
                "page_range": [
                    min(c["page_number"] for c in current_children),
                    max(c.get("page_end", c["page_number"]) for c in current_children),
                ],
            }
            parent_chunks.append(p_chunk)

            for c in current_children:
                c["parent_chunk_id"] = pid
                c["parent_id"] = pid

            current_children = []
            current_tokens = 0
            current_parent_title = None

        for child in child_chunks:
            # 1. 2048 토큰을 초과하는 초대형 표 단독 승격 규칙
            raw_html_len = len(child.get("raw_html", "")) if child.get("raw_html") else 0
            raw_table_tokens = self.estimate_korean_tokens(child.get("raw_html", "")) if raw_html_len > 0 else child["token_estimate"]

            if child.get("chunk_type") == "table" and raw_table_tokens > 2048:
                flush_parent()
                current_children.append(child)
                current_tokens = raw_table_tokens
                current_parent_title = child.get("table_caption") or f"{sec_title} - 대형 표"
                flush_parent()
                continue

            # 2. 조문(article_display) 변경 감지 시 독립 Parent 생성
            art_disp = child.get("metadata", {}).get("article_display")
            if art_disp and current_parent_title and current_parent_title != art_disp:
                flush_parent()

            if not current_parent_title and art_disp:
                current_parent_title = art_disp

            # 3. 2048 토큰 초과 검사
            c_tokens = child.get("token_estimate", 0)
            if current_tokens + c_tokens > 2048 and current_children:
                flush_parent()
                if art_disp:
                    current_parent_title = f"{art_disp} (계속)"

            current_children.append(child)
            current_tokens += c_tokens

        flush_parent()
        return parent_chunks, parent_counter

    def export_to_jsonl(self, etl_result: Dict[str, Any]) -> str:
        """
        RAG Vector DB 및 하이브리드 검색 엔진 적재를 위한 표준 JSONL을 생성합니다.
        - 검색/임베딩 대상: text
        - LLM 프롬프트 생성 문맥: parent_context_text (Small-to-Big Retrieval 100% 지원)
        """
        lines: List[str] = []
        parent_map = {
            p.get("parent_chunk_id", p.get("id", "")): p
            for p in etl_result.get("parent_chunks", [])
        }
        sec_list = etl_result.get("sections") or etl_result.get("parent_sections") or []
        section_map = {s["id"]: s for s in sec_list}

        for chunk in etl_result.get("child_chunks", []):
            if chunk.get("is_ignored"):
                continue

            pid = chunk.get("parent_chunk_id") or chunk.get("parent_id", "")
            parent = parent_map.get(pid, {})
            sec_id = chunk.get("section_id") or parent.get("section_id", "")
            section = section_map.get(sec_id, {})

            breadcrumbs = chunk.get("breadcrumbs") or section.get("breadcrumbs") or []
            breadcrumbs_str = " > ".join(breadcrumbs) if breadcrumbs else ""

            start_page = chunk.get("page_number", 1)
            end_page = chunk.get("page_end", start_page)
            if end_page < start_page:
                end_page = start_page
            pages_list = list(range(start_page, end_page + 1))

            meta = dict(chunk.get("metadata") or {})
            meta["doc_title"] = etl_result.get("doc_title", "")
            meta["section"] = section.get("title", "")
            meta["page"] = start_page
            meta["page_start"] = start_page
            meta["page_end"] = end_page
            meta["pages"] = pages_list
            is_table = (chunk.get("chunk_type") == "table" or bool(chunk.get("is_atomic_table")))
            meta["is_atomic_table"] = is_table

            parent_text = parent.get("text", "")
            if breadcrumbs_str and not parent_text.startswith(f"[{breadcrumbs_str}]"):
                parent_context_text = f"[{breadcrumbs_str}]\n{parent_text}".strip()
            else:
                parent_context_text = parent_text.strip()

            record = {
                "id": chunk.get("chunk_id", ""),
                "parent_chunk_id": pid,
                "section_id": sec_id,
                "section_title": section.get("title", ""),
                "breadcrumbs": breadcrumbs,
                "breadcrumbs_str": breadcrumbs_str,
                "text": chunk.get("text", ""),
                "parent_context_text": parent_context_text,
                "chunk_type": chunk.get("chunk_type", "paragraph"),
                "is_atomic_table": is_table,
                "page": start_page,
                "pages": pages_list,
                "token_estimate": chunk.get("token_estimate", self.estimate_korean_tokens(chunk.get("text", ""))),
                "parent_token_estimate": parent.get("token_estimate", self.estimate_korean_tokens(parent_text)),
                "metadata": meta,
            }

            if end_page > start_page:
                record["page_end"] = end_page
            if is_table:
                record["raw_html"] = chunk.get("raw_html", "")
                record["table_caption"] = chunk.get("table_caption", "")
                if chunk.get("image_path"):
                    record["image_path"] = chunk.get("image_path")
                if chunk.get("image_url"):
                    record["image_url"] = chunk.get("image_url")

            lines.append(json.dumps(record, ensure_ascii=False))

        return "\n".join(lines)

    @classmethod
    def reindex_etl_result(cls, etl_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        수동 편집(분할/병합/섹션 재지정) 후 불연속해진 모든 ID를
        '문서 물리적 등장 순서(Page & Block Position)' 기준으로 일괄 재정렬(Re-index)합니다.
        - doc_id: 6자리 해시 기반 정규화 (d_xxxxxx)
        - sections: s00 (root), s01, s02...
        - parent_chunks: p001, p002, p003...
        - child_chunks: c001, c002, c003...
        - Section-Parent-Child 간 모든 양방향 참조 일괄 갱신
        """
        import copy
        res = copy.deepcopy(etl_result)
        raw_doc_id = res.get("doc_id") or "doc"
        doc_id = cls.generate_doc_id(raw_doc_id)
        res["doc_id"] = doc_id

        raw_sections = res.get("sections") or res.get("parent_sections") or []
        raw_parents = res.get("parent_chunks", [])
        raw_children = res.get("child_chunks", [])

        # 1. 물리적 페이지 순서 기반 정렬 (안정 정렬)
        root_sec = None
        normal_sections = []
        for s in raw_sections:
            if s.get("level", 0) == 0 or s.get("id", "").endswith("_s00") or s.get("id", "").endswith("_root"):
                root_sec = s
            else:
                normal_sections.append(s)

        normal_sections.sort(key=lambda s: s.get("page_range", [1, 1])[0])
        sorted_sections = ([root_sec] if root_sec else []) + normal_sections

        # Parent는 page_range[0] 기준 정렬
        sorted_parents = sorted(raw_parents, key=lambda p: p.get("page_range", [1, 1])[0])

        # Child는 page_number 기준 정렬
        sorted_children = sorted(raw_children, key=lambda c: c.get("page_number", 1))

        # 2. 신규 ID 매핑 맵 생성
        section_id_map: Dict[str, str] = {}
        sec_counter = 1
        new_sections = []
        for sec in sorted_sections:
            old_sid = sec.get("id", "")
            if sec.get("level", 0) == 0 or old_sid.endswith("_s00") or old_sid.endswith("_root"):
                new_sid = f"{doc_id}_s00"
            else:
                new_sid = f"{doc_id}_s{sec_counter:02d}"
                sec_counter += 1
            section_id_map[old_sid] = new_sid
            sec["id"] = new_sid
            new_sections.append(sec)

        parent_id_map: Dict[str, str] = {}
        parent_counter = 1
        new_parents = []
        for p in sorted_parents:
            old_pid = p.get("parent_chunk_id") or p.get("id", "")
            new_pid = f"{doc_id}_p{parent_counter:03d}"
            parent_counter += 1
            parent_id_map[old_pid] = new_pid
            p["parent_chunk_id"] = new_pid
            p["id"] = new_pid
            new_parents.append(p)

        child_id_map: Dict[str, str] = {}
        child_counter = 1
        new_children = []
        for c in sorted_children:
            old_cid = c.get("chunk_id", "")
            new_cid = f"{doc_id}_c{child_counter:03d}"
            child_counter += 1
            child_id_map[old_cid] = new_cid
            c["chunk_id"] = new_cid

            p_start = c.get("page_number", 1)
            p_end = c.get("page_end", p_start)
            if p_end < p_start:
                p_end = p_start

            if isinstance(c.get("metadata"), dict):
                c["metadata"]["page"] = p_start
                c["metadata"]["page_start"] = p_start
                c["metadata"]["page_end"] = p_end
                c["metadata"]["pages"] = list(range(p_start, p_end + 1))

            new_children.append(c)

        # 3. 상호 참조 ID 일괄 갱신
        for sec in new_sections:
            old_psid = sec.get("parent_section_id")
            if old_psid and old_psid in section_id_map:
                sec["parent_section_id"] = section_id_map[old_psid]

            sec["parent_chunk_ids"] = [
                parent_id_map[pid] for pid in sec.get("parent_chunk_ids", []) if pid in parent_id_map
            ]
            sec["child_chunk_ids"] = [
                child_id_map[cid] for cid in sec.get("child_chunk_ids", []) if cid in child_id_map
            ]

        for p in new_parents:
            old_sid = p.get("section_id")
            if old_sid and old_sid in section_id_map:
                p["section_id"] = section_id_map[old_sid]

            p["child_chunk_ids"] = [
                child_id_map[cid] for cid in p.get("child_chunk_ids", []) if cid in child_id_map
            ]

        for c in new_children:
            old_pid = c.get("parent_chunk_id") or c.get("parent_id")
            if old_pid and old_pid in parent_id_map:
                c["parent_chunk_id"] = parent_id_map[old_pid]
                c["parent_id"] = parent_id_map[old_pid]

            old_sid = c.get("section_id")
            if old_sid and old_sid in section_id_map:
                c["section_id"] = section_id_map[old_sid]

        res["sections"] = new_sections
        res["parent_sections"] = new_sections
        res["parent_chunks"] = new_parents
        res["child_chunks"] = new_children
        res["stats"] = cls._calculate_stats(new_sections, new_parents, new_children)

        return res

    @staticmethod
    def _calculate_stats(
        sections: List[Dict[str, Any]],
        parents: List[Dict[str, Any]],
        children: List[Dict[str, Any]]
    ) -> Dict[str, int]:
        return {
            "total_sections": len(sections),
            "total_parent_sections": len(sections),
            "total_parent_chunks": len(parents),
            "total_child_chunks": len(children),
            "paragraph_chunks": sum(1 for c in children if c.get("chunk_type") in ["paragraph", "article_clause"]),
            "table_chunks": sum(1 for c in children if c.get("chunk_type") == "table"),
            "total_words": sum(c.get("token_estimate", 0) for c in children),
        }

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
