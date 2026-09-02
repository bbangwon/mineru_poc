# MinerU RAG ETL: 3단계 계층 구조(Section - Parent - Child) 청킹 엔진 구현 계획서

> **문서 상태**: Draft / Ready to Execute (Greenfield Refactoring)  
> **작성일**: 2026-09-02  
> **대상 프로젝트**: `mineru_poc` (FastAPI + React Vite)  
> **설계 원칙**: **구버전 데이터 하위 호환성 배제(Clean Slate)**. 레거시 어댑터를 제거하고 단일 진실 공급원(Single Source of Truth) 기반의 정규 3단계(`Section` - `Parent` - `Child`) 계층 아키텍처 구축.  
> **목적**: RAG 검색과 생성에 최적화된 3단계 계층 구조, 문장·조항·표 보존 분할 규칙, 수동 큐레이션(분할/병합/상위 섹션 재지정), 그리고 대용량 문서 운영 엣지 케이스 가드레일을 완비한 상세 계획 수립.

---

## 1. 배경 및 필요성 (Background & Objective)

### 1.1 기존 2단계 구조의 한계
현재 시스템은 `ParentSection`(목차 트리)과 `ChildChunk`(텍스트/표/조문)의 2단계로 동작합니다.
1. **검색과 생성의 딜레마**:
   * `ChildChunk`를 작게 나누면 검색 유사도(Retrieval Recall)는 올라가지만 LLM에게 주입할 전후 문맥(Context)이 부족해 환각(Hallucination)이 발생합니다.
   * 반대로 문맥을 확보하기 위해 청크를 크게 잡으면(예: 조문 전체, 긴 문단) 임베딩 벡터가 희석되어 정밀 검색 성능이 저하됩니다.
   * `ParentSection.full_text`는 섹션 내 전체 텍스트를 단순 병합한 것으로, 수천~수만 토큰에 달해 LLM 프롬프트에 직접 넣기 부적합합니다.
2. **Small-to-Big Retrieval 부재**:
   * 최신 RAG 표준 기법인 "작은 단위로 검색(Small Retrieval)하고, 상위 문맥 단위로 답변 생성(Big Generation)"을 지원하기 위한 중간 버퍼 레이어가 결여되어 있습니다.

### 1.2 3단계 계층 구조 목표
* **Section (Level 1)**: 문서의 장/절/헤딩 메타데이터 (네비게이션, 브레드크럼, 필터링)
* **Parent Chunk (Level 2, ~2048 토큰)**: 완성도 높은 문맥을 담은 블록 (LLM 프롬프트 주입용 Context)
* **Child Chunk (Level 3, ~512 토큰)**: 문장 단위로 정밀하게 분할된 청크 (Vector DB 임베딩 및 키워드 검색용)
* **표(Table) 원자성 보존**: 표는 행/열 구조가 깨지지 않도록 중간 절단 없이 통째로 보존
* **인간 큐레이션(Human-in-the-Loop) 완벽 보존**:
  * 기존 수동 분할(Split), 병합(Merge) 동작 유지 (Child 조작 시 Parent 자동 동기화)
  * 자동 파서의 오인식 교정을 위한 **Parent의 상위 섹션 재지정(Reassign Section)** 기능 제공

---

## 2. 계층 아키텍처 및 토큰 규격

```
========================================================================================
[ Level 1: Section ] (목차 / 거시 계층)
  - 식별자: d_xxxx_s01, s02 ...
  - 대상: 문서 제목, 제1장, 제2절, 부칙, 별표 등 헤딩 트리 구조
  - 역할: 네비게이션, 브레드크럼 제공, Vector DB 메타데이터 필터링 (where section == '총칙')
========================================================================================
       │
       ▼ (소속)
========================================================================================
[ Level 2: Parent Chunk ] (문맥 / 중간 계층)
  - 식별자: d_xxxx_p001, p002 ...
  - 목표 크기: 최대 2048 토큰 (Soft limit ~2048, 단일 대형 표 예외 허용)
  - 대상: 서브섹션 본문, 조문 전체(제N조 및 항·호 묶음), 연관 문단 그룹
  - 역할: LLM 답변 생성 시 프롬프트로 주입되는 풍부한 전후 맥락(Context Window)
========================================================================================
       │
       ▼ (포함: 1 Parent -> N Children)
========================================================================================
[ Level 3: Child Chunk ] (검색 / 미시 계층)
  - 식별자: d_xxxx_c001, c002 ...
  - 목표 크기: 최대 512 토큰 (표 제외)
  - 대상: 1~3개 문장 블록, 개별 항·호, 원자적 표(Atomic Table)
  - 역할: Vector DB 벡터 임베딩, BM25 키워드 검색 (정밀 유사도 매칭)
========================================================================================
```

