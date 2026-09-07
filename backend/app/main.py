import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE_DIR = Path(__file__).resolve().parent.parent.parent
_PKG_ROOT = BASE_DIR / "packages" / "rag_embed_core"
if _PKG_ROOT.exists() and str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

import pypdf
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.app.services.hierarchical_chunker import HierarchicalChunker
from backend.app.services.mineru_svc import MineruService
from backend.app.services.embedding_svc import embedding_svc, EMBEDDED_JSON_PATH
from backend.app.services.qdrant_config_svc import get_qdrant_config, save_qdrant_config
from backend.app.services.llm_config_svc import (
    LLMConfig,
    get_llm_config,
    save_llm_config,
    get_default_system_prompt,
)
from backend.app.services.llm_refine_svc import llm_refine_svc
from rag_embed_core.config import QdrantConfig

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
latest_content_list_path: Optional[Path] = None
current_selected_pdf_name: Optional[str] = None

# In-memory background jobs registry
jobs_db: Dict[str, Dict[str, Any]] = {}


class ParseRequest(BaseModel):
    filename: Optional[str] = None
    all_pages: Optional[bool] = False
    start_page: Optional[int] = 0
    end_page: Optional[int] = 2
    lang: Optional[str] = "korean"
    backend: Optional[str] = "pipeline"
    method: Optional[str] = "auto"
    formula: Optional[bool] = True
    strategy: Optional[str] = "general"


def process_etl_job(task_id: str, req_data: dict, pdf_path_str: str):
    """백그라운드에서 실행되는 MinerU 파싱 및 계층 청킹 워커"""
    global latest_etl_result, latest_content_list_path, current_selected_pdf_name
    pdf_path = Path(pdf_path_str)
    job = jobs_db.get(task_id)
    if not job:
        return

    job["status"] = "running"
    job["progress_msg"] = "MinerU 파이프라인 엔진으로 PDF 파싱 중..."
    start_time = time.time()

    all_pages = req_data.get("all_pages", False)
    start_p = None if all_pages else req_data.get("start_page", 0)
    end_p = None if all_pages else req_data.get("end_page", 2)
    method = req_data.get("method") or "auto"
    formula = True if req_data.get("formula") is None else req_data.get("formula")
    backend = req_data.get("backend") or "pipeline"
    lang = req_data.get("lang") or "korean"
    strategy = req_data.get("strategy") or "general"

    output_dir = BASE_DIR / "output" / f"mineru_{backend}_{method}_{lang}"

    try:
        parse_res = mineru_svc.parse_pdf(
            pdf_path=pdf_path,
            output_dir=output_dir,
            start_page=start_p,
            end_page=end_p,
            lang=lang,
            backend=backend,
            method=method,
            formula=formula,
        )

        if not parse_res.get("success"):
            job["status"] = "failed"
            job["error"] = parse_res.get("error", "MinerU parse failed")
            job["elapsed_time"] = round(time.time() - start_time, 1)
            return

        job["progress_msg"] = "문서 위계 구조 및 법률 조문 계층 청킹 중..."

        content_list = parse_res.get("content_list", [])
        if parse_res.get("content_list_path"):
            latest_content_list_path = Path(parse_res["content_list_path"])
        elif not content_list:
            found = find_latest_content_list(pdf_path.stem)
            if found:
                latest_content_list_path = found[0]
                content_list = found[1]

        chunker = HierarchicalChunker(doc_id=pdf_path.stem)
        etl_res = chunker.chunk_content_list(content_list, doc_title=pdf_path.stem, strategy=strategy)
        etl_res["elapsed_time"] = parse_res.get("elapsed_time", round(time.time() - start_time, 1))
        etl_res["active_pdf"] = pdf_path.name
        etl_res["total_pages"] = get_pdf_page_count(pdf_path)

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
        current_selected_pdf_name = pdf_path.name

        job["status"] = "completed"
        job["progress_msg"] = "파싱 및 청킹 완료"
        job["result"] = etl_res
        job["elapsed_time"] = round(time.time() - start_time, 1)

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        job["elapsed_time"] = round(time.time() - start_time, 1)


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


