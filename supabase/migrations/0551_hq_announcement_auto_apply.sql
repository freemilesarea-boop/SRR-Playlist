-- 0551_hq_announcement_auto_apply.sql
--
-- 본사(브랜드)가 올린 안내방송 음원·일정은 운영사 검수 없이 바로 반영한다.
--
-- 왜
--   안내방송은 본사가 자기 매장에 내보내는 자기 콘텐츠라, 운영사가 매번 검수·승인해야
--   매장에 나가는 구조가 반영을 늦출 뿐이었다. (음악 설정·매장 화면 이미지/영상은 그대로 검수)
--
-- 바뀌는 것
--   · _hq_apply_announcement_request(id) — 안내방송 5종 요청을 즉시 반영하는 내부 함수.
--     admin_* RPC 는 super admin 검사가 있어 본사 세션에서 못 부르므로 같은 처리를 직접 한다.
--     본사·익명 세션이 직접 부를 수 없게 실행 권한을 막는다 (hq_submit_content_request 만 사용).
--   · hq_submit_content_request — 안내방송 종류면 저장 직후 반영, status='approved'
--     (review_note='본사 직접 반영'), 운영사 검수 알림은 보내지 않는다.
--     반영 중 오류가 나면 요청도 함께 롤백되어 본사 화면에 오류가 그대로 보인다.
--   · 기록은 hq_content_requests 에 그대로 남는다 (누가 언제 무엇을 바꿨는지).

create or replace function public._hq_apply_announcement_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r       public.hq_content_requests%rowtype;
  v_res   jsonb;
  v_id    uuid;
  v_asset uuid;
  v_scope text;
  v_dep   public.hq_content_requests%rowtype;
begin
  select * into r from public.hq_content_requests where id = p_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status <> 'pending' then raise exception 'already_reviewed: %', r.status; end if;
  if r.kind not in ('announcement_asset_add', 'announcement_asset_delete',
                    'schedule_create', 'schedule_update', 'schedule_delete') then
    raise exception 'not_auto_applicable: %', r.kind;
  end if;

  -- 제출 이후 바뀐 상태(음원 삭제 등)까지 다시 검사
  perform public._hq_validate_content_request(r.enterprise_account_id, r.kind, r.payload);

  if r.kind = 'announcement_asset_add' then
    if nullif(btrim(coalesce(r.payload->>'file_url', '')), '') is null
       or nullif(btrim(coalesce(r.payload->>'file_path', '')), '') is null then
      raise exception 'invalid_file';
    end if;
    insert into public.enterprise_announcement_assets (
      enterprise_account_id, title, description, file_url, file_path, file_name,
      mime_type, file_size_bytes, duration_seconds, status, created_by)
    values (
      r.enterprise_account_id, btrim(r.payload->>'title'), r.payload->>'description',
      r.payload->>'file_url', r.payload->>'file_path', r.payload->>'file_name',
      r.payload->>'mime_type', (r.payload->>'file_size_bytes')::bigint,
      (r.payload->>'duration_seconds')::numeric, 'active', r.requested_by)
    returning id into v_id;
    v_res := jsonb_build_object('success', true, 'asset_id', v_id);

  elsif r.kind = 'announcement_asset_delete' then
    v_asset := (r.payload->>'asset_id')::uuid;
    update public.enterprise_announcement_assets
       set deleted_at = now(), status = 'disabled', updated_at = now()
     where id = v_asset and enterprise_account_id = r.enterprise_account_id and deleted_at is null;
    if not found then raise exception 'asset_not_found'; end if;
    update public.enterprise_announcement_schedules
       set status = 'paused', updated_at = now()
     where asset_id = v_asset and deleted_at is null and status = 'active';
    v_res := jsonb_build_object('success', true, 'asset_id', v_asset);

  elsif r.kind = 'schedule_create' then
    v_asset := (r.payload->>'asset_id')::uuid;
    if v_asset is null then
      -- (0551 이전 화면) 검수 대기 음원 요청을 가리키는 일정 — 그 음원 요청을 먼저 반영
      select * into v_dep from public.hq_content_requests
       where id = (r.payload->>'asset_request_id')::uuid and enterprise_account_id = r.enterprise_account_id;
      if v_dep.status = 'pending' then
        perform public._hq_apply_announcement_request(v_dep.id);
        select * into v_dep from public.hq_content_requests where id = v_dep.id;
      end if;
      if v_dep.status is distinct from 'approved' then
        raise exception 'asset_not_found';
      end if;
      v_asset := (v_dep.applied_result->>'asset_id')::uuid;
    end if;
    v_scope := r.payload->>'scope_type';
    insert into public.enterprise_announcement_schedules (
      asset_id, enterprise_account_id, region_id, scope_type, scope_store_ids,
      name, description, status, starts_at, ends_at, timezone, recurrence_rule,
      play_mode, max_plays_per_day, created_by)
    values (
      v_asset, r.enterprise_account_id,
      case when v_scope = 'region' then (r.payload->>'region_id')::uuid end,
      v_scope,
      case when v_scope = 'store' then array(select jsonb_array_elements_text(r.payload->'store_ids')::uuid) end,
      btrim(r.payload->>'name'), r.payload->>'description', coalesce(r.payload->>'status', 'active'),
      (r.payload->>'starts_at')::timestamptz, (r.payload->>'ends_at')::timestamptz,
      'Asia/Seoul', r.payload->>'recurrence_rule', 'after_current_track',
      least(greatest(coalesce((r.payload->>'max_plays_per_day')::int, 10), 1), 100), r.requested_by)
    returning id into v_id;
    v_res := jsonb_build_object('success', true, 'schedule_id', v_id);

  elsif r.kind = 'schedule_update' then
    v_scope := r.payload->>'scope_type';
    update public.enterprise_announcement_schedules
       set name              = coalesce(nullif(btrim(r.payload->>'name'), ''), name),
           status            = coalesce(r.payload->>'status', status),
           starts_at         = coalesce((r.payload->>'starts_at')::timestamptz, starts_at),
           ends_at           = coalesce((r.payload->>'ends_at')::timestamptz, ends_at),
           recurrence_rule   = coalesce(r.payload->>'recurrence_rule', recurrence_rule),
           -- greatest/least 는 NULL 을 무시하므로 값이 없을 때를 따로 둔다
           max_plays_per_day = case when r.payload->>'max_plays_per_day' is null then max_plays_per_day
                                    else least(greatest((r.payload->>'max_plays_per_day')::int, 1), 100) end,
           scope_type        = coalesce(v_scope, scope_type),
           region_id         = case when v_scope is null then region_id
                                    when v_scope = 'region' then (r.payload->>'region_id')::uuid else null end,
           scope_store_ids   = case when v_scope is null then scope_store_ids
                                    when v_scope = 'store' then array(select jsonb_array_elements_text(r.payload->'store_ids')::uuid)
                                    else null end,
           updated_at        = now()
     where id = (r.payload->>'schedule_id')::uuid
       and enterprise_account_id = r.enterprise_account_id and deleted_at is null;
    if not found then raise exception 'schedule_not_found'; end if;
    v_res := jsonb_build_object('success', true, 'schedule_id', r.payload->>'schedule_id');

  else -- schedule_delete
    update public.enterprise_announcement_schedules
       set deleted_at = now(), status = 'disabled', updated_at = now()
     where id = (r.payload->>'schedule_id')::uuid
       and enterprise_account_id = r.enterprise_account_id and deleted_at is null;
    if not found then raise exception 'schedule_not_found'; end if;
    v_res := jsonb_build_object('success', true, 'schedule_id', r.payload->>'schedule_id');
  end if;

  update public.hq_content_requests
     set status = 'approved', review_note = '본사 직접 반영',
         reviewed_at = now(), updated_at = now(), applied_result = v_res
   where id = p_id;

  return v_res;