---

## 3. 핵심 텍스트 분할 & 표 보존 알고리즘

### 3.0 한국어 토큰 추정 보정 공식 (Korean-Aware Token Estimation)
* **문제점**: 공백 기준 어절 수(`len(text.split())`)는 한국어의 형태소 결합 및 서브워드(BPE/cl100k) 특성을 반영하지 못해 실제 LLM 토큰 수 대비 약 2~2.5배 과소평가되는 심각한 오차가 발생합니다.
* **표준 공식**:
  $$\text{token\_estimate} = \max\left(\left\lfloor \frac{\text{len(text)}}{2.0} \right\rfloor, \lfloor \text{len(text.split())} \times 2.2 \rfloor \right)$$
* **적용**: 512 / 2048 토큰 패킹 및 린터 계산 시 위 보정식을 전면 적용하여 LLM 컨텍스트 윈도우 초과를 사전에 원천 차단합니다.

### 3.1 문장 및 조항 보존 우선순위 분할 (Sentence & Clause Splitting)
텍스트가 문맥 중간에서 어색하게 잘려 의미가 왜곡되지 않도록 **우선순위 기반 분할 규칙**을 적용합니다.

1. **0순위 (법률 조항 분할 - Legal 모드)**:
   * 항 번호 경계: `(?=\n?\s*[①-⑳])`
   * 호 번호 경계: `(?=\n?\s*\d+\.\s)` 및 `(?=\n?\s*[가-하]\.\s)`
   * MinerU가 조문 전체를 단일 문단으로 추출하더라도 항·호 단위로 정밀 분할하여 Child로 패킹.
2. **1순위 (단락 경계)**: `\n\n` (빈 줄을 포함한 단락 분리)
3. **2순위 (줄바꿈 경계)**: `\n` (목록 항목, 개조식 줄바꿈)
4. **3순위 (문장 종결 기호)**: 
   * 한국어 종결어미: `(?<=(?:다|음|함|임|됨)\.)\s+` (단, 인용부호 `".다."` 및 괄호 `(다.)` 보존)
   * 영문/공통: `(?<=[.!?])\s+(?=[^0-9])` (단, `3.14%` 등 소수점 오분할 방지)
5. **최후의 수단 (절/구분 기호)**: `, `, `; `, 공백 ` ` (단일 문장이 512 토큰을 초과하는 극단적 예외 시에만 적용)

### 3.2 512 토큰 패킹 (Child Chunk Packing)
* 텍스트를 위 우선순위 기호로 쪼개어 '문장/조항 단위 리스트'를 생성합니다.
* 순차적으로 누적하면서 `current_tokens + next_sentence_tokens <= 512`를 만족할 때까지 결합합니다.
* 512 토큰을 넘는 시점에 현재 청크를 확정하고 새 청크를 시작합니다.
* 문장 간 연결 시 원본의 공백/줄바꿈 서식을 그대로 보존합니다.

### 3.3 2048 토큰 패킹 (Parent Chunk Packing)
* 동일 섹션(`Section`) 내의 인접한 `Child Chunk`들을 순서대로 누적합니다.
* `parent_tokens + child_tokens <= 2048` 한도 내에서 하나의 `Parent Chunk`로 바인딩합니다.
* 2048 토큰을 초과하면 새 `Parent Chunk`를 생성하여 다음 Child들을 수용합니다.

