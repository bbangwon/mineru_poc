# MinerU RAG ETL Studio

**MinerU (OpenDataLab)** 엔진을 활용한 **RAG(Retrieval-Augmented Generation) 전용 문서 ETL 및 부모-자식(Parent-Child) 계층 청킹 플랫폼**입니다.

Apple Silicon(Mac M-series)의 **MLX/Metal** 하드웨어 가속 환경에서 고속 구동됩니다.

---

## 🚀 RAG ETL 핵심 기능

1. **부모-자식 계층 청킹 (Hierarchical / Parent-Child Chunking)**:
   - MinerU의 Heading `level`과 레이아웃 메타데이터를 파싱하여 `[문서 > 상위 장 > 하위 절]` 계층 트리 자동 구성
   - **부모 섹션(Parent Chunk)**: LLM 생성 컨텍스트용 거시적 섹션 전체 문맥
   - **자식 청크(Child Chunk)**: 검색 및 임베딩용 정밀 문단/표 단위 (약 100~300 토큰)
2. **원형 100% 무손실 표(Atomic Table) 보존**:
   - 표를 토큰 수 기준으로 임의 절단하지 않고 하나의 완전한 엔티티(`<table>...</table>`)로 캡슐화
   - MinerU가 크롭한 고해상도 표 이미지 경로 및 `bbox`, 페이지 메타데이터 자동 연결
   - 추후 RAG 인덱싱 시 **Multi-Vector / 요약 인덱싱** 전략 지원
3. **표준 RAG JSONL 원클릭 익스포트**:
   - LangChain, LlamaIndex, Pinecone, Chroma, Milvus, Qdrant 등에 즉시 적재 가능한 표준 JSONL 파일 다운로드 (`/api/etl/export/jsonl`)
4. **인터랙티브 청크 뷰어 & 문서 트리 탐색기**:
   - 좌측 문서 헤딩 트리 클릭 시 해당 부모 섹션의 자식 청크만 실시간 필터링
   - 표 원형 렌더링 확인 및 실시간 단일 JSONL 레코드 인스펙터 제공
5. **동적 PDF 업로드 & 맞춤 파싱**:
   - 상단 툴바에서 새 PDF 업로드 및 페이지 범위/엔진 선택 후 실시간 파싱 실행

---

## 🚀 빠른 시작

### 1. 웹 스튜디오 실행 (FastAPI + React SPA)
```bash
./run.sh
```
- 웹 UI: [http://localhost:8001](http://localhost:8001) (`frontend/dist` React 앱이 자동 빌드되어 서빙됩니다.)

### 2. 프론트엔드 실시간 개발 모드 (Vite HMR)
```bash
cd frontend
npm run dev
```
- 프론트엔드 HMR 개발 서버: [http://localhost:5173](http://localhost:5173) (FastAPI 백엔드로 자동 API 프록시)

### 3. 주요 API 엔드포인트
- `GET /api/pdf/list`: 문서 목록 조회
- `POST /api/pdf/upload`: 신규 PDF 업로드
- `POST /api/pdf/select`: 활성 PDF 변경
- `POST /api/etl/parse`: MinerU 파싱 & 계층 청킹 실행
- `GET /api/etl/sample`: 현재 로드된 ETL 청크 결과 조회
- `GET /api/etl/export/jsonl`: RAG 표준 JSONL 다운로드
- `GET /api/pdf`: 활성 원본 PDF 뷰

---

## 📚 개발 및 고도화 문서
- [계층 구조 및 청크 편집 기능 구현 계획서](docs/CHUNK_EDITOR_IMPLEMENTATION_PLAN.md)

