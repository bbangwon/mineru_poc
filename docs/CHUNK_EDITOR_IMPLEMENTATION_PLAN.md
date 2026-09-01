# MinerU RAG ETL Studio: 계층 구조 및 청크 편집 기능 구현 계획서

> **문서 상태**: Draft / Ready to Execute  
> **최초 작성일**: 2026-09-01  
> **대상 프로젝트**: `mineru_poc` (FastAPI + React Vite)  
> **목적**: 세션이 초기화되거나 다른 개발자/AI 에이전트가 투입되어도 연속성을 잃지 않고 단계별로 기능을 구현 및 검증할 수 있도록 기술적 세부사항, 아키텍처, API 명세, 단계별 체크리스트를 기록함.

---

## 1. 배경 및 목적 (Overview & Objective)

### 1.1 배경
* MinerU 파이프라인으로 PDF 문서를 파싱한 후 계층 청킹(`HierarchicalChunker`)을 수행하여 구조화된 부모 섹션(`ParentSection`)과 자식 청크(`ChildChunk`)를 생성하고 있습니다.
* 그러나 실제 운영 환경의 RAG(Retrieval-Augmented Generation) 시스템에서는 자동 파싱 결과물에 다음과 같은 결함이 발생합니다:
  1. 머리글/바닥글(Header/Footer) 오인식 및 오탈자 잔존
  2. 표(Table) 또는 조문(Article) 경계 분할 오류
  3. 특정 청크의 길이가 과도하게 길어 Vector DB 임베딩 토큰 한도를 초과하거나 너무 짧아 의미 맥락 결여
  4. 목차, 면책조항, 도판 설명 등 임베딩할 필요가 없는 노이즈 청크 포함

### 1.2 목적
* 파싱 결과를 단순 열람(View)하는 데 그치지 않고, **실제 임베딩 대상 단위(Chunk)와 문서 계층 구조(Hierarchy)를 직접 검수·수정·분할·병합하고 저장할 수 있는 Human-in-the-Loop 큐레이션 환경**을 구축합니다.
* 사용자의 작업 편의성을 위해 단일 뷰의 복잡도를 낮추고, **좌측 네비게이션 메뉴를 통해 파싱 대시보드와 전용 청크 에디터 스튜디오를 분리**합니다.

---

## 2. 현재 시스템 분석 (Current Baseline)

### 2.1 주요 소스코드 위치
* **백엔드 (FastAPI)**:
  * 엔트리포인트 및 API 라우트: `backend/app/main.py`
  * 계층 청킹 엔진: `backend/app/services/hierarchical_chunker.py`
  * MinerU CLI 래퍼: `backend/app/services/mineru_svc.py`
  * 파싱 결과 저장 경로: `output/`
* **프론트엔드 (React + Vite + Tailwind CSS)**:
  * 메인 앱 컴포넌트: `frontend/src/App.tsx`
  * API 통신 클라이언트: `frontend/src/api/client.ts`
  * 공통 타입 정의: `frontend/src/types/index.ts`
  * 주요 컴포넌트:
    * `frontend/src/components/HierarchyTree.tsx` (문서 목차 트리)
    * `frontend/src/components/ChunkExplorer.tsx` (청크 목록 탐색기)
    * `frontend/src/components/ChunkCard.tsx` (개별 청크 카드 뷰)
    * `frontend/src/components/ControllerBar.tsx` (PDF 선택 및 파싱 실행)
    * `frontend/src/components/Header.tsx` (상단 헤더)

### 2.2 핵심 데이터 모델 (`frontend/src/types/index.ts`)
```typescript
export interface ParentSection {
  id: string;
  title: string;
  level: number;
  parent_section_id?: string;
  breadcrumbs: string[];
  child_chunk_ids: string[];
  full_text: string;
  page_range: [number, number];
}

export interface ChildChunk {
  chunk_id: string;
  parent_id: string;
  chunk_type: 'paragraph' | 'table' | 'article';
  text: string;
  page_number: number;
  breadcrumbs: string[];
  token_estimate: number;
  raw_html?: string;
  table_caption?: string;
  metadata?: Record<string, any>;
  // [확장 예정]: is_ignored?: boolean; is_edited?: boolean;
}
```

