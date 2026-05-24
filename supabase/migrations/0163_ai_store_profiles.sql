-- 0163 — 매장 유형 프로파일(설정화). store_fit/exclusions/mismatch 계산의 단일 소스. (22종 seed)
create table if not exists public.ai_store_profiles (
  id uuid primary key default gen_random_uuid(),
  store_key text unique not null, store_label text not null,
  preferred_genres text[] default '{}', allowed_genres text[] default '{}', blocked_genres text[] default '{}',
  preferred_moods text[] default '{}', blocked_moods text[] default '{}', preferred_situations text[] default '{}',
  vocal_preference text default 'vocal_allowed', language_preference text[] default '{}',
  bpm_min int, bpm_max int, ideal_bpm_min int, ideal_bpm_max int,
  energy_min numeric, energy_max numeric, ideal_energy_min numeric, ideal_energy_max numeric,
  danceability_min numeric, acousticness_min numeric, instrumentalness_min numeric,
  vocal_presence_min numeric, vocal_presence_max numeric, brightness_min numeric, brightness_max numeric,
  loudness_max numeric, dynamic_range_min numeric,
  allow_strong_beat boolean default true, allow_drop boolean default true, allow_explicit boolean default false,
  require_clean_content boolean default false, conversation_friendly boolean default false,
  focus_friendly boolean default false, family_friendly boolean default false, luxury_mood boolean default false,
  trendy_priority numeric default 0, calm_priority numeric default 0, energy_priority numeric default 0,
  sort_order int default 100, active boolean default true, description text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.ai_store_profiles enable row level security;
drop policy if exists asp_admin_read on public.ai_store_profiles;
create policy asp_admin_read on public.ai_store_profiles for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
drop policy if exists asp_public_read on public.ai_store_profiles;
create policy asp_public_read on public.ai_store_profiles for select using (active);

insert into public.ai_store_profiles
(store_key, store_label, preferred_genres, blocked_genres, preferred_moods, blocked_moods, vocal_preference,
 ideal_bpm_min, ideal_bpm_max, bpm_min, bpm_max, ideal_energy_min, ideal_energy_max, energy_min, energy_max,
 danceability_min, acousticness_min, instrumentalness_min, vocal_presence_max, brightness_min, brightness_max,
 allow_strong_beat, allow_drop, require_clean_content, conversation_friendly, focus_friendly, family_friendly, luxury_mood,
 trendy_priority, calm_priority, energy_priority, sort_order, description) values
('gym','헬스장',array['kpop','pop','edm','hiphop'],array['ambient','classical','meditation'],array['energetic','hype'],array['calm','sad'],'vocal_preferred',120,160,100,175,0.7,1.0,0.55,1.0,0.55,null,null,null,0.4,null,true,true,false,false,false,false,false,1.0,0,1.0,10,'운동 텐션 유도'),
('pilates','필라테스',array['lofi','acoustic','chill','ambient'],array['edm','hiphop'],array['calm','warm'],array['aggressive'],'instrumental_first',60,105,50,120,0.2,0.55,0.1,0.65,null,0.45,0.4,0.55,null,0.7,false,false,false,false,true,false,false,0,1.0,0,20,'호흡/긴장완화'),
('yoga','요가',array['ambient','newage','meditation','nature'],array['edm','hiphop','rock'],array['calm','peaceful'],array['aggressive','dark'],'instrumental_first',40,85,35,100,0.05,0.4,0.0,0.5,null,0.5,0.55,0.4,null,0.55,false,false,false,false,true,false,false,0,1.0,0,30,'심박 안정/집중'),
('hospital','병원',array['classical','piano','lofi','ambient'],array['edm','hiphop','rock'],array['calm','soft'],array['anxious','dark','aggressive'],'instrumental_first',55,95,45,110,0.1,0.45,0.0,0.55,null,0.4,0.4,0.45,null,0.6,false,false,true,false,true,true,false,0,1.0,0,40,'대기 스트레스 감소'),
('cafe_independent','카페_개인',array['indiepop','jazzpop','lofi'],array['edm'],array['emotional','chill','warm'],array['aggressive'],'vocal_allowed',70,115,60,130,0.25,0.65,0.15,0.75,null,0.4,null,0.8,0.3,0.7,true,true,false,true,false,false,false,0.3,0.5,0.2,50,'감성/체류시간 증가'),
('cafe_franchise','카페_프렌차이즈',array['kpop','indiepop','pop','jazzpop'],array[]::text[],array['bright','trendy'],array['dark'],'vocal_allowed',80,125,70,140,0.4,0.75,0.3,0.85,0.45,null,null,null,0.45,null,true,true,false,false,false,false,false,0.7,0,0.6,60,'밝고 텐션 있는 분위기'),
('winebar','와인바',array['jazz','soul','smoothpop'],array['edm','hiphop'],array['luxury','smooth'],array['aggressive'],'instrumental_first',55,100,45,115,0.15,0.55,0.05,0.65,null,0.4,0.4,0.6,null,0.6,false,false,false,true,false,false,true,0.3,0.6,0,70,'심야/고급 분위기'),
('cocktail_bar','칵테일바',array['deephouse','lounge','nujazz'],array[]::text[],array['trendy','luxury'],array[]::text[],'vocal_allowed',90,125,80,140,0.45,0.75,0.35,0.85,0.5,null,null,null,0.4,null,true,true,false,false,false,false,true,0.8,0,0.6,80,'힙하고 감각적인 야간'),
('restaurant','식당',array['jazzpop','acousticpop','bossanova','kpop'],array['edm'],array['warm','pleasant'],array['aggressive'],'lyrics_restricted',65,115,55,130,0.25,0.65,0.15,0.75,null,0.35,null,0.7,null,null,true,true,false,true,false,true,false,0.2,0.4,0.2,90,'대화/식사 흐름'),
('korean_restaurant','한식당',array['acoustic','kpop','korean_indie','fusion'],array['edm','hiphop'],array['warm','comfortable'],array['aggressive'],'vocal_allowed',60,110,50,125,0.25,0.6,0.15,0.7,null,0.4,null,0.8,null,null,true,true,false,true,false,true,false,0.1,0.5,0.2,100,'편안한 식사'),
('brunch_cafe','브런치카페',array['citypop','jazzpop','acoustic'],array['edm'],array['warm','sunny','sns'],array['dark'],'vocal_allowed',75,120,65,135,0.35,0.7,0.25,0.8,null,0.35,null,null,0.5,null,true,true,false,true,false,false,false,0.5,0.3,0.4,110,'낮 시간 산뜻함'),
('office','사무실',array['lofi','piano','jazz'],array['edm','hiphop'],array['focus','calm'],array['intense','aggressive'],'instrumental_first',60,105,50,120,0.15,0.5,0.05,0.6,null,0.4,0.45,0.4,null,0.65,false,false,false,false,true,false,false,0,0.8,0,120,'업무 집중/장시간'),
('coworking','코워킹스페이스',array['lofi','chillpop','jazzhiphop','ambient'],array['edm'],array['focus','chill'],array['aggressive'],'vocal_allowed',70,115,60,130,0.25,0.65,0.15,0.75,null,0.35,0.3,0.65,null,null,true,false,false,false,true,false,false,0.5,0.4,0.3,130,'스타트업 감성/적당한 텐션'),
('salon','미용실',array['pop','kpop','trendy'],array['hiphop'],array['bright','trendy'],array['dark','sad'],'vocal_allowed',85,130,75,145,0.45,0.8,0.35,0.9,0.45,null,null,null,0.5,null,true,true,false,false,false,false,false,0.7,0,0.6,140,'세련됨/대기 지루함 감소'),
('nail_shop','네일샵',array['softpop','lofi','jazzpop'],array['edm','hiphop'],array['bright','soft'],array['aggressive'],'vocal_allowed',70,115,60,130,0.25,0.6,0.15,0.7,null,0.35,null,0.8,0.4,0.85,true,false,false,true,false,false,false,0.4,0.4,0.2,150,'긴 시술시간 피로감 감소'),
('hotel_lobby','호텔로비',array['classical','lounge','jazz'],array['kpop','hiphop'],array['luxury','elegant'],array['aggressive'],'instrumental_first',55,105,45,120,0.15,0.55,0.05,0.65,null,0.4,0.5,0.5,null,0.6,false,false,false,false,false,false,true,0.2,0.6,0,160,'브랜드 이미지/국제적 무드'),
('select_shop','편집샵',array['indiepop','house','alternative','pop_instrumental'],array[]::text[],array['unique','viral','trendy'],array[]::text[],'vocal_allowed',90,135,80,150,0.45,0.85,0.35,0.95,0.5,null,null,null,0.45,null,true,true,false,false,false,false,false,1.0,0,0.7,170,'힙함/브랜드 정체성'),
('clothing_store','의류매장',array['pop','kpop','house','trendy'],array['ambient','classical'],array['bright','trendy'],array['calm','sad'],'vocal_allowed',90,135,80,150,0.45,0.85,0.35,0.95,0.5,null,null,null,0.45,null,true,true,false,false,false,false,false,1.0,0,0.8,180,'쇼핑 텐션/시즌 무드'),
('kids_cafe','키즈카페',array['kids','brightpop','family'],array['hiphop'],array['bright','happy'],array['dark','sad','aggressive'],'vocal_allowed',80,130,70,145,0.35,0.75,0.25,0.85,null,null,null,null,0.5,null,true,false,true,false,false,true,false,0.4,0.2,0.4,190,'안전한 콘텐츠/아이 스트레스 방지'),
('dog_cafe','애견카페',array['acoustic','lofi','softpop'],array['edm'],array['warm','calm'],array['aggressive'],'vocal_allowed',60,110,50,125,0.2,0.55,0.1,0.65,null,0.45,null,0.7,null,null,false,false,false,true,false,true,false,0.1,0.6,0,200,'동물 스트레스 최소화'),
('pc_bang','PC방',array['edm','hiphop','rock','kpop','pop'],array['ambient','classical'],array['hype','energetic'],array['calm','sad'],'vocal_preferred',110,160,95,175,0.65,1.0,0.5,1.0,0.55,null,null,null,0.4,null,true,true,true,false,false,false,false,1.0,0,1.0,210,'텐션 유지/야간 플레이'),
('fine_dining','파인다이닝',array['classical','jazz'],array['edm','hiphop','kpop'],array['luxury','elegant','calm'],array['aggressive'],'instrumental_first',45,95,40,110,0.1,0.45,0.0,0.55,null,0.45,0.5,0.4,null,0.55,false,false,false,true,false,false,true,0,1.0,0,220,'고급 식사 경험 방해 금지')
on conflict (store_key) do nothing;