### 3.4 표(Table) 원자성(Atomic) 보존 및 듀얼 필드(Dual-Field) 규칙
1. **중간 절단 금지**: 표(HTML Table, Markdown)는 행 단위로 쪼개지 않고 무조건 **단일 독립 Child Chunk**로 유지합니다.
2. **Child 512 토큰 예외 허용**: 표 내용이 512 토큰을 초과하더라도 억지로 자르지 않고 원형을 유지하며 `is_atomic_table: true` 플래그를 부여합니다.
3. **Parent 2048 토큰 수용**:
   * 표 크기가 2048 토큰 미만인 경우: 앞뒤 설명 문단과 함께 같은 Parent로 묶여 문맥을 보존합니다.
   * 표 크기가 2048 토큰을 초과하는 초대형 표인 경우: 해당 표만을 위한 **독립 Parent Chunk로 단독 승격**하여 다른 문단들이 강제로 잘리지 않도록 보호합니다.
4. **듀얼 필드(Dual-Field) 검색 최적화**:
   * 초대형 표(3,000~5,000 토큰)가 소형 임베딩 모델(512/1024 한도)에서 강제 절단(Truncation)되는 문제를 방지하기 위해:
   * `raw_html`: 원본 HTML 테이블 구조를 무손실 보존 (LLM 프롬프트 주입 및 브라우저 렌더링용)
   * `text`: `[표: {캡션}] 컬럼: {컬럼목록} | 상위 주요 행 데이터...` 형태의 검색 친화적 요약 텍스트를 구성하여 Vector DB 임베딩 수행.

---

## 4. 인간 큐레이션(Human-in-the-Loop) 기능 보존 및 확장

기존 2단계 에디터에서 사용하던 편집 기능들을 3단계에서도 완전무결하게 유지하고 고도화합니다.

### 4.1 수동 분할 (Split Chunk)
* **사용자 작업**: 기존처럼 우측 타임라인에서 Child 청크의 [분할] 버튼 클릭.
* **시스템 자동 처리**:
  1. 대상 Child $C_1$이 $C_{1a}, C_{1b}$로 분할됨.
  2. $C_{1a}, C_{1b}$는 $C_1$의 `parent_chunk_id`와 `section_id`를 그대로 승계.
  3. 상위 Parent의 `child_chunk_ids` 배열에서 $C_1$을 `[C_{1a}, C_{1b}]`로 자동 치환하고 Parent 텍스트 갱신.

### 4.2 수동 병합 (Merge Chunks)
* **사용자 작업**: 인접한 Child 청크 2개 이상 선택 후 [병합] 클릭.
* **시스템 자동 처리**:
  * **동일 Parent 내 병합**: Parent의 자식 목록에서 선택된 ID들을 단일 병합 ID로 교체하고 Parent 텍스트 갱신.
  * **다른 Parent 간 병합**: 앞선 Parent로 귀속시키고, 뒤쪽 Parent의 자식 목록에서 제외 후 양쪽 Parent 토큰 수 재계산.
  * **빈 Parent 자동 정리(Auto-pruning)**: 병합으로 인해 자식 Child가 0개가 된 뒤쪽 Parent는 자동으로 삭제 처리(Garbage Collection).

### 4.3 ★ 상위 섹션 재지정 (Reassign Parent's Section)
자동 파싱 시 헤딩 인식 오차로 인해 특정 Parent 덩어리가 잘못된 섹션(장·절)에 포함된 경우 이를 바로잡는 핵심 기능입니다.

```
[ 기존 오류 상태 ]
제1장 총칙 (s01)
  └── Parent (p002) ── [Child c005, c006, c007]  (실제 내용은 제2장의 조항)

     ▼ 사용자가 p002의 상위 섹션을 "제2장 채권 (s02)"로 재지정

[ 수정 완료 상태 ]
제2장 채권 (s02)
  └── Parent (p002) ── [Child c005, c006, c007]
      * 하위 Child c005~c007의 브레드크럼 및 섹션 메타데이터 원클릭 일괄 동기화!
```

* **동작 상세**:
  1. `Parent.section_id`를 `s01` $\rightarrow$ `s02`로 변경.
  2. 섹션 `s01`의 `parent_chunk_ids`에서 `p002` 제거, 섹션 `s02`에 `p002` 추가.
  3. 소속된 모든 하위 Child(`c005, c006, c007`)의 `breadcrumbs`와 `section_id`를 신규 섹션 정보로 **연쇄 자동 갱신(Cascading Sync)**.
  4. 사용자는 Child를 하나씩 옮길 필요 없이, Parent 단위 1회 작업으로 수십 개 청크의 소속을 한 번에 정정 가능.

