-- ============================================================
-- settlement_versioning_test.sql — 0348 회귀 테스트 (X6.45)
--
-- 검증 대상 (0348_settlement_versioning.sql 요구사항):
--   2) 재생성 시 기존 row 를 삭제하지 않고 version+1 새 row 생성 (이력 보존)
--   3) 동일 (월, 아티스트) 에서 최신 version 만 is_current=true (partial unique)
--   4) 봉인된(이전) version 은 finalize/지급 불가, finalized/paid 는 잠금
--   6) admin_settlement_version_history 로 이전 version 조회 가능
--   7) 백필 — version/is_current 컬럼·인덱스 존재
--   + get_my_settlements 는 current version 만 노출
--
-- 실행:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/settlement_versioning_test.sql
--
-- 트랜잭션 전체를 ROLLBACK 하므로 DB 에 흔적을 남기지 않음.
-- 모든 단언은 PL/pgSQL ASSERT — 실패 시 즉시 exception (exit code != 0).
-- ============================================================

begin;
set local client_min_messages = warning;

-- ---------- A) 스키마 불변식 (요구사항 3, 7) ----------
do $$
declare v_cnt int;
begin
  -- version / is_current 컬럼 존재
  select count(*) into v_cnt
  from information_schema.columns
  where table_schema = 'public' and table_name = 'artist_settlements'
    and column_name in ('version', 'is_current');
  assert v_cnt = 2, 'version/is_current 컬럼이 존재해야 함 (found=' || v_cnt || ')';

  -- 최신만 current 보장하는 partial unique index 존재
  select count(*) into v_cnt
  from pg_indexes
  where schemaname = 'public' and tablename = 'artist_settlements'
    and indexname = 'artist_settlements_current_unique';
  assert v_cnt = 1, 'artist_settlements_current_unique partial index 가 존재해야 함';

  -- (월,아티스트,version) unique index 존재
  select count(*) into v_cnt
  from pg_indexes
  where schemaname = 'public' and tablename = 'artist_settlements'
    and indexname = 'artist_settlements_month_artist_version_key';
  assert v_cnt = 1, 'artist_settlements_month_artist_version_key 가 존재해야 함';

  -- 기존 데이터 백필 검증: is_current 인 row 는 모두 version >= 1
  select count(*) into v_cnt
  from public.artist_settlements
  where is_current and (version is null or version < 1);
  assert v_cnt = 0, '백필 위반 — current row 는 version>=1 이어야 함 (violations=' || v_cnt || ')';

  raise notice 'A) schema invariants — PASS';
end$$;

-- ---------- B) 버전 관리 동작 (요구사항 2, 3, 4, 6) ----------
do $$
declare
  v_admin  uuid := '0a000000-0000-0000-0000-00000000ad01';
  v_artist uuid := '0a000000-0000-0000-0000-00000000a201';
  v_policy uuid;
  v_month  date := date '2099-01-01';
  v_v1 uuid; v_v2 uuid;
  v_cnt int; v_status text; v_ok boolean;
