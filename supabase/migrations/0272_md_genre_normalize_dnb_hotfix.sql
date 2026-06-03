-- 0272 — _normalize_genre_for_md Drum & Bass 정규화 갭 수정 (X5.4 hotfix)
--
-- 문제: 'Drum & Bass' → 'drumbass' / 'Drum and Bass' → 'drumandbass' / 'DnB' → 'dnb' 등
--       서로 다른 결과로 정규화. MD seed 'drum_and_bass' (= 'drumandbass') 와 매칭 실패.
--
-- 수정: drum-bass family 통일 substitution 4개 추가
--   1. 'drum [conn] bass' 패턴 → 'drumandbass'
--      (Drum & Bass / Drum and Bass / drum_and_bass / drumbass 등)
--   2. 'dnb' word → 'drumandbass'
--   3. 'd [conn] b' word (D&B) → 'drumandbass'
--
-- 정책: 표준 slug = 'drumandbass' (seed normalize 결과와 동일)
--
-- 카탈로그 영향: 현재 0건. 미래 신규 업로드 (DnB / D&B / Drum & Bass) 매칭 보장.

create or replace function public._normalize_genre_for_md(p text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(coalesce(p, '')),
            -- 0270: R&B family → rnb
            'r[ &]*(and|n)?[ &]*b', 'rnb', 'g'
          ),
          -- 0272: drum-bass family → drumandbass
          'drum[\s&_-]*(and|n)?[\s&_-]*bass', 'drumandbass', 'g'
        ),
        -- 0272: 'dnb' as word → drumandbass
        '\mdnb\M', 'drumandbass', 'g'
      ),
      -- 0272: 'd&b' / 'd b' / 'd-b' / 'd_b' as word → drumandbass
      '\md[\s&_-]+b\M', 'drumandbass', 'g'
    ),
    -- 일반 정리: 남은 separator 제거
    '[-_ &]+', '', 'g'
  );
$$;