def find_latest_content_list(preferred_doc_name: Optional[str] = None) -> Optional[tuple[Path, list]]:
    """가장 최근에 생성된 MinerU content_list_v2.json 우선 탐색 (preferred_doc_name 우선)"""
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

    # preferred_doc_name이 주어지면 파일 경로에 포함된 것 우선 정렬
    if preferred_doc_name:
        stem = Path(preferred_doc_name).stem
        preferred = [c for c in candidates if stem in str(c[1])]
        if preferred:
            preferred.sort(key=lambda x: x[0], reverse=True)
            candidates = preferred

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
async def get_sample_etl(strategy: Optional[str] = "general"):
    """기존 파싱 결과를 바탕으로 부모-자식 청크 & 표 원형 보존 ETL 결과 반환 (수정본 존재 시 우선 로드)"""
    global latest_etl_result, latest_content_list_path
    found = find_latest_content_list(current_selected_pdf_name)
    if not found:
        raise HTTPException(status_code=404, detail="No MinerU parsed content found.")

    file_path, content_list = found
    latest_content_list_path = file_path

    # rag_chunks_edited.json 존재 시 우선 로드
    edited_path = file_path.parent / "rag_chunks_edited.json"
    if edited_path.exists():
        try:
            with open(edited_path, "r", encoding="utf-8") as f:
                edited_data = json.load(f)
                latest_etl_result = edited_data
                return edited_data
        except Exception as e:
            print(f"Failed to load edited chunks: {e}")

    doc_name = file_path.parent.parent.name
    chunker = HierarchicalChunker(doc_id=doc_name)
    etl_res = chunker.chunk_content_list(content_list, doc_title=doc_name, strategy=strategy or "general")

    # 표 이미지 상대 URL 보정 (/output/...)
    for chunk in etl_res.get("child_chunks", []):
        if chunk.get("chunk_type") == "table" and chunk.get("image_path"):
            img_p = file_path.parent / chunk["image_path"]
            if img_p.exists():
                rel_to_output = img_p.relative_to(OUTPUT_DIR)
                chunk["image_url"] = f"/output/{rel_to_output}"

    latest_etl_result = etl_res
    return etl_res


@app.post("/api/etl/reindex")
async def reindex_etl_endpoint(req: Optional[Dict[str, Any]] = None):
    """
    현재 편집 중인 ETL 결과(또는 메모리의 latest_etl_result)의
    모든 섹션(s01~)과 청크(c001~) ID를 문서 순서대로 일괄 재정렬합니다.
    """
    global latest_etl_result
    etl_data = (req.get("etl_result") if req else None) or req or latest_etl_result
    if not etl_data or "child_chunks" not in etl_data:
        raise HTTPException(status_code=400, detail="재정렬할 유효한 ETL 결과 데이터가 없습니다.")

    reindexed = HierarchicalChunker.reindex_etl_result(etl_data)
    latest_etl_result = reindexed
    return reindexed


class SaveEtlRequest(BaseModel):
    etl_result: Optional[Dict[str, Any]] = None


