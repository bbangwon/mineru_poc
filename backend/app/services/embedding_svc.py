import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

# 패키지 경로를 sys.path에 등록하여 서브프로세스 및 uvicorn 환경 호환 보장
_PKG_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "packages" / "rag_embed_core"
if _PKG_ROOT.exists() and str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

from rag_embed_core import (
    DenseEncoder,
    KiwiSparseEncoder,
    QdrantConfig,
    QdrantManager,
    SparseVector,
)
from backend.app.services.qdrant_config_svc import get_qdrant_config

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
OUTPUT_DIR = BASE_DIR / "output"
EMBEDDED_JSON_PATH = OUTPUT_DIR / "rag_chunks_embedded.json"

# 싱글톤 인코더 캐시
_kiwi_encoder: Optional[KiwiSparseEncoder] = None
_dense_encoder: Optional[DenseEncoder] = None


def get_sparse_encoder() -> KiwiSparseEncoder:
    global _kiwi_encoder
    if _kiwi_encoder is None:
        logger.info("KiwiSparseEncoder 싱글톤 인스턴스 초기화")
        _kiwi_encoder = KiwiSparseEncoder()
    return _kiwi_encoder


def get_dense_encoder(config: Optional[QdrantConfig] = None) -> DenseEncoder:
    global _dense_encoder
    cfg = config or get_qdrant_config()
    if _dense_encoder is None or _dense_encoder.model_name != cfg.dense_model_name:
        logger.info(f"DenseEncoder 싱글톤 인스턴스 초기화 (모델: {cfg.dense_model_name})")
        _dense_encoder = DenseEncoder(
            model_name=cfg.dense_model_name,
            device=cfg.device,
            lazy_load=True,
        )
    return _dense_encoder


