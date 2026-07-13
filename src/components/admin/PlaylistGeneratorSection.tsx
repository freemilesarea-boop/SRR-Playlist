/**
 * PlaylistGeneratorSection — AI Playlist Generator (Phase AI-PLAYLIST-4).
 *
 * 실제 Track 메타데이터/KPI 로 성과가 높은 Playlist 초안(Draft)을 생성한다. AI 가 음악
 * 취향을 임의 생성하지 않고, 업종 프로필·메타·KPI 매칭 + Diversity/Freshness/Fatigue Guard
 * 로만 판단하며 모든 선택/제외에 Evidence 를 남긴다. **자동 Publish 없음** — 승인 후 기존
 * Rollout 사용. 기존 Playback/Queue/Playlist/Rollout 무변경.
 *
 * 탭: Generator · Drafts · Brand DNA · Compatibility · History.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wand2, ListMusic, Fingerprint, Gauge, History as HistoryIcon, RefreshCw, Inbox, Sparkles, CheckCircle2 } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchGeneratorPool, savePlaylistDraft, fetchPlaylistDrafts, setPlaylistDraftStatus, fetchBrandDna, upsertBrandDna,
  type GeneratorPoolTrack, type PlaylistDraftRow, type BrandDnaRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import {
  INDUSTRY_PROFILES, generateDraft, simulateDraft, computeCompatibility, getProfile,
  BUCKET_LABEL, UNSUPPORTED_METADATA,
  type PoolTrack, type GenerateResult, type SimulationResult, type GeneratorConfig,
} from '@/lib/playlistGenerator';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const PCT = (n: number | null | undefined) => (n == null ? '데이터 없음' : `${n}%`);
const INDUSTRIES = Object.keys(INDUSTRY_PROFILES);

type Tab = 'generator' | 'drafts' | 'brand' | 'compat' | 'history';
const TABS: { key: Tab; label: string; icon: typeof Wand2 }[] = [
  { key: 'generator', label: 'Generator', icon: Wand2 },
  { key: 'drafts', label: 'Drafts', icon: ListMusic },
  { key: 'brand', label: 'Brand DNA', icon: Fingerprint },
  { key: 'compat', label: 'Compatibility', icon: Gauge },
  { key: 'history', label: 'History', icon: HistoryIcon },
];

function toPoolTrack(r: GeneratorPoolTrack): PoolTrack { return { ...r }; }

export default function PlaylistGeneratorSection() {
  const [tab, setTab] = useState<Tab>('generator');
  const [pool, setPool] = useState<PoolTrack[]>([]);
  const [drafts, setDrafts] = useState<PlaylistDraftRow[] | null>(null);
  const [brands, setBrands] = useState<BrandDnaRow[] | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nowMs] = useState(() => Date.now());

  // Generator 설정
  const [storeType, setStoreType] = useState('cafe');
  const [count, setCount] = useState(20);
  const [minCompat, setMinCompat] = useState(50);
  const [maxFatigue, setMaxFatigue] = useState(70);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [sim, setSim] = useState<SimulationResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setPool((await fetchGeneratorPool('30d', 300)).map(toPoolTrack)); }
    catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  const loadDrafts = useCallback(async () => { try { setDrafts(await fetchPlaylistDrafts(null, 50)); } catch { setDrafts([]); } }, []);
  const loadBrands = useCallback(async () => { try { setBrands(await fetchBrandDna()); } catch { setBrands([]); } }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'drafts' || tab === 'history') void loadDrafts(); if (tab === 'brand') void loadBrands(); }, [tab, loadDrafts, loadBrands]);

  function runGenerate() {
    const cfg: GeneratorConfig = { storeType, targetCount: count, minCompatibility: minCompat, maxFatigue };
    const r = generateDraft(pool, cfg, nowMs);
    setResult(r); setSim(simulateDraft(r.selected));
    if (r.selected.length === 0) toast.info('생성된 Track 없음 — 조건을 완화하거나 Pool 을 확인하세요.');
    else toast.success(`${r.selected.length}곡 Draft 생성(초안 · 자동 배포 없음)`);
  }

  async function saveDraft() {
    if (!result || result.selected.length === 0) { toast.error('저장할 Draft 가 없습니다.'); return; }
    setBusy(true);
    try {
      await savePlaylistDraft({
        name: `${INDUSTRY_PROFILES[storeType]?.label ?? storeType} Draft ${count}곡`, store_type: storeType,
        config: { targetCount: count, minCompatibility: minCompat, maxFatigue },
        tracks: result.selected.map((s) => ({ track_id: s.track.track_id, title: s.track.title, compatibility: s.compatibility, fatigue: s.fatigue, bucket: s.bucket, reason: s.reason })),
        excluded: result.excluded.slice(0, 30).map((e) => ({ track_id: e.track.track_id, title: e.track.title, reason: e.reason })),
        simulation: sim,
      });
      toast.success('Draft 저장 (승인 후 Rollout 사용)');
      if (tab === 'drafts') void loadDrafts();
    } catch (e) { toast.error(`저장 실패: ${friendlyError(e, '0487 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }

  async function decideDraft(d: PlaylistDraftRow, status: 'approved' | 'rejected') {
    setBusy(true);
    try { await setPlaylistDraftStatus(d.id, status); toast.success(`Draft ${status === 'approved' ? '승인(배포 아님)' : '반려'}`); await loadDrafts(); }
    catch (e) { toast.error(`처리 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Wand2 size={16} /> AI Playlist Generator</span>}
      subtitle="실제 메타/KPI 기반 Draft 생성 — 취향 추측 없음, 자동 Publish 없음(승인 후 Rollout)"
      action={
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 rounded-full bg-bg-deep px-2 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Pool 갱신
          </button>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {err && <AdminAlert tone="warning" title="Track Pool 을 불러오지 못했어요" description={`${err.message} · 0487 미적용 시 비어 있습니다.`} action={<button onClick={() => void load()} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />}

      {tab === 'generator' && (
        <GeneratorTab pool={pool} loading={loading} busy={busy} storeType={storeType} setStoreType={setStoreType}
          count={count} setCount={setCount} minCompat={minCompat} setMinCompat={setMinCompat} maxFatigue={maxFatigue} setMaxFatigue={setMaxFatigue}
          result={result} sim={sim} onGenerate={runGenerate} onSave={saveDraft} />
      )}
      {tab === 'drafts' && <DraftsTab drafts={drafts} busy={busy} onDecide={decideDraft} />}
      {tab === 'brand' && <BrandTab brands={brands} busy={busy} onReload={loadBrands} onSave={upsertBrandDna} />}
      {tab === 'compat' && <CompatTab pool={pool} storeType={storeType} setStoreType={setStoreType} />}
      {tab === 'history' && <DraftsTab drafts={(drafts ?? []).filter((d) => d.status !== 'draft')} busy={busy} onDecide={decideDraft} historyMode />}
    </AdminCard>
  );
}

/* ── Generator ─────────────────────────────────────────────── */
function GeneratorTab(p: {
  pool: PoolTrack[]; loading: boolean; busy: boolean;
  storeType: string; setStoreType: (s: string) => void; count: number; setCount: (n: number) => void;
  minCompat: number; setMinCompat: (n: number) => void; maxFatigue: number; setMaxFatigue: (n: number) => void;
  result: GenerateResult | null; sim: SimulationResult | null; onGenerate: () => void; onSave: () => void;
}) {
  if (p.loading) return <div className="h-40 animate-pulse rounded-2xl bg-bg-deep" />;
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-deep p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-[10px] text-ink-dim">업종
            <select value={p.storeType} onChange={(e) => p.setStoreType(e.target.value)} className="mt-0.5 w-full rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink">
              {INDUSTRIES.map((s) => <option key={s} value={s}>{INDUSTRY_PROFILES[s].label}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-ink-dim">곡 수
            <input type="number" min={1} max={100} value={p.count} onChange={(e) => p.setCount(Math.max(1, Math.min(100, +e.target.value || 1)))} className="mt-0.5 w-full rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink" />
          </label>
          <label className="text-[10px] text-ink-dim">최소 적합도
            <input type="number" min={0} max={100} value={p.minCompat} onChange={(e) => p.setMinCompat(Math.max(0, Math.min(100, +e.target.value || 0)))} className="mt-0.5 w-full rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink" />
          </label>
          <label className="text-[10px] text-ink-dim">최대 피로도
            <input type="number" min={0} max={100} value={p.maxFatigue} onChange={(e) => p.setMaxFatigue(Math.max(0, Math.min(100, +e.target.value || 0)))} className="mt-0.5 w-full rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink" />
          </label>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-ink-dim">Pool {NUM(p.pool.length)}곡 · 미지원 메타: {UNSUPPORTED_METADATA.join(', ')}</span>
          <button disabled={p.busy} onClick={p.onGenerate} className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40"><Sparkles size={12} /> Draft 생성</button>
        </div>
      </div>

      {p.result && (
        <>
          {p.sim && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <SimStat label="곡 수" value={NUM(p.sim.trackCount)} />
              <SimStat label="다양성" value={`${p.sim.diversity}`} />
              <SimStat label="신선도" value={`${p.sim.freshness}`} />
              <SimStat label="예상 완주" value={PCT(p.sim.avgCompletion)} />
              <SimStat label="Skip Risk" value={PCT(p.sim.skipRisk)} />
            </div>
          )}
          {p.sim && (
            <p className="text-[10px] text-ink-dim">Freshness 구성: {(['verified', 'test_pool', 'promoted', 'longterm'] as const).map((b) => `${BUCKET_LABEL[b]} ${p.sim!.bucketMix[b]}`).join(' · ')}</p>
          )}
          {p.result.selected.length === 0
            ? <AdminEmpty icon={<Inbox size={24} />} title="생성된 Track 없음" description="적합도/피로도 조건을 완화하거나 Pool 을 확인하세요." />
            : <>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-ink">생성 Draft ({p.result.selected.length}곡) · 선택 이유 공개</p>
                <button disabled={p.busy} onClick={p.onSave} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">Draft 저장</button>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {p.result.selected.map((s, i) => (
                  <div key={s.track.track_id} className="rounded-lg bg-bg-deep px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] text-ink"><span className="text-ink-dim">#{i + 1}</span> {s.track.title}{s.track.artist ? ` · ${s.track.artist}` : ''}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <AdminBadge tone="neutral" size="sm">{BUCKET_LABEL[s.bucket]}</AdminBadge>
                        <span className="text-[11px] tabular-nums text-ink">적합 {s.compatibility}</span>
                      </span>
                    </div>
                    <p className="text-[9px] text-ink-dim">{s.track.main_genre ?? '—'} · {s.track.mood ?? '—'} · 완주 {PCT(s.track.completion_rate)} · 피로 {s.fatigue}</p>
                  </div>
                ))}
              </div>
              {p.result.excluded.length > 0 && <p className="text-[10px] text-ink-dim">제외 {p.result.excluded.length}곡 (예: {p.result.excluded.slice(0, 2).map((e) => `${e.track.title}—${e.reason}`).join(', ')})</p>}
            </>}
        </>
      )}
    </div>
  );
}
function SimStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-bg-deep p-2.5"><p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p><p className="mt-0.5 text-base font-bold text-ink">{value}</p></div>;
}

