-- 0191 — 곡 메타데이터 수정 이력(audit log). tracks 메타 컬럼 변경 시 트리거가 자동 기록.
create table if not exists public.track_metadata_audit_log (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  before jsonb, after jsonb, changes jsonb not null default '[]'::jsonb,
  reason text, source text
);
create index if not exists idx_tmal_track on public.track_metadata_audit_log(track_id, changed_at desc);
alter table public.track_metadata_audit_log enable row level security;
drop policy if exists tmal_admin_read on public.track_metadata_audit_log;
create policy tmal_admin_read on public.track_metadata_audit_log for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

create or replace function public._trg_log_metadata_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_ch jsonb := '[]'::jsonb;
begin
  if OLD.genre_tags is distinct from NEW.genre_tags then
    v_ch := v_ch || jsonb_build_object('field','genre','label','장르','from',to_jsonb(OLD.genre_tags),'to',to_jsonb(NEW.genre_tags)); end if;
  if OLD.mood_tags is distinct from NEW.mood_tags then
    v_ch := v_ch || jsonb_build_object('field','mood','label','분위기','from',to_jsonb(OLD.mood_tags),'to',to_jsonb(NEW.mood_tags)); end if;
  if OLD.business_type_tags is distinct from NEW.business_type_tags then
    v_ch := v_ch || jsonb_build_object('field','store','label','추천 매장','from',to_jsonb(OLD.business_type_tags),'to',to_jsonb(NEW.business_type_tags)); end if;
  if OLD.vocal_type is distinct from NEW.vocal_type then
    v_ch := v_ch || jsonb_build_object('field','vocal','label','보컬','from',to_jsonb(OLD.vocal_type),'to',to_jsonb(NEW.vocal_type)); end if;
  if OLD.recommended_dayparts is distinct from NEW.recommended_dayparts then
    v_ch := v_ch || jsonb_build_object('field','dayparts','label','시간대','from',to_jsonb(OLD.recommended_dayparts),'to',to_jsonb(NEW.recommended_dayparts)); end if;
  if OLD.language is distinct from NEW.language then
    v_ch := v_ch || jsonb_build_object('field','language','label','언어','from',to_jsonb(OLD.language),'to',to_jsonb(NEW.language)); end if;
  if OLD.tempo_feel is distinct from NEW.tempo_feel then
    v_ch := v_ch || jsonb_build_object('field','tempo','label','템포','from',to_jsonb(OLD.tempo_feel),'to',to_jsonb(NEW.tempo_feel)); end if;

  if v_ch <> '[]'::jsonb then
    insert into public.track_metadata_audit_log(track_id, changed_by, before, after, changes, source)
    values (NEW.id, auth.uid(),
      jsonb_build_object('genre_tags',OLD.genre_tags,'mood_tags',OLD.mood_tags,'business_type_tags',OLD.business_type_tags,'vocal_type',OLD.vocal_type,'recommended_dayparts',OLD.recommended_dayparts,'language',OLD.language,'tempo_feel',OLD.tempo_feel),
      jsonb_build_object('genre_tags',NEW.genre_tags,'mood_tags',NEW.mood_tags,'business_type_tags',NEW.business_type_tags,'vocal_type',NEW.vocal_type,'recommended_dayparts',NEW.recommended_dayparts,'language',NEW.language,'tempo_feel',NEW.tempo_feel),
      v_ch, coalesce(NEW.metadata_source,'edit'));
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_log_metadata_change on public.tracks;
create trigger trg_log_metadata_change after update on public.tracks
for each row when (
  OLD.genre_tags is distinct from NEW.genre_tags or OLD.mood_tags is distinct from NEW.mood_tags
  or OLD.business_type_tags is distinct from NEW.business_type_tags or OLD.vocal_type is distinct from NEW.vocal_type
  or OLD.recommended_dayparts is distinct from NEW.recommended_dayparts or OLD.language is distinct from NEW.language
  or OLD.tempo_feel is distinct from NEW.tempo_feel)
execute function public._trg_log_metadata_change();

create or replace function public.admin_list_metadata_audit(p_track_id uuid default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.changed_at desc), '[]'::jsonb) into v from (
    select a.id, a.track_id, t.title, a.changed_at, a.changes, a.source, a.reason, a.changed_by,
      coalesce(u.nickname, au.email, '시스템') as editor, au.email as editor_email
    from public.track_metadata_audit_log a
    left join public.tracks t on t.id = a.track_id
    left join public.users u on u.id = a.changed_by
    left join auth.users au on au.id = a.changed_by
    where (p_track_id is null or a.track_id = p_track_id)
    order by a.changed_at desc limit greatest(1, p_limit)) x;
  return v;
end; $$;
grant execute on function public.admin_list_metadata_audit(uuid, int) to authenticated;
