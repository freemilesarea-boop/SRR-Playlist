-- 0070 — artist_profiles ↔ users.artist_approval_status 자동 sync + 기존 불일치 복구
--
-- 배경:
-- 0062 에서 한 번 sync 복구를 수행했으나, 그 이후에도 일부 row 가 다시 깨짐:
--   artist_profiles.approval_status='approved' 인데 users.artist_approval_status='pending'
-- 결과:
--   - get_artist_upload_eligibility 가 'approval_sync_broken' reason 반환
--   - ensure_artist_contract_for_user 가 'not approved' 예외 → 400
--   - 사용자는 화면에 "관리자 승인 대기" 표시
--
-- 조치:
-- 1) artist_profiles UPDATE trigger 추가 — approval_status 변경 시 users 자동 동기화
-- 2) 현재 불일치 row 일괄 복구 (artist_profiles 진실의 원천)
-- 3) ensure_artist_contract_for_user 강화 — approval_sync_broken 분기 명시
--
-- 정책:
-- - 자동 승인 X: artist_profiles.approval_status='approved' 인 경우만 users 갱신
--   (관리자가 의도적으로 approve 했음을 신호하므로 sync 보정은 정당)
-- - rejected/pending 도 동일하게 sync

create or replace function public._sync_users_artist_approval_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.approval_status is distinct from coalesce(OLD.approval_status, '') then
    update public.users
      set artist_approval_status = NEW.approval_status
    where id = NEW.user_id
      and coalesce(artist_approval_status, '') is distinct from NEW.approval_status;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_sync_users_artist_approval on public.artist_profiles;
create trigger trg_sync_users_artist_approval
  after insert or update of approval_status on public.artist_profiles
  for each row execute function public._sync_users_artist_approval_status();

WITH mismatched AS (
  SELECT u.id
  FROM public.users u
  JOIN public.artist_profiles ap ON ap.user_id = u.id
  WHERE u.account_type = 'artist'
    AND coalesce(u.artist_approval_status, '') IS DISTINCT FROM coalesce(ap.approval_status, '')
)
UPDATE public.users u
SET artist_approval_status = ap.approval_status
FROM public.artist_profiles ap
WHERE u.id = ap.user_id
  AND u.account_type = 'artist'
  AND coalesce(u.artist_approval_status, '') IS DISTINCT FROM coalesce(ap.approval_status, '');

create or replace function public.ensure_artist_contract_for_user()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_account_type text;
  v_users_approval text;
  v_profile_approval text;
  v_tier text;
  v_template_version text;
  v_template_title text;
  v_template_body text;
  v_existing_id uuid;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  -- 모든 컬럼 alias 명시 (ambiguity 차단)
  select u.account_type, u.artist_approval_status, u.membership_tier
    into v_account_type, v_users_approval, v_tier
  from public.users u where u.id = v_uid;

  select ap.approval_status into v_profile_approval
  from public.artist_profiles ap where ap.user_id = v_uid;

  if v_account_type is null then
    raise exception 'user not found';
  end if;
  if v_account_type <> 'artist' then
    raise exception 'not artist account (account_type=%)', v_account_type;
  end if;

  -- approval_sync_broken 케이스 명시 — 자동 보정은 0070 trigger 가 책임
  if coalesce(v_users_approval, 'pending') <> 'approved' then
    if coalesce(v_profile_approval, '') = 'approved' then
      raise exception 'approval_sync_broken (users=% / profile=approved) — admin must re-run approve_artist_profile', coalesce(v_users_approval,'pending');
    end if;
    raise exception 'not approved (status=%)', coalesce(v_users_approval,'pending');
  end if;

  if coalesce(v_tier, 'free') <> 'individual' then
    raise exception 'not paid (tier=%)', coalesce(v_tier,'free');
  end if;

  select c.id into v_existing_id
  from public.artist_contracts c
  where c.artist_user_id = v_uid
    and c.status in ('pending_signature','signed')
  order by c.created_at desc limit 1;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select tpl.version, tpl.title, tpl.body
    into v_template_version, v_template_title, v_template_body
  from public.contract_templates tpl where tpl.is_active = true limit 1;
  if v_template_version is null then
    raise exception 'no active contract template — admin must seed via admin_seed_contract_template';
  end if;

  insert into public.artist_contracts (
    artist_user_id, contract_version, contract_title, contract_body,
    status, pending_signature_at, created_by
  ) values (
    v_uid, v_template_version, v_template_title, v_template_body,
    'pending_signature', now(), v_uid
  ) returning id into v_new_id;

  update public.users
    set contract_status = case when contract_status = 'signed' then 'signed' else 'pending_signature' end
  where id = v_uid;

  return v_new_id;
end;
$function$;

grant execute on function public.ensure_artist_contract_for_user() to authenticated;

NOTIFY pgrst, 'reload schema';