class EmbeddingService:
    """ETL 청크 하이브리드 임베딩 및 Qdrant 색인/검색 오케스트레이션 서비스"""

    def __init__(self):
        pass

    def get_manager(self, config: Optional[QdrantConfig] = None) -> QdrantManager:
        cfg = config or get_qdrant_config()
        return QdrantManager(config=cfg)

    def test_connection(self, config: Optional[QdrantConfig] = None) -> Dict[str, Any]:
        manager = self.get_manager(config)
        return manager.test_connection()

    def embed_and_upsert(
        self,
        child_chunks: List[Dict[str, Any]],
        parent_chunks: Optional[List[Dict[str, Any]]] = None,
        config: Optional[QdrantConfig] = None,
        collection_name: Optional[str] = None,
        progress_callback: Optional[Callable[[str, float], None]] = None,
    ) -> Dict[str, Any]:
        """자식 청크 목록을 Dense & Sparse 인코딩하고 Qdrant에 저장합니다."""
        start_time = time.time()
        cfg = config or get_qdrant_config()
        target_col = collection_name or cfg.collection_name
        manager = self.get_manager(cfg)

        if not child_chunks:
            return {
                "success": False,
                "error": "인덱싱할 청크 데이터가 비어 있습니다.",
                "total_chunks": 0,
                "upserted_count": 0,
            }

        # 제외 플래그(is_ignored)가 설정된 청크 필터링
        active_chunks = [c for c in child_chunks if not c.get("is_ignored")]
        if not active_chunks:
            return {
                "success": False,
                "error": "인덱싱 대상 청크가 모두 제외(is_ignored) 상태입니다.",
                "total_chunks": 0,
                "upserted_count": 0,
            }

        if progress_callback:
            progress_callback("형태소 분석 및 Sparse 벡터 생성 중...", 10)

        sparse_enc = get_sparse_encoder()
        dense_enc = get_dense_encoder(cfg)

        # 텍스트 추출 (text 필드 우선, 없을 경우 content 필드)
        texts = [c.get("text") or c.get("content") or "" for c in active_chunks]

        # 1. Sparse 인코딩
        sparse_vecs = sparse_enc.encode_documents(texts)

        if progress_callback:
            progress_callback("Dense 임베딩 모델 로드 및 벡터 추출 중 (BGE-m3-ko)...", 30)

        # 2. Dense 인코딩
        dense_vecs = dense_enc.encode_texts(
            texts,
            batch_size=cfg.batch_size,
            show_progress_bar=False,
        )

        if progress_callback:
            progress_callback(f"Qdrant 컬렉션 준비 및 데이터 적재 중 ({len(active_chunks)}개)...", 70)

        # 부모 청크 매핑 테이블 구성
        parent_map: Dict[str, Dict[str, Any]] = {}
        if parent_chunks:
            for p in parent_chunks:
                pid = p.get("parent_chunk_id") or p.get("id")
                if pid:
                    parent_map[pid] = p

        # 3. Qdrant 포인트 구성
        points: List[Dict[str, Any]] = []
        embedded_export_data: List[Dict[str, Any]] = []

        for i, chunk in enumerate(active_chunks):
            cid = chunk.get("chunk_id") or f"chunk_{i:04d}"
            sp_vec = sparse_vecs[i]
            dn_vec = dense_vecs[i]

            pid = chunk.get("parent_chunk_id") or chunk.get("parent_id") or ""
            # chunk 자체에 parent_text가 있으면 우선 채택, 없으면 parent_map에서 조회
            p_text = chunk.get("parent_text")
            if not p_text and pid and pid in parent_map:
                p_text = parent_map[pid].get("text", "")
            p_text = p_text or ""

            # 페이지 정보 정규화
            page_start = chunk.get("page_number") or chunk.get("page") or 1
            page_end = chunk.get("page_end") or page_start
            page_idx = (page_start - 1) if isinstance(page_start, int) and page_start > 0 else chunk.get("page_idx", 0)

            # 목차/계층 정보 정규화
            breadcrumbs = chunk.get("breadcrumbs") or chunk.get("heading_hierarchy") or []

            # 토큰 수 정규화
            token_count = chunk.get("token_estimate") or chunk.get("token_count") or 0

            payload = {
                "chunk_id": cid,
                "doc_id": chunk.get("doc_id", ""),
                "parent_chunk_id": pid,
                "parent_text": p_text,
                "section_id": chunk.get("section_id", ""),
                "chunk_type": chunk.get("chunk_type", "text"),
                "title": chunk.get("title") or chunk.get("table_caption") or "",
                "page_number": page_start,
                "page_end": page_end,
                "page_idx": page_idx,
                "breadcrumbs": breadcrumbs,
                "heading_hierarchy": breadcrumbs,  # 기존 호환성 유지
                "text": texts[i],
                "token_count": token_count,
                "token_estimate": token_count,
                "char_length": len(texts[i]),
                "raw_html": chunk.get("raw_html"),
                "table_caption": chunk.get("table_caption"),
                "table_footnote": chunk.get("table_footnote"),
                "table_type": chunk.get("table_type"),
                "is_table": bool(chunk.get("is_table") or chunk.get("chunk_type") == "table"),
                "is_atomic_table": bool(chunk.get("is_atomic_table")),
                "image_path": chunk.get("image_path"),
                "image_url": chunk.get("image_url"),
                "metadata": chunk.get("metadata") or {},
            }

            points.append({
                "id": cid,
                "dense_vector": dn_vec,
                "sparse_vector": sp_vec,
                "payload": payload,
            })

            # 내보내기용 직렬화 데이터 (JSON 호환)
            embedded_export_data.append({
                "chunk_id": cid,
                "dense_vector_dim": len(dn_vec),
                "sparse_indices_count": len(sp_vec.indices),
                "sparse_indices": sp_vec.indices,
                "sparse_values": sp_vec.values,
                "payload": payload,
            })

        # 컬렉션 생성 (recreate 여부 반영)
        manager.init_collection(target_col, recreate=cfg.recreate_collection)

        # 포인트 업서트
        upserted_count = manager.upsert_points(
            points,
            collection_name=target_col,
            batch_size=cfg.batch_size,
        )

        # 4. JSON 파일 저장
        try:
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            with open(EMBEDDED_JSON_PATH, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "collection_name": target_col,
                        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "total_chunks": len(points),
                        "chunks": embedded_export_data,
                    },
                    f,
                    ensure_ascii=False,
                    indent=2,
                )
        except Exception as e:
            logger.warning(f"임베딩 JSON 파일 저장 실패: {e}")

        elapsed = round(time.time() - start_time, 2)

        if progress_callback:
            progress_callback(f"인덱싱 완료! ({upserted_count}개 적재 완료, 소요시간: {elapsed}초)", 100)

        return {
            "success": True,
            "collection_name": target_col,
            "total_chunks": len(child_chunks),
            "upserted_count": upserted_count,
            "elapsed_time": elapsed,
            "dense_dim": len(dense_vecs[0]) if dense_vecs else 0,
            "export_file": str(EMBEDDED_JSON_PATH.name),
        }

    def hybrid_search(
        self,
        query: str,
        limit: int = 10,
        config: Optional[QdrantConfig] = None,
        collection_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """사용자 자연어 쿼리로 Qdrant RRF 하이브리드 검색을 수행합니다."""
        if not query or not query.strip():
            return []

        cfg = config or get_qdrant_config()
        manager = self.get_manager(cfg)
        target_col = collection_name or cfg.collection_name

        sparse_enc = get_sparse_encoder()
        dense_enc = get_dense_encoder(cfg)

        q_sparse = sparse_enc.encode_query(query)
        q_dense = dense_enc.encode_text(query)

        search_results = manager.search_hybrid(
            query_dense=q_dense,
            query_sparse=q_sparse,
            limit=limit,
            collection_name=target_col,
        )

        formatted_results: List[Dict[str, Any]] = []
        for rank, res in enumerate(search_results, start=1):
            p = res.payload or {}
            formatted_results.append({
                "rank": rank,
                "id": res.id,
                "score": round(res.score, 6),
                "chunk_id": p.get("chunk_id", res.id),
                "parent_chunk_id": p.get("parent_chunk_id", ""),
                "parent_text": p.get("parent_text", ""),
                "section_id": p.get("section_id", ""),
                "text": p.get("text", ""),
                "title": p.get("title", ""),
                "page_number": p.get("page_number", (p.get("page_idx", 0) + 1)),
                "page_end": p.get("page_end", p.get("page_number", (p.get("page_idx", 0) + 1))),
                "page_idx": p.get("page_idx", 0),
                "chunk_type": p.get("chunk_type", "text"),
                "breadcrumbs": p.get("breadcrumbs") or p.get("heading_hierarchy", []),
                "heading_hierarchy": p.get("heading_hierarchy") or p.get("breadcrumbs", []),
                "token_count": p.get("token_count", 0),
                "token_estimate": p.get("token_estimate", p.get("token_count", 0)),
                "raw_html": p.get("raw_html"),
                "table_caption": p.get("table_caption"),
                "table_footnote": p.get("table_footnote"),
                "is_table": p.get("is_table", False),
                "image_url": p.get("image_url"),
                "metadata": p.get("metadata", {}),
                "payload": p,
            })

        return formatted_results


embedding_svc = EmbeddingService()
