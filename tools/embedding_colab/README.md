# 듣다 — Audio Embedding PoC (Mac mini 없이 Colab/로컬 수동 파이프라인)

상시 worker(Mac mini) 도입 전까지, **수동/반자동**으로 OpenL3 임베딩을 생성·검증하는 방법.

## 전체 흐름
```
[관리자 앱]  AI 큐레이션 > 임베딩(PoC) 탭
   ① "embedding_pending.csv 다운로드"
        │  (track_id, audio_url, title, artist, duration)
        ▼
[Colab]  openl3_embedding_poc.ipynb
   ② CSV 업로드 → 각 audio_url 다운로드 → OpenL3 임베딩(512d, 평균풀링+L2)
   ③ generated_embeddings.json 생성/다운로드
        │  [{track_id, model_name, model_version, embedding_dim, embedding:[...]}]
        ▼
[관리자 앱]  임베딩(PoC) 탭
   ④ generated_embeddings.json 업로드 → "dry-run 검증" → "임포트 실행"
        │  (admin_import_track_embeddings: track_id/dim 검증, 실패 row skip)
        ▼
[검증]  recommend_stores_for_track 로 곡↔매장 cosine 유사도 확인
        (자동 추천/차트/정산에는 반영되지 않음 — 관리자 검증용)
```

## ① Export (관리자 앱)
- 관리자 → **AI 큐레이션 → 임베딩(PoC)** 탭 → **embedding_pending.csv 다운로드**.
- 서버 RPC `admin_export_embedding_pending_tracks('openl3', 500)` 결과(임베딩 미보유 공개곡).

## ② Colab 실행
1. `openl3_embedding_poc.ipynb` 를 Colab 에 업로드(또는 열기).
2. 첫 셀: `pip install openl3 soundfile requests numpy` (런타임 1회).
3. `embedding_pending.csv` 를 Colab 에 업로드.
4. 전체 실행 → 각 곡 다운로드 → OpenL3 임베딩 → `generated_embeddings.json` 자동 다운로드.
- **GPU 불필요** (CPU 런타임으로 충분). 곡당 ~3–8초.

## ③→④ Import (관리자 앱)
- 임베딩(PoC) 탭에서 `generated_embeddings.json` 선택.
- **dry-run 검증** → 성공/건너뜀(사유) 확인 → 문제없으면 **임포트 실행**.
- 검증 항목: `track_id` 존재, `embedding` 배열, `embedding_dim == 길이`, model 필드.
- 실패 row 는 건너뛰고 사유 표시. 기존 임베딩은 upsert.

## 보안 / 안전
- **service_role key 를 notebook 에 절대 하드코딩하지 않음.** 임포트는 관리자 앱(관리자 로그인 세션)으로 수행.
- 터미널 임포트가 필요하면 `import_embeddings.py` 사용 (service_role 은 환경변수에서만 읽음).
- 자동 추천/차트/정산에 반영되지 않음. `compute_ai_fit_v2` 는 설계용(라이브 미연동).

## 예상 비용
- Colab 무료 런타임으로 충분(67곡 기준 10~20분 내, 무료). 초과 시 Colab Pro(월 약 $10) 선택적.
- 클라우드 GPU/추가 인프라 비용 0.

## 장단점
- 장점: Mac mini 없이 즉시 PoC, 비용 0, 임베딩 품질은 동일(OpenL3).
- 단점: 수동(신곡마다 export→Colab→import 반복), 상시 자동화 아님. → Mac mini 도입 시 `tools/embedding_worker/worker.py` 로 상시 배치 전환.

## Mac mini 도입 전까지의 운영 방식
1. 신곡이 일정 수(예: 10~20곡) 쌓이면 관리자가 주기적으로 export → Colab → import.
2. 임포트 후 `recommend_stores_for_track` 로 분류 방향성 점검(특히 재즈/라운지 곡이 gym 으로 가지 않는지).
3. 충분히 검증되면 store archetype 시드 확정 → 추후 `compute_ai_fit_v2` soft 연동 검토(자동 공개는 여전히 금지).