@app.post("/api/etl/save")
async def save_etl_result(req: Dict[str, Any]):
    """사용자가 편집한 ETL 결과 전체를 백엔드에 영속 저장"""
    global latest_etl_result, latest_content_list_path

    etl_data = req.get("etl_result", req)
    if not etl_data or "child_chunks" not in etl_data:
        raise HTTPException(status_code=400, detail="유효한 ETL 결과 데이터가 아닙니다.")

    target_content_list_path = latest_content_list_path
    if not target_content_list_path or not target_content_list_path.exists():
        found = find_latest_content_list(current_selected_pdf_name)
        if found:
            target_content_list_path = found[0]
            latest_content_list_path = target_content_list_path

    if not target_content_list_path:
        raise HTTPException(status_code=404, detail="저장할 대상 파싱 결과 디렉토리를 찾을 수 없습니다.")

    save_path = target_content_list_path.parent / "rag_chunks_edited.json"
    try:
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(etl_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")

    latest_etl_result = etl_data
    total_chunks = len(etl_data.get("child_chunks", []))
    saved_time = time.time()

    return {
        "success": True,
        "message": "수정본이 성공적으로 저장되었습니다.",
        "saved_at": saved_time,
        "total_chunks": total_chunks,
    }


class ResetRequest(BaseModel):
    strategy: Optional[str] = "general"


@app.post("/api/etl/reset")
async def reset_etl_result(req: Optional[ResetRequest] = None):
    """수정본(rag_chunks_edited.json)을 제거하고 원본 파싱 결과로 리셋"""
    global latest_etl_result, latest_content_list_path

    target_content_list_path = latest_content_list_path
    if not target_content_list_path or not target_content_list_path.exists():
        found = find_latest_content_list(current_selected_pdf_name)
        if found:
            target_content_list_path = found[0]
            latest_content_list_path = target_content_list_path

    if not target_content_list_path or not target_content_list_path.exists():
        raise HTTPException(status_code=404, detail="원본 파싱 결과를 찾을 수 없습니다.")

    save_path = target_content_list_path.parent / "rag_chunks_edited.json"
    if save_path.exists():
        try:
            save_path.unlink()
        except Exception as e:
            print(f"수정본 파일 삭제 실패: {e}")

    try:
        with open(target_content_list_path, "r", encoding="utf-8") as f:
            content_list = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"원본 데이터 로드 실패: {str(e)}")

    strat = (req.strategy if req and req.strategy else None) or "general"
    doc_name = target_content_list_path.parent.parent.name
    chunker = HierarchicalChunker(doc_id=doc_name)
    etl_res = chunker.chunk_content_list(content_list, doc_title=doc_name, strategy=strat)

    # 표 이미지 상대 URL 보정
    for chunk in etl_res.get("child_chunks", []):
        if chunk.get("chunk_type") == "table" and chunk.get("image_path"):
            img_p = target_content_list_path.parent / chunk["image_path"]
            if img_p.exists():
                rel_to_output = img_p.relative_to(OUTPUT_DIR)
                chunk["image_url"] = f"/output/{rel_to_output}"

    latest_etl_result = etl_res
    return etl_res


@app.post("/api/etl/parse")
async def run_etl_parse(req: ParseRequest):
    """지정된 PDF(또는 활성 PDF)를 파싱하고 즉시 계층 청킹 파이프라인 수행"""
    global latest_etl_result, latest_content_list_path, current_selected_pdf_name

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

    method = req.method or "auto"
    formula = True if req.formula is None else req.formula
    output_dir = BASE_DIR / "output" / f"mineru_{req.backend}_{method}_{req.lang}"
    parse_res = mineru_svc.parse_pdf(
        pdf_path=pdf_path,
        output_dir=output_dir,
        start_page=start_p,
        end_page=end_p,
        lang=req.lang or "korean",
        backend=req.backend or "pipeline",
        method=method,
        formula=formula,
    )

    if not parse_res.get("success"):
        raise HTTPException(
            status_code=500, detail=parse_res.get("error", "MinerU parse failed")
        )

    content_list = parse_res.get("content_list", [])
    if parse_res.get("content_list_path"):
        latest_content_list_path = Path(parse_res["content_list_path"])
    elif not content_list:
        found = find_latest_content_list(pdf_path.stem)
        if found:
            latest_content_list_path = found[0]
            content_list = found[1]

    chunk_strat = req.strategy or "general"
    chunker = HierarchicalChunker(doc_id=pdf_path.stem)
    etl_res = chunker.chunk_content_list(content_list, doc_title=pdf_path.stem, strategy=chunk_strat)
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