### 4.4 3단계 린터 (Linter) 및 토큰 가이드
* **Child 린터 (512 기준)**:
  * 512 토큰 초과 텍스트 청크: "분할 권장(Over-limit)" 경고 배지 표시 (표는 제외)
  * 20 토큰 미만 청크: "병합 권장(Under-limit)" 경고 배지 표시
* **Parent 린터 (2048 기준)**:
  * 2048 토큰 초과 시 "Parent 문맥 비대" 알림 및 원클릭 Parent 분할 보조 제공

### 4.5 문서 물리적 순서 기반 ID 일괄 재정렬 (Re-index Sequence Rule)
* 섹션 재지정이나 수동 분할/병합으로 인해 ID 번호가 불연속해진 경우, [전체 ID 재정렬]을 통해 `s01~`, `p001~`, `c001~`을 순차적으로 다시 채번합니다.
* **정렬 기준**: **문서 원본의 물리적 등장 순서(Page & Block Position)**를 최우선 기준으로 정렬하여, PDF 원본 탐색 및 LLM 생성 시 문맥의 인과관계를 완벽히 보존합니다.

---

## 5. 핵심 운영 엣지 케이스 및 가드레일 (Operational Guardrails)

실제 서비스 운영 및 대용량 문서 청킹 시 발생할 수 있는 5가지 리스크와 방어 메커니즘을 정의합니다.

### 5.1 [파싱] 단일 블록 통짜 조문 묶임 방어
* **현상**: MinerU 파서가 조문 전체(`제12조 ... ① ... ② ... 1. ...`)를 분리하지 않고 단일 `paragraph` 블록으로 추출하는 경우.
* **가드레일**: `legal` 전략 실행 시 단락 분할에 앞서 항 번호(`[①-⑳]`) 및 호 번호(`\d+\.\s`, `[가-하]\.\s`) 경계를 사전 분할하여, 조문이 최소 2~3개의 Child로 적절히 분산 수용되도록 강제합니다.

### 5.2 [편집] 고아 Parent(Dangling Parent) 방어
* **현상**: Child 병합이나 삭제로 인해 특정 Parent 아래에 소속된 Child가 0개가 되는 경우.
* **가드레일**: 프론트엔드 상태 변경 핸들러에서 `child_chunk_ids.length === 0`인 Parent를 감지하여 자동으로 `parent_chunks` 및 상위 섹션의 `parent_chunk_ids`에서 즉시 소멸시킵니다(Auto-pruning).

### 5.3 [정렬] 섹션 재지정과 물리적 순서의 무결성
* **현상**: 뒤쪽 페이지의 Parent를 앞쪽 섹션으로 재지정했을 때의 순서 뒤섞임.
* **가드레일**: 섹션 재지정은 **'논리적 트리 및 메타데이터'** 관계만 변경하며, 청크의 **'물리적 페이지 번호 및 문서 읽기 순서'**는 왜곡하지 않습니다. Re-index 역시 물리적 순서를 보존하여 RAG 프롬프트 조립 시 시간/순서 역전 현상을 방지합니다.

### 5.4 [임베딩] 초대형 표(3,000+ 토큰)와 소형 임베딩 모델(512/1024) 충돌 방어
* **현상**: 표 원자성 보존으로 인해 수천 토큰의 표가 단일 청크로 승격될 경우, 사내 구축형 소형 임베딩 모델의 Context Limit을 초과하여 뒷부분 데이터가 임의 Truncation되는 문제.
* **가드레일**: Child 청크의 `raw_html`에는 원본 전체를 무손실 보존하되, Vector DB 적재용 `text` 필드에는 `[표 캡션 + 헤더 스키마 + 상위 핵심 행 요약]` 텍스트를 별도 생성하여 512 토큰 한도 내에서 안전하게 고밀도 임베딩되도록 보장합니다.

### 5.5 [성능] 100+ 페이지 대용량 문서(1,000+ 청크) 렌더링 최적화
* **현상**: 2열 타임라인에서 1,000개 이상의 청크 카드를 한 번에 DOM에 그릴 때 발생하는 브라우저 프리징(Lag).
* **가드레일**:
  1. `ChunkStudio` 진입 시 기본 필터를 '전체 보기'가 아닌 **'첫 번째 유효 섹션 자동 선택'**으로 지정하여 초기 렌더링 카드를 20~30개로 억제.
  2. 전체 보기 모드 선택 시 50개 단위 가상화/페이지네이션을 적용하여 부드러운 스크롤을 보장.

