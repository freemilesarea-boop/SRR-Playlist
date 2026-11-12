/**
 * BrandAnnouncerPage — 브랜드 안내방송 전용 플레이어 (/brand/announcer/:brandId).
 *
 * 매장 코드로 연결한 기기를 "안내멘트만 나가는 스피커"로 쓴다. 음악은 절대 나오지 않는다.
 * 남는 태블릿·공기계를 안내 스피커에 꽂아 켜 두는 용도 — 음악 플레이어가 멈추거나
 * 꺼져도 안내는 이 기기에서 따로 나간다.
 *
 * 안내 재생 자체는 AppShell 의 GlobalStoreAudioOverlays(AnnouncementOverlay)가 맡는다
 * (브랜드 플레이어 세션이 있으면 0551 판정으로 마운트, 이 경로는 announceOnly).
 * 이 화면은
 *   · 매장 코드 연결(device binding)을 서버에서 다시 확인하고
 *   · 이 창에서 음악이 나오지 않게 막고
 *   · 소리 재생 허용(첫 터치)과 화면 꺼짐 방지를 잡고
 *   · 다음 안내 예정 · 오늘 송출 기록 · 스피커 테스트를 보여 준다.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2, Clock, Megaphone, MousePointerClick, Music, Unplug, Volume2, Wifi, WifiOff, XCircle,
} from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useAnnouncerHeartbeat } from '@/hooks/useAnnouncerHeartbeat';
import { verifyBrandDeviceBinding, revokeBrandDeviceByToken } from '@/lib/api/brandPlayerApi';
import { getBrandToken, clearBrandToken, setBrandEntryMode } from '@/lib/brandSession';
import {
  getMyAnnouncementToday, getUpcomingAnnouncements,
  type MyAnnouncementLogRow, type UpcomingAnnouncement,
} from '@/lib/api/announcementApi';

const POLL_MS = 60_000;
const LOOKAHEAD_SECONDS = 12 * 3600;

function hasUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : false;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function untilLabel(iso: string, now: number): string {
  const sec = Math.round((new Date(iso).getTime() - now) / 1000);
  if (sec <= 0) return '곧';
  if (sec < 60) return `${sec}초 뒤`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분 뒤`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분 뒤`;
}

/** 스피커 확인용 짧은 차임 — 음원 파일 없이 바로 소리를 낸다. */
async function playTestChime(): Promise<void> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('unsupported');
  const ctx = new Ctx();
  const notes = [880, 660, 990];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    o.type = 'sine';
    const t0 = ctx.currentTime + i * 0.35;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.34);
  });
  await new Promise((r) => setTimeout(r, notes.length * 350 + 100));
  await ctx.close();
}