@app.post("/api/etl/parse-job")
async def start_etl_job(req: ParseRequest, background_tasks: BackgroundTasks):
    """비동기 백그라운드 태스크 등록: 즉시 task_id 반환 (타임아웃 방지)"""
    global current_selected_pdf_name
    pdf_path = None
    if req.filename:
        p1 = DOCS_DIR / req.filename
        pdf_path = p1 if p1.exists() else None

    if not pdf_path:
        pdf_path = get_active_pdf_path()

    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Target PDF not found")

    current_selected_pdf_name = pdf_path.name
    task_id = f"job_{uuid.uuid4().hex[:8]}"

    jobs_db[task_id] = {
        "task_id": task_id,
        "status": "pending",
        "progress_msg": "태스크가 백그라운드 대기열에 등록되었습니다...",
        "filename": pdf_path.name,
        "strategy": req.strategy or "general",
        "created_at": time.time(),
        "elapsed_time": 0,
        "result": None,
        "error": None,
    }

    background_tasks.add_task(process_etl_job, task_id, req.model_dump(), str(pdf_path))
    return {
        "success": True,
        "task_id": task_id,
        "status": "pending",
        "message": "백그라운드 파싱 작업이 등록되었습니다."
    }


@app.get("/api/etl/jobs/active")
async def get_active_job():
    """현재 진행 중인 가장 최근 백그라운드 작업 반환 (새로고침 시 폴링 복구용)"""
    for task_id, job in reversed(list(jobs_db.items())):
        if job["status"] in ["pending", "running"]:
            job_copy = dict(job)
            job_copy["elapsed_time"] = round(time.time() - job["created_at"], 1)
            return job_copy
    return {"active": False}


@app.get("/api/etl/jobs/{task_id}")
async def get_job_status(task_id: str):
    """특정 백그라운드 태스크의 진행 상태 및 완료 결과 조회"""
    job = jobs_db.get(task_id)
    if not job:
        raise HTTPException(status_code=404, detail="Task not found")

    job_copy = dict(job)
    if job["status"] in ["pending", "running"]:
        job_copy["elapsed_time"] = round(time.time() - job["created_at"], 1)
    return job_copy


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


# ==========================================
# Phase 2: Qdrant & 하이브리드 임베딩 API 엔드포인트
# ==========================================

class QdrantTestConnectionRequest(BaseModel):
    mode: Optional[str] = None
    local_path: Optional[str] = None
    url: Optional[str] = None
    api_key: Optional[str] = None


class EmbedRequest(BaseModel):
    collection_name: Optional[str] = None
    recreate_collection: Optional[bool] = None
    chunks: Optional[List[Dict[str, Any]]] = None


class SearchRequest(BaseModel):
    query: str
    limit: Optional[int] = 10
    collection_name: Optional[str] = None


# 임베딩 작업 상태 관리 객체
embed_job_state: Dict[str, Any] = {
    "status": "idle",  # idle | running | done | error
    "progress_msg": "대기 중",
    "progress_pct": 0,
    "last_result": None,
    "error": None,
    "elapsed_time": 0,
}


@app.get("/api/qdrant/config")
async def api_get_qdrant_config():
    """현재 Qdrant 설정 조회"""
    cfg = get_qdrant_config()
    return cfg.model_dump()


@app.post("/api/qdrant/config")
async def api_save_qdrant_config(req: QdrantConfig):
    """Qdrant 설정 업데이트 및 저장"""
    saved = save_qdrant_config(req)
    return {"success": True, "config": saved.model_dump()}


@app.post("/api/qdrant/test-connection")
async def api_test_qdrant_connection(req: Optional[QdrantTestConnectionRequest] = None):
    """Qdrant 연결 헬스체크 및 컬렉션 현황 테스트"""
    current_cfg = get_qdrant_config()
    test_dict = current_cfg.model_dump()

    if req:
        if req.mode is not None:
            test_dict["mode"] = req.mode
        if req.local_path is not None:
            test_dict["local_path"] = req.local_path
        if req.url is not None:
            test_dict["url"] = req.url
        if req.api_key is not None:
            test_dict["api_key"] = req.api_key

    test_cfg = QdrantConfig(**test_dict)
    res = embedding_svc.test_connection(test_cfg)
    return res


