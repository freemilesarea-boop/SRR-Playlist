-- ============================================
-- 0065_p0_stabilization.sql
--
-- P0 안정화 패치:
--   1) tracks.audio_sha256 (text) — 클라이언트가 SHA-256 계산 후 전달
--   2) submit_artist_release: owner_user_id + audio_sha256 중복 방지
--      (0064 의 60초 가드는 유지, 거기에 sha256 기반 강한 가드 추가)
--   3) _tracks_release_protect 강화: released 상태에서 핵심 메타데이터
--      (title/audio_url/audio_sha256/isrc/release_date) 변경 차단
--   4) settlement_items / artist_settlements snapshot 컬럼 보강
--      (isrc / release_date / release_title / rights_holder_name / artist_email
--       / sales_agent_code)
--   5) release_date >= today+3 검증을 RPC 추가 + CHECK 가능 부분 보강
--
-- 영향:
--   - 운영 artist_upload 트랙 0건 → backfill 없음
--   - settlement 0건 → snapshot 컬럼 추가 무영향
-- ============================================

-- ----------------------
-- 1) audio_sha256 컬럼 + UNIQUE index (artist+hash 중복 방지)
-- ----------------------
alter table public.tracks
  add column if not exists audio_sha256 text;

-- 부분 unique: artist 가 같은 파일을 또 올리면 같은 row 반환되도록.
-- (NULL 은 unique 제약 우회 가능 — 신규 컬럼이라 기존 row 영향 0)
create unique index if not exists idx_tracks_owner_sha256_unique
  on public.tracks(owner_user_id, audio_sha256)
  where audio_sha256 is not null and source_type = 'artist_upload';

create index if not exists idx_tracks_audio_sha256
  on public.tracks(audio_sha256)
  where audio_sha256 is not null;