---

## 3. 데이터 영속화 전략 (Data Persistence Strategy)

원본 데이터를 훼손하지 않으면서 사용자의 수정 사항을 안전하게 보존하고 원복(Reset)할 수 있도록 설계합니다.

```
output/
  └── mineru_pipeline_auto_korean/
        ├── document_name/
        │     ├── document_name_content_list_v2.json   <-- (원본 파싱 결과, Read-Only)
        │     ├── rag_chunks_edited.json                <-- (사용자 수정본 영속 저장)
        │     └── images/
```

1. **저장 파일 분리**:
   * 파싱 결과 디렉토리 내에 `rag_chunks_edited.json`을 저장합니다.
   * `GET /api/etl/sample` 또는 작업 완료 시 `rag_chunks_edited.json`이 존재하면 수정본을 우선 로드합니다.
2. **원복 기능 (Reset to Original)**:
   * 원본 파싱 결과(`content_list_v2.json`)를 다시 청킹하여 원상 복구할 수 있는 엔드포인트(`POST /api/etl/reset`)를 제공합니다.
3. **JSONL 내보내기 동기화**:
   * `GET /api/etl/export/jsonl` 호출 시 현재 메모리 및 영속화된 수정본 데이터를 기반으로 JSONL을 생성합니다. (임베딩 제외 플래그가 켜진 청크는 자동 필터링)

---

## 4. 단계별 상세 구현 로드맵 (Implementation Phases)

### 📌 Phase 1: 기본 편집 & 저장 파이프라인 (Core Editing & Save)
> **목표**: 기존 UI를 최소한으로 변경하면서 청크 내용 및 부모 섹션 제목 수정, 백엔드 영속 저장, 수정본 JSONL 다운로드 기능 완성.

#### 1. 백엔드 작업
* **엔드포인트 추가 (`backend/app/main.py`)**:
  * `POST /api/etl/save`: 프론트엔드에서 수정한 `EtlResult` 전체를 받아 메모리 갱신 및 파일(`rag_chunks_edited.json`) 저장.
  * `POST /api/etl/reset`: 수정본 파일을 삭제하고 원본 `content_list`로부터 초기 데이터 재청킹.
* **수정본 우선 로드 로직**:
  * `get_sample_etl` 및 파싱 완료 직후 `rag_chunks_edited.json`이 있으면 우선 반환.
* **JSONL 익스포트 갱신**:
  * `is_ignored == True`인 청크는 JSONL 내보내기에서 제외.

#### 2. 프론트엔드 작업
* **타입 확장 (`frontend/src/types/index.ts`)**:
  * `ChildChunk`에 `is_edited?: boolean; is_ignored?: boolean;` 필드 추가.
* **API 클라이언트 함수 추가 (`frontend/src/api/client.ts`)**:
  * `saveEtlResult(data: EtlResult)`
  * `resetEtlResult()`
* **청크 편집 모달 구현 (`frontend/src/components/ChunkEditModal.tsx`)**:
  * 텍스트(Text) 및 표 원형(raw_html) 편집 텍스트에어리어.
  * 부모 섹션 ID 변경 드롭다운.
  * 임베딩 제외 체크박스.
  * 단어(토큰) 수 실시간 카운터.
* **컴포넌트 연동**:
  * `ChunkCard.tsx`: [수정] 버튼 추가, 수정됨(`Edited`) 또는 제외됨(`Ignored`) 배지 표시.
  * `Header.tsx` 또는 `ControllerBar.tsx`: **[수정본 저장]** 버튼 및 **[초기화]** 버튼 추가.

