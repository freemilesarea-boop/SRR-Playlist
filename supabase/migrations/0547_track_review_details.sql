-- 0547_track_review_details.sql
--
-- 음원 검수 기록을 '구조화'해서 남긴다 — 사유 체크박스(증상) + 문제 시점(초).
--
-- 왜
--   지금까지 거절 사유는 자유 문장이라 87%가 "음질 부적격" 한 줄이고, 어디가 어떻게 문제인지
--   남지 않았다. 자동 음질 분석기를 학습·검증하려면 "어떤 증상이 몇 초에 있었는지"가 필요하다.
--   아티스트에게도 구체적인 사유가 전달된다(기존 rejected_reason 문장에도 함께 들어간다).
--
-- 바뀌는 것
--   · track_review_details — 곡별 검수 결정 + 표준 사유 + 증상[] + 문제 시점[] + 메모
--   · admin_record_track_review_detail(track_ids[], …) — 단건·일괄 모두 같은 함수로 기록
--   기존 거절 흐름(admin_reject_artist_release 등)은 그대로다. 기록은 거절 직후 덧붙인다.

create table if not exists public.track_review_details (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  decision text not null check (decision in ('reject', 'changes', 'approve')),
  reason_key text,
  symptoms text[] not null default '{}',
  problem_seconds int[] not null default '{}',
  note text,
  reviewer_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_track_review_details_track on public.track_review_details (track_id, created_at desc);
create index if not exists idx_track_review_details_symptoms on public.track_review_details using gin (symptoms);

alter table public.track_review_details enable row level security;
revoke all on public.track_review_details from anon, authenticated;

create or replace function public.admin_record_track_review_detail(
  p_track_ids uuid[],
  p_decision text,
  p_reason_key text default null,
  p_symptoms text[] default '{}',
  p_problem_seconds int[] default '{}',
  p_note text default null
)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_decision not in ('reject', 'changes', 'approve') then
    raise exception 'invalid decision';
  end if;
  if coalesce(array_length(p_track_ids, 1), 0) = 0 or array_length(p_track_ids, 1) > 500 then
    raise exception 'invalid track ids';
  end if;

  insert into public.track_review_details (track_id, decision, reason_key, symptoms, problem_seconds, note, reviewer_id)
  select t.id, p_decision, nullif(btrim(coalesce(p_reason_key, '')), ''),
         coalesce((select array_agg(distinct s) from unnest(p_symptoms) s where s ~ '^[a-z_]{2,40}$'), '{}'),
         coalesce((select array_agg(distinct x order by x) from unnest(p_problem_seconds) x where x between 0 and 3600), '{}'),
         nullif(left(btrim(coalesce(p_note, '')), 500), ''), v_uid
    from public.tracks t
   where t.id = any(p_track_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.admin_record_track_review_detail(uuid[], text, text, text[], int[], text) from public, anon;
grant execute on function public.admin_record_track_review_detail(uuid[], text, text, text[], int[], text) to authenticated;