export default function BrandAnnouncerPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const navigate = useNavigate();
  const token = brandId ? getBrandToken(brandId) : null;
  const online = usePlaybackHealthStore((s) => s.online);

  const [armed, setArmed] = useState(hasUserActivation);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingAnnouncement[] | null>(null);
  const [today, setToday] = useState<MyAnnouncementLogRow[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [testing, setTesting] = useState<'idle' | 'playing' | 'failed'>('idle');

  // 화면 꺼짐 방지 — 안내를 받기 시작한 뒤부터. (상태 표시는 App 의 다른 wake lock 과
  // 같은 store 를 공유해 정확하지 않으므로 화면에 띄우지 않는다.)
  useWakeLock(armed);
  // 0553 — 켜짐 신호. 이 기기가 살아 있는 동안 같은 계정의 음악 플레이어는 안내를 넘겨준다.
  useAnnouncerHeartbeat({ enabled: !!brandId && !!token, armed, brandId: brandId ?? null });

  // 연결 없음 → 코드 입력 화면(안내방송 전용 모드 유지)
  useEffect(() => {
    if (brandId && !token) navigate('/brand?mode=announcer', { replace: true });
  }, [brandId, token, navigate]);

  // 진입 시 기기 연결 서버 재검증 — BrandPlayerPage 와 같은 게이트.
  useEffect(() => {
    if (!brandId || !token) return;
    setBrandEntryMode(brandId, 'announcer');
    let cancelled = false;
    (async () => {
      try {
        const v = await verifyBrandDeviceBinding(brandId, token);
        if (cancelled) return;
        if (v.ok) { setBrandName(v.brand_name ?? null); return; }
        clearBrandToken(brandId);
        navigate('/brand?mode=announcer', { replace: true, state: { fromPlayerReject: true, reason: v.reason } });
      } catch { /* 일시 네트워크 오류 → 화면 유지 */ }
    })();
    return () => { cancelled = true; };
  }, [brandId, token, navigate]);

  // 이 창에서는 음악이 나오면 안 된다 — 같은 탭에서 음악을 틀던 상태가 남아 있어도 즉시 멈춘다.
  useEffect(() => {
    const p = usePlayerStore.getState();
    if (p.playing) p.pause();
    return usePlayerStore.subscribe((s, prev) => {
      if (s.playing && !prev.playing) usePlayerStore.getState().pause();
    });
  }, []);

  // 브라우저는 사용자가 한 번 누른 창에서만 소리를 낸다.
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

  const reload = useCallback(() => {
    getUpcomingAnnouncements(null, LOOKAHEAD_SECONDS)
      .then((r) => setUpcoming((r.data ?? [])
        .filter((a) => new Date(a.scheduled_at).getTime() >= Date.now() - 60_000)
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))))
      .catch(() => setUpcoming((prev) => prev ?? []));
    getMyAnnouncementToday(30)
      .then(setToday)
      .catch(() => setToday((prev) => prev ?? []));
  }, []);

  useEffect(() => {
    if (!token) return;
    reload();
    const t = window.setInterval(reload, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [token, reload]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  const runTest = async () => {
    setArmed(true);
    setTesting('playing');
    try { await playTestChime(); setTesting('idle'); }
    catch { setTesting('failed'); }
  };

  const toMusicPlayer = () => {
    if (!brandId) return;
    setBrandEntryMode(brandId, 'player');
    navigate(`/brand/player/${brandId}`, { replace: true });
  };

  const disconnect = async () => {
    if (!brandId || !token) return;
    if (!window.confirm('이 기기의 매장 연결을 해제할까요? 다시 쓰려면 매장 코드를 입력해야 해요.')) return;
    try { await revokeBrandDeviceByToken(brandId, token); } catch { /* 로컬 정리는 진행 */ }
    clearBrandToken(brandId);
    navigate('/brand?mode=announcer', { replace: true, state: { deviceRevoked: true } });
  };

  const next = upcoming?.[0] ?? null;
  const clock = new Date(now);

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-gradient-to-b from-bg-deep to-black px-4 pb-10 pt-6 text-white">
      <div className="mx-auto w-full max-w-md space-y-4">
        <header className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 ring-1 ring-accent/30">
            <Megaphone size={18} className="text-accent" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{brandName ?? '브랜드'} · 안내방송 전용</p>
            <p className="text-[11px] text-white/50">이 기기에서는 음악이 나오지 않아요</p>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
            {online ? <Wifi size={11} /> : <WifiOff size={11} />}{online ? '연결됨' : '오프라인'}
          </span>
        </header>

        <div className="text-center">
          <p className="font-mono text-5xl font-bold tabular-nums tracking-tight">
            {String(clock.getHours()).padStart(2, '0')}:{String(clock.getMinutes()).padStart(2, '0')}
            <span className="text-2xl text-white/40">:{String(clock.getSeconds()).padStart(2, '0')}</span>
          </p>
        </div>

        {armed ? (
          <p className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 p-3 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
            <CheckCircle2 size={16} /> 안내방송 대기 중 — 화면을 켜 둔 채 두세요
          </p>
        ) : (
          <button type="button" onClick={() => setArmed(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-4 text-base font-bold text-black">
            <MousePointerClick size={18} /> 안내방송 받기 시작 (한 번 눌러 주세요)
          </button>
        )}

        <section className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-white/60"><Clock size={13} /> 다음 안내</p>
          {upcoming === null ? (
            <p className="mt-2 text-sm text-white/40">불러오는 중…</p>
          ) : !next ? (
            <p className="mt-2 text-sm text-white/40">12시간 안에 예정된 안내방송이 없어요.</p>
          ) : (
            <>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold text-accent">{hhmm(next.scheduled_at)}</span>
                <span className="text-xs text-white/60">{untilLabel(next.scheduled_at, now)}</span>
              </div>
              <p className="truncate text-sm">{next.schedule_name} · {next.asset_title}</p>
              {upcoming.length > 1 && (
                <ul className="mt-3 space-y-1 border-t border-white/10 pt-2">
                  {upcoming.slice(1, 6).map((a) => (
                    <li key={a.occurrence_key} className="flex items-center gap-2 text-xs text-white/70">
                      <span className="shrink-0 font-mono font-bold">{hhmm(a.scheduled_at)}</span>
                      <span className="truncate">{a.schedule_name} · {a.asset_title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <p className="text-xs font-semibold text-white/60">오늘 이 기기에서 나간 안내</p>
          {today === null ? (
            <p className="mt-2 text-sm text-white/40">불러오는 중…</p>
          ) : today.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">아직 없어요.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {today.map((r, i) => (
                <li key={`${r.schedule_id}-${r.scheduled_at}-${i}`} className="flex items-center gap-2 text-xs">
                  <span className="shrink-0 font-mono text-white/60">{hhmm(r.scheduled_at)}</span>
                  <span className="min-w-0 flex-1 truncate">{r.schedule_name ?? '안내방송'}</span>
                  {r.status === 'played' ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-emerald-300"><CheckCircle2 size={12} /> 송출</span>
                  ) : r.status === 'failed' ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-rose-300" title={r.error ?? ''}><XCircle size={12} /> 실패</span>
                  ) : (
                    <span className="shrink-0 text-white/50">{r.status === 'started' ? '재생 중' : '건너뜀'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <button type="button" onClick={() => void runTest()} disabled={testing === 'playing'}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-60">
          <Volume2 size={16} /> {testing === 'playing' ? '테스트음 재생 중…' : '스피커 테스트 (딩동 소리)'}
        </button>
        {testing === 'failed' && (
          <p className="text-center text-[11px] text-rose-300">테스트음을 내지 못했어요. 기기 볼륨과 스피커 연결을 확인해 주세요.</p>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={toMusicPlayer}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white/60 ring-1 ring-white/10 hover:text-white">
            <Music size={13} /> 음악 플레이어로 바꾸기
          </button>
          <button type="button" onClick={() => void disconnect()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white/60 ring-1 ring-white/10 hover:text-rose-300">
            <Unplug size={13} /> 연결 해제
          </button>
        </div>

        <p className="text-center text-[11px] leading-relaxed text-white/40">
          앱(탭)을 닫거나 기기를 잠그면 안내방송이 나가지 않아요. 홈 화면에 앱으로 설치해 두면 다음부터 바로 이 화면으로 열려요.
        </p>
      </div>
    </div>
  );
}