/* ── Drafts / History ──────────────────────────────────────── */
function DraftsTab({ drafts, busy, onDecide, historyMode }: { drafts: PlaylistDraftRow[] | null; busy: boolean; onDecide: (d: PlaylistDraftRow, s: 'approved' | 'rejected') => void; historyMode?: boolean }) {
  if (!drafts) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (drafts.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title={historyMode ? '처리 이력 없음' : 'Draft 없음'} description="Generator 에서 Draft 를 생성/저장하세요 (0487 미적용 시 비어 있음)." />;
  return (
    <div className="space-y-2">
      {drafts.map((d) => (
        <div key={d.id} className="rounded-xl bg-bg-deep p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-ink">{d.name}</span>
                <AdminBadge tone={d.status === 'approved' ? 'success' : d.status === 'rejected' ? 'neutral' : 'info'} size="sm">{d.status === 'approved' ? '승인' : d.status === 'rejected' ? '반려' : '초안'}</AdminBadge>
                <AdminBadge tone="neutral" size="sm">{Array.isArray(d.tracks) ? d.tracks.length : 0}곡</AdminBadge>
              </div>
              <p className="mt-1 text-[10px] text-ink-dim">{d.store_type ?? '—'} · {relativeTimeKo(d.created_at)}</p>
            </div>
            {d.status === 'draft' && !historyMode && (
              <div className="flex shrink-0 gap-1">
                <button disabled={busy} onClick={() => onDecide(d, 'rejected')} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">반려</button>
                <button disabled={busy} onClick={() => onDecide(d, 'approved')} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-40"><CheckCircle2 size={11} /> 승인(배포 아님)</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Brand DNA ─────────────────────────────────────────────── */
function BrandTab({ brands, busy, onReload, onSave }: { brands: BrandDnaRow[] | null; busy: boolean; onReload: () => void; onSave: (k: string, l: string | null, p: Record<string, unknown>) => Promise<unknown> }) {
  const [key, setKey] = useState(''); const [label, setLabel] = useState(''); const [genres, setGenres] = useState(''); const [moods, setMoods] = useState('');
  async function submit() {
    if (!key.trim()) { toast.error('brand_key 를 입력하세요.'); return; }
    try {
      await onSave(key.trim(), label.trim() || null, { genres: genres.split(',').map((s) => s.trim()).filter(Boolean), moods: moods.split(',').map((s) => s.trim()).filter(Boolean) });
      toast.success('Brand DNA 저장(Draft Profile)'); setKey(''); setLabel(''); setGenres(''); setMoods(''); onReload();
    } catch (e) { toast.error(`저장 실패: ${friendlyError(e, '0487 미적용일 수 있음')}`); }
  }
  return (
    <div className="space-y-3">
      <AdminAlert tone="info" icon={<Fingerprint size={16} />} title="Brand DNA (운영 프로필)" description="기존 Brand Policy 가 없을 때 Draft Profile 로 저장합니다. 생성 시 참고용." />
      <div className="rounded-xl bg-bg-deep p-3">
        <div className="grid grid-cols-2 gap-2">
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="brand_key" className="rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink placeholder:text-ink-dim" />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="브랜드명" className="rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink placeholder:text-ink-dim" />
          <input value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="선호 장르(쉼표)" className="rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink placeholder:text-ink-dim" />
          <input value={moods} onChange={(e) => setMoods(e.target.value)} placeholder="선호 무드(쉼표)" className="rounded-lg bg-bg-card px-2 py-1.5 text-xs text-ink placeholder:text-ink-dim" />
        </div>
        <div className="mt-2 flex justify-end"><button disabled={busy} onClick={submit} className="rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40">저장</button></div>
      </div>
      {!brands ? <div className="h-16 animate-pulse rounded-2xl bg-bg-deep" />
        : brands.length === 0 ? <p className="text-[11px] text-ink-dim">등록된 Brand DNA 없음.</p>
          : <div className="space-y-1.5">
            {brands.map((b) => {
              const prof = b.profile as { genres?: string[]; moods?: string[] };
              return (
                <div key={b.brand_key} className="rounded-lg bg-bg-deep px-2.5 py-2 text-[11px]">
                  <span className="font-bold text-ink">{b.brand_label ?? b.brand_key}</span>
                  <span className="ml-2 text-ink-dim">장르 {(prof.genres ?? []).join('·') || '—'} · 무드 {(prof.moods ?? []).join('·') || '—'} · {b.source}</span>
                </div>
              );
            })}
          </div>}
    </div>
  );
}

/* ── Compatibility ─────────────────────────────────────────── */
function CompatTab({ pool, storeType, setStoreType }: { pool: PoolTrack[]; storeType: string; setStoreType: (s: string) => void }) {
  const profile = getProfile(storeType);
  const ranked = useMemo(() => {
    if (!profile) return [];
    return pool.map((t) => ({ t, c: computeCompatibility(t, profile) })).sort((a, b) => b.c.score - a.c.score).slice(0, 20);
  }, [pool, profile]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-ink-mute">업종별 Track 적합도 (0~100 · Evidence 공개)</span>
        <select value={storeType} onChange={(e) => setStoreType(e.target.value)} className="rounded-full bg-bg-deep px-2 py-1 text-[11px] text-ink">
          {INDUSTRIES.map((s) => <option key={s} value={s}>{INDUSTRY_PROFILES[s].label}</option>)}
        </select>
      </div>
      {ranked.length === 0 ? <AdminEmpty icon={<Gauge size={24} />} title="Pool 없음" description="Track Pool 을 불러오세요." />
        : <div className="space-y-1">
          {ranked.map(({ t, c }) => (
            <div key={t.track_id} className="rounded-lg bg-bg-deep px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] text-ink">{t.title}{t.artist ? ` · ${t.artist}` : ''}</span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-ink">{c.score}</span>
              </div>
              <p className="text-[9px] text-ink-dim">{c.signals.filter((s) => s.present).map((s) => `${s.label} ${typeof s.value === 'number' ? s.value : s.value ?? '—'}(${Math.round(s.match * 100)}%)`).join(' · ') || '메타 없음'}</p>
            </div>
          ))}
        </div>}
    </div>
  );
}
