-- 0320 — 관리자 음원 검수/유통 KPI RPC (X6.31)
--
-- 목적:
--   관리자가 한눈에 "총 등록 / 검수 대기 / 검수 통과 / 유통 / 탈락 / 반려율 /
--   유통률" 을 확인. 기간 + 아티스트별 필터 지원.
--
-- Source of truth:
--   public.tracks (release_status, released_at, rejected_reason, removed_at,
--                   owner_user_id, created_at) — 운영 DB 확인 결과 단일 테이블.
--
-- Status 매핑 (운영 데이터 기반):
--   대기  : release_status in ('draft','submitted','review_pending','changes_requested')
--   통과  : release_status in ('approved','scheduled','released')
--   유통  : release_status = 'released' AND released_at IS NOT NULL
--   탈락  : release_status in ('rejected','removed')
--
-- 중복 방지: count(distinct id)
-- 삭제 처리: 현 스키마에 별도 deleted_at 없음 — removed_at 가 사실상 삭제 표식.
--           기본 집계는 전체 row. 탈락 카운트가 removed/rejected 모두 포함.

create or replace function public.admin_audio_distribution_stats(
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_artist_user_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_total bigint; v_pending bigint; v_approved bigint;
  v_distributed bigint; v_rejected bigint;
  v_rejection_breakdown jsonb;
begin
  -- admin 권한 체크 (super_admin / content_admin)
  if not exists (select 1 from public.users u
                 where u.id = v_uid and u.role in ('admin','super_admin','content_admin')) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  -- 전체 / 대기 / 통과 / 유통 / 탈락 일괄 산정 (단일 스캔)
  select
    count(distinct id) filter (where true),
    count(distinct id) filter (where release_status in ('draft','submitted','review_pending','changes_requested')),
    count(distinct id) filter (where release_status in ('approved','scheduled','released')),
    count(distinct id) filter (where release_status = 'released' and released_at is not null),
    count(distinct id) filter (where release_status in ('rejected','removed'))
  into v_total, v_pending, v_approved, v_distributed, v_rejected
  from public.tracks t
  where (p_start is null or t.created_at >= p_start)
    and (p_end is null or t.created_at < p_end)
    and (p_artist_user_id is null or t.owner_user_id = p_artist_user_id);

  -- 반려 사유 상위 10건 (free text — 그대로 그룹)
  select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'n', n) order by n desc), '[]'::jsonb)
  into v_rejection_breakdown
  from (
    select coalesce(nullif(btrim(t.rejected_reason), ''), '(사유 없음)') as reason,
           count(distinct t.id) as n
    from public.tracks t
    where t.release_status in ('rejected','removed')
      and (p_start is null or t.created_at >= p_start)
      and (p_end is null or t.created_at < p_end)
      and (p_artist_user_id is null or t.owner_user_id = p_artist_user_id)
    group by 1
    order by 2 desc
    limit 10
  ) top10;

  return jsonb_build_object(
    'total_submitted', v_total,
    'pending_review', v_pending,
    'approved', v_approved,
    'distributed', v_distributed,
    'rejected', v_rejected,
    'rejection_rate_pct', case when v_total > 0 then round(v_rejected::numeric * 100 / v_total, 1) else 0 end,
    'distribution_rate_pct', case when v_total > 0 then round(v_distributed::numeric * 100 / v_total, 1) else 0 end,
    'rejection_breakdown', v_rejection_breakdown,
    'window_start', p_start,
    'window_end', p_end,
    'artist_user_id', p_artist_user_id,
    'computed_at', now()
  );
end; $$;

grant execute on function public.admin_audio_distribution_stats(timestamptz, timestamptz, uuid) to authenticated;

-- 보조 RPC: 트랙 보유 아티스트 owner_user_id 목록 (UI select 옵션용)
create or replace function public.admin_list_track_artist_owners()
returns table(owner_user_id uuid, nickname text, email text, track_count bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u
                 where u.id = auth.uid() and u.role in ('admin','super_admin','content_admin')) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select t.owner_user_id, coalesce(u.nickname, '')::text, coalesce(au.email::text, '')::text,
         count(distinct t.id)::bigint as track_count
  from public.tracks t
  left join public.users u on u.id = t.owner_user_id
  left join auth.users au on au.id = t.owner_user_id
  where t.owner_user_id is not null
  group by t.owner_user_id, u.nickname, au.email
  order by track_count desc
  limit 500;
end; $$;

grant execute on function public.admin_list_track_artist_owners() to authenticated;
