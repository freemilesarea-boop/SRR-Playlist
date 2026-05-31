# Migration 작성 규칙

## 자동 검사

```bash
npm run lint:migrations
```

PR 머지 전 통과 필수. 위반 시 exit code 1.

스크립트: `scripts/lint-migrations.mjs`
대상: `supabase/migrations/*.sql` 전체

---

## Rule: text[] 컬럼/변수 추가 — `array_append` 사용 (필수)

### 문제

PostgreSQL 에서 `text[] || 'literal'` 사용 시:

```
ERROR: malformed array literal: "ai_store_top3_match"
```

`||` 우항이 `text[]` 로 캐스팅되며 중괄호 없는 string 은 array literal 로 파싱 불가.

### ❌ 금지

```sql
v_reason_codes := v_reason_codes || 'ai_store_top3_match';
v_tags := v_tags || ('prefix_' || v_dyn);
```

### ✅ 허용

```sql
-- 단일 값 추가
v_reason_codes := array_append(v_reason_codes, 'ai_store_top3_match');

-- 동적 문자열 추가 (반드시 ::text cast)
v_reason_codes := array_append(v_reason_codes, 'ai_mood_overlap_' || v_n::text);

-- 복수 값 추가
v_reason_codes := array_cat(v_reason_codes, ARRAY['a', 'b']);

-- 명시적 ARRAY[] 형태 (가능하지만 array_append 권장)
v_reason_codes := v_reason_codes || ARRAY['ai_genre_match'];
```

### 검사 패턴

Lint 가 감지하는 변수 suffix:
- `_codes` / `_tags` / `_flags` / `_signals` / `_slugs` / `_keys`
- `_paths` / `_emails` / `_ids` / `_array` / `_arr`

이 외의 array 변수에 사용한 경우는 lint 가 놓칠 수 있음 — 코드 리뷰에서 확인 필요.

### Per-file Opt-out (예외)

이미 별도 hotfix migration 으로 superseded 된 historic migration 은 다음 헤더 추가 가능 (사용 자제, 가능하면 인라인 수정):

```sql
-- lint-disable-file: unsafe-array-concat
-- (이유: 0257 에서 _ai_compute_fit 재정의로 대체됨)
```

---

## 기타 권장 사항

### 1. `CREATE OR REPLACE FUNCTION` 시 파라미터 추가 주의

PostgreSQL 은 파라미터 시그니처가 다르면 **새 overload** 를 생성. `default` 만 추가해도 mismatch.

```sql
-- 0253: 14 params
log_playback_event_v2(p_track_id uuid, ..., p_anonymous_id text);

-- 0254: p_evidence_json 추가 → 새 overload 생성 (오버로드 충돌)
log_playback_event_v2(p_track_id uuid, ..., p_anonymous_id text, p_evidence_json jsonb default null);
```

→ PostgREST RPC 호출 시 "function is not unique" 에러.

**해결**: 구 버전 명시 DROP

```sql
DROP FUNCTION IF EXISTS public.log_playback_event_v2(
  uuid, text, text, numeric, numeric, numeric, numeric, boolean, uuid, uuid, text, text, text, text
);
```

### 2. RPC 호출 시 RLS 와 `SECURITY DEFINER` 선택

- `SECURITY INVOKER`: 사용자 권한으로 실행, RLS policy 통과 필요
- `SECURITY DEFINER`: 함수 정의자 권한으로 실행, RLS 우회
  - admin 함수는 보통 DEFINER + 내부 `auth.uid()` 체크

### 3. `partial unique index` 충돌 방지

```sql
-- unique 제약을 일부 row 만 적용
CREATE UNIQUE INDEX uq_foo_open ON foo (a, b) WHERE status='open';

-- INSERT 시 ON CONFLICT target 명시
INSERT INTO foo (...) VALUES (...)
  ON CONFLICT (a, b) WHERE status='open' DO NOTHING;
```

WHERE 조건 빼면 partial index 와 매치 안 되어 일반 INSERT 가 됨.

### 4. timestamp / interval 계산

```sql
-- 인터벌 안전 cast
now() - (p_window_days || ' days')::interval
```
