-- 0195 — 아티스트 유통 컴플라이언스 게이트 + 전수 감사 플래그. 자동 조치 없음(플래그/관리자 검수).
create table if not exists public.track_compliance_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, track_id uuid not null,
  flag_type text not null check (flag_type in ('missing_artist_profile','missing_contract','missing_payout_account','missing_payment','invalid_user_role','released_without_compliance')),
  severity text not null default 'high' check (severity in ('critical','high','medium')),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  reason text, detected_at timestamptz not null default now(),
  resolved_by uuid, resolved_at timestamptz, admin_note text,
  unique (track_id, flag_type)
);
create index if not exists idx_tcf_status on public.track_compliance_flags(status, flag_type);
alter table public.track_compliance_flags enable row level security;
drop policy if exists tcf_admin_read on public.track_compliance_flags;
create policy tcf_admin_read on public.track_compliance_flags for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- 유통 가능 여부 (중앙 게이트). hard: 프로필+승인+계약(signed)+정산계좌(verified). 결제는 soft.
create or replace function public.can_artist_release(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_missing text[] := '{}'; v_payment boolean; v_approved text;
begin
  select artist_approval_status into v_approved from public.users where id = p_user_id;
  if not exists (select 1 from public.artist_profiles ap where ap.user_id = p_user_id) then v_missing := array_append(v_missing, 'artist_profile'); end if;
  if coalesce(v_approved,'pending') <> 'approved' then v_missing := array_append(v_missing, 'artist_approval'); end if;
  if not exists (select 1 from public.artist_contracts c where c.artist_user_id = p_user_id and c.status='signed') then v_missing := array_append(v_missing, 'contract'); end if;
  if not exists (select 1 from public.artist_payout_accounts pa where pa.user_id = p_user_id and pa.verification_status='verified') then v_missing := array_append(v_missing, 'payout_account'); end if;
  v_payment := exists (select 1 from public.payment_orders po where po.user_id=p_user_id and po.status='paid')
            or exists (select 1 from public.subscriptions s where s.user_id=p_user_id and s.status='active');
  return jsonb_build_object('ok', (array_length(v_missing,1) is null), 'missing', to_jsonb(v_missing), 'payment_completed', v_payment,
    'message', case when array_length(v_missing,1) is null then '유통 가능' else '아티스트 계약/정산/프로필 정보가 완료되지 않아 음원을 유통할 수 없습니다.' end);
end; $$;
grant execute on function public.can_artist_release(uuid) to authenticated;

-- 전수 감사: 유통 곡 중 위반 플래그 생성(자동 조치 없음).
create or replace function public.admin_scan_track_compliance()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_comp jsonb; v_missing text[]; v_payment boolean; v_n int := 0;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in select t.id, t.owner_user_id from public.tracks t
    where t.source_type='artist_upload' and t.removed_at is null and t.release_status in ('released','approved','scheduled')
  loop
    v_comp := public.can_artist_release(r.owner_user_id);
    v_missing := array(select jsonb_array_elements_text(v_comp->'missing'));
    v_payment := (v_comp->>'payment_completed')::boolean;
    if 'artist_profile' = any(v_missing) then insert into public.track_compliance_flags(user_id, track_id, flag_type, severity, reason) values (r.owner_user_id, r.id, 'missing_artist_profile','critical','아티스트 프로필 없음') on conflict (track_id, flag_type) do nothing; v_n:=v_n+1; end if;
    if 'contract' = any(v_missing) then insert into public.track_compliance_flags(user_id, track_id, flag_type, severity, reason) values (r.owner_user_id, r.id, 'missing_contract','critical','계약 미완료') on conflict (track_id, flag_type) do nothing; v_n:=v_n+1; end if;
    if 'payout_account' = any(v_missing) then insert into public.track_compliance_flags(user_id, track_id, flag_type, severity, reason) values (r.owner_user_id, r.id, 'missing_payout_account','high','정산 계좌 미등록/미검증') on conflict (track_id, flag_type) do nothing; v_n:=v_n+1; end if;
    if not v_payment then insert into public.track_compliance_flags(user_id, track_id, flag_type, severity, reason) values (r.owner_user_id, r.id, 'missing_payment','medium','결제/구독 내역 없음(정책 미정)') on conflict (track_id, flag_type) do nothing; v_n:=v_n+1; end if;
    if array_length(v_missing,1) is not null then insert into public.track_compliance_flags(user_id, track_id, flag_type, severity, reason) values (r.owner_user_id, r.id, 'released_without_compliance','critical', '유통 중 컴플라이언스 미충족: '||array_to_string(v_missing,',')) on conflict (track_id, flag_type) do nothing; v_n:=v_n+1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'flags_upserted', v_n);
end; $$;
grant execute on function public.admin_scan_track_compliance() to authenticated;
