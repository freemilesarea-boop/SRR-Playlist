-- 0512 — 매장 재생 중단 원인 기록 (숙대점 사례에서 드러난 관측 공백)
--
-- 배경 — 숙대점(김가희) 조사에서 세 가지를 겪었다:
--   1) 09-09 06:44 하트비트가 죽고 102분 무음. "탭이 얼었다" 는 추론이었고 증거가 없었다.
--   2) 곡이 20초에 끊긴 세션 272건(109개 서로 다른 곡). **원인을 끝내 특정하지 못했다.**
--   3) 자동재생 차단 화면이 떴지만 직전에 왜 리로드됐는지 알 수 없었다.
--
-- stream_sessions_v2 는 "얼마나 재생됐나" 는 알려주지만 "왜 끊겼나" 는 모른다.
-- 이 테이블은 그 한 줄을 채운다. 매장 무인 운영에서 원인 추정에 시간을 쓰지 않도록.
--
-- 설계 원칙:
--   • 이벤트는 드물다(재생 중단·복구 시점만). 정상 재생 중에는 아무것도 안 쓴다.
--   • 실패해도 재생을 막지 않는다(클라이언트에서 fire-and-forget).
--   • 개인정보 없음 — user_id 와 기술 정보만.

create table if not exists public.store_playback_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- 무슨 일이 있었나
  event text not null check (event in (
    'session_start',      -- 플레이어 진입 (reason 에 리로드 사유)
    'page_frozen',        -- 브라우저가 탭을 얼림 (freeze 이벤트)
    'page_resumed',       -- 얼었던 탭이 깨어남 (resume 이벤트)
    'page_hidden',        -- 백그라운드 전환
    'autoplay_blocked',   -- 자동재생 정책에 막힘
    'autoplay_recovered', -- 화면 터치 등으로 복구
    'track_cut_short',    -- 곡이 끝까지 안 가고 끊김 (원인은 reason)
    'playback_stalled'    -- 재생이 멈춘 채 진행 안 됨
  )),

  -- 왜 — 'sw_update' | 'chunk_error' | 'self_heal' | 'fresh_load' | 'media_error'
  --      | 'network' | 'skip' | 'policy_blocked' | 'preview_limit' | 'unknown'
  reason text,

  -- 맥락 (곡, 경과시간, 오류코드, 네트워크 상태 등)
  context jsonb not null default '{}'::jsonb,

  -- 어느 화면/기기
  player_mode text,                  -- 'store' | 'brand' | 'personal'
  is_native boolean not null default false,
  user_agent text,

  created_at timestamptz not null default now()
);

create index if not exists store_playback_diag_user_idx
  on public.store_playback_diagnostics (user_id, created_at desc);
create index if not exists store_playback_diag_event_idx
  on public.store_playback_diagnostics (event, created_at desc);

alter table public.store_playback_diagnostics enable row level security;

-- 본인 기록만 조회. 관리자는 전체.
drop policy if exists store_diag_select_own on public.store_playback_diagnostics;
create policy store_diag_select_own on public.store_playback_diagnostics
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- 기록은 RPC 로만 (임의 삽입 차단)
create or replace function public.log_store_playback_diagnostic(
  p_event text,
  p_reason text default null,
  p_context jsonb default '{}'::jsonb,
  p_player_mode text default null,
  p_is_native boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_recent int;
begin
  if v_user is null then
    return;                       -- 비로그인은 조용히 무시
  end if;

  -- 폭주 방지: 같은 이벤트가 1분 안에 20건을 넘으면 버린다.
  select count(*) into v_recent
  from public.store_playback_diagnostics d
  where d.user_id = v_user
    and d.event = p_event
    and d.created_at > now() - interval '1 minute';

  if v_recent >= 20 then
    return;
  end if;

  insert into public.store_playback_diagnostics
    (user_id, event, reason, context, player_mode, is_native, user_agent)
  values
    (v_user, p_event, p_reason, coalesce(p_context, '{}'::jsonb), p_player_mode, p_is_native,
     left(coalesce(current_setting('request.headers', true)::jsonb->>'user-agent', ''), 200));
exception when others then
  return;                         -- 진단 기록 실패가 재생을 막아선 안 된다
end;
$$;

revoke all on function public.log_store_playback_diagnostic(text, text, jsonb, text, boolean) from public, anon;
grant execute on function public.log_store_playback_diagnostic(text, text, jsonb, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 운영자용 요약 — "지난 N시간 매장별 중단 원인"
-- ----------------------------------------------------------------------------
create or replace function public.admin_store_playback_interruptions(p_hours int default 24)
returns table (
  user_id uuid,
  nickname text,
  store_name text,
  event text,
  reason text,
  occurrences bigint,
  last_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select d.user_id,
         u.nickname,
         (select fs.store_name from public.franchise_stores fs where fs.store_id = d.user_id limit 1),
         d.event,
         d.reason,
         count(*) as occurrences,
         max(d.created_at) as last_at
  from public.store_playback_diagnostics d
  join public.users u on u.id = d.user_id
  where d.created_at > now() - make_interval(hours => greatest(1, p_hours))
    and d.event <> 'session_start'
  group by d.user_id, u.nickname, d.event, d.reason
  order by max(d.created_at) desc;
$$;

revoke all on function public.admin_store_playback_interruptions(int) from public, anon;
grant execute on function public.admin_store_playback_interruptions(int) to authenticated;

-- 90일 보존 — 진단 데이터가 무한히 쌓이지 않도록
create or replace function public.cron_prune_store_playback_diagnostics()
returns int
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.store_playback_diagnostics
    where created_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::int from deleted;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('srr-prune-playback-diagnostics')
      where exists (select 1 from cron.job where jobname = 'srr-prune-playback-diagnostics');
    perform cron.schedule('srr-prune-playback-diagnostics', '30 19 * * *',
                          'select public.cron_prune_store_playback_diagnostics();');
  end if;
end;
$$;