#### ✅ Phase 1 검증 체크리스트
- [x] 특정 청크를 수정한 후 [수정본 저장] 클릭 시 성공 토스트 표시
- [x] 브라우저를 새로고침해도 수정한 텍스트가 유지되는지 확인
- [x] [JSONL 다운로드] 시 수정한 내용이 반영되어 내려받아지는지 확인
- [x] [초기화] 클릭 시 원본 파싱 내용으로 복원되는지 확인

---

### 📌 Phase 2: 사이드바 메뉴 & '청크 에디터 스튜디오' 전용 화면 분리
> **목표**: 좁은 카드 레이아웃을 탈피하여 임베딩 작업에 최적화된 3단 전문 스튜디오 워크스페이스 구축.

```
+---------------------------------------------------------------------------------------+
|  Slim   | [Header] PDF 파일명 / 현재 모드 / 저장 상태 버튼                             |
| Sidebar |-----------------------------------------------------------------------------|
|         | [1. 위계 트리]       | [2. 청크 타임라인 목록]    | [3. 포커스 에디터 패널]       |
|  [대시  | - 섹션 제목 인라인수정  | - 청크 타입별 필터 (표/문단)  | - 선택 청크 텍스트 실시간 편집  |
|   보드] | - 섹션 클릭 시 필터링    | - 임베딩 제외 배지 토글      | - 부모 섹션 재할당 드롭다운     |
|         | - 섹션별 청크 수 표시   | - 단어수/페이지 표기         | - 메타데이터 커스텀 태그 편집   |
|  [청크  |                      |                          | - 실시간 토큰 경고 (800자 초과) |
|  에디터]|                      |                          |                              |
+---------------------------------------------------------------------------------------+
```

#### 1. 네비게이션 및 라우팅 구조
* `frontend/src/components/SidebarNav.tsx` 신설:
  * **Dashboard (대시보드)**: PDF 선택, 파싱 옵션 설정, 상태 카드, 기존 뷰어
  * **Chunk Studio (청크 스튜디오)**: 임베딩 단위 집중 편집 및 큐레이션 전용 화면
* `App.tsx`에서 활성 탭 상태(`activeTab: 'dashboard' | 'studio'`) 관리.

#### 2. 전용 스튜디오 컴포넌트 (`frontend/src/components/ChunkStudio.tsx`)
* **1열 (좌측: 계층 목차 패널)**:
  * 섹션 더블클릭 시 섹션명 인라인 수정 가능
  * 섹션 선택 시 2열의 청크 목록을 해당 섹션 소속으로 자동 필터링
* **2열 (중앙: 청크 타임라인 목록)**:
  * 컴팩트 리스트 뷰로 한눈에 많은 청크 탐색 가능
  * 청크 클릭 시 3열 에디터에 로드
  * 청크 상태(정상 / 수정됨 / 제외됨) 배지 표기
* **3열 (우측: 포커스 에디터 패널)**:
  * 선택된 단일 청크를 집중해서 편집할 수 있는 넓은 에디터 영역
  * 원본 마크다운/HTML 실시간 뷰 & 코드 뷰어 토글
  * 임베딩 메타데이터(커스텀 키-값 태그) 추가 기능

#### ✅ Phase 2 검증 체크리스트
- [ ] 좌측 사이드바로 대시보드와 청크 스튜디오가 매끄럽게 전환되는지 확인
- [ ] 청크 스튜디오에서 청크를 선택했을 때 3열 에디터에 즉시 반영되는지 확인
- [ ] 3열에서 수정한 내용이 2열 목록에 실시간 동기화되는지 확인

---

### 📌 Phase 3: 임베딩 튜닝 고급 도구 (분할/병합/필터링)
> **목표**: 실제 Vector DB 인덱싱을 위한 청크 분할(Split) 및 병합(Merge) 기능 제공.

