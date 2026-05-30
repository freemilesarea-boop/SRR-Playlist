-- 0236 — Phase X1.2.2 taxonomy_moods 에 romantic 추가
--
-- 운영 데이터의 tracks.mood 에 "로맨틱한" 이 다수 존재하지만 X1.0 시드 11종에
-- romantic 슬러그가 없어서 AI 예측 ↔ 기존 mood 영구 불일치.
-- emotional/dreamy/luxurious 로 흡수하는 대신 별도 슬러그 추가.
--
-- sort_order = 55 (emotional 50, dreamy 60 사이 — 감성 계열 중간).

insert into public.taxonomy_moods(slug, name_ko, name_en, description, sort_order) values
  ('romantic', '로맨틱한', 'Romantic', '로맨틱하고 친밀한 분위기 — 와인바 / 디너 / 저녁 라운지', 55)
on conflict (slug) do update set
  name_ko = excluded.name_ko,
  name_en = excluded.name_en,
  description = excluded.description,
  sort_order = excluded.sort_order;
