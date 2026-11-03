/**
 * 본사 > 브랜드 콘텐츠 > 브랜드 음악 — 음악 정책·재생 시간 변경 요청.
 * 관리자 '음악 정책 스튜디오'와 같은 항목을 본사가 직접 정한다(검수 후 반영).
 */
import { useEffect, useState } from 'react';
import { Loader2, Search, Send } from 'lucide-react';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import {
  BRAND_POLICY_GENRES, BRAND_POLICY_MOODS, validateCustomPolicy, type TaxonomyOption,
} from '@/lib/brandMusicPolicy';
import { isStudyCafeStoreType } from '@/lib/studyCafePolicy';
import {
  previewMyMusicPolicy, submitContentRequest, summarizeRequest,
  type HqBrandContent, type HqContentRequest, type HqVocalPolicy, type MusicPolicyPreview,
} from '@/lib/api/hqContentApi';
import { Card, NoteInput, PendingRow } from './shared';

const VOCAL_LABEL: Record<HqVocalPolicy, string> = {
  any: '제한 없음', vocal_ok: '보컬 허용', prefer_instrumental: '연주곡 선호', instrumental_only: '연주곡만',
};
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function Chips({ options, selected, onToggle, tone = 'accent' }: {
  options: readonly TaxonomyOption[]; selected: string[]; onToggle: (slug: string) => void; tone?: 'accent' | 'danger';
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.slug);
        const onCls = tone === 'danger'
          ? 'bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-500/20 dark:text-rose-200 dark:ring-rose-400/40'
          : 'bg-accent/15 text-accent ring-accent/40';
        return (
          <button
            key={o.slug}
            type="button"
            onClick={() => onToggle(o.slug)}
            className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 transition ${on ? onCls : 'bg-bg-soft text-ink-mute ring-transparent hover:text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-semibold text-ink-mute">{label}</p>
      {children}
    </div>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const numOrNull = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const str = (n: number | null | undefined) => (n == null ? '' : String(n));

export default function MusicTab({ data, onChanged, onCancel }: {
  data: HqBrandContent; onChanged: () => void; onCancel: (id: string) => void;
}) {
  const brand = data.brand;
  const pol = data.music_policy;
  const isStudy = isStudyCafeStoreType(brand?.industry_type);

  const [mode, setMode] = useState<'inherit' | 'custom'>(pol?.policy_mode === 'custom' ? 'custom' : 'inherit');
  const [allowed, setAllowed] = useState<string[]>(pol?.allowed_genres ?? []);
  const [blocked, setBlocked] = useState<string[]>(pol?.blocked_genres ?? []);
  const [preferred, setPreferred] = useState<string[]>(pol?.preferred_genres ?? []);
  const [blockedMoods, setBlockedMoods] = useState<string[]>(pol?.blocked_moods ?? []);
  const [preferredMoods, setPreferredMoods] = useState<string[]>(pol?.preferred_moods ?? []);
  const [vocal, setVocal] = useState<HqVocalPolicy>(pol?.vocal_policy ?? 'any');
  const [eMin, setEMin] = useState(str(pol?.energy_min));
  const [eMax, setEMax] = useState(str(pol?.energy_max));
  const [bMin, setBMin] = useState(str(pol?.bpm_min));
  const [bMax, setBMax] = useState(str(pol?.bpm_max));
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<MusicPolicyPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'music' | 'playback' | null>(null);

  const [pbMode, setPbMode] = useState<'always_on' | 'business_hours'>(brand?.playback_mode ?? 'always_on');
  const [openTime, setOpenTime] = useState((brand?.open_time ?? '10:00').slice(0, 5));
  const [closeTime, setCloseTime] = useState((brand?.close_time ?? '22:00').slice(0, 5));
  const [days, setDays] = useState<number[]>(brand?.playback_days ?? [0, 1, 2, 3, 4, 5, 6]);

  useEffect(() => { setPreview(null); }, [mode, allowed, blocked, blockedMoods, vocal, eMin, eMax, bMin, bMax]);

  if (!brand) {
    return (
      <Card
        title="브랜드 플레이어가 아직 연결되지 않았어요"
        subtitle="브랜드 음악과 매장 화면은 브랜드 플레이어가 연결된 뒤 관리할 수 있어요. 운영사에 문의해 주세요. 안내방송은 지금 바로 쓸 수 있어요."
      />
    );
  }

  const pendingMusic = data.requests.find((r) => r.kind === 'music_policy' && r.status === 'pending');
  const pendingPlayback = data.requests.find((r) => r.kind === 'playback_policy' && r.status === 'pending');

  function musicPayload(): Record<string, unknown> {
    const custom = mode === 'custom';
    return {
      policy_mode: mode,
      allowed_genres: custom ? allowed : [],
      preferred_genres: custom ? preferred : [],
      blocked_genres: custom ? blocked : [],
      preferred_moods: custom ? preferredMoods : [],
      blocked_moods: custom ? blockedMoods : [],
      energy_min: custom ? numOrNull(eMin) : null,
      energy_max: custom ? numOrNull(eMax) : null,
      bpm_min: custom ? numOrNull(bMin) : null,
      bpm_max: custom ? numOrNull(bMax) : null,
      vocal_policy: custom ? vocal : null,
    };
  }

  function validate(): boolean {
    if (mode !== 'custom') return true;
    const v = validateCustomPolicy({
      allowedGenres: allowed, blockedGenres: blocked, preferredGenres: preferred,
      blockedMoods, preferredMoods,
      energyMin: numOrNull(eMin), energyMax: numOrNull(eMax), bpmMin: numOrNull(bMin), bpmMax: numOrNull(bMax),
    });
    if (!v.ok) toast.error(v.error ?? '설정 값을 확인해 주세요');
    return v.ok;
  }

  async function runPreview() {
    if (!validate()) return;
    setBusy('preview');
    try { setPreview(await previewMyMusicPolicy(musicPayload())); }
    catch (e) { toast.error(friendlyError(e, '곡 수를 확인하지 못했어요')); }
    finally { setBusy(null); }
  }

  async function sendMusic() {
    if (!validate()) return;
    setBusy('music');
    try {
      await submitContentRequest('music_policy', musicPayload(), note);
      toast.success('검수 요청을 보냈어요. 반영되면 알림으로 알려드려요.');
      setNote('');
      onChanged();
    } catch (e) { toast.error(friendlyError(e, '요청을 보내지 못했어요')); }
    finally { setBusy(null); }
  }

  async function sendPlayback() {
    if (pbMode === 'business_hours' && openTime === closeTime) {
      toast.error('시작 시각과 종료 시각이 같아요. 하루 종일이면 24시간 재생을 고르세요.');
      return;
    }
    setBusy('playback');
    try {
      await submitContentRequest('playback_policy', pbMode === 'business_hours'
        ? { playback_mode: pbMode, open_time: openTime, close_time: closeTime, days: [...days].sort() }
        : { playback_mode: pbMode });
      toast.success('재생 시간 변경을 요청했어요.');
      onChanged();
    } catch (e) { toast.error(friendlyError(e, '요청을 보내지 못했어요')); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      {pendingMusic && <PendingRow req={pendingMusic} summary={summarizeRequest(pendingMusic as HqContentRequest)} onCancel={onCancel} />}

      <Card
        title="음악 고르는 기준"
        subtitle={<>
          이 기준에 맞는 곡으로 매일 오전 9시에 오늘의 플레이리스트가 만들어져요.
          {data.today_playlist && <> 지금 오늘 플레이리스트: <b>{data.today_playlist.track_count}곡</b>.</>}
        </>}
      >
        {isStudy && (
          <p className="mb-3 rounded-xl bg-sky-50 p-2.5 text-[12px] leading-relaxed text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
            스터디카페 업종은 집중을 위해 <b>연주곡만 · 잔잔한 곡(에너지 0.5 이하, BPM 110 이하) · 로파이/앰비언트/재즈</b> 안에서만 고를 수 있어요.
            이보다 넓게 고르면 자동으로 이 범위로 맞춰져요.
          </p>
        )}

        <div className="mb-3 grid grid-cols-2 gap-2">
          {(['inherit', 'custom'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-xl px-3 py-2 text-left ring-1 transition ${mode === m ? 'bg-accent/10 ring-accent/50' : 'bg-bg-soft ring-transparent hover:ring-line/30'}`}
            >
              <p className={`text-sm font-bold ${mode === m ? 'text-accent' : ''}`}>{m === 'inherit' ? '업종 기본 음악' : '브랜드 맞춤'}</p>
              <p className="text-[11px] text-ink-mute">{m === 'inherit' ? '업종에 맞는 음악을 운영사 기준으로' : '장르·분위기·보컬을 직접 고르기'}</p>
            </button>
          ))}
        </div>

        {mode === 'custom' && (
          <div className="space-y-4">
            <Field label="틀 장르 (하나도 안 고르면 전체)">
              <Chips options={BRAND_POLICY_GENRES} selected={allowed} onToggle={(s) => setAllowed(toggle(allowed, s))} />
            </Field>
            <Field label="더 자주 틀 장르">
              <Chips options={BRAND_POLICY_GENRES} selected={preferred} onToggle={(s) => setPreferred(toggle(preferred, s))} />
            </Field>
            <Field label="빼고 싶은 장르">
              <Chips options={BRAND_POLICY_GENRES} selected={blocked} tone="danger" onToggle={(s) => setBlocked(toggle(blocked, s))} />
            </Field>
            <Field label="더 자주 틀 분위기">
              <Chips options={BRAND_POLICY_MOODS} selected={preferredMoods} onToggle={(s) => setPreferredMoods(toggle(preferredMoods, s))} />
            </Field>
            <Field label="빼고 싶은 분위기">
              <Chips options={BRAND_POLICY_MOODS} selected={blockedMoods} tone="danger" onToggle={(s) => setBlockedMoods(toggle(blockedMoods, s))} />
            </Field>
            <Field label="보컬">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(Object.keys(VOCAL_LABEL) as HqVocalPolicy[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVocal(v)}
                    className={`rounded-lg py-1.5 text-[12px] font-semibold transition ${vocal === v ? 'bg-accent text-bg' : 'bg-bg-soft text-ink-mute hover:text-ink'}`}
                  >
                    {VOCAL_LABEL[v]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="에너지 (0 차분함 ~ 1 신남)">
                <div className="flex items-center gap-1.5">
                  <input value={eMin} onChange={(e) => setEMin(e.target.value)} placeholder="최소" inputMode="decimal" className="input w-full text-sm" />
                  <span className="text-ink-mute">~</span>
                  <input value={eMax} onChange={(e) => setEMax(e.target.value)} placeholder="최대" inputMode="decimal" className="input w-full text-sm" />
                </div>
              </Field>
              <Field label="빠르기 (BPM)">
                <div className="flex items-center gap-1.5">
                  <input value={bMin} onChange={(e) => setBMin(e.target.value)} placeholder="최소" inputMode="numeric" className="input w-full text-sm" />
                  <span className="text-ink-mute">~</span>
                  <input value={bMax} onChange={(e) => setBMax(e.target.value)} placeholder="최대" inputMode="numeric" className="input w-full text-sm" />
                </div>
              </Field>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-bg-soft px-3 py-2 text-[12px] font-semibold hover:bg-bg-hover disabled:opacity-50"
          >
            {busy === 'preview' ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} 몇 곡이 해당되는지 확인
          </button>
          {preview && (
            <p className={`text-[12px] ${preview.eligible < 100 ? 'font-semibold text-amber-600 dark:text-amber-300' : 'text-ink-mute'}`}>
              이 기준에 맞는 곡 <b>{preview.eligible.toLocaleString()}곡</b>
              {preview.eligible < 100 && ' — 곡이 적으면 같은 노래가 자주 반복돼요'}
            </p>
          )}
        </div>

        <div className="mt-3 space-y-2 border-t border-line/10 pt-3">
          <NoteInput value={note} onChange={setNote} />
          <button
            type="button"
            onClick={() => void sendMusic()}
            disabled={busy !== null}
            className="btn-primary inline-flex w-full items-center justify-center gap-1.5 py-2.5 text-sm disabled:opacity-50"
          >
            {busy === 'music' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 음악 기준 변경 검수 요청
          </button>
        </div>
      </Card>

      {pendingPlayback && <PendingRow req={pendingPlayback} summary={summarizeRequest(pendingPlayback as HqContentRequest)} onCancel={onCancel} />}

      <Card title="재생 시간" subtitle="브랜드 플레이어가 음악을 트는 시간이에요. 영업시간 밖에는 자동으로 멈춰요.">
        <div className="grid grid-cols-2 gap-2">
          {(['always_on', 'business_hours'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPbMode(m)}
              className={`rounded-lg py-2 text-sm font-semibold transition ${pbMode === m ? 'bg-accent text-bg' : 'bg-bg-soft text-ink-mute hover:text-ink'}`}
            >
              {m === 'always_on' ? '24시간 재생' : '영업시간에만'}
            </button>
          ))}
        </div>
        {pbMode === 'business_hours' && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className="input text-sm" aria-label="시작 시각" />
              <span className="text-ink-mute">~</span>
              <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className="input text-sm" aria-label="종료 시각" />
            </div>
            <div className="flex gap-1">
              {DAY_LABELS.map((label, d) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
                  className={`h-8 w-8 rounded-full text-[12px] font-bold ${days.includes(d) ? 'bg-accent text-bg' : 'bg-bg-soft text-ink-mute'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => void sendPlayback()}
          disabled={busy !== null || (pbMode === 'business_hours' && days.length === 0)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-bg-soft py-2 text-sm font-semibold hover:bg-bg-hover disabled:opacity-50"
        >
          {busy === 'playback' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 재생 시간 변경 검수 요청
        </button>
      </Card>
    </div>
  );
}