@app.get("/api/qdrant/collections")
async def api_get_qdrant_collections():
    """Qdrant 인스턴스에 존재하는 컬렉션 목록 및 현재 기본 컬렉션 반환"""
    cfg = get_qdrant_config()
    conn = embedding_svc.test_connection(cfg)
    return {
        "success": conn.get("success", False),
        "current_collection": cfg.collection_name,
        "collections": conn.get("collections", []),
        "error": conn.get("error"),
    }


def run_embedding_task(chunks_to_embed: List[Dict[str, Any]], custom_col: Optional[str], recreate: Optional[bool]):
    global embed_job_state
    embed_job_state["status"] = "running"
    embed_job_state["progress_msg"] = "임베딩 작업 시작..."
    embed_job_state["progress_pct"] = 5
    embed_job_state["error"] = None
    start_t = time.time()

    def progress_callback(msg: str, pct: float):
        embed_job_state["progress_msg"] = msg
        embed_job_state["progress_pct"] = pct
        embed_job_state["elapsed_time"] = round(time.time() - start_t, 1)

    try:
        cfg = get_qdrant_config()
        if recreate is not None:
            cfg.recreate_collection = recreate
        if custom_col:
            cfg.collection_name = custom_col

        res = embedding_svc.embed_and_upsert(
            child_chunks=chunks_to_embed,
            config=cfg,
            collection_name=custom_col,
            progress_callback=progress_callback,
        )
        embed_job_state["status"] = "done"
        embed_job_state["last_result"] = res
        embed_job_state["progress_pct"] = 100
        embed_job_state["progress_msg"] = f"인덱싱 완료 ({res.get('upserted_count', 0)}개 청크 저장됨)"
        embed_job_state["elapsed_time"] = round(time.time() - start_t, 1)
    except Exception as e:
        embed_job_state["status"] = "error"
        embed_job_state["error"] = str(e)
        embed_job_state["progress_msg"] = f"임베딩 오류: {e}"
        embed_job_state["elapsed_time"] = round(time.time() - start_t, 1)


@app.post("/api/etl/embed")
async def api_embed_chunks(req: EmbedRequest, background_tasks: BackgroundTasks):
    """현재 ETL 청크를 Dense & Sparse로 인코딩하여 Qdrant에 비동기 인덱싱"""
    global latest_etl_result, embed_job_state

    # 인덱싱 대상 청크 추출
    chunks_to_embed = req.chunks
    if not chunks_to_embed:
        if latest_etl_result and "child_chunks" in latest_etl_result:
            chunks_to_embed = latest_etl_result["child_chunks"]
        else:
            found = find_latest_content_list()
            if found:
                file_path, content_list = found
                chunker = HierarchicalChunker(doc_id="doc_asbestos")
                latest_etl_result = chunker.chunk_content_list(
                    content_list, doc_title=file_path.parent.parent.name
                )
                chunks_to_embed = latest_etl_result.get("child_chunks", [])

    if not chunks_to_embed:
        raise HTTPException(
            status_code=400,
            detail="인덱싱할 청크 데이터가 존재하지 않습니다. 먼저 파싱/청킹을 수행해주세요.",
        )

    # 이미 실행 중인 경우 체크
    if embed_job_state["status"] == "running":
        return {
            "success": False,
            "message": "이미 임베딩/인덱싱 작업이 진행 중입니다.",
            "status": "running",
        }

    background_tasks.add_task(
        run_embedding_task,
        chunks_to_embed,
        req.collection_name,
        req.recreate_collection,
    )

    return {
        "success": True,
        "message": f"{len(chunks_to_embed)}개 청크의 인덱싱 작업이 백그라운드에서 시작되었습니다.",
        "total_chunks": len(chunks_to_embed),
        "status": "running",
    }


