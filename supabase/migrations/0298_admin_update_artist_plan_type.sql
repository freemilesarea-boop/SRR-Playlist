-- 0298 — 관리자 수동 plan_type 변경 + audit log (X6.10 Phase 3)
--
-- 단일 사용자에 한해 admin 이 plan_type 을 수동 변경.
-- 기존 계정 일괄 변경 / tracks / artist_profiles / subscription /
-- payment 자동 변경 절대 금지.
--
-- 변경 가능 값:
--   'general_artist'  — 월 5곡, 플리/큐레이터 불가
--   'student_artist'  — 월 50곡, PRO
--   'legacy_student'  — 월 50곡, 기존 운영 보존용 (legacy 명시 라벨)
--   NULL              — legacy (구 동작 그대로)
--
-- 모든 변경은 artist_plan_audit_logs 에 기록.

-- ===== A. artist_plan_audit_logs =====
create table if not exists public.artist_plan_audit_logs (
  id bigserial primary key,
  target_user_id uuid not null references public.users(id) on delete cascade,
  before_plan_type text,
  after_plan_type text,
  admin_user_id uuid references public.users(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_apal_target_created
  on public.artist_plan_audit_logs(target_user_id, created_at desc);
create index if not exists idx_apal_admin_created
  on public.artist_plan_audit_logs(admin_user_id, created_at desc);

alter table public.artist_plan_audit_logs enable row level security;
drop policy if exists "apal admin read" on public.artist_plan_audit_logs;
create policy "apal admin read" on public.artist_plan_audit_logs
  for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. admin_update_artist_plan_type =====
create or replace function public.admin_update_artist_plan_type(
  p_user_id uuid,
  p_plan_type text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_before text;
  v_account_type text;
  v_after text;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  if p_user_id is null then raise exception 'user_id required'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required';
  end if;

  -- 허용값 검증 — 빈 문자열 / 'null' / 'legacy' 는 NULL 로 정규화
  v_after := case
    when p_plan_type is null then null
    when btrim(lower(p_plan_type)) in ('', 'null', 'legacy') then null
    else btrim(p_plan_type)
  end;
  if v_after is not null and v_after not in
       ('general_artist','student_artist','admin','legacy_student') then
    raise exception 'invalid_plan_type: %', v_after;
  end if;

  select plan_type, account_type into v_before, v_account_type
  from public.users where id = p_user_id;
  if not found then raise exception 'user_not_found'; end if;

  -- 단일 사용자만 — 일괄 변경 의도 없음 (RPC 시그니처가 단일 user_id).
  -- 기존 곡 / 정산 / 구독 / artist_profiles 무변경.

  if v_before is not distinct from v_after then
    return jsonb_build_object(
      'ok', true, 'noop', true,
      'user_id', p_user_id,
      'plan_type', v_after,
      'before', v_before
    );
  end if;

  update public.users set plan_type = v_after where id = p_user_id;

  insert into public.artist_plan_audit_logs
    (target_user_id, before_plan_type, after_plan_type, admin_user_id, reason)
  values
    (p_user_id, v_before, v_after, v_admin, btrim(p_reason));

  -- 관리자 일반 audit 로그에도 기록 (있으면)
  begin
    perform public.admin_log_operation(
      'admin_member_actions', 'member', 'info', 'completed',
      format('update artist plan_type %s → %s', coalesce(v_before,'(null)'), coalesce(v_after,'(null)')),
      jsonb_build_object('user_id', p_user_id, 'before', v_before, 'after', v_after, 'reason', p_reason),
      p_user_id, p_user_id::text, null, null, null
    );
  exception when others then null; end;

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'plan_type', v_after,
    'plan_label', case coalesce(v_after, 'legacy')
      when 'general_artist'  then '일반 아티스트'
      when 'student_artist'  then '수강생 아티스트 PRO'
      when 'admin'           then '관리자'
      when 'legacy_student'  then '기존 아티스트 (legacy_student)'
      else                        '기존 아티스트'
    end,
    'monthly_quota', public._plan_monthly_quota(v_after),
    'before', v_before,
    'account_type', v_account_type
  );
end; $$;

-- ===== C. admin_list_artist_plan_audit (특정 사용자의 변경 이력) =====
create or replace function public.admin_list_artist_plan_audit(
  p_user_id uuid, p_limit int default 20
)
returns table(
  id bigint,
  before_plan_type text,
  after_plan_type text,
  admin_user_id uuid,
  admin_email text,
  reason text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select l.id, l.before_plan_type, l.after_plan_type,
         l.admin_user_id, au.email::text, l.reason, l.created_at
  from public.artist_plan_audit_logs l
  left join auth.users au on au.id = l.admin_user_id
  where l.target_user_id = p_user_id
  order by l.created_at desc
  limit greatest(p_limit, 1);
end; $$;

-- ===== D. 권한 =====
revoke all on function public.admin_update_artist_plan_type(uuid,text,text) from public, anon;
revoke all on function public.admin_list_artist_plan_audit(uuid,int) from public, anon;
grant execute on function public.admin_update_artist_plan_type(uuid,text,text) to authenticated, service_role;
grant execute on function public.admin_list_artist_plan_audit(uuid,int) to authenticated, service_role;
