# 듣다 — CLAP 임베딩 파이프라인 (Colab)

`laion-clap-music-v1` (512-dim) 으로 트랙 임베딩 + 매장 아키타입을 생성해
Supabase 에 적재하는 수동 batch 파이프라인.

## 무엇이 되는가
1. **트랙 임베딩**: 미적재 트랙의 오디오 30초 segment 를 다운로드 → CLAP 임베딩 → `track_embeddings` 적재
2. **매장 아키타입**: 27개 store_key 각각의 한국어 description 을 CLAP **텍스트** 임베딩으로 변환 → `store_archetype_embeddings` 적재
   - CLAP 은 텍스트-오디오 contrastive 학습이라 두 임베딩이 같은 공간 — 텍스트 prompt 로 매장 정의 가능
3. **결과**: `recommend_stores_for_track`, `recommend_clap_for_playlist` RPC 가 정상 작동 → fit_score 의 audio_score 가 dead 50 → 실제 매칭 점수로

## 실행 환경 — Colab

### 1. 노트북 생성
[Colab](https://colab.research.google.com/) → "새 노트북" → 런타임 → "런타임 유형 변경" → **GPU (T4)**

> CPU 만 가능하나 ~3배 느림. T4 무료 GPU 면 841 트랙 ~20분.

### 2. Colab Secrets (좌측 열쇠 아이콘) 에 등록
- `SUPABASE_URL` = `https://nsoesrvwkxqifjcxzvol.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = (Vercel 환경변수 또는 Supabase Dashboard → API → service_role secret)

### 3. 스크립트 복사
`notebooks/clap_embedding_pipeline.py` 의 각 섹션을 Colab 셀로 분할 복사.
또는 한 셀에 전체 붙여넣고 함수 호출만 분리.

### 4. 단계별 실행

```python
# 셀 1: 의존성 설치 (2~3분, 1회만)
# Colab 기본 torch + 추가 패키지만 — pin 회피로 Python 3.12 호환성 확보 (X6.56)
!pip install -q transformers librosa soundfile requests
```

```python
# 셀 2: 인증 + 클라이언트 초기화
from google.colab import userdata
import os
SUPABASE_URL = userdata.get('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = userdata.get('SUPABASE_SERVICE_ROLE_KEY')
```

```python
# 셀 3: 모델 로드 (1~2분)
from clap_embedding_pipeline import load_clap_model
model = load_clap_model()
```

```python
# 셀 4: 트랙 임베딩 batch (~20분, 841 트랙 기준)
from clap_embedding_pipeline import process_track_batch
result = process_track_batch(model, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, limit=1000)
print(result)  # {imported, skipped, errors}
```

```python
# 셀 5: 매장 아키타입 (수초)
from clap_embedding_pipeline import build_store_archetypes_from_text
result = build_store_archetypes_from_text(model, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
print(result)  # {built: 27}
```

```python
# 셀 6: fit_score 재계산 트리거 (관리자 화면에서도 가능)
# AiCurationPanel → 매장 학습/AI 검수 큐 탭에서 "전체 재계산" 클릭
```

## 검증

- Supabase Dashboard → Table editor → `track_embeddings` 행 수 확인
- AiCurationPanel → 임베딩(PoC) 탭 → 상태 패널에서 `track_embeddings` / `store_archetypes` / `embedding_dim=512` 표시 확인
- 임의 트랙 클릭 → `recommend_stores_for_track` 호출 → TOP 5 매장 점수 확인

## 비용
- 모델 다운로드: ~1.5GB (1회)
- GPU 시간: T4 무료, 약 20분/배치
- 모든 결과는 JSON → service_role key 로 RPC 호출
- **0원**

## 향후 자동화 시
- 현재: 수동 (월 1~2회 신곡 batch). 신규 트랙 ~10건 미만/월 일 때 충분.
- 신곡 페이스가 일 10건+ 되면 Edge Function + HuggingFace Inference API 로 자동화 검토.
