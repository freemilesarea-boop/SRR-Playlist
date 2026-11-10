-- 0546_hq_reject_reason_required.sql
--
-- 본사 콘텐츠 요청을 반려할 때 사유를 서버에서도 필수로 한다.
-- 관리자 화면은 이미 막고 있었지만 RPC 를 직접 부르면 빈 사유로 반려할 수 있었다.
-- (음원이 반려되며 함께 반려되는 일정은 기존처럼 자동 사유가 붙는다.)

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
    -- 반려 사유는 본사에 그대로 전달된다 — 이유 없는 반려를 막는다.
    if nullif(btrim(coalesce(p_note, '')), '') is null then
      raise exception 'reject_reason_required: 반려 사유를 적어 주세요.';
    end if;
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
