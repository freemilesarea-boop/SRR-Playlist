-- 0237 — Phase X1.2.3 taxonomy_moods 4종 추가 (운영 mood 일치율 개선)
--
-- X1.2.2 233곡 백필 결과에서 71곡이 taxonomy 누락으로 영구 일치 불가:
--   - 감각적인 29곡 → sensual
--   - 편안한 25곡 → relaxed
--   - 신나는 9곡 → exciting
--   - 활기찬 8곡 → lively
--
-- sort_order 배치 (의미적 인접 유지):
--   10  calm
--   15  relaxed   ← 신규 (calm 과 warm 사이)
--   20  warm
--   30  bright
--   35  lively    ← 신규 (bright 와 happy 사이)
--   40  happy
--   50  emotional
--   55  romantic
--   60  dreamy
--   65  sensual   ← 신규 (dreamy 와 chic 사이)
--   70  chic
--   80  luxurious
--   85  exciting  ← 신규 (luxurious 와 energetic 사이)
--   90  energetic
--   100 trendy
--   110 focused

insert into public.taxonomy_moods(slug, name_ko, name_en, description, sort_order) values
  ('relaxed',  '편안한',   'Relaxed',
   '부담 없고 편안한 분위기의 음악 — 카페 / 병원 / 대기공간 / 라운지',                15),
  ('lively',   '활기찬',   'Lively',
   '밝고 생동감 있는 음악 — 카페 / 리테일 / 키즈존 / 캐주얼 매장',                    35),
  ('sensual',  '감각적인', 'Sensual',
   '세련되고 감각적인 분위기 — 편집샵 / 뷰티샵 / 와인바 / 패션 공간',                 65),
  ('exciting', '신나는',   'Exciting',
   '흥겹고 리듬감 있는 음악 — 피트니스 / 매장 활력 / 이벤트 공간',                    85)
on conflict (slug) do update set
  name_ko     = excluded.name_ko,
  name_en     = excluded.name_en,
  description = excluded.description,
  sort_order  = excluded.sort_order;
