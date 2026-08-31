-- ============================================================================
-- Phase ARTIST-BILLING-SECURITY-HARDENING-0468
-- 0467에서 추가된 SECURITY DEFINER 함수의 실행 권한(EXECUTE)만 최소화한다.
--
-- 이 마이그레이션은 권한(GRANT/REVOKE)만 조정한다. 기능·정책·트리거·Entitlement·
-- RLS·Storage·PayApp·Scheduler·데이터는 일절 변경하지 않는다. 함수 본문(CREATE OR
-- REPLACE) 재정의 없음 → 동작·API Response·UI 무변경.
--
-- 배경(감사 결과):
--   Supabase 기본 권한(ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS
--   TO anon, authenticated, service_role) 과 PostgreSQL 기본 PUBLIC EXECUTE 로
--   인해 0467 신규 SECURITY DEFINER 함수 6종이 anon 을 포함한 모든 Role 에서
--   /rest/v1/rpc/* 로 실행 가능했다. 특히 artist_billing_access_detail(uuid) 는
--   임의 uuid 의 결제 '상태'(active/cancelled/unpaid/expired…)를 익명 조회할 수
--   있어 상태 열람 노출면이 존재했다.
--
-- 최소 권한 결정(실호출 위치 기준 — 0468 감사표):
--   • artist_has_paid_access(uuid), _is_artist_account(uuid)
--       RLS 정책(tracks_artist_insert/tracks_artist_update_pending/taq_self_insert
--       /storage audio_authed_write/covers_authed_write)에서 authenticated 역할이
--       직접 평가·실행한다 → authenticated + service_role 유지, PUBLIC/anon 제거.
--       (트리거·정의자 RPC 내부 호출은 정의자=postgres 컨텍스트라 별도 grant 불필요.)
--   • get_artist_billing_access(), record_artist_billing_denial(text,text)
--       클라이언트(authenticated) 가 supabase.rpc 로 호출하는 진입점이며 내부에서
--       auth.uid() 로 '본인' 것만 판정/기록한다 → authenticated + service_role 유지,
--       PUBLIC/anon 제거.
--   • artist_billing_access_detail(uuid)
--       RLS 미참조·클라이언트 직접 호출 없음. get_artist_billing_access() 및
--       record_artist_billing_denial() (둘 다 SECURITY DEFINER, owner=postgres)
--       내부에서만 호출되어 정의자 권한으로 실행된다 → service_role 만 유지,
--       PUBLIC/anon/authenticated 제거. (정의자 내부 호출은 영향 없음.)
--   • _tg_artist_tracks_billing_guard()
--       BEFORE INSERT/UPDATE 트리거 전용 함수. 트리거 발화는 EXECUTE 권한과
--       무관하다 → 모든 Role 에서 EXECUTE 제거.
--
-- 안전성: authenticated 의 RLS/RPC 실행 권한을 그대로 유지하므로 활성 결제
--   아티스트(허용)·제한 아티스트(차단) 동작은 0467 과 100% 동일. anon 은 애초에
--   해당 쓰기/RPC 경로를 사용하지 않으므로 정상 흐름 회귀 없음.
-- 멱등: REVOKE/GRANT 는 반복 적용 안전.
-- ============================================================================

-- (1) artist_has_paid_access(uuid) — RLS + 트리거/정의자 내부. authenticated/service_role.
revoke execute on function public.artist_has_paid_access(uuid) from public;
revoke execute on function public.artist_has_paid_access(uuid) from anon;
grant  execute on function public.artist_has_paid_access(uuid) to authenticated, service_role;

-- (2) _is_artist_account(uuid) — RLS(taq/storage). authenticated/service_role.
revoke execute on function public._is_artist_account(uuid) from public;
revoke execute on function public._is_artist_account(uuid) from anon;
grant  execute on function public._is_artist_account(uuid) to authenticated, service_role;

-- (3) get_artist_billing_access() — 클라이언트 RPC(auth.uid, 본인). authenticated/service_role.
revoke execute on function public.get_artist_billing_access() from public;
revoke execute on function public.get_artist_billing_access() from anon;
grant  execute on function public.get_artist_billing_access() to authenticated, service_role;

-- (4) record_artist_billing_denial(text,text) — 클라이언트 RPC(auth.uid, 본인). authenticated/service_role.
revoke execute on function public.record_artist_billing_denial(text, text) from public;
revoke execute on function public.record_artist_billing_denial(text, text) from anon;
grant  execute on function public.record_artist_billing_denial(text, text) to authenticated, service_role;

-- (5) artist_billing_access_detail(uuid) — 정의자 RPC 내부 전용. service_role 만.
revoke execute on function public.artist_billing_access_detail(uuid) from public;
revoke execute on function public.artist_billing_access_detail(uuid) from anon;
revoke execute on function public.artist_billing_access_detail(uuid) from authenticated;
grant  execute on function public.artist_billing_access_detail(uuid) to service_role;

-- (6) _tg_artist_tracks_billing_guard() — 트리거 전용. 실행 권한 불필요(모든 Role 제거).
revoke execute on function public._tg_artist_tracks_billing_guard() from public;
revoke execute on function public._tg_artist_tracks_billing_guard() from anon;
revoke execute on function public._tg_artist_tracks_billing_guard() from authenticated;
revoke execute on function public._tg_artist_tracks_billing_guard() from service_role;