#### 1. 청크 분할 (Split Chunk)
* **기능**:
  * 길이가 너무 긴 청크의 텍스트 에디터에서 구분자(`\n\n` 또는 사용자가 지정한 위치)를 기준으로 2개의 청크로 분리.
  * 생성되는 신규 청크 ID는 `{원본ID}_split1`, `{원본ID}_split2` 형태로 부여.
  * 부모 섹션(`ParentSection.child_chunk_ids`) 목록도 자동 갱신.

#### 2. 청크 병합 (Merge Chunks)
* **기능**:
  * 2열 목록에서 인접한 2개 이상의 청크를 다중 선택(체크박스) 후 **[병합]** 버튼 클릭.
  * 텍스트를 줄바꿈(`\n\n`)으로 결합하고, `page_number` 범위 병합, 토큰 수 재계산.
  * 병합된 기존 자식 청크들은 삭제 또는 비활성화 처리.

#### 3. 임베딩 적합성 검사 (Token & Quality Linter)
* **기능**:
  * 800 토큰 초과 시 주황색 경고 배지 표시 ("임베딩 분할 권장").
  * 20 토큰 미만의 지나치게 짧은 청크 표시 ("병합 권장").
  * 공백만 있는 빈 청크 자동 검출 및 일괄 정리 기능.

#### ✅ Phase 3 검증 체크리스트
- [ ] 1개 청크 분할 시 2개의 독립된 청크로 정상 생성되고 부모 섹션에 등록되는지 확인
- [ ] 2개 청크 병합 시 텍스트와 토큰 수가 합산되고 ID 정합성이 유지되는지 확인
- [ ] 최종 JSONL 내보내기 시 분할/병합된 상태가 정확히 반영되는지 확인

---

## 5. API 명세서 (API Specification)

### 5.1 `POST /api/etl/save`
* **설명**: 사용자가 편집한 ETL 결과 전체를 백엔드에 영속 저장.
* **Request Body**: `EtlResult` (JSON)
* **Response**:
```json
{
  "success": true,
  "message": "수정본이 성공적으로 저장되었습니다.",
  "saved_at": 1772522739.12,
  "total_chunks": 42
}
```

### 5.2 `POST /api/etl/reset`
* **설명**: 수정본(`rag_chunks_edited.json`)을 제거하고 원본 파싱 결과로 리셋.
* **Request Body**: `{ "doc_id": "doc_xxxx" }`
* **Response**: 원본 파싱 결과 기반의 `EtlResult`

### 5.3 `GET /api/etl/export/jsonl`
* **설명**: 저장된 수정본 데이터를 RAG 임베딩 표준 NDJSON 파일로 다운로드.
* **필터링 규칙**: `is_ignored == true`인 청크는 제외하고 반환.

---

## 6. 세션 인수인계 가이드 (Handoff Guide for AI/Developer)

새로운 세션이 시작되었을 때 아래 순서대로 진행 상황을 파악하고 작업을 이어가면 됩니다.

1. **상태 확인 명령**:
   * 백엔드 저장 API 존재 여부 확인: `backend/app/main.py`에서 `/api/etl/save` 검색
   * 프론트엔드 편집 컴포넌트 확인: `frontend/src/components/ChunkEditModal.tsx` 또는 `ChunkStudio.tsx` 존재 여부 확인
2. **진행 단계 확인**:
   * Phase 1 미완료 상태인 경우: Phase 1 체크리스트의 백엔드 API 및 편집 모달부터 착수.
   * Phase 1 완료 상태인 경우: Phase 2 (사이드바 메뉴 및 전용 스튜디오 분리) 착수.
   * Phase 2 완료 상태인 경우: Phase 3 (분할/병합 고급 기능) 착수.
3. **실행 및 테스트 방법**:
   * 백엔드 실행: `uvicorn backend.app.main:app --reload --port 8000`
   * 프론트엔드 실행: `cd frontend && npm run dev`