@app.get("/api/etl/embed/status")
async def api_embed_status():
    """임베딩 및 Qdrant 적재 진행 상태 조회"""
    return embed_job_state


@app.post("/api/etl/search/test")
async def api_search_test(req: SearchRequest):
    """자연어 질의로 Qdrant 하이브리드 RRF 검색 테스트 수행"""
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="검색 쿼리가 비어 있습니다.")

    cfg = get_qdrant_config()
    target_col = req.collection_name or cfg.collection_name

    try:
        results = embedding_svc.hybrid_search(
            query=req.query,
            limit=req.limit or 10,
            config=cfg,
            collection_name=target_col,
        )
        return {
            "success": True,
            "query": req.query,
            "collection_name": target_col,
            "total_matches": len(results),
            "results": results,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"하이브리드 검색 중 오류가 발생했습니다: {str(e)}",
        )


@app.get("/api/etl/export/vectors")
async def api_export_vectors():
    """Dense/Sparse 벡터가 포함된 임베딩 백업 JSON 파일 다운로드"""
    if not EMBEDDED_JSON_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="저장된 벡터 데이터 파일이 없습니다. 먼저 Qdrant 인덱싱을 실행하세요.",
        )

    return FileResponse(
        path=EMBEDDED_JSON_PATH,
        media_type="application/json; charset=utf-8",
        filename="rag_chunks_embedded.json",
    )


# ---------------------------------------------------------
# LLM 텍스트 자동 교정 및 OpenAI 호환 설정 엔드포인트
# ---------------------------------------------------------
class LLMTestRequest(BaseModel):
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    api_key: Optional[str] = None
    timeout: Optional[int] = None


class RefineChunkRequest(BaseModel):
    text: str
    custom_prompt: Optional[str] = None


@app.get("/api/llm/config")
async def api_get_llm_config():
    """현재 저장된 LLM 설정 조회"""
    return get_llm_config()


@app.post("/api/llm/config")
async def api_save_llm_config(config: LLMConfig):
    """LLM 설정 저장 및 영속화"""
    try:
        saved = save_llm_config(config)
        return {"success": True, "config": saved}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM 설정 저장 실패: {str(e)}")


@app.get("/api/llm/config/default-prompt")
async def api_get_default_prompt():
    """기본 시스템 프롬프트 텍스트 조회"""
    return {"default_prompt": get_default_system_prompt()}


@app.get("/api/llm/models")
async def api_get_llm_models(
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
):
    """지정되거나 저장된 LLM 엔드포인트에서 사용 가능한 모델 목록 조회"""
    cfg = get_llm_config()
    if base_url:
        cfg.base_url = base_url
    if api_key is not None:
        cfg.api_key = api_key
    models = await llm_refine_svc.fetch_models(cfg)
    return {"success": True, "models": models}


@app.post("/api/llm/test")
async def api_test_llm_connection(req: Optional[LLMTestRequest] = None):
    """LLM 엔드포인트 연결 테스트"""
    cfg = get_llm_config()
    if req:
        if req.base_url:
            cfg.base_url = req.base_url
        if req.model_name:
            cfg.model_name = req.model_name
        if req.temperature is not None:
            cfg.temperature = req.temperature
        if req.api_key is not None:
            cfg.api_key = req.api_key
        if req.timeout is not None:
            cfg.timeout = req.timeout

    res = await llm_refine_svc.test_connection(cfg)
    return res


@app.post("/api/llm/refine-chunk")
async def api_refine_chunk(req: RefineChunkRequest):
    """단일 청크 텍스트 LLM 자동 교정"""
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="교정할 텍스트가 비어 있습니다.")

    try:
        result = await llm_refine_svc.refine_chunk_text(
            text=req.text,
            custom_prompt=req.custom_prompt,
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"텍스트 교정 중 오류가 발생했습니다: {str(e)}",
        )


