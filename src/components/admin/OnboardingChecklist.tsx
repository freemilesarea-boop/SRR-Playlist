import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import type { PlaylistRow, TrackRow } from '@/types/db';
import { isPlayableTrack } from '@/lib/audio';
import { isStandalone } from '@/hooks/useInstallPrompt';

interface Props {
  tracks: TrackRow[];
  playlists: PlaylistRow[];
}

interface Item {
  key: string;
  label: string;
  done: boolean;
  detail?: string;
  /** 자동 감지 가능한 항목 */
  auto: boolean;
}

export default function OnboardingChecklist({ tracks, playlists }: Props) {
  const playableTracks = tracks.filter(isPlayableTrack);
  const tracksWithCover = tracks.filter((t) => t.cover_url && t.cover_url.length > 0);
  const businessPlaylists = playlists.filter((p) => p.is_business_only);
  const hasEnv =
    Boolean(import.meta.env.VITE_SUPABASE_URL) && Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

  const items: Item[] = [
    {
      key: 'env',
      label: '환경 변수 설정 (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)',
      done: hasEnv,
      detail: hasEnv ? '연결됨' : '.env 파일 확인',
      auto: true,
    },
    {
      key: 'storage',
      label: 'Supabase Storage 버킷 (audio · covers) 생성 + Public',
      done: playableTracks.length > 0,
      detail:
        playableTracks.length > 0
          ? '재생 가능한 트랙이 있으므로 정상'
          : '버킷이 없거나 Public 미설정이면 업로드/재생 실패',
      auto: true,
    },
    {
      key: 'tracks',
      label: '샘플 mp3 3~5개 업로드',
      done: playableTracks.length >= 3,
      detail: `${playableTracks.length}/${tracks.length} 곡 재생 가능 · 권장 3곡 이상`,
      auto: true,
    },
    {
      key: 'covers',
      label: '커버 이미지 업로드 (선택)',
      done: tracksWithCover.length >= 1,
      detail: `${tracksWithCover.length}개 트랙에 커버 등록`,
      auto: true,
    },
    {
      key: 'mapping',
      label: '플레이리스트에 트랙 연결',
      done: playableTracks.length > 0 && playlists.length > 0,
      detail: `${playlists.length}개 플레이리스트 등록`,
      auto: true,
    },
    {
      key: 'business',
      label: '사업자 전용 플레이리스트 1개 이상 활성화',
      done: businessPlaylists.length >= 1,
      detail: `${businessPlaylists.length}개 사업자 플레이리스트`,
      auto: true,
    },
    {
      key: 'vercel',
      label: 'Vercel 환경변수 설정 + 배포',
      done: false,
      detail: 'Vercel 대시보드에서 직접 확인',
      auto: false,
    },
    {
      key: 'pwa',
      label: '모바일에서 PWA 설치 테스트',
      done: isStandalone(),
      detail: isStandalone() ? '현재 PWA 모드로 실행 중' : '폰에서 ‘홈 화면에 추가’ 해보기',
      auto: true,
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  return (
    <details
      className="group rounded-2xl bg-bg-card ring-1 ring-line/10"
      open={!allDone}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">MVP 운영 체크리스트</h3>
          <p className="text-xs text-ink-mute">
            {doneCount}/{items.length} 완료 · 베타 시연 준비 상태
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg-soft">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${(doneCount / items.length) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-ink-dim group-open:hidden">펼치기</span>
          <span className="hidden text-[11px] text-ink-dim group-open:inline">접기</span>
        </div>
      </summary>
      <ul className="divide-y divide-line/10 border-t border-line/10">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-3 px-4 py-3">
            {item.done ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" />
            ) : (
              <Circle size={16} className="mt-0.5 shrink-0 text-ink-dim" />
            )}
            <div className="flex-1 space-y-0.5">
              <p className={`text-sm ${item.done ? 'text-ink' : 'text-ink-mute'}`}>{item.label}</p>
              {item.detail && <p className="text-[11px] text-ink-dim">{item.detail}</p>}
            </div>
            {!item.auto && (
              <span className="rounded-full bg-bg-hover px-2 py-0.5 text-[10px] text-ink-dim">
                수동 확인
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="border-t border-line/10 p-3 text-[11px] text-ink-dim">
        자세한 절차는 README.md 의 ‘베타 운영’ 섹션을 확인하세요.
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer"
          className="ml-2 inline-flex items-center gap-1 text-accent hover:underline"
        >
          Supabase 대시보드 <ExternalLink size={10} />
        </a>
      </div>
    </details>
  );
}