end;
$$;

revoke all on function public._hq_apply_announcement_request(uuid) from public, anon, authenticated;

create or replace function public.hq_submit_content_request(p_kind text, p_payload jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ea uuid := public._hq_current_enterprise_account_id();
  v_brand uuid;
  v_id uuid;
  v_target text;
  v_auto boolean := p_kind in ('announcement_asset_add', 'announcement_asset_delete',
                               'schedule_create', 'schedule_update', 'schedule_delete');
  v_res jsonb;
begin
  if v_ea is null then
    raise exception 'forbidden: not an enterprise HQ admin' using errcode = '42501';
  end if;
  v_brand := public._hq_validate_content_request(v_ea, p_kind, p_payload);

  if not v_auto and (select count(*) from public.hq_content_requests
       where enterprise_account_id = v_ea and status = 'pending') >= 50 then
    raise exception 'too_many_pending: 검수 대기 요청이 너무 많아요. 반영된 뒤 다시 요청해 주세요.';
  end if;

  v_target := coalesce(p_payload->>'asset_id', p_payload->>'schedule_id');
  if p_kind in ('music_policy', 'playback_policy') then
    update public.hq_content_requests set status = 'superseded', updated_at = now()
     where enterprise_account_id = v_ea and kind = p_kind and status = 'pending';
  elsif p_kind in ('media_update', 'schedule_update') and v_target is not null then
    update public.hq_content_requests set status = 'superseded', updated_at = now()
     where enterprise_account_id = v_ea and kind = p_kind and status = 'pending'
       and coalesce(payload->>'asset_id', payload->>'schedule_id') = v_target;
  end if;

  insert into public.hq_content_requests (enterprise_account_id, brand_id, kind, payload, requested_by, hq_note)
  values (v_ea, v_brand, p_kind, p_payload, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  -- 0551: 안내방송은 검수 없이 바로 반영
  if v_auto then
    v_res := public._hq_apply_announcement_request(v_id);
    return jsonb_build_object('success', true, 'id', v_id, 'applied', true, 'result', v_res);
  end if;

  begin
    insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
    select 'hq_content_request', 'info',
           format('[본사 콘텐츠 검수] %s — %s', ea.enterprise_name, case p_kind
             when 'music_policy' then '브랜드 음악 설정'
             when 'playback_policy' then '재생 시간'
             when 'media_add' then '매장 화면 추가'
             when 'media_update' then '매장 화면 수정'
             when 'media_delete' then '매장 화면 삭제'
             else p_kind end),
           coalesce(nullif(btrim(coalesce(p_note, '')), ''), '관리자 > 본사 콘텐츠 검수에서 확인해 주세요.'),
           jsonb_build_object('request_id', v_id, 'enterprise_account_id', v_ea, 'kind', p_kind,
                              'tab', 'hq-content-review'),
           0, now()
      from public.enterprise_accounts ea where ea.id = v_ea;
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true, 'id', v_id, 'applied', false);
end;
$$;

-- 이미 검수 대기 중인 안내방송 요청이 있으면 지금 반영 (음원 요청을 일정보다 먼저)
do $$
declare
  v_req record;
begin
  for v_req in
    select id from public.hq_content_requests
     where status = 'pending'
       and kind in ('announcement_asset_add', 'announcement_asset_delete',
                    'schedule_create', 'schedule_update', 'schedule_delete')
     order by (kind = 'announcement_asset_add') desc, created_at
  loop
    begin
      perform public._hq_apply_announcement_request(v_req.id);
    exception when others then
      raise notice 'auto-apply skipped %: %', v_req.id, sqlerrm;
    end;
  end loop;
end;
$$;
