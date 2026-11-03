-- 0543_hq_content_hardening.sql
--
-- 0541 점검 후속.
--   · 업로드 요청의 URL 이 이 프로젝트 스토리지의 실제 파일인지 확인한다. 이전에는 file_path 가
--     URL 에 '포함'만 되면 통과해, 외부 주소(검수 후 내용 바꿔치기)나 javascript: 링크를 넣을 수 있었다.
--   · 안내 음원 삭제를 승인하면 그 음원을 쓰던 일정을 일시중지한다(이전: '켜짐'인데 안 나감).

create or replace function public._hq_valid_upload(p_bucket text, p_ea_id uuid, p_path text, p_url text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- ① 본사 전용 폴더 ② 이 프로젝트 스토리지의 공개 URL 그대로(외부 주소·javascript: 차단)
  -- ③ 실제로 올라간 파일. 검수 때 본 파일과 매장에 나가는 파일이 같다는 보장.
  select p_path is not null and p_url is not null
     and p_path like 'hq/' || p_ea_id::text || '/%'
     and p_path !~ '\.\.'
     and p_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/'
     and p_url = substring(p_url from '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/')
                 || p_bucket || '/' || p_path
     and exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_path);
$$;
revoke all on function public._hq_valid_upload(text, uuid, text, text) from public, anon, authenticated;