-- ----------------------
-- 2) submit_artist_release — sha256 중복 가드 + p_audio_sha256 파라미터
-- ----------------------
create or replace function public.submit_artist_release(
  p_track_id uuid default null,
  p_title text default null, p_artist text default null,
  p_album_name text default null, p_release_title text default null,
  p_release_type text default null, p_release_date date default null,
  p_main_genre text default null, p_sub_genre text default null,
  p_mood text default null, p_suitable_store text default null,
  p_lyrics text default null, p_isrc text default null,
  p_rights_holder_name text default null,
  p_explicit_content boolean default false, p_instrumental boolean default false,
  p_audio_url text default null, p_cover_url text default null,
  p_rights_confirmed boolean default false,
  p_audio_sha256 text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_track_id uuid;
  v_profile_id uuid; v_payout_id uuid;
  v_artist_name text; v_real_name text;
  v_min_date date := (current_date + interval '3 days')::date;
  v_dup_row record;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not p_rights_confirmed then raise exception 'rights confirmation required'; end if;
  if p_release_date is null then raise exception 'release_date required'; end if;
  if p_release_date < v_min_date then
    raise exception 'release_date must be at least % (today + 3 days)', v_min_date
      using hint = '검수 및 출시 준비를 위해 발매일은 최소 3일 뒤부터 선택할 수 있습니다.';
  end if;
  if p_release_type not in ('single','ep','album') then raise exception 'release_type must be single/ep/album'; end if;
  if not exists (
    select 1 from public.users u where u.id = v_uid
      and u.account_type = 'artist' and u.artist_approval_status = 'approved'
      and u.membership_tier = 'individual' and u.contract_status = 'signed'
  ) then raise exception 'artist not eligible (approval/payment/contract)'; end if;
  select id into v_payout_id from public.artist_payout_accounts
  where user_id = v_uid and verification_status = 'verified';
  if v_payout_id is null then raise exception 'verified payout account required'; end if;
  select id, artist_name, real_name into v_profile_id, v_artist_name, v_real_name
  from public.artist_profiles where user_id = v_uid;
  if v_profile_id is null then raise exception 'artist profile not found'; end if;

  perform pg_advisory_xact_lock(hashtext('release_submit:' || v_uid::text));

  if p_track_id is not null then
    -- 재제출 (draft/changes_requested 만)
    if not exists (
      select 1 from public.tracks where id = p_track_id and owner_user_id = v_uid
        and release_status in ('draft','changes_requested')
    ) then raise exception 'cannot resubmit track in current status'; end if;
    update public.tracks set
      title = coalesce(nullif(btrim(p_title), ''), title),
      artist = coalesce(nullif(btrim(p_artist), ''), artist, v_artist_name),
      album_name = coalesce(nullif(btrim(p_album_name), ''), album_name),
      release_title = coalesce(nullif(btrim(p_release_title), ''), release_title),
      release_type = coalesce(p_release_type, release_type),
      release_date = coalesce(p_release_date, release_date),
      main_genre = coalesce(nullif(btrim(p_main_genre), ''), main_genre),
      sub_genre = coalesce(nullif(btrim(p_sub_genre), ''), sub_genre),
      mood = coalesce(nullif(btrim(p_mood), ''), mood),
      suitable_store = coalesce(nullif(btrim(p_suitable_store), ''), suitable_store),
      lyrics = coalesce(nullif(btrim(p_lyrics), ''), lyrics),
      isrc = coalesce(nullif(btrim(p_isrc), ''), isrc),
      rights_holder_name = coalesce(nullif(btrim(p_rights_holder_name), ''), rights_holder_name, v_real_name, v_artist_name),
      explicit_content = coalesce(p_explicit_content, explicit_content),
      instrumental = coalesce(p_instrumental, instrumental),
      audio_url = coalesce(p_audio_url, audio_url),
      audio_sha256 = coalesce(nullif(btrim(p_audio_sha256), ''), audio_sha256),
      cover_url = coalesce(p_cover_url, cover_url),
      rights_confirmed_at = now(), rights_confirmed_by = v_uid,
      release_status = 'submitted', submitted_at = now(),
      resubmitted_at = now(),
      submission_version = submission_version + 1,
      audio_review_status = 'pending', cover_review_status = 'pending', metadata_review_status = 'pending',
      review_started_at = null, admin_review_note = null,
      changes_requested_reason = null
    where id = p_track_id;
    return p_track_id;
  end if;

  -- 신규 INSERT 경로
  if p_audio_url is null then raise exception 'audio_url required for new release'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'title required'; end if;
  if p_album_name is null or length(btrim(p_album_name)) = 0 then raise exception 'album_name required'; end if;

  -- (a) sha256 기반 강한 중복 가드 — 같은 아티스트가 동일 해시 파일 재업로드 시 기존 row 반환
  if p_audio_sha256 is not null and length(btrim(p_audio_sha256)) > 0 then
    select id into v_dup_row from public.tracks
    where owner_user_id = v_uid
      and source_type = 'artist_upload'
      and audio_sha256 = btrim(p_audio_sha256)
    limit 1;
    if v_dup_row.id is not null then
      return v_dup_row.id;
    end if;
  end if;

  -- (b) 60초 audio_url 가드 (0064) — sha256 없는 케이스 보호
  select id into v_dup_row from public.tracks
  where owner_user_id = v_uid and source_type = 'artist_upload'
    and audio_url = p_audio_url and created_at >= now() - interval '60 seconds'
  order by created_at desc limit 1;
  if v_dup_row.id is not null then return v_dup_row.id; end if;

  insert into public.tracks (
    title, artist, album_name, release_title, release_type, release_date,
    main_genre, sub_genre, mood, suitable_store, lyrics,
    isrc, rights_holder_name, rights_confirmed_at, rights_confirmed_by,
    explicit_content, instrumental, audio_url, audio_sha256, cover_url,
    owner_user_id, artist_profile_id, payout_account_id,
    uploaded_by_account_type, source_type,
    release_status, submitted_at, submission_version,
    audio_review_status, cover_review_status, metadata_review_status
  ) values (
    btrim(p_title), coalesce(nullif(btrim(p_artist), ''), v_artist_name),
    btrim(p_album_name), nullif(btrim(p_release_title), ''),
    p_release_type, p_release_date,
    nullif(btrim(p_main_genre), ''), nullif(btrim(p_sub_genre), ''),
    nullif(btrim(p_mood), ''), nullif(btrim(p_suitable_store), ''),
    nullif(btrim(p_lyrics), ''), nullif(btrim(p_isrc), ''),
    coalesce(nullif(btrim(p_rights_holder_name), ''), v_real_name, v_artist_name),
    now(), v_uid,
    coalesce(p_explicit_content, false), coalesce(p_instrumental, false),
    p_audio_url, nullif(btrim(p_audio_sha256), ''), p_cover_url,
    v_uid, v_profile_id, v_payout_id,
    'artist', 'artist_upload',
    'submitted', now(), 1,
    'pending', 'pending', 'pending'
  ) returning id into v_track_id;
  return v_track_id;
end;
$$;

grant execute on function public.submit_artist_release(
  uuid, text, text, text, text, text, date, text, text, text, text, text, text, text,
  boolean, boolean, text, text, boolean, text
) to authenticated;

-- 0064 의 함수도 호환 유지 (oldest signature 없으면 위 함수만 존재)

-- ----------------------
-- 3) _tracks_release_protect 강화 — released 후 핵심 메타데이터 변경 차단
-- ----------------------
create or replace function public._tracks_release_protect()
returns trigger language plpgsql as $$
begin
  -- released 상태에서는 핵심 메타데이터 / 발매 / 권리 컬럼 변경 차단
  if OLD.release_status = 'released' then
    if NEW.release_status <> 'released' then
      raise exception 'released track is immutable on release_status (id=%)', OLD.id
        using errcode = '42501';
    end if;
    if NEW.release_date is distinct from OLD.release_date
       or NEW.release_type is distinct from OLD.release_type
       or NEW.released_at is distinct from OLD.released_at then
      raise exception 'released track is immutable on release_* fields (id=%)', OLD.id
        using errcode = '42501';
    end if;
    -- 0065: 핵심 메타데이터/audio/권리 컬럼도 차단
    if NEW.title is distinct from OLD.title
       or NEW.audio_url is distinct from OLD.audio_url
       or NEW.audio_sha256 is distinct from OLD.audio_sha256
       or NEW.isrc is distinct from OLD.isrc
       or NEW.rights_holder_name is distinct from OLD.rights_holder_name
       or NEW.rights_confirmed_at is distinct from OLD.rights_confirmed_at
       or NEW.album_name is distinct from OLD.album_name
       or NEW.release_title is distinct from OLD.release_title
       or NEW.owner_user_id is distinct from OLD.owner_user_id
       or NEW.artist_profile_id is distinct from OLD.artist_profile_id
       or NEW.payout_account_id is distinct from OLD.payout_account_id then
      raise exception 'released track core metadata is immutable (id=%)', OLD.id
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$$;