---

## 6. 데이터 모델 및 스키마 명세

### 6.1 프론트엔드 TypeScript 모델 (`frontend/src/types/index.ts`)

```typescript
// 1. Section (목차 노드)
export interface SectionNode {
  id: string;                      // 예: "d_xxxx_s01"
  title: string;                   // "제1장 총칙"
  level: number;                   // 1 (장), 2 (절), 3 (관) ...
  parent_section_id?: string;      // 상위 섹션 참조
  breadcrumbs: string[];           // ["규정집", "제1장 총칙"]
  parent_chunk_ids: string[];      // 소속된 Parent 청크 ID 목록
  page_range: [number, number];
}

// 2. Parent Chunk (문맥/컨텍스트 단위, ~2048 tokens)
export interface ParentChunk {
  parent_chunk_id: string;         // 예: "d_xxxx_p001"
  section_id: string;              // 소속 섹션 ID ("d_xxxx_s01")
  title?: string;                  // 서브섹션명 또는 "제1조(목적)"
  text: string;                    // LLM 주입용 결합 문맥 텍스트 (~2048 토큰)
  token_estimate: number;
  child_chunk_ids: string[];       // 소속된 Child 청크 ID 목록
  page_range: [number, number];
  is_edited?: boolean;
}

// 3. Child Chunk (검색/임베딩 단위, ~512 tokens or Atomic Table)
export interface ChildChunk {
  chunk_id: string;                // 예: "d_xxxx_c001"
  parent_chunk_id: string;         // 소속 Parent 청크 ID ("d_xxxx_p001")
  section_id: string;              // 소속 Section ID ("d_xxxx_s01")
  chunk_type: 'paragraph' | 'table' | 'article_clause';
  text: string;                    // 검색/임베딩 대상 텍스트 (~512 토큰 or 표 요약)
  token_estimate: number;
  page_number: number;
  page_end?: number;
  breadcrumbs: string[];           // ["제1장 총칙", "제1조(목적)"]
  raw_html?: string;               // 표 원형 보존
  table_caption?: string;
  is_table?: boolean;
  is_edited?: boolean;
  is_ignored?: boolean;            // Vector DB 임베딩 제외 플래그
  metadata?: Record<string, any>;
}

// 4. 전체 ETL 결과 컨테이너
export interface HierarchicalEtlResult {
  doc_id: string;
  doc_title: string;
  strategy: 'general' | 'legal' | string;
  stats: {
    total_sections: number;
    total_parent_chunks: number;
    total_child_chunks: number;
    paragraph_chunks: number;
    table_chunks: number;
    total_words: number;
  };
  sections: SectionNode[];
  parent_chunks: ParentChunk[];
  child_chunks: ChildChunk[];
}
```

### 6.2 RAG 표준 JSONL 출력 포맷 (`export_to_jsonl`)

Vector DB 및 하이브리드 검색 엔진(Elasticsearch/OpenSearch/Milvus/Chroma)에 적재되는 최종 레코드 규격:

```json
{
  "id": "d_a1b2_c005",
  "parent_chunk_id": "d_a1b2_p002",
  "section_id": "d_a1b2_s01",
  "section_title": "제1장 총칙",
  "breadcrumbs": ["취업규칙", "제1장 총칙", "제3조(적용범위)"],
  "breadcrumbs_str": "취업규칙 > 제1장 총칙 > 제3조(적용범위)",
  
  "text": "제1항 이 규칙은 회사의 모든 정규직 및 계약직 근로자에게 적용한다.",
  "parent_context_text": "[취업규칙 > 제1장 총칙 > 제3조(적용범위)]\n제3조(적용범위) ① 이 규칙은 회사의 모든 정규직 및 계약직 근로자에게 적용한다.\n② 수습기간 중인 자에 대하여는 본 규칙 제2장을 준용한다.",
  
  "chunk_type": "paragraph",
  "is_atomic_table": false,
  "page": 2,
  "pages": [2],
  "token_estimate": 28,
  "parent_token_estimate": 115,
  "metadata": {
    "doc_title": "취업규칙",
    "section": "제1장 총칙",
    "page": 2
  }
}
```
* **핵심 이점**: Vector DB 임베딩은 `text`로 수행하고, 검색된 후 LLM 생성 프롬프트에는 `parent_context_text`를 주입함으로써 **Small-to-Big Retrieval을 100% 실현**.

