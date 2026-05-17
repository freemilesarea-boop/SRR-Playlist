-- 0072 — sign_artist_contract: pgcrypto digest() 스키마 정규화 (긴급 핫픽스)
--
-- 증상:
--   POST /rest/v1/rpc/sign_artist_contract 호출 실패
--   실제 SQL error: ERROR 42883 function digest(text, unknown) does not exist
--   사용자 콘솔에는 PostgREST 응답으로 404 또는 400 표시
--
-- 근본 원인:
--   - pgcrypto 확장이 'extensions' 스키마에 설치됨 (Supabase 표준 설정)
--   - 함수 정의의 SET search_path TO 'public' 가 extensions 를 포함하지 않음
--   - 본문의 bare digest(...) 호출이 search_path 에서 함수를 못 찾음
--
-- 조치:
--   1) digest() 호출을 extensions.digest(...) 로 schema 명시
--   2) 첫 번째 인자를 명시적으로 bytea cast (digest 시그니처 안전성)
--   3) 다른 동작 로직 / RLS / RPC 시그니처 / GRANT 모두 0068 과 동일
--
-- 검증:
--   - SQL 시뮬레이션 (957c240c minseo + f46940a4 pending contract) 호출 →
--     status='signed', users.contract_status='signed' 전환 확인 (rollback)
--   - contract_hash sha256 생성 정상
--   - contract_email_jobs 큐 INSERT 정상 (artist + freemilesarea + admin*)
--   - email_status='queued', admin_email_delivery_count 카운트 정상

create or replace function public.sign_artist_contract(
  p_contract_id uuid,
  p_signed_ip text default null,
  p_signed_user_agent text default null
)
returns table (contract_id uuid, status text, signed_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_contract record;
  v_signed_at timestamptz;
  v_artist_email text;
  v_subject text;
  v_recipients text[];
  v_e text;
  v_admin_count int := 0;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select c.id, c.artist_user_id, c.status, c.expires_at, c.contract_body, c.contract_version
    into v_contract
  from public.artist_contracts c where c.id = p_contract_id;
  if v_contract.id is null then raise exception 'contract not found'; end if;
  if v_contract.artist_user_id <> v_uid then raise exception 'forbidden'; end if;
  if v_contract.status <> 'pending_signature' then
    raise exception 'cannot sign contract in status=%', v_contract.status;
  end if;
  if v_contract.expires_at is not null and v_contract.expires_at < now() then
    update public.artist_contracts set status = 'expired' where id = p_contract_id;
    raise exception 'contract expired at %', v_contract.expires_at;
  end if;

  v_signed_at := now();

  update public.artist_contracts as c
  set status = 'signed',
      signed_at = v_signed_at,
      signed_ip = nullif(btrim(coalesce(p_signed_ip, '')), '')::inet,
      signed_user_agent = nullif(btrim(coalesce(p_signed_user_agent, '')), ''),
      contract_hash = encode(
        extensions.digest(
          (coalesce(c.contract_body,'') || '|' ||
           v_contract.artist_user_id::text || '|' ||
           to_char(v_signed_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::bytea,
          'sha256'
        ),
        'hex'
      )
  where c.id = p_contract_id;

  update public.users set contract_status = 'signed' where id = v_uid;

  -- 이메일 큐잉 — 실패해도 signed 유지 (sub-block)
  begin
    select au.email::text into v_artist_email
    from auth.users au where au.id = v_uid;

    v_subject := '[스르륵 플리] 아티스트 계약 체결 완료 - 버전 ' || v_contract.contract_version;

    v_recipients := array[]::text[];
    if v_artist_email is not null and length(btrim(v_artist_email)) > 0 then
      v_recipients := v_recipients || v_artist_email;
    end if;
    if not 'freemilesarea@gmail.com' = any(v_recipients) then
      v_recipients := v_recipients || 'freemilesarea@gmail.com';
    end if;

    if v_artist_email is not null then
      insert into public.contract_email_jobs
        (contract_id, recipient_email, recipient_kind, recipient_user_id, subject)
      values
        (p_contract_id, v_artist_email, 'artist', v_uid, v_subject);
    end if;

    insert into public.contract_email_jobs
      (contract_id, recipient_email, recipient_kind, subject)
    values
      (p_contract_id, 'freemilesarea@gmail.com', 'hardcoded', v_subject);

    insert into public.contract_email_jobs
      (contract_id, recipient_email, recipient_kind, recipient_user_id, subject)
    select distinct
      p_contract_id, au.email::text, 'admin', u.id, v_subject
    from public.users u
    join auth.users au on au.id = u.id
    where u.role = 'admin'
      and au.email is not null
      and au.email::text <> coalesce(v_artist_email, '')
      and au.email::text <> 'freemilesarea@gmail.com'
      and not exists (
        select 1 from public.contract_email_jobs j
        where j.contract_id = p_contract_id and j.recipient_email = au.email::text
      );

    get diagnostics v_admin_count = row_count;

    update public.artist_contracts
      set email_status = 'queued',
          admin_email_delivery_count = v_admin_count
    where id = p_contract_id;
  exception when others then
    get stacked diagnostics v_e = message_text;
    update public.artist_contracts
      set last_email_error = 'enqueue failed: ' || v_e,
          email_status = 'failed'
    where id = p_contract_id;
  end;

  return query
  select c.id, c.status::text, c.signed_at
  from public.artist_contracts c where c.id = p_contract_id;
end;
$function$;

grant execute on function public.sign_artist_contract(uuid, text, text) to authenticated;

NOTIFY pgrst, 'reload schema';