-- ----------------------
-- 4) settlement_items / artist_settlements snapshot 컬럼 보강
-- ----------------------
alter table public.settlement_items
  add column if not exists isrc text,
  add column if not exists release_date date,
  add column if not exists release_title text,
  add column if not exists rights_holder_name text;

alter table public.artist_settlements
  add column if not exists artist_email text,
  add column if not exists sales_agent_code text;

-- ----------------------
-- 5) admin_generate_monthly_settlement 갱신 — 새 snapshot 필드 채우기
--    (0060 의 본문 그대로 + INSERT 부분에 새 컬럼 추가)
-- ----------------------
create or replace function public.admin_generate_monthly_settlement(
  p_month date,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_policy record;
  v_platform_revenue bigint;
  v_pool_revenue bigint;
  v_total_streams bigint;
  v_artist record;
  v_existing record;
  v_payout record;
  v_sales_agent record;
  v_artist_email text;
  v_gross bigint;
  v_company_fee bigint;
  v_agent_fee bigint;
  v_artist_net bigint;
  v_prev_carried bigint;
  v_total bigint;
  v_meets_min boolean;
  v_withholding bigint;
  v_final_payout bigint;
  v_carried_over bigint;
  v_settlement_id uuid;
  v_track record;
  v_track_streams int;
  v_track_amount bigint;
  v_generated int := 0;
  v_overwritten int := 0;
  v_skipped int := 0;
  v_payable int := 0;
  v_carried_count int := 0;
  v_sum_gross bigint := 0;
  v_sum_company bigint := 0;
  v_sum_agent bigint := 0;
  v_sum_final bigint := 0;
  v_sum_carried bigint := 0;
  v_skipped_arr jsonb := '[]'::jsonb;
  v_run_id uuid;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  perform pg_advisory_xact_lock(hashtext('settlement_gen:' || p_month::text));

  select * into v_policy from public.settlement_policies
  where effective_from <= p_month
  order by effective_from desc limit 1;
  if v_policy.id is null then raise exception 'no settlement policy effective for %', p_month; end if;

  v_month_start := (p_month::timestamp at time zone 'Asia/Seoul');
  v_month_end := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  select coalesce(sum(po.amount), 0)::bigint into v_platform_revenue
  from public.payment_orders po
  where po.status = 'paid'
    and coalesce(po.paid_at, po.created_at) >= v_month_start
    and coalesce(po.paid_at, po.created_at) <  v_month_end;
  v_pool_revenue := floor(v_platform_revenue * v_policy.pool_revenue_ratio);

  select coalesce(count(*), 0)::bigint into v_total_streams
  from public.stream_events se
  join public.eligible_settlement_tracks et on et.track_id = se.track_id
  where se.event_type = 'milestone_30s'
    and se.created_at >= v_month_start
    and se.created_at <  v_month_end;

  for v_artist in
    select et.artist_user_id, count(distinct et.track_id) as track_count
    from public.eligible_settlement_tracks et
    where exists (
      select 1 from public.stream_events se
      where se.track_id = et.track_id
        and se.event_type = 'milestone_30s'
        and se.created_at >= v_month_start
        and se.created_at <  v_month_end
    )
    group by et.artist_user_id
  loop
    select id, status into v_existing
    from public.artist_settlements
    where settlement_month = p_month and artist_user_id = v_artist.artist_user_id;
    if v_existing.id is not null and v_existing.status <> 'pending' then
      v_skipped := v_skipped + 1;
      v_skipped_arr := v_skipped_arr || jsonb_build_object(
        'artist_user_id', v_artist.artist_user_id,
        'existing_status', v_existing.status,
        'reason', 'finalized_or_paid'
      );
      continue;
    end if;

    v_gross := 0;
    for v_track in
      select et.track_id, et.track_code, t.title as track_title,
             t.isrc, t.release_date, t.release_title, t.rights_holder_name
      from public.eligible_settlement_tracks et
      join public.tracks t on t.id = et.track_id
      where et.artist_user_id = v_artist.artist_user_id
    loop
      select coalesce(count(*), 0)::int into v_track_streams
      from public.stream_events se
      where se.track_id = v_track.track_id
        and se.event_type = 'milestone_30s'
        and se.created_at >= v_month_start
        and se.created_at <  v_month_end;
      if v_track_streams = 0 or v_total_streams = 0 then
        v_track_amount := 0;
      else
        v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint;
      end if;
      v_gross := v_gross + v_track_amount;
      if not p_dry_run then
        insert into public.streaming_revenues (
          revenue_month, artist_user_id, track_id, track_code,
          stream_count, total_pool_revenue, total_pool_streams,
          gross_artist_amount, policy_id
        ) values (
          p_month, v_artist.artist_user_id, v_track.track_id, v_track.track_code,
          v_track_streams, v_pool_revenue, v_total_streams, v_track_amount, v_policy.id
        ) on conflict (revenue_month, artist_user_id, track_id) do update set
          stream_count = excluded.stream_count,
          total_pool_revenue = excluded.total_pool_revenue,
          total_pool_streams = excluded.total_pool_streams,
          gross_artist_amount = excluded.gross_artist_amount,
          policy_id = excluded.policy_id,
          computed_at = now();
      end if;
    end loop;

    v_company_fee := floor(v_gross * v_policy.company_fee_ratio)::bigint;

    select u.sales_agent_id, sa.commission_rate, sa.code into v_sales_agent
    from public.users u
    left join public.sales_agents sa on sa.id = u.sales_agent_id
    where u.id = v_artist.artist_user_id;

    if v_sales_agent.sales_agent_id is not null and v_sales_agent.commission_rate is not null then
      v_agent_fee := floor(v_gross * v_sales_agent.commission_rate / 100.0)::bigint;
    else
      v_agent_fee := 0;
    end if;
    v_artist_net := greatest(v_gross - v_company_fee - v_agent_fee, 0);

    select coalesce(carried_over_amount, 0)::bigint into v_prev_carried
    from public.artist_settlements
    where artist_user_id = v_artist.artist_user_id
      and settlement_month < p_month
      and status in ('carried_over','payable','paid','held','disputed')
    order by settlement_month desc limit 1;
    v_prev_carried := coalesce(v_prev_carried, 0);
    v_total := v_artist_net + v_prev_carried;

    if v_policy.min_payout_basis = 'gross' then
      v_meets_min := (v_total >= v_policy.min_payout_amount);
    else
      v_meets_min := ((v_total - floor(v_total * v_policy.withholding_tax_ratio)) >= v_policy.min_payout_amount);
    end if;

    if v_meets_min then
      v_withholding := floor(v_total * v_policy.withholding_tax_ratio)::bigint;
      v_final_payout := v_total - v_withholding;
      v_carried_over := 0;
    else
      v_withholding := 0;
      v_final_payout := 0;
      v_carried_over := v_total;
    end if;

    select pa.id, pa.bank_name, pa.account_holder, pa.account_number into v_payout
    from public.artist_payout_accounts pa
    where pa.user_id = v_artist.artist_user_id and pa.verification_status = 'verified';

    -- 0065: artist_email snapshot
    select au.email::text into v_artist_email from auth.users au where au.id = v_artist.artist_user_id;

    v_sum_gross := v_sum_gross + v_gross;
    v_sum_company := v_sum_company + v_company_fee;
    v_sum_agent := v_sum_agent + v_agent_fee;
    v_sum_final := v_sum_final + v_final_payout;
    v_sum_carried := v_sum_carried + v_carried_over;
    if v_meets_min then v_payable := v_payable + 1; else v_carried_count := v_carried_count + 1; end if;

    if not p_dry_run then
      if v_existing.id is not null then
        delete from public.settlement_items where settlement_id = v_existing.id;
        v_settlement_id := v_existing.id;
        v_overwritten := v_overwritten + 1;
        update public.artist_settlements set
          policy_id = v_policy.id,
          gross_settlement_amount = v_gross,
          company_fee_amount = v_company_fee,
          sales_agent_id = v_sales_agent.sales_agent_id,
          sales_agent_code = v_sales_agent.code,             -- 0065
          sales_agent_commission_rate = v_sales_agent.commission_rate,
          sales_agent_fee_amount = v_agent_fee,
          artist_net_settlement = v_artist_net,
          previous_carried_amount = v_prev_carried,
          total_settlement_amount = v_total,
          meets_min_payout = v_meets_min,
          withholding_tax_amount = v_withholding,
          final_payout_amount = v_final_payout,
          carried_over_amount = v_carried_over,
          payout_account_id = v_payout.id,
          payout_bank_name = v_payout.bank_name,
          payout_account_holder = v_payout.account_holder,
          masked_account_number = public._mask_account_number(v_payout.account_number),
          artist_email = v_artist_email,                     -- 0065
          status = 'pending'
        where id = v_existing.id;
      else
        insert into public.artist_settlements (
          settlement_month, artist_user_id, policy_id,
          gross_settlement_amount, company_fee_amount,
          sales_agent_id, sales_agent_code, sales_agent_commission_rate, sales_agent_fee_amount,
          artist_net_settlement, previous_carried_amount, total_settlement_amount,
          meets_min_payout, withholding_tax_amount, final_payout_amount, carried_over_amount,
          payout_account_id, payout_bank_name, payout_account_holder, masked_account_number,
          artist_email, status, created_by
        ) values (
          p_month, v_artist.artist_user_id, v_policy.id,
          v_gross, v_company_fee,
          v_sales_agent.sales_agent_id, v_sales_agent.code, v_sales_agent.commission_rate, v_agent_fee,
          v_artist_net, v_prev_carried, v_total,
          v_meets_min, v_withholding, v_final_payout, v_carried_over,
          v_payout.id, v_payout.bank_name, v_payout.account_holder,
          public._mask_account_number(v_payout.account_number),
          v_artist_email, 'pending', v_uid
        ) returning id into v_settlement_id;
        v_generated := v_generated + 1;
      end if;

      for v_track in
        select et.track_id, et.track_code, t.title as track_title,
               t.isrc, t.release_date, t.release_title, t.rights_holder_name
        from public.eligible_settlement_tracks et
        join public.tracks t on t.id = et.track_id
        where et.artist_user_id = v_artist.artist_user_id
      loop
        select coalesce(count(*), 0)::int into v_track_streams
        from public.stream_events se
        where se.track_id = v_track.track_id
          and se.event_type = 'milestone_30s'
          and se.created_at >= v_month_start
          and se.created_at <  v_month_end;
        if v_track_streams > 0 then
          v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint;
          insert into public.settlement_items (
            settlement_id, artist_user_id, track_id, track_code, track_title,
            stream_count, pool_revenue_share,
            isrc, release_date, release_title, rights_holder_name        -- 0065
          ) values (
            v_settlement_id, v_artist.artist_user_id, v_track.track_id, v_track.track_code,
            v_track.track_title, v_track_streams, v_track_amount,
            v_track.isrc, v_track.release_date, v_track.release_title, v_track.rights_holder_name
          );
        end if;
      end loop;
    else
      if v_existing.id is not null then v_overwritten := v_overwritten + 1;
      else v_generated := v_generated + 1; end if;
    end if;
  end loop;

  insert into public.settlement_generation_runs (
    run_by, settlement_month, dry_run, policy_id,
    platform_revenue, pool_revenue, total_pool_streams,
    generated_count, overwritten_count, skipped_count,
    payable_count, carried_over_count,
    total_gross, total_company_fee, total_sales_agent_fee,
    total_final_payout, total_carried_over, skipped_artists
  ) values (
    v_uid, p_month, p_dry_run, v_policy.id,
    v_platform_revenue, v_pool_revenue, v_total_streams,
    v_generated, v_overwritten, v_skipped,
    v_payable, v_carried_count,
    v_sum_gross, v_sum_company, v_sum_agent,
    v_sum_final, v_sum_carried, v_skipped_arr
  ) returning id into v_run_id;

  return jsonb_build_object(
    'ok', true, 'run_id', v_run_id, 'dry_run', p_dry_run,
    'settlement_month', p_month,
    'platform_revenue', v_platform_revenue,
    'pool_revenue', v_pool_revenue,
    'total_pool_streams', v_total_streams,
    'generated', v_generated, 'overwritten', v_overwritten, 'skipped', v_skipped,
    'payable', v_payable, 'carried_over', v_carried_count,
    'total_gross', v_sum_gross, 'total_company_fee', v_sum_company,
    'total_sales_agent_fee', v_sum_agent,
    'total_final_payout', v_sum_final, 'total_carried_over', v_sum_carried,
    'skipped_artists', v_skipped_arr
  );
end;
$$;
grant execute on function public.admin_generate_monthly_settlement(date, boolean) to authenticated;