create or replace function public._hq_validate_content_request(p_ea_id uuid, p_kind text, p_payload jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_brand uuid := public._hq_my_brand_id(p_ea_id);
  v_scope text;
  v_rule text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;
  if p_kind in ('music_policy', 'playback_policy', 'media_add', 'media_update', 'media_delete') and v_brand is null then
    raise exception 'no_brand: 연결된 브랜드 플레이어가 없습니다';
  end if;

  if p_kind = 'music_policy' then
    if coalesce(p_payload->>'policy_mode', '') not in ('inherit', 'custom') then
      raise exception 'invalid_policy_mode';
    end if;
    if p_payload->>'vocal_policy' is not null
       and p_payload->>'vocal_policy' not in ('any', 'vocal_ok', 'prefer_instrumental', 'instrumental_only') then
      raise exception 'invalid_vocal_policy';
    end if;

  elsif p_kind = 'playback_policy' then
    if coalesce(p_payload->>'playback_mode', '') not in ('always_on', 'business_hours') then
      raise exception 'invalid_playback_mode';
    end if;
    if p_payload->>'playback_mode' = 'business_hours' then
      if p_payload->>'open_time' is null or p_payload->>'close_time' is null then
        raise exception '영업시간 모드는 시작/종료 시각이 필요합니다.';
      end if;
      perform (p_payload->>'open_time')::time, (p_payload->>'close_time')::time;
    end if;

  elsif p_kind = 'media_add' then
    if not public._hq_valid_upload('brand-media', p_ea_id, p_payload->>'file_path', p_payload->>'url') then
      raise exception 'invalid_file';
    end if;
    if coalesce(p_payload->>'asset_type', 'image') not in ('image', 'video') then
      raise exception 'invalid_asset_type';
    end if;

  elsif p_kind in ('media_update', 'media_delete') then
    if not exists (select 1 from public.brand_media_assets m
                    where m.id = (p_payload->>'asset_id')::uuid and m.brand_id = v_brand and m.deleted_at is null) then
      raise exception 'media_not_found';
    end if;
    if p_kind = 'media_update' and p_payload->>'status' is not null
       and p_payload->>'status' not in ('active', 'inactive') then
      raise exception 'invalid_status';
    end if;

  elsif p_kind = 'announcement_asset_add' then
    if nullif(btrim(coalesce(p_payload->>'title', '')), '') is null then
      raise exception 'title_required';
    end if;
    if not public._hq_valid_upload('enterprise-announcements', p_ea_id, p_payload->>'file_path', p_payload->>'file_url') then
      raise exception 'invalid_file';
    end if;

  elsif p_kind = 'announcement_asset_delete' then
    if not exists (select 1 from public.enterprise_announcement_assets a
                    where a.id = (p_payload->>'asset_id')::uuid and a.enterprise_account_id = p_ea_id
                      and a.deleted_at is null) then
      raise exception 'asset_not_found';
    end if;

  elsif p_kind in ('schedule_create', 'schedule_update') then
    if p_kind = 'schedule_update' then
      if not exists (select 1 from public.enterprise_announcement_schedules s
                      where s.id = (p_payload->>'schedule_id')::uuid and s.enterprise_account_id = p_ea_id
                        and s.deleted_at is null) then
        raise exception 'schedule_not_found';
      end if;
    else
      if nullif(btrim(coalesce(p_payload->>'name', '')), '') is null then
        raise exception 'name_required';
      end if;
      if p_payload->>'asset_id' is not null then
        if not exists (select 1 from public.enterprise_announcement_assets a
                        where a.id = (p_payload->>'asset_id')::uuid and a.enterprise_account_id = p_ea_id
                          and a.deleted_at is null) then
          raise exception 'asset_not_found';
        end if;
      elsif p_payload->>'asset_request_id' is not null then
        if not exists (select 1 from public.hq_content_requests r
                        where r.id = (p_payload->>'asset_request_id')::uuid and r.enterprise_account_id = p_ea_id
                          and r.kind = 'announcement_asset_add' and r.status in ('pending', 'approved')) then
          raise exception 'asset_not_found';
        end if;
      else
        raise exception 'asset_required';
      end if;
      if p_payload->>'scope_type' is null then
        raise exception 'scope_required';
      end if;
    end if;

    v_scope := p_payload->>'scope_type';
    if v_scope is not null then
      if v_scope not in ('enterprise', 'region', 'store') then
        raise exception 'invalid_scope';
      end if;
      if v_scope = 'region' and not exists (
           select 1 from public.enterprise_regions r
            where r.id = (p_payload->>'region_id')::uuid and r.enterprise_account_id = p_ea_id and r.deleted_at is null) then
        raise exception 'region_not_found';
      end if;
      if v_scope = 'store' then
        if jsonb_typeof(p_payload->'store_ids') is distinct from 'array' or jsonb_array_length(p_payload->'store_ids') = 0 then
          raise exception 'stores_required';
        end if;
        if exists (select 1 from jsonb_array_elements_text(p_payload->'store_ids') x
                    where not public._store_in_enterprise(x::uuid, p_ea_id)) then
          raise exception 'store_not_in_enterprise';
        end if;
      end if;
    end if;

    v_rule := p_payload->>'recurrence_rule';
    if v_rule is not null and v_rule !~ '^(once:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|daily:\d{2}:\d{2}|weekly:(SUN|MON|TUE|WED|THU|FRI|SAT)(,(SUN|MON|TUE|WED|THU|FRI|SAT))*:\d{2}:\d{2})$' then
      raise exception 'invalid_recurrence_rule';
    end if;
    if p_payload->>'status' is not null and p_payload->>'status' not in ('active', 'paused') then
      raise exception 'invalid_status';
    end if;

  elsif p_kind = 'schedule_delete' then
    if not exists (select 1 from public.enterprise_announcement_schedules s
                    where s.id = (p_payload->>'schedule_id')::uuid and s.enterprise_account_id = p_ea_id
                      and s.deleted_at is null) then
      raise exception 'schedule_not_found';
    end if;

  else
    raise exception 'invalid_kind';
  end if;

  return v_brand;
end;
$$;
revoke all on function public._hq_validate_content_request(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.admin_review_hq_content_request(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.hq_content_requests%rowtype;
  v_brand uuid;
  v_res jsonb;
  v_asset uuid;
  v_dep public.hq_content_requests%rowtype;
  v_scope text;
  v_hq_user uuid;
  v_label text;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  select * into r from public.hq_content_requests where id = p_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if r.status <> 'pending' then
    raise exception 'already_reviewed: %', r.status;
  end if;

  if not coalesce(p_approve, false) then
    update public.hq_content_requests
       set status = 'rejected', review_note = nullif(btrim(coalesce(p_note, '')), ''),
           reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
     where id = p_id;
    -- 이 음원을 쓰려던 대기 일정도 함께 반려한다.
    if r.kind = 'announcement_asset_add' then
      update public.hq_content_requests
         set status = 'rejected', review_note = '사용하려던 안내 음원이 반려되었습니다.',
             reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
       where status = 'pending' and kind = 'schedule_create' and payload->>'asset_request_id' = p_id::text;
    end if;
  else
    v_brand := public._hq_validate_content_request(r.enterprise_account_id, r.kind, r.payload);

    if r.kind = 'music_policy' then
      v_res := public.admin_upsert_brand_music_policy(
        v_brand,
        array(select jsonb_array_elements_text(coalesce(r.payload->'preferred_genres', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(r.payload->'blocked_genres', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(r.payload->'preferred_moods', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(r.payload->'blocked_moods', '[]'::jsonb))),
        (r.payload->>'energy_min')::numeric, (r.payload->>'energy_max')::numeric,
        r.payload->>'vocal_policy', null, null,
        r.payload->>'policy_mode',
        array(select jsonb_array_elements_text(coalesce(r.payload->'allowed_genres', '[]'::jsonb))),
        (r.payload->>'bpm_min')::int, (r.payload->>'bpm_max')::int);
      -- 오늘 플레이리스트도 새 정책으로 바로 다시 만든다(매장은 곡 사이에 자연스럽게 교체).
      v_res := v_res || jsonb_build_object('regenerated', public.generate_brand_daily_playlist(v_brand, true));

    elsif r.kind = 'playback_policy' then
      v_res := public.admin_set_brand_playback_policy(
        v_brand, r.payload->>'playback_mode',
        (r.payload->>'open_time')::time, (r.payload->>'close_time')::time,
        coalesce(r.payload->>'timezone', 'Asia/Seoul'),
        case when jsonb_typeof(r.payload->'days') = 'array'
             then array(select jsonb_array_elements_text(r.payload->'days')::int) else null end);

    elsif r.kind = 'media_add' then
      v_res := public.admin_add_brand_media(
        v_brand, r.payload->>'url', r.payload->>'title',
        coalesce((r.payload->>'display_duration_seconds')::int, 10), null,
        (r.payload->>'starts_at')::timestamptz, (r.payload->>'ends_at')::timestamptz,
        coalesce(r.payload->>'asset_type', 'image'), r.payload->>'mime_type',
        r.payload->>'thumbnail_url', (r.payload->>'media_duration_seconds')::numeric);

    elsif r.kind = 'media_update' then
      v_res := public.admin_update_brand_media(
        (r.payload->>'asset_id')::uuid, r.payload->>'title',
        (r.payload->>'display_duration_seconds')::int, (r.payload->>'sort_order')::int,
        (r.payload->>'starts_at')::timestamptz, (r.payload->>'ends_at')::timestamptz,
        r.payload->>'status');

    elsif r.kind = 'media_delete' then
      v_res := public.admin_delete_brand_media((r.payload->>'asset_id')::uuid);

    elsif r.kind = 'announcement_asset_add' then
      v_res := public.admin_create_announcement_asset(
        r.payload->>'title', r.payload->>'file_url', r.payload->>'file_path',
        r.payload->>'file_name', r.payload->>'mime_type',
        (r.payload->>'file_size_bytes')::bigint, (r.payload->>'duration_seconds')::numeric,
        r.payload->>'description', r.enterprise_account_id, 'active');

    elsif r.kind = 'announcement_asset_delete' then
      v_res := public.admin_soft_delete_announcement_asset((r.payload->>'asset_id')::uuid);
      -- 이 음원을 쓰던 일정은 더 이상 나갈 수 없다 — '켜짐'으로 남아 본사가 착각하지 않게 일시중지한다.
      update public.enterprise_announcement_schedules
         set status = 'paused', updated_at = now()
       where asset_id = (r.payload->>'asset_id')::uuid and deleted_at is null and status = 'active';

    elsif r.kind = 'schedule_create' then
      v_asset := (r.payload->>'asset_id')::uuid;
      if v_asset is null then
        select * into v_dep from public.hq_content_requests where id = (r.payload->>'asset_request_id')::uuid;
        -- 아직 검수 전인 음원이면 함께 승인한다(일정만 승인하고 음원이 없는 상태를 막는다).
        if v_dep.status = 'pending' then
          perform public.admin_review_hq_content_request(v_dep.id, true, p_note);
          select * into v_dep from public.hq_content_requests where id = v_dep.id;
        end if;
        if v_dep.status <> 'approved' then
          raise exception '이 일정이 쓰는 안내 음원이 승인되지 않았습니다.';
        end if;
        v_asset := (v_dep.applied_result->>'asset_id')::uuid;
      end if;
      v_scope := r.payload->>'scope_type';
      v_res := public.admin_create_announcement_schedule(
        v_asset, r.payload->>'name', v_scope, r.enterprise_account_id,
        case when v_scope = 'region' then (r.payload->>'region_id')::uuid else null end,
        case when v_scope = 'store' then array(select jsonb_array_elements_text(r.payload->'store_ids')::uuid) else null end,
        r.payload->>'description', coalesce(r.payload->>'status', 'active'),
        (r.payload->>'starts_at')::timestamptz, (r.payload->>'ends_at')::timestamptz,
        'Asia/Seoul', r.payload->>'recurrence_rule', 'after_current_track',
        coalesce((r.payload->>'max_plays_per_day')::int, 10));

    elsif r.kind = 'schedule_update' then
      v_scope := r.payload->>'scope_type';
      v_res := public.admin_update_announcement_schedule(
        (r.payload->>'schedule_id')::uuid, r.payload->>'name', null, r.payload->>'status',
        (r.payload->>'starts_at')::timestamptz, (r.payload->>'ends_at')::timestamptz, null,
        r.payload->>'recurrence_rule', null, (r.payload->>'max_plays_per_day')::int,
        case when v_scope = 'region' then (r.payload->>'region_id')::uuid else null end,
        v_scope,
        case when v_scope = 'store' then array(select jsonb_array_elements_text(r.payload->'store_ids')::uuid) else null end,
        v_scope is not null and v_scope <> 'region',
        v_scope is not null and v_scope <> 'store');

    elsif r.kind = 'schedule_delete' then
      v_res := public.admin_delete_announcement_schedule((r.payload->>'schedule_id')::uuid);
    end if;

    update public.hq_content_requests
       set status = 'approved', review_note = nullif(btrim(coalesce(p_note, '')), ''),
           reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now(), applied_result = v_res
     where id = p_id;
  end if;

  -- 본사 알림센터에 결과를 남긴다(실패해도 검수 자체는 유지).
  begin
    select ea.auth_user_id into v_hq_user from public.enterprise_accounts ea where ea.id = r.enterprise_account_id;
    v_label := case r.kind
      when 'music_policy' then '브랜드 음악 설정'
      when 'playback_policy' then '재생 시간'
      when 'media_add' then '매장 화면 이미지·영상 추가'
      when 'media_update' then '매장 화면 이미지·영상 수정'
      when 'media_delete' then '매장 화면 이미지·영상 삭제'
      when 'announcement_asset_add' then '안내 음원 추가'
      when 'announcement_asset_delete' then '안내 음원 삭제'
      when 'schedule_create' then '안내방송 일정 추가'
      when 'schedule_update' then '안내방송 일정 수정'
      else '안내방송 일정 삭제' end;
    if v_hq_user is not null then
      insert into public.enterprise_notifications (
        enterprise_account_id, target_type, target_id, recipient_user_id, notification_type,
        title, message, severity, status, action_url, metadata)
      values (
        r.enterprise_account_id, 'user', v_hq_user, v_hq_user, 'content_review',
        case when p_approve then v_label || ' 요청이 반영됐어요' else v_label || ' 요청이 반려됐어요' end,
        coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                 case when p_approve then '전 가맹점에 반영되었습니다.' else '브랜드 콘텐츠 관리에서 내용을 확인해 주세요.' end),
        case when p_approve then 'info' else 'medium' end, 'unread', '/enterprise/content',
        jsonb_build_object('request_id', r.id, 'kind', r.kind));
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true, 'status', case when p_approve then 'approved' else 'rejected' end,
                            'result', v_res);
end;
$$;
revoke all on function public.admin_review_hq_content_request(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_hq_content_request(uuid, boolean, text) to authenticated;