---

## 7. 단계별 상세 구현 로드맵 (Phases)

### 📌 Phase 1: 백엔드 3단계 청킹 엔진 & 문장/표 보존기 구현 (완료)
> **목표**: `backend/app/services/hierarchical_chunker.py`를 리팩토링하여 2048/512 토큰 기준 3단계 청킹 엔진 완성.

* [x] **한국어 토큰 추정기 & 문장/조항 분할 유틸리티 구현**:
  * `len(text) // 2` 보정 추정식 탑재 (`estimate_korean_tokens`).
  * `legal` 전략용 항 번호(`[①-⑳]`) 및 호 번호 분리기 작성 (`split_text_into_units`).
  * 단락(`\n\n`), 개조식 줄바꿈(`\n`), 종결어미(`다.`, `음.`, `함.`) 기반 정규식 분리기 작성.
* [x] **Child 패킹 엔진 (`_pack_to_child_chunks`)**:
  * 문장을 순차적으로 누적하여 512 토큰 한도 내로 Child 생성.
  * 표(`table`) 블록 감지 시 분할을 건너뛰고 단독 Child(`is_atomic_table=True`)로 패킹.
  * 표 검색을 위한 `raw_html`과 요약 `text` 듀얼 필드 동시 생성 (`generate_table_search_text`).
* [x] **Parent 패킹 엔진 (`_pack_to_parent_chunks`)**:
  * 동일 Section 내의 Child들을 누적하여 2048 토큰 한도 내로 Parent 생성.
  * 표가 2048을 초과하는 경우 독립 Parent로 단독 승격.
* [x] **법률/규정(legal) & 일반(general) 전략 통합**:
  * `legal`: 장·절 $\rightarrow$ Section / 조문 $\rightarrow$ Parent / 항·호·표 $\rightarrow$ Child
  * `general`: H1~H2 $\rightarrow$ Section / H3 또는 문단군 $\rightarrow$ Parent / 세부문장군·표 $\rightarrow$ Child
* [x] **Re-index 알고리즘 확장**:
  * `reindex_etl_result`에서 물리적 문서 순서 기반 `s01`, `p001`, `c001` 3개 계층 ID 및 양방향 참조 일괄 재정렬.
* [x] **JSONL 익스포트 함수 확장**:
  * `parent_context_text` 필드 추가 (Small-to-Big Retrieval 100% 지원).

### 📌 Phase 2: 수동 편집 & 상위 섹션 재지정 핸들러 구현
> **목표**: 프론트엔드 상태 관리(`App.tsx`)에 3단계 계층 동기화 로직 및 섹션 재지정 기능 구현.

* [ ] **타입 정의 업데이트 (`frontend/src/types/index.ts`)**:
  * `SectionNode`, `ParentChunk`, `ChildChunk`, `HierarchicalEtlResult` 인터페이스 정의.
* [ ] **Child 분할/병합 핸들러 업데이트**:
  * Child 분할 시 상위 `parent_chunk_id` 자동 승계 및 Parent 텍스트 실시간 재계산.
  * Child 병합 시 소속 Parent 관계 정합성 유지 및 **자식 0개 Parent 자동 삭제(Auto-pruning)**.
* [ ] **★ Parent 상위 섹션 재지정 핸들러 (`handleReassignParentSection`)**:
  * `(parentChunkId: string, newSectionId: string) => void` 구현.
  * 하위 Child 전체의 `breadcrumbs` 및 `section_id` 연쇄 갱신(Cascading Sync).
* [ ] **프론트엔드 Re-index 유틸리티 (`idUtils.ts`)**:
  * 물리적 순서 기준 `s01`, `p001`, `c001` 일괄 재정렬 로직 구현.
* [ ] **린터(Linter) 기준값 업데이트**:
  * Child 512 토큰 초과 / 20 토큰 미만 검사.
  * Parent 2048 토큰 초과 검사.

