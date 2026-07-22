-- BRAND-TEST-RECOVERY-1 — Synthetic Brand Player seed (TEST PROJECT ONLY).
-- No PII, no real brand/store names, no real audio metadata, no real store codes.
-- Public test fixtures for media/audio/covers. Idempotent by fixed ids.
-- DO NOT apply to Production.
--
-- Requires a synthetic auth user in auth.users (Test only), e.g.:
--   id = a0000000-0000-4000-8000-000000000001, email = qa-brand-user@test.invalid
-- (created out-of-band; password set via Supabase dashboard for browser QA — not stored here.)

begin;
delete from public.brand_media_assets   where brand_id in ('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000b2');
delete from public.brand_music_policies  where brand_id in ('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000b2');
delete from public.brand_signage_settings where brand_id in ('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000b2');
delete from public.brand_accounts        where id in ('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000b2');
delete from public.enterprise_accounts   where id in ('c0000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-0000000000b2');
delete from public.tracks                where id::text like 'd0000000-0000-4000-8000-%';

-- Stores (enterprise_accounts) + brands. Store codes are SYNTHETIC test values.
insert into public.enterprise_accounts(id, enterprise_name, store_invite_code, status, auth_user_id) values
  ('c0000000-0000-4000-8000-0000000000a1','QA Synthetic Store A','QA-STORE-ALPHA-7X3K9','active','a0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-0000000000b2','QA Synthetic Store B','QA-STORE-BETA-4M8P2','active','a0000000-0000-4000-8000-000000000001');
insert into public.brand_accounts(id, name, industry_type, status, enterprise_account_id) values
  ('b0000000-0000-4000-8000-0000000000a1','QA Synthetic Brand A','cafe','active','c0000000-0000-4000-8000-0000000000a1'),
  ('b0000000-0000-4000-8000-0000000000b2','QA Synthetic Brand B','retail','active','c0000000-0000-4000-8000-0000000000b2');

insert into public.brand_music_policies(brand_id, vocal_policy) values
  ('b0000000-0000-4000-8000-0000000000a1','any'),
  ('b0000000-0000-4000-8000-0000000000b2','any');
insert into public.brand_signage_settings(brand_id, transition_effect, show_slide_dots) values
  ('b0000000-0000-4000-8000-0000000000a1','fade', true);

-- Brand A media: logo + 2 images + 1 video (public test fixtures).
insert into public.brand_media_assets(brand_id, asset_type, title, image_url, display_duration_seconds, sort_order, status, mime_type, media_duration_seconds) values
  ('b0000000-0000-4000-8000-0000000000a1','image','QA Logo',  'https://picsum.photos/seed/qalogo/800/800',   8,0,'active','image/jpeg',null),
  ('b0000000-0000-4000-8000-0000000000a1','image','QA Image 1','https://picsum.photos/seed/qaimg1/1920/1080',10,1,'active','image/jpeg',null),
  ('b0000000-0000-4000-8000-0000000000a1','image','QA Image 2','https://picsum.photos/seed/qaimg2/1920/1080',10,2,'active','image/jpeg',null),
  ('b0000000-0000-4000-8000-0000000000a1','video','QA Video', 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',0,3,'active','video/mp4',10);

-- 15 synthetic tracks (public SoundHelix audio + picsum covers). release_status null (avoids release-metadata trigger; generator accepts null).
insert into public.tracks(id, title, artist, audio_url, cover_url, duration, main_genre, mood, energy_level, tempo_feel, instrumental, visibility_status, release_status)
select
  ('d0000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  'QA Track '||g, 'QA Artist '||((g%5)+1),
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-'||((g%10)+1)||'.mp3',
  'https://picsum.photos/seed/qatrk'||g||'/600/600',
  (150 + g*7),
  (array['Lo-fi','Jazz','House','Ambient','Pop'])[(g%5)+1],
  (array['차분한','신나는','편안한','활기찬','몽환적인'])[(g%5)+1],
  ((g%5)+1),
  (array['slow','medium','fast'])[(g%3)+1],
  (g%4=0), 'approved', null::text
from generate_series(1,15) g;
commit;
