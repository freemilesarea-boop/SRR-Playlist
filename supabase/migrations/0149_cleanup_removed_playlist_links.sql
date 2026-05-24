-- 0149 — 카탈로그 플레이리스트에서 삭제/미발매/음원·자켓 누락 트랙 링크 정리 + 재발 방지 트리거.
--   원인: 음원 takedown(removed) 시 playlist_tracks 링크가 남아, 관리자(RLS 우회)·일부 경로에서
--   재생 불가 곡이 큐에 섞이고 "재생 가능 곡 수"가 실제와 어긋남(예: 9곡 중 6곡 removed).
--   조치: 재생 불가 트랙의 playlist_tracks 링크 삭제(트랙 자체는 보존). 향후 removed 전환 시 자동 정리.
--   (playlist_tracks = 큐레이션 연결 메타데이터. 결제/정산/스트림/계약 데이터 아님 — 안전.)

delete from public.playlist_tracks pt
using public.tracks t
where pt.track_id = t.id
  and (t.release_status = 'removed'
       or t.removed_at is not null
       or t.visibility_status = 'hidden'
       or t.audio_url is null or btrim(t.audio_url) = ''
       or t.cover_url is null or btrim(t.cover_url) = '');

-- 재발 방지: 트랙이 removed/hidden 으로 전환되면 카탈로그 플레이리스트 링크 자동 제거.
create or replace function public._tracks_cleanup_playlist_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if NEW.release_status = 'removed' or NEW.removed_at is not null or NEW.visibility_status = 'hidden' then
    delete from public.playlist_tracks where track_id = NEW.id;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_tracks_cleanup_playlist_links on public.tracks;
create trigger trg_tracks_cleanup_playlist_links
  after update of release_status, removed_at, visibility_status on public.tracks
  for each row execute function public._tracks_cleanup_playlist_links();
