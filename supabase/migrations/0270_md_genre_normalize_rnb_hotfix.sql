# 0270 — _normalize_genre_for_md R&B 정규화 버그 수정 (X5.4 hotfix)
#
# 문제: regexp_replace(lower(p), '[-_ &]+', '', 'g') 는 'R&B' → 'rb' 로 처리.
#       MD 정책 'rnb' 와 매칭 실패 → winebar R&B 18건, hotel R&B 3건 등 false positive.
#
# 수정: r [&n and] b 패턴을 먼저 'rnb' 로 치환한 후 일반 정리.
#       - R&B / R & B / R and B / RnB / rnb → rnb
#       - K-R&B → krnb (보존)
#       - Rock / Rap / Reggaeton 등 영향 없음 (r 다음 매칭 패턴 다름)

create or replace function public._normalize_genre_for_md(p text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(
    regexp_replace(
      lower(coalesce(p, '')),
      'r[ &]*(and|n)?[ &]*b', 'rnb', 'g'
    ),
    '[-_ &]+', '', 'g'
  );
$$;
