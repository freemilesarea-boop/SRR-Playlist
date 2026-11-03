-- 0542_hq_content_admin_notify.sql
--
-- 본사 콘텐츠 변경 요청(0541)이 들어오면 관리자 알림 벨에 띄운다 — 검수가 늦어지지 않게.
-- severity 'info' 라 dispatch-admin-notifications(기본 최소 'warning')는 슬랙·메일로 보내지 않는다.

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
begin
  if v_ea is null then
    raise exception 'forbidden: not an enterprise HQ admin' using errcode = '42501';
  end if;
  v_brand := public._hq_validate_content_request(v_ea, p_kind, p_payload);

  if (select count(*) from public.hq_content_requests
       where enterprise_account_id = v_ea and status = 'pending') >= 50 then
    raise exception 'too_many_pending: 검수 대기 요청이 너무 많아요. 반영된 뒤 다시 요청해 주세요.';
  end if;

  -- 같은 대상의 이전 대기 요청은 새 요청으로 대체한다(마지막 요청만 검수).
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

  -- 관리자 알림 벨(검수 대기 알림). info 라 슬랙·메일로는 나가지 않는다.
  begin
    insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
    select 'hq_content_request', 'info',
           format('[본사 콘텐츠 검수] %s — %s', ea.enterprise_name, case p_kind
             when 'music_policy' then '브랜드 음악 설정'
             when 'playback_policy' then '재생 시간'
             when 'media_add' then '매장 화면 추가'
             when 'media_update' then '매장 화면 수정'
             when 'media_delete' then '매장 화면 삭제'
             when 'announcement_asset_add' then '안내 음원 추가'
             when 'announcement_asset_delete' then '안내 음원 삭제'
             when 'schedule_create' then '안내방송 일정 추가'
             when 'schedule_update' then '안내방송 일정 수정'
             else '안내방송 일정 삭제' end),
           coalesce(nullif(btrim(coalesce(p_note, '')), ''), '관리자 > 본사 콘텐츠 검수에서 확인해 주세요.'),
           jsonb_build_object('request_id', v_id, 'enterprise_account_id', v_ea, 'kind', p_kind,
                              'tab', 'hq-content-review'),
           0, now()
      from public.enterprise_accounts ea where ea.id = v_ea;
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
revoke all on function public.hq_submit_content_request(text, jsonb, text) from public, anon;
grant execute on function public.hq_submit_content_request(text, jsonb, text) to authenticated;
