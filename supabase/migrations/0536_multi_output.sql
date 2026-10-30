-- 0536_multi_output.sql
--
-- 분리 송출 — 한 매장에서 플레이어를 최대 3개 띄워 공간(스피커)별로 다른 음악을 튼다.
--
-- 왜
--   섹션마다 다른 음악을 원하는 점주가 많다. 브라우저 창마다 출력 장치(setSinkId)를
--   다르게 고르면 1번 창은 홀, 2번 창은 룸으로 나간다. 원하는 고객만 켜서 쓴다.
--
-- 바뀌는 것
--   · public.users.multi_output_enabled  — 켜짐/꺼짐 (기본 false, 기존 회원 무영향)
--   · public.users.multi_output_config   — 플레이어 1~3 설정 + 안내방송 송출 플레이어
--       {
--         "slots": [
--           { "slot": 1, "mode": "brand" },
--           { "slot": 2, "mode": "store", "source": "category", "category": "카페" },
--           { "slot": 3, "mode": "off" }
--         ],
--         "announcement_slot": 1
--       }
--     mode: brand | store | off. store 의 source: schedule(내 자동 스케줄) | category(업종).
--     매장 카테고리는 점주가 직접 고른다(운영사가 대신 고르지 않는다).
--   · set_my_multi_output RPC — 본인 설정만 저장. 형식을 서버에서 검증한다.
--
-- 출력 장치는 PC(브라우저)마다 다른 값이라 DB 가 아니라 그 PC 의 저장소에 둔다.

alter table public.users
  add column if not exists multi_output_enabled boolean not null default false,
  add column if not exists multi_output_config jsonb;

-- 0120 이후 users 는 컬럼 단위 UPDATE 권한이다. 이 두 컬럼은 RPC 로만 바꾼다(권한 미부여).

create or replace function public._normalize_multi_output_config(p_config jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_slots jsonb := '[]'::jsonb;
  v_item jsonb;
  v_slot int;
  v_mode text;
  v_source text;
  v_category text;
  v_seen int[] := '{}';
  v_ann int;
  v_active int[] := '{}';
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'invalid_config';
  end if;
  if jsonb_typeof(coalesce(p_config->'slots', 'null'::jsonb)) <> 'array' then
    raise exception 'invalid_slots';
  end if;

  for v_item in select * from jsonb_array_elements(p_config->'slots') loop
    begin
      v_slot := (v_item->>'slot')::int;
    exception when others then
      raise exception 'invalid_slot';
    end;
    if v_slot is null or v_slot < 1 or v_slot > 3 or v_slot = any(v_seen) then
      raise exception 'invalid_slot';
    end if;
    v_seen := v_seen || v_slot;

    v_mode := coalesce(v_item->>'mode', 'off');
    if v_mode not in ('brand', 'store', 'off') then
      raise exception 'invalid_mode';
    end if;

    v_source := null;
    v_category := null;
    if v_mode = 'store' then
      v_source := coalesce(v_item->>'source', 'schedule');
      if v_source not in ('schedule', 'category') then
        raise exception 'invalid_source';
      end if;
      if v_source = 'category' then
        v_category := left(nullif(btrim(coalesce(v_item->>'category', '')), ''), 40);
        if v_category is null then
          raise exception 'category_required';
        end if;
      end if;
    end if;
    if v_mode <> 'off' then
      v_active := v_active || v_slot;
    end if;

    v_slots := v_slots || jsonb_strip_nulls(jsonb_build_object(
      'slot', v_slot, 'mode', v_mode, 'source', v_source, 'category', v_category));
  end loop;

  if cardinality(v_active) = 0 then
    raise exception 'no_active_slot';
  end if;

  begin
    v_ann := coalesce((p_config->>'announcement_slot')::int, v_active[1]);
  exception when others then
    raise exception 'invalid_announcement_slot';
  end;
  if not (v_ann = any(v_active)) then
    raise exception 'invalid_announcement_slot';
  end if;

  return jsonb_build_object('slots', v_slots, 'announcement_slot', v_ann);
end;
$$;

create or replace function public.set_my_multi_output(p_enabled boolean, p_config jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_config jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  -- 끄기만 할 때는 설정을 보존한다(다시 켜면 그대로 돌아온다).
  if p_config is not null then
    v_config := public._normalize_multi_output_config(p_config);
  end if;
  update public.users set
    multi_output_enabled = coalesce(p_enabled, false),
    multi_output_config = coalesce(v_config, multi_output_config)
  where id = v_uid;
  return jsonb_build_object(
    'enabled', coalesce(p_enabled, false),
    'config', (select multi_output_config from public.users where id = v_uid));
end;
$$;

revoke all on function public.set_my_multi_output(boolean, jsonb) from public, anon;
grant execute on function public.set_my_multi_output(boolean, jsonb) to authenticated;