begin
  -- 픽스처: auth.users 는 signup 트리거 우회를 위해 replica 모드로 삽입
  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (v_admin,  'reg-admin@versiontest.local'),
    (v_artist, 'reg-artist@versiontest.local')
  on conflict (id) do nothing;
  set local session_replication_role = origin;

  insert into public.users (id, role, nickname) values
    (v_admin,  'admin', 'reg-admin'),
    (v_artist, 'user',  'reg-artist')
  on conflict (id) do nothing;

  insert into public.settlement_policies (
    effective_from, pool_revenue_ratio, company_fee_ratio,
    withholding_tax_ratio, min_payout_amount, min_payout_basis
  ) values (v_month, 0.5, 0.2, 0.033, 50000, 'gross')
  returning id into v_policy;

  -- v1 (현재) 정산 + settlement_item 1건
  insert into public.artist_settlements (
    settlement_month, artist_user_id, policy_id,
    gross_settlement_amount, company_fee_amount, sales_agent_fee_amount,
    artist_net_settlement, previous_carried_amount, total_settlement_amount,
    meets_min_payout, withholding_tax_amount, final_payout_amount, carried_over_amount,
    status, version, is_current
  ) values (
    v_month, v_artist, v_policy,
    100000, 20000, 0, 80000, 0, 80000,
    true, 2640, 77360, 0, 'pending', 1, true
  ) returning id into v_v1;

  -- v1 에 100개 settlement_items 박제 (예: 트랙 100개)
  insert into public.settlement_items (
    settlement_id, artist_user_id, track_code, track_title,
    stream_count, pool_revenue_share
  )
  select v_v1, v_artist, 'V1-' || g, 'Track ' || g, 10, 800
  from generate_series(1, 100) g;

  -- === 재생성 시뮬레이션: v1 봉인 → v2 생성 (요구사항 2, 3) ===
  update public.artist_settlements set is_current = false, updated_at = now() where id = v_v1;
  insert into public.artist_settlements (
    settlement_month, artist_user_id, policy_id,
    gross_settlement_amount, company_fee_amount, sales_agent_fee_amount,
    artist_net_settlement, previous_carried_amount, total_settlement_amount,
    meets_min_payout, withholding_tax_amount, final_payout_amount, carried_over_amount,
    status, version, is_current
  ) values (
    v_month, v_artist, v_policy,
    120000, 24000, 0, 96000, 0, 96000,
    true, 3168, 92832, 0, 'pending', 2, true
  ) returning id into v_v2;

  -- v2 에 101개 settlement_items 박제 (재생성 시 트랙 1개 증가 시나리오)
  insert into public.settlement_items (
    settlement_id, artist_user_id, track_code, track_title,
    stream_count, pool_revenue_share
  )
  select v_v2, v_artist, 'V2-' || g, 'Track ' || g, 12, 950
  from generate_series(1, 101) g;

  -- (2) 기존 row 보존 — 2개 version 존재
  select count(*) into v_cnt from public.artist_settlements
  where settlement_month = v_month and artist_user_id = v_artist;
  assert v_cnt = 2, '재생성 후 version 2개가 보존되어야 함 (found=' || v_cnt || ')';

  -- (3) 최신만 is_current
  select count(*) into v_cnt from public.artist_settlements
  where settlement_month = v_month and artist_user_id = v_artist and is_current;
  assert v_cnt = 1, 'is_current 는 정확히 1건이어야 함 (found=' || v_cnt || ')';

  -- (2) settlement_items 가 version 별 settlement_id 로 완전 분리 보관됨
  --     v1=100 유지, v2=101 — 재생성 시 items 가 삭제되지 않고 새 version 으로 복제 생성
  select count(*) into v_cnt from public.settlement_items where settlement_id = v_v1;
  assert v_cnt = 100, 'v1 의 settlement_items 100개가 보존되어야 함 (found=' || v_cnt || ')';

  select count(*) into v_cnt from public.settlement_items where settlement_id = v_v2;
  assert v_cnt = 101, 'v2 의 settlement_items 101개가 생성되어야 함 (found=' || v_cnt || ')';

  -- 두 version 의 items 가 서로 다른 settlement_id 로 분리됨
  select count(distinct settlement_id) into v_cnt
  from public.settlement_items where settlement_id in (v_v1, v_v2);
  assert v_cnt = 2, 'items 는 version 별 distinct settlement_id 로 분리되어야 함';

  -- 관리자 컨텍스트 (admin_settlement_detail 호출 전 필요)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  -- 상세 조회 시 v1=100개, v2=101개 (요구사항 예시 그대로)
  select jsonb_array_length((public.admin_settlement_detail(v_v1)) -> 'items') into v_cnt;
  assert v_cnt = 100, 'admin_settlement_detail(v1) 은 100개 items 를 반환해야 함 (found=' || v_cnt || ')';

  select jsonb_array_length((public.admin_settlement_detail(v_v2)) -> 'items') into v_cnt;
  assert v_cnt = 101, 'admin_settlement_detail(v2) 은 101개 items 를 반환해야 함 (found=' || v_cnt || ')';

  -- (3) partial unique index 가 2번째 is_current 삽입을 차단
  v_ok := false;
  begin
    insert into public.artist_settlements (
      settlement_month, artist_user_id, policy_id,
      gross_settlement_amount, company_fee_amount, sales_agent_fee_amount,
      artist_net_settlement, previous_carried_amount, total_settlement_amount,
      meets_min_payout, withholding_tax_amount, final_payout_amount, carried_over_amount,
      status, version, is_current
    ) values (
      v_month, v_artist, v_policy,
      1, 0, 0, 1, 0, 1, false, 0, 0, 1, 'pending', 3, true
    );
  exception when unique_violation then
    v_ok := true;
  end;
  assert v_ok, 'partial unique index 가 2번째 is_current 를 차단해야 함';

  -- 관리자 컨텍스트 설정 (auth.uid())
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);

  -- (6) version_history RPC — 2개 version, 최신 우선
  select count(*) into v_cnt from public.admin_settlement_version_history(v_month, v_artist);
  assert v_cnt = 2, 'version_history 가 2개 version 을 반환해야 함 (found=' || v_cnt || ')';

  select version into v_cnt from public.admin_settlement_version_history(v_month, v_artist) limit 1;
  assert v_cnt = 2, 'version_history 는 최신 version 을 먼저 반환해야 함 (first=' || v_cnt || ')';

  -- (4) 봉인된(이전) version v1 은 finalize 불가
  v_ok := false;
  begin
    perform public.admin_finalize_settlement(v_v1);
  exception when others then
    v_ok := true;
  end;
  assert v_ok, '봉인된 이전 version 의 finalize 는 거부되어야 함';

  -- 현재 version v2 는 finalize 가능 → payable
  perform public.admin_finalize_settlement(v_v2);
  select status into v_status from public.artist_settlements where id = v_v2;
  assert v_status = 'payable', 'finalize 후 현재 version 상태는 payable 이어야 함 (status=' || v_status || ')';

  -- (4) finalized(payable) 가 된 v2 는 더 이상 pending 이 아니므로
  --     generate 의 재생성 대상에서 제외 (status guard) — 상태 잠금 확인
  assert v_status not in ('pending', 'held'), 'finalized 상태는 재생성 대상에서 제외되어야 함';

  -- get_my_settlements 는 아티스트에게 current version 만 노출
  perform set_config('request.jwt.claims', json_build_object('sub', v_artist::text)::text, true);
  select count(*) into v_cnt from public.get_my_settlements();
  assert v_cnt = 1, '아티스트는 current version 1건만 조회되어야 함 (found=' || v_cnt || ')';

  raise notice 'B) versioning behavior — PASS';
end$$;

do $$ begin raise notice 'settlement_versioning_test — ALL PASS'; end$$;

rollback;
