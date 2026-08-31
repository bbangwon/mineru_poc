import json
import os
from pathlib import Path
from typing import List, Optional

import pypdf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.app.services.hierarchical_chunker import HierarchicalChunker
from backend.app.services.mineru_svc import MineruService

BASE_DIR = Path(__file__).resolve().parent.parent.parent
TEMPLATES_DIR = BASE_DIR / "backend" / "app" / "templates"
FRONTEND_DIST_DIR = BASE_DIR / "frontend" / "dist"
DOCS_DIR = BASE_DIR / "pdfs"
OUTPUT_DIR = BASE_DIR / "output"

app = FastAPI(title="MinerU RAG ETL Studio")

# CORS setup for frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static mount for images in output directory
if OUTPUT_DIR.exists():
    app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")

# Static mount for built frontend assets if dist exists
if (FRONTEND_DIST_DIR / "assets").exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST_DIR / "assets")),
        name="assets",
    )


mineru_svc = MineruService()

# Cache latest ETL result & current active PDF in memory
latest_etl_result: Optional[dict] = None
current_selected_pdf_name: Optional[str] = None


class ParseRequest(BaseModel):
    filename: Optional[str] = None
    all_pages: Optional[bool] = False
    start_page: Optional[int] = 0
    end_page: Optional[int] = 2
    lang: Optional[str] = "korean"
    backend: Optional[str] = "pipeline"


class SelectPdfRequest(BaseModel):
    filename: str


def get_pdf_page_count(path: Path) -> int:
    try:
        reader = pypdf.PdfReader(str(path))
        return len(reader.pages)
    except Exception:
        return 1


def get_active_pdf_path() -> Optional[Path]:
    global current_selected_pdf_name
    if current_selected_pdf_name:
        p1 = DOCS_DIR / current_selected_pdf_name
        if p1.exists():
            return p1
    pdf_files = list(DOCS_DIR.glob("*.pdf"))
    if pdf_files:
        current_selected_pdf_name = pdf_files[0].name
        return pdf_files[0]
    return None


