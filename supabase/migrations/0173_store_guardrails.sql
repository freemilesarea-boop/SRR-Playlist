-- 0173 — 매장별 절대 금지 규칙(Hard Guardrails) 테이블 + seed + 관리자 override. additive.
create table if not exists public.store_guardrails (
  id uuid primary key default gen_random_uuid(),
  store_key text not null, rule_key text not null, rule_type text not null, operator text not null, value text not null,
  severity text not null default 'hard_block' check (severity in ('warning','soft_block','hard_block')),
  reason text, enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_sg_store on public.store_guardrails(store_key, enabled);
alter table public.store_guardrails enable row level security;
drop policy if exists sg_read on public.store_guardrails;
create policy sg_read on public.store_guardrails for select using (true);

create table if not exists public.store_guardrail_overrides (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade, store_key text not null,
  reason text, created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now(),
  unique (track_id, store_key)
);
alter table public.store_guardrail_overrides enable row level security;
drop policy if exists sgo_admin_read on public.store_guardrail_overrides;
create policy sgo_admin_read on public.store_guardrail_overrides for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

insert into public.store_guardrails(store_key, rule_key, rule_type, operator, value, severity, reason) values
('gym','min_energy','numeric','<','0.45','hard_block','운동 텐션 부족(저에너지)'),('gym','min_bpm','numeric','<','75','hard_block','BPM 너무 낮음'),('gym','max_acousticness','numeric','>','0.8','soft_block','과한 어쿠스틱'),
('pilates','max_bpm','numeric','>','120','hard_block','BPM 과다'),('pilates','banned_genre','genre','contains','edm','hard_block','하드 EDM 드롭'),('pilates','max_energy','numeric','>','0.7','soft_block','에너지 과다'),
('yoga','max_bpm','numeric','>','95','hard_block','BPM 과다'),('yoga','max_energy','numeric','>','0.55','hard_block','에너지 과다'),('yoga','banned_genre','genre','contains','edm','hard_block','EDM 금지'),('yoga','banned_genre','genre','contains','hiphop','hard_block','aggressive hiphop 금지'),('yoga','max_brightness','numeric','>','0.78','soft_block','과한 고역'),
('hospital','max_energy','numeric','>','0.55','hard_block','에너지 과다'),('hospital','max_bpm','numeric','>','105','hard_block','BPM 과다'),('hospital','banned_genre','genre','contains','edm','hard_block','EDM 금지'),('hospital','banned_genre','genre','contains','hiphop','hard_block','aggressive hiphop 금지'),('hospital','banned_genre','genre','contains','trap','hard_block','trap 금지'),('hospital','banned_explicit','flag','is_true','true','hard_block','explicit 금지'),
('cafe_independent','banned_genre','genre','contains','edm','soft_block','festival EDM'),('cafe_independent','max_energy','numeric','>','0.85','soft_block','피로 유발 고에너지'),
('cafe_franchise','banned_genre','genre','contains','drill','hard_block','hard drill'),('cafe_franchise','banned_mood','mood','contains','dark','soft_block','우울/다크'),
('winebar','max_bpm','numeric','>','115','hard_block','BPM 과다'),('winebar','banned_genre','genre','contains','edm','hard_block','gym/festival EDM'),('winebar','banned_genre','genre','contains','hyperpop','hard_block','hyperpop'),('winebar','max_energy','numeric','>','0.65','soft_block','에너지 과다'),('winebar','max_brightness','numeric','>','0.75','soft_block','과한 고역'),
('cocktail_bar','min_energy','numeric','<','0.3','soft_block','sleepy ambient'),('cocktail_bar','banned_genre','genre','contains','metal','hard_block','hard metal'),
('restaurant','max_bpm','numeric','>','130','hard_block','BPM 과다'),('restaurant','max_vocal_presence','numeric','>','0.88','soft_block','보컬 과다'),
('korean_restaurant','banned_genre','genre','contains','hyperpop','hard_block','hyperpop'),('korean_restaurant','banned_genre','genre','contains','edm','soft_block','western club EDM'),
('brunch_cafe','banned_mood','mood','contains','dark','soft_block','dark aggressive'),('brunch_cafe','banned_genre','genre','contains','trap','soft_block','dark trap'),
('office','max_bpm','numeric','>','115','hard_block','BPM 과다'),('office','banned_explicit','flag','is_true','true','hard_block','explicit rap'),('office','max_vocal_presence','numeric','>','0.8','soft_block','가사 집중 방해'),('office','max_energy','numeric','>','0.65','soft_block','에너지 과다'),
('coworking','min_energy','numeric','<','0.2','soft_block','sleepy ambient only'),('coworking','banned_genre','genre','contains','edm','soft_block','harsh EDM'),
('salon','banned_mood','mood','contains','dark','soft_block','우울'),('salon','banned_genre','genre','contains','hiphop','soft_block','ultra aggressive rap'),
('nail_shop','max_vocal_presence','numeric','>','0.88','soft_block','harsh'),('nail_shop','banned_genre','genre','contains','edm','soft_block','distorted EDM'),
('hotel_lobby','banned_genre','genre','contains','edm','hard_block','gym EDM'),('hotel_lobby','banned_genre','genre','contains','hiphop','soft_block','aggressive trap'),('hotel_lobby','max_energy','numeric','>','0.6','soft_block','에너지 과다'),
('select_shop','min_energy','numeric','<','0.3','soft_block','sleepy healing ambient'),
('clothing_store','min_energy','numeric','<','0.35','soft_block','funeral-like mood'),
('kids_cafe','banned_explicit','flag','is_true','true','hard_block','explicit 가사'),('kids_cafe','banned_genre','genre','contains','hiphop','hard_block','aggressive rap'),('kids_cafe','banned_genre','genre','contains','trap','hard_block','trap'),('kids_cafe','banned_mood','mood','contains','dark','hard_block','dark/horror'),('kids_cafe','banned_mood','mood','contains','aggressive','hard_block','violent'),('kids_cafe','max_bpm','numeric','>','140','hard_block','과속 BPM'),
('dog_cafe','max_energy','numeric','>','0.7','soft_block','과한 에너지'),('dog_cafe','banned_genre','genre','contains','edm','soft_block','strong EDM/bass'),
('pc_bang','min_energy','numeric','<','0.4','hard_block','저에너지'),('pc_bang','min_bpm','numeric','<','90','soft_block','BPM 낮음'),
('fine_dining','max_energy','numeric','>','0.5','hard_block','에너지 과다'),('fine_dining','banned_genre','genre','contains','edm','hard_block','festival EDM'),('fine_dining','banned_genre','genre','contains','hiphop','hard_block','aggressive rap'),('fine_dining','max_bpm','numeric','>','110','soft_block','BPM 과다')
on conflict do nothing;
