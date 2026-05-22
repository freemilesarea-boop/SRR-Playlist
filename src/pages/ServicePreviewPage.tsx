import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Lock, Headphones, Clock, Loader2 } from 'lucide-react';
import {
  PREVIEW_CATEGORIES,
  getBusinessPreviewStatus,
  recordBusinessPreviewPlay,
  fetchPreviewSampleTracks,
  type PreviewStatus,
  type PreviewCategory,
} from '@/lib/servicePreview';
import { usePlayerStore } from '@/store/playerStore';
import { gradientStyle } from '@/lib/cover';
import { toast } from '@/store/toastStore';

export default function ServicePreviewPage() {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const play = usePlayerStore((s) => s.play);

  async function loadStatus() {
    setStatus(await getBusinessPreviewStatus());
  }
  useEffect(() => { void loadStatus(); }, []);

  const remaining = status?.remaining ?? 0;
  const canPreview = status?.can_preview ?? false;

  async function handlePreview(cat: PreviewCategory) {
    if (busyKey) return;            // 중복 클릭 방지
    setBusyKey(cat.key);
    try {
      // 1) 재생 가능한 샘플 음원 확보 (없으면 차감하지 않고 "준비 중")
      const tracks = await fetchPreviewSampleTracks(cat.businessType);
      if (tracks.length === 0) {
        toast.info(`${cat.title} — 샘플이 준비 중이에요. 곧 업데이트됩니다.`);
        return;
      }
      // 2) 미리듣기 횟수 차감 (서버 권위)
      const res = await recordBusinessPreviewPlay(cat.key, cat.playlistId ?? null);
      if (!res.allowed) {
        if (res.reason === 'login_required') {
          toast.error('사업자 회원가입 후 2회 무료 미리듣기가 가능합니다.');
        } else if (res.reason === 'not_business') {
          toast.error('사업자 회원으로 로그인하면 미리듣기가 가능합니다.');
        } else if (res.reason === 'limit_reached') {
          toast.error('무료 미리듣기 2회를 모두 사용했습니다. 서비스 이용을 시작해주세요.');
        } else {
          toast.error('미리듣기를 시작할 수 없어요. 잠시 후 다시 시도해주세요.');
        }
        await loadStatus();
        return;
      }
      // 3) 재생
      setQueue(tracks, 0, null, null);
      play();
      await loadStatus();
      if (typeof res.remaining === 'number' && res.reason !== 'admin') {
        toast.success(`미리듣기 시작 — 남은 무료 ${res.remaining}회`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '미리듣기 실패');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pb-28 pt-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <Headphones size={22} className="text-accent" /> 업종별 미리듣기
        </h1>
        <p className="text-sm text-ink-mute">우리 매장에 어울리는 BGM 예시를 들어보세요.</p>
      </header>

      {/* 상태 배너 */}
      {status && (
        <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          {!status.is_authenticated ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-mute">
                <Lock size={14} className="mr-1 inline" />
                사업자 회원가입 후 <b className="text-accent">2회 무료 미리듣기</b>가 가능합니다.
              </p>
              <Link to="/login" className="btn-primary px-3 py-2 text-xs">사업자 회원가입</Link>
            </div>
          ) : status.is_admin ? (
            <p className="text-sm font-semibold text-emerald-500">관리자 — 제한 없이 미리듣기 가능</p>
          ) : !status.is_business ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-mute">사업자 회원만 미리듣기를 이용할 수 있어요.</p>
              <Link to="/profile" className="btn-ghost px-3 py-2 text-xs">사업자 전환 안내</Link>
            </div>
          ) : canPreview ? (
            <p className="text-sm">
              남은 무료 미리듣기 <b className="text-accent">{remaining}회</b> / {status.limit}회
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-mute">무료 미리듣기 2회를 모두 사용했습니다. 서비스 이용을 시작해주세요.</p>
              <Link to="/subscription" className="btn-primary px-3 py-2 text-xs">이용 시작</Link>
            </div>
          )}
        </div>
      )}

      {/* 업종 카드 */}
      <div className="grid gap-3 sm:grid-cols-2">
        {PREVIEW_CATEGORIES.map((cat) => {
          const isBusy = busyKey === cat.key;
          const locked = !!status && (!status.is_authenticated || (!status.is_admin && !status.is_business)) ;
          const limitOut = !!status && status.is_business && !status.can_preview;
          return (
            <div key={cat.key} className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
              <div className="relative h-24" style={gradientStyle(cat.theme)}>
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                <div className="absolute bottom-2 left-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{cat.businessType}</p>
                  <p className="text-sm font-bold text-white drop-shadow">{cat.genre}</p>
                </div>
              </div>
              <div className="space-y-2 p-3">
                <h3 className="text-sm font-bold">{cat.title}</h3>
                <div className="flex flex-wrap gap-1">
                  {cat.mood.map((m) => (
                    <span key={m} className="rounded-full bg-bg-soft px-2 py-0.5 text-[10px] text-ink-mute">{m}</span>
                  ))}
                </div>
                <p className="text-xs leading-relaxed text-ink-mute">{cat.description}</p>
                <button
                  onClick={() => void handlePreview(cat)}
                  disabled={isBusy || limitOut}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2.5 text-xs font-bold text-black hover:bg-accent/90 disabled:opacity-50"
                >
                  {isBusy ? <Loader2 size={14} className="animate-spin" /> : locked ? <Lock size={14} /> : <Play size={14} fill="currentColor" />}
                  {isBusy ? '준비 중…' : locked ? '가입 후 미리듣기' : limitOut ? '무료 미리듣기 소진' : '플레이리스트 미리듣기'}
                </button>
                <p className="flex items-center gap-1 text-[10px] text-ink-dim">
                  <Clock size={10} /> 사업자 가입 시 2회 무료듣기 가능
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