def find_latest_content_list() -> Optional[tuple[Path, list]]:
    """가장 최근에 생성된 MinerU content_list_v2.json 우선 탐색 (없으면 v1)"""
    v2_candidates = []
    v1_candidates = []
    if OUTPUT_DIR.exists():
        for root, _, files in os.walk(OUTPUT_DIR):
            for f in files:
                p = Path(root) / f
                if f.endswith("_content_list_v2.json"):
                    v2_candidates.append((p.stat().st_mtime, p))
                elif f.endswith("_content_list.json"):
                    v1_candidates.append((p.stat().st_mtime, p))

    candidates = v2_candidates if v2_candidates else v1_candidates
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    latest_path = candidates[0][1]
    try:
        with open(latest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return latest_path, data
    except Exception:
        return None


@app.get("/api/pdf/list")
async def list_pdfs():
    """사용 가능한 모든 PDF 파일 목록과 페이지 수 반환"""
    global current_selected_pdf_name
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    pdf_files = list(DOCS_DIR.glob("*.pdf"))
    extra_docs = BASE_DIR / "pdfs"
    if extra_docs.exists():
        for f in extra_docs.glob("*.pdf"):
            if not any(p.name == f.name for p in pdf_files):
                pdf_files.append(f)

    if not current_selected_pdf_name and pdf_files:
        current_selected_pdf_name = pdf_files[0].name

    items = []
    for p in pdf_files:
        pages = get_pdf_page_count(p)
        items.append(
            {
                "filename": p.name,
                "size_bytes": p.stat().st_size,
                "total_pages": pages,
                "is_current": (p.name == current_selected_pdf_name),
            }
        )

    return {"pdfs": items, "current": current_selected_pdf_name}


@app.post("/api/pdf/select")
async def select_pdf(req: SelectPdfRequest):
    """활성 파싱 대상 PDF 변경"""
    global current_selected_pdf_name
    target = DOCS_DIR / req.filename
    if not target.exists():
        extra = BASE_DIR / "pdfs" / req.filename
        if extra.exists():
            target = extra
        else:
            raise HTTPException(status_code=404, detail="PDF file not found")
    current_selected_pdf_name = req.filename
    pages = get_pdf_page_count(target)
    return {"success": True, "current": req.filename, "total_pages": pages}


@app.post("/api/pdf/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """신규 PDF 파일 업로드 및 자동 활성화"""
    global current_selected_pdf_name
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    save_path = DOCS_DIR / file.filename
    with open(save_path, "wb") as f:
        content = await file.read()
        f.write(content)

    current_selected_pdf_name = file.filename
    pages = get_pdf_page_count(save_path)
    return {
        "success": True,
        "filename": file.filename,
        "total_pages": pages,
        "size_bytes": save_path.stat().st_size,
    }


@app.get("/", response_class=HTMLResponse)
async def get_index():
    react_index = FRONTEND_DIST_DIR / "index.html"
    if react_index.exists():
        with open(react_index, "r", encoding="utf-8") as f:
            return f.read()
    index_path = TEMPLATES_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Template not found")
    with open(index_path, "r", encoding="utf-8") as f:
        return f.read()


@app.get("/favicon.svg")
async def get_favicon():
    fav = FRONTEND_DIST_DIR / "favicon.svg"
    if fav.exists():
        return FileResponse(fav, media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="Favicon not found")


@app.get("/api/etl/sample")
async def get_sample_etl():
    """기존 파싱 결과를 바탕으로 부모-자식 청크 & 표 원형 보존 ETL 결과 반환"""
    global latest_etl_result
    found = find_latest_content_list()
    if not found:
        raise HTTPException(status_code=404, detail="No MinerU parsed content found.")

    file_path, content_list = found
    doc_name = file_path.parent.parent.name
    chunker = HierarchicalChunker(doc_id="doc_asbestos")
    etl_res = chunker.chunk_content_list(content_list, doc_title=doc_name)

    # 표 이미지 상대 URL 보정 (/output/...)
    for chunk in etl_res.get("child_chunks", []):
        if chunk.get("chunk_type") == "table" and chunk.get("image_path"):
            img_p = file_path.parent / chunk["image_path"]
            if img_p.exists():
                rel_to_output = img_p.relative_to(OUTPUT_DIR)
                chunk["image_url"] = f"/output/{rel_to_output}"

    latest_etl_result = etl_res
    return etl_res


@app.post("/api/etl/parse")
async def run_etl_parse(req: ParseRequest):
    """지정된 PDF(또는 활성 PDF)를 파싱하고 즉시 계층 청킹 파이프라인 수행"""
    global latest_etl_result, current_selected_pdf_name

    pdf_path = None
    if req.filename:
        p1 = DOCS_DIR / req.filename
        pdf_path = p1 if p1.exists() else None

    if not pdf_path:
        pdf_path = get_active_pdf_path()

    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Target PDF not found")

    current_selected_pdf_name = pdf_path.name

    # 전체 페이지(all_pages) 옵션 처리
    start_p = None if req.all_pages else req.start_page
    end_p = None if req.all_pages else req.end_page

    output_dir = BASE_DIR / "output" / f"mineru_{req.backend}_{req.lang}"
    parse_res = mineru_svc.parse_pdf(
        pdf_path=pdf_path,
        output_dir=output_dir,
        start_page=start_p,
        end_page=end_p,
        lang=req.lang or "korean",
        backend=req.backend or "pipeline",
    )

    if not parse_res.get("success"):
        raise HTTPException(
            status_code=500, detail=parse_res.get("error", "MinerU parse failed")
        )

    content_list = parse_res.get("content_list", [])
    if not content_list:
        found = find_latest_content_list()
        if found:
            content_list = found[1]

    chunker = HierarchicalChunker(doc_id=f"doc_{pdf_path.stem[:12]}")
    etl_res = chunker.chunk_content_list(content_list, doc_title=pdf_path.stem)
    etl_res["elapsed_time"] = parse_res.get("elapsed_time", 0)
    etl_res["active_pdf"] = pdf_path.name
    etl_res["total_pages"] = get_pdf_page_count(pdf_path)

    # 표 이미지 경로 보정
    for chunk in etl_res.get("child_chunks", []):
        if chunk.get("chunk_type") == "table" and chunk.get("image_path"):
            img_p = Path(parse_res.get("output_dir", "")) / chunk["image_path"]
            if img_p.exists():
                try:
                    rel_to_output = img_p.relative_to(OUTPUT_DIR)
                    chunk["image_url"] = f"/output/{rel_to_output}"
                except Exception:
                    pass

    latest_etl_result = etl_res
    return etl_res


@app.get("/api/etl/export/jsonl")
async def export_jsonl():
    """RAG 표준 JSONL 파일 다운로드"""
    global latest_etl_result
    if not latest_etl_result:
        found = find_latest_content_list()
        if found:
            file_path, content_list = found
            chunker = HierarchicalChunker(doc_id="doc_asbestos")
            latest_etl_result = chunker.chunk_content_list(
                content_list, doc_title=file_path.parent.parent.name
            )
        else:
            raise HTTPException(
                status_code=404, detail="No ETL data available to export"
            )

    chunker = HierarchicalChunker(doc_id=latest_etl_result.get("doc_id", "doc"))
    jsonl_content = chunker.export_to_jsonl(latest_etl_result)

    return Response(
        content=jsonl_content,
        media_type="application/x-ndjson; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="rag_chunks.jsonl"'},
    )


@app.get("/api/pdf")
async def get_pdf():
    pdf_path = get_active_pdf_path()
    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(pdf_path, media_type="application/pdf")
