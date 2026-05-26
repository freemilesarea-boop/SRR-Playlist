-- Rollback for 0195_sales_agent_free_trial.sql
-- 전부 additive 였으므로 롤백 = 신규 객체 제거 + 신규 컬럼 제거.
-- 기존 데이터(users 행/구독/결제)는 건드리지 않음. 신규 컬럼 drop 시 해당 컬럼 값만 사라짐.
-- 실행 전 반드시 free_trial_redemptions 백업 권장 (체험 이력 보존이 필요하면).

begin;

drop function if exists public.salesperson_my_trial_stats();
drop function if exists public.admin_list_free_trials(integer, text);
drop function if exists public.admin_end_trial(uuid, text);
drop function if exists public.admin_extend_trial(uuid, integer);
drop function if exists public.expire_free_trials();
drop function if exists public.get_my_trial_status();
drop function if exists public.start_sales_agent_trial(text);
drop function if exists public._normalize_phone(text);

drop table if exists public.free_trial_redemptions;
drop table if exists public.free_trial_config;

alter table public.users
  drop column if exists free_trial_started_at,
  drop column if exists free_trial_ends_at,
  drop column if exists trial_source,
  drop column if exists trial_sales_agent_id,
  drop column if exists is_trial_active,
  drop column if exists playback_enabled;

commit;
