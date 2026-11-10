/**
 * AnnouncerPage — 분리 송출의 "안내방송 전용" 창 (/business/announcer?slot=N, 0538).
 *
 * 음악 없이 안내·긴급방송만 내보낸다. 복도·화장실·대기 공간처럼 노래 없이 안내멘트만
 * 필요한 스피커용. 안내 재생 자체는 AppShell 의 GlobalStoreAudioOverlays 가 맡고
 * (이 창이 안내방송 송출 창이면 마운트됨), 이 화면은
 *   · 이 창에서 음악이 절대 나오지 않게 막고
 *   · 소리 재생 허용(첫 클릭)을 받고
 *   · 다음 안내 예정 시각을 보여준다.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, Clock, CheckCircle2, MousePointerClick } from 'lucide-react';
import OutputSlotBar from '@/components/player/OutputSlotBar';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { getOutputSlot } from '@/lib/outputSlot';
import { normalizeMultiOutputConfig, slotConfigOf } from '@/lib/multiOutput';
import { getUpcomingAnnouncements, type UpcomingAnnouncement } from '@/lib/api/announcementApi';

const POLL_MS = 60_000;

function hasUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : false;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function AnnouncerPage() {
  const slot = getOutputSlot();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profile = useAuthStore((s) => s.profile);
  const [armed, setArmed] = useState(hasUserActivation);
  const [upcoming, setUpcoming] = useState<UpcomingAnnouncement[] | null>(null);

  const config = profile?.multi_output_config ? normalizeMultiOutputConfig(profile.multi_output_config) : null;
  const isAnnounceSlot = !!profile?.multi_output_enabled && slotConfigOf(config, slot)?.mode === 'announce';

  // 이 창에서는 음악이 나오면 안 된다 — 이전에 이 번호로 음악을 틀던 기록이 살아나도 즉시 멈춘다.
  useEffect(() => {
    const p = usePlayerStore.getState();
    if (p.playing) p.pause();
    return usePlayerStore.subscribe((s, prev) => {
      if (s.playing && !prev.playing) usePlayerStore.getState().pause();
    });
  }, []);

  // 크롬은 사용자가 한 번 클릭한 창에서만 소리를 낸다 — 클릭 전엔 안내가 막힐 수 있다.
  useEffect(() => {
    if (armed) return;
    const on = () => setArmed(true);
    document.addEventListener('pointerdown', on, { once: true });
    document.addEventListener('keydown', on, { once: true });
    return () => {
      document.removeEventListener('pointerdown', on);
      document.removeEventListener('keydown', on);
    };
  }, [armed]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = () => {
      getUpcomingAnnouncements(null, 3600)
        .then((r) => { if (alive) setUpcoming((r.data ?? []).filter((a) => new Date(a.scheduled_at).getTime() >= Date.now() - 60_000)); })
        .catch(() => { if (alive) setUpcoming([]); });
    };
    load();
    const t = window.setInterval(load, POLL_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, [userId]);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-y-auto bg-gradient-to-b from-bg-deep to-black px-4 pb-8 pt-28 text-white">
      <OutputSlotBar kind="announce" />

      <div className="w-full max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent/15 ring-1 ring-accent/30">
          <Megaphone size={36} className="text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{slot ? `${slot}번 · ` : ''}안내방송 전용</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-white/60">
            이 창에서는 음악이 나오지 않아요. 예약된 안내방송과 긴급방송만 위에서 고른 스피커로 나갑니다.
          </p>
        </div>

        {!slot || !isAnnounceSlot ? (
          <p className="rounded-xl bg-amber-400/15 p-3 text-xs leading-relaxed text-amber-100 ring-1 ring-amber-300/30">
            이 창은 안내방송 전용으로 설정돼 있지 않아요.{' '}
            <Link to="/profile" className="font-bold underline">내 정보 → 분리 송출</Link>에서 플레이어 하나를
            "안내방송"으로 바꾸고 저장한 뒤 [창 열기]로 다시 열어 주세요.
          </p>
        ) : armed ? (
          <p className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 p-3 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
            <CheckCircle2 size={16} /> 안내방송 대기 중 — 창을 열어 두세요
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-black"
          >
            <MousePointerClick size={16} /> 안내방송 받기 시작 (한 번 눌러 주세요)
          </button>
        )}

        <div className="rounded-xl bg-white/5 p-3 text-left ring-1 ring-white/10">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-white/70">
            <Clock size={13} /> 앞으로 1시간 안내 예정
          </p>
          {upcoming === null ? (
            <p className="mt-2 text-xs text-white/40">불러오는 중…</p>
          ) : upcoming.length === 0 ? (
            <p className="mt-2 text-xs text-white/40">1시간 안에 예정된 안내방송이 없어요.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {upcoming.slice(0, 5).map((a) => (
                <li key={a.occurrence_key} className="flex items-center gap-2 text-sm">
                  <span className="shrink-0 font-mono font-bold text-accent">{hhmm(a.scheduled_at)}</span>
                  <span className="truncate">{a.asset_title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-white/40">
          창을 최소화하지 말고 열어 두세요(다른 창 뒤에 겹쳐 두는 건 괜찮아요). 창을 닫으면 안내방송이 나가지 않아요.
        </p>
      </div>
    </div>
  );
}
