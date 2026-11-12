-- 0551_announcement_eligibility.sql
--
-- 이 로그인 계정이 안내방송을 받아야 하는 매장인지 — 클라이언트 수신 여부 판정용.
--
-- 왜
--   안내방송 수신(AnnouncementOverlay)은 사업자 계정 / 매장 모드에서만 켜졌다.
--   2026-11-12 ming: 본사가 브랜드 플레이어로 재생했는데, 그 계정이 '개인/무료' 라
--   수신이 아예 켜지지 않아 안내가 나가지 않았다. 브랜드에 연결된 기기(가맹 매장 계정,
--   브랜드 플레이어 세션)라면 계정 종류와 무관하게 받아야 한다.
--
-- 판정 기준은 서버 송출 범위(_store_in_enterprise)와 같다:
--   · 활성 가맹 매장(franchise_stores ↔ enterprise_franchises)
--   · 만료·해지되지 않은 브랜드 플레이어 세션

create or replace function public.my_announcement_eligible()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.franchise_stores fs
              join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
             where fs.store_id = auth.uid() and fs.status = 'active')
    or exists (select 1 from public.brand_player_sessions bps
                where bps.user_id = auth.uid() and bps.enterprise_account_id is not null
                  and bps.revoked_at is null and (bps.expires_at is null or bps.expires_at > now()))
  );
$$;

revoke all on function public.my_announcement_eligible() from public, anon;
grant execute on function public.my_announcement_eligible() to authenticated;