### 📌 Phase 3: 청크 스튜디오 UI 고도화 및 시각화
> **목표**: 3단계 계층을 직관적으로 탐색하고 제어할 수 있는 3단 에디터 UI 제공.

* [ ] **1열 (계층 목차 트리)**:
  * Section 노드 하위에 소속 Parent 개수 및 Child 개수 뱃지 표기.
* [ ] **2열 (타임라인 목록)**:
  * Parent Chunk 단위로 그룹 테두리(Container Box)를 렌더링하고, 그 내부에 소속 Child 카드들을 배치.
  * Parent 헤더에 `[소속 섹션: 제1장 총칙 ▾]` 빠른 변경 드롭다운 배치.
  * 초기 진입 시 첫 번째 섹션을 기본 활성화하여 1,000+ 청크 렌더링 부하 방어.
* [ ] **3열 (포커스 에디터 & 모달)**:
  * `ChunkEditModal` 및 포커스 에디터에 '상위 Parent 정보' 및 '소속 섹션 재지정' 셀렉터 반영.
  * 표(Table) 원형 렌더링 및 512 토큰 초과 시에도 "표 원형 보존 상태" 정상 뱃지 부여.
* [ ] **전체 플로우 E2E 테스트**:
  * PDF 파싱 $\rightarrow$ 3단계 청킹 자동 생성 $\rightarrow$ 수동 분할/병합 $\rightarrow$ 상위 섹션 재지정 $\rightarrow$ JSONL 다운로드 검증.

---

## 8. 검증 및 테스트 체크리스트 (Verification)

| 항목 | 검증 기준 | 확인 방법 |
| :--- | :--- | :--- |
| **조문/문장 보존 분할** | 조문 내 항(`①, ②`) 경계 및 문장 종결 부호에서 정확히 분할되는가? | 생성된 Child 청크 텍스트 첫 문장과 끝 문장 검사 |
| **토큰 한도 준수** | 한국어 보정식 기준으로 Child는 512 이하, Parent는 2048 이하로 적절히 패킹되는가? | 통계 카드 및 린터 경고 0건 확인 |
| **표 원자성 보존** | 표 HTML 태그가 분할되지 않고 독립 청크로 보존되며 검색용 요약 텍스트가 존재하는가? | `chunk_type == 'table'` 청크의 `raw_html` 및 `text` 검사 |
| **수동 분할/병합 & Auto-prune** | Child를 분할/병합해도 상위 Parent 텍스트가 동기화되며, 빈 Parent는 자동 소멸하는가? | 스튜디오에서 분할/병합 실행 후 Parent 표시 및 개수 확인 |
| **상위 섹션 재지정** | Parent의 섹션을 바꿨을 때 하위 모든 Child의 브레드크럼이 일괄 갱신되는가? | 섹션 변경 후 Child 브레드크럼 및 JSONL 미리보기 확인 |
| **물리적 순서 Re-index** | ID 재정렬 시 섹션 재지정과 무관하게 문서 물리적 등장 순서대로 정렬되는가? | 재정렬 후 `page_number` 순차 배열 검사 |
| **JSONL RAG 적재** | 검색용 `text`와 생성용 `parent_context_text`가 정상 분리 적재되는가? | 내보낸 JSONL 파일의 필드 구조 확인 |

---

## 9. 인수인계 가이드 (Developer Handoff)

* **파일 위치**:
  * 백엔드 청킹 엔진: `backend/app/services/hierarchical_chunker.py`
  * 백엔드 API: `backend/app/main.py`
  * 프론트엔드 타입: `frontend/src/types/index.ts`
  * 프론트엔드 ID 유틸: `frontend/src/utils/idUtils.ts`
  * 프론트엔드 메인: `frontend/src/App.tsx`
  * 프론트엔드 스튜디오: `frontend/src/components/ChunkStudio.tsx`
* **개발 시작점**:
  1. `hierarchical_chunker.py`의 한국어 토큰 추정기, 조항/문장 분리기, `_pack_to_child_chunks`, `_pack_to_parent_chunks` 함수를 먼저 작성하고 단위 테스트 수행.
  2. 프론트엔드 `types/index.ts` 및 `idUtils.ts`를 신규 규격으로 갱신하고 `App.tsx`의 동기화 핸들러 연결.

