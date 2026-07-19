/**
 * PlaylistIntelCoreSection — Playlist Intelligence Core & Safe Draft Generation
 * (Phase AI-PLAYLIST-INTEL-1).
 *
 * Production Read Model(후보 Pool RPC) → Hard/Soft/Advisory 제약 → 결정론적 선택(Seed)
 * → Diversity/Energy 평가 → Quality(서버 재계산이 최종) → Explainability → 사람 검토.
 * **여기서 종료** — 실제 Playlist/playlist_tracks/Queue/Scheduler/Player 반영 버튼은
 * 존재하지 않는다. Approve 는 "검토 승인" 감사 기록일 뿐 Publish 가 아니다.
 *
 * 탭: Create · Drafts · Detail · Limitations.
 */
import { useCallback, useEffect, useState } from 'react';
import { Wand2, ListMusic, FileSearch, ShieldAlert, RefreshCw, Inbox } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  createAiPlDraft, fetchAiPlCandidatePool, fetchAiPlDraftDetail, fetchAiPlDrafts,
  reevaluateAiPlDraft, setAiPlDraftStatus,
  type AiPlDraftDetail, type AiPlDraftListRow, type AiPlDraftStatus,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import { INDUSTRY_PROFILES } from '@/lib/playlistGenerator';
import {
  DEFAULT_INTEL_CONFIG, FIXED_DRAFT_WARNING, buildDraftExplanation, buildDraftPayload,
  computeDiversityMetrics, computeEnergyProfile, computeQuality, selectDraftTracks,
  type IntelPoolRow, type PlaylistIntelConfig, type PlaylistQualityResult, type SelectionResult,
} from '@/lib/playlistIntelCore';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'create' | 'drafts' | 'detail' | 'limits';
const TABS: { key: Tab; label: string; icon: typeof Wand2 }[] = [
  { key: 'create', label: 'Create', icon: Wand2 },
  { key: 'drafts', label: 'Drafts', icon: ListMusic },
  { key: 'detail', label: 'Detail', icon: FileSearch },
  { key: 'limits', label: 'Limitations', icon: ShieldAlert },
];

const STATUS_TONE: Record<AiPlDraftStatus, 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'neutral', ready_for_review: 'info', approved: 'success', rejected: 'danger', expired: 'warning', archived: 'neutral',
};

function Box({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-bg-deep px-3 py-2">
      <div className="text-[10px] text-ink-mute">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      {hint ? <div className="text-[10px] text-ink-mute">{hint}</div> : null}
    </div>
  );
}

const KNOWN_LIMITATIONS = [
  '이 Draft는 실제 매장 Playlist, Queue, Player, Scheduler에 자동 반영되지 않습니다(Publish 경로 자체가 없음).',
  'Approve 상태는 "사람이 Draft 품질을 검토하고 승인했다"는 감사 기록일 뿐 Production Publish가 아닙니다.',
  'Quality Score는 서버(_ai_pl_draft_quality)가 재계산해 저장하며, 브라우저 미리보기 점수는 참고용입니다.',
  'Store Fit은 playlist 단위(playlist_track_fit_scores)만 존재 — source playlist 미지정 시 missing_store_fit으로 처리합니다.',
  'Daypart 목표 Energy Profile은 predicted_dayparts 미적재로 항상 insufficient_data입니다.',
  '무드 목표 분포 정책이 없어 moodBalance는 산출하지 않습니다(임의 목표 생성 금지).',
  '앨범은 album_name 텍스트 기준이며 정규 album_id가 없어 누락 시 albumDiversity를 산출하지 않습니다.',
  'Hard Constraint(Explicit/Instrumental/차단 장르/매장 제외/QC 미달/fit excluded)는 목표 곡 수 충족을 위해 완화하지 않습니다.',
  '후보 Pool은 최대 500곡으로 제한되며 전체 트랙 Full Scan을 하지 않습니다.',
  '이 UI는 브라우저에서 직접 검증되지 않았습니다(정상 동작 단정 없음). Migration 0565는 Production 미적용입니다.',
];

export default function PlaylistIntelCoreSection() {
  const [tab, setTab] = useState<Tab>('create');
  const [drafts, setDrafts] = useState<AiPlDraftListRow[] | null>(null);
  const [detail, setDetail] = useState<AiPlDraftDetail | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [rejectReason, setRejectReason] = useState('');
  const [nowMs] = useState(() => Date.now());

  // Create 설정
  const [name, setName] = useState('');
  const [storeType, setStoreType] = useState('cafe');
  const [target, setTarget] = useState(20);
  const [minFit, setMinFit] = useState<number | ''>('');
  const [minQc, setMinQc] = useState<number | ''>(60);
  const [blockExplicit, setBlockExplicit] = useState(true);
  const [requireInstrumental, setRequireInstrumental] = useState(false);
  const [recentDays, setRecentDays] = useState<number | ''>('');
  const [seed, setSeed] = useState(1);
  const [preview, setPreview] = useState<{
    poolCount: number; result: SelectionResult; quality: PlaylistQualityResult; explanation: string[];
    cfg: PlaylistIntelConfig;
  } | null>(null);

  const loadDrafts = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setDrafts(await fetchAiPlDrafts(statusFilter || null, 100)); }
    catch (e) { setErr(classifyAdminError(e)); setDrafts(null); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  const generatePreview = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const cfg: PlaylistIntelConfig = {
        ...DEFAULT_INTEL_CONFIG,
        storeType, targetCount: target, seed,
        minStoreFit: minFit === '' ? null : minFit,
        minQc: minQc === '' ? null : minQc,
        blockExplicit, requireInstrumental,
        recentPlayExcludeDays: recentDays === '' ? null : recentDays,
      };
      const pool = await fetchAiPlCandidatePool({ store_type: storeType, limit: 500 });
      const rows = pool.items as unknown as IntelPoolRow[];
      const result = selectDraftTracks(rows, cfg, nowMs);
      const metrics = computeDiversityMetrics(result.selected, nowMs);
      const energy = computeEnergyProfile(result.selected, cfg);
      const quality = computeQuality(result.selected, 0, metrics, energy, cfg, new Date(nowMs).toISOString());
      const explanation = buildDraftExplanation(cfg, rows.length, result, metrics, energy, quality);
      setPreview({ poolCount: rows.length, result, quality, explanation, cfg });
      if (result.selected.length === 0) toast.info('선택된 곡 없음 — 조건을 완화하거나 후보를 확인하세요.');
    } catch (e) { setErr(classifyAdminError(e)); toast.error(`후보 조회 실패: ${friendlyError(e, '0565 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }, [storeType, target, seed, minFit, minQc, blockExplicit, requireInstrumental, recentDays, nowMs]);

  const saveDraft = useCallback(async () => {
    if (!preview || preview.result.selected.length === 0) { toast.error('저장할 Draft가 없습니다.'); return; }
    if (!name.trim()) { toast.error('Draft 이름을 입력하세요.'); return; }
    setBusy(true);
    try {
      const payload = buildDraftPayload(name.trim(), preview.cfg, preview.poolCount, preview.result, preview.explanation, preview.quality);
      const saved = await createAiPlDraft(payload);
      toast.success(saved.duplicate ? '동일 조건 Draft가 이미 있어 기존 Draft를 반환했습니다.' : 'Draft 저장(서버가 Hard Gate·품질 재검증). 자동 반영 없음.');
      setDetail(saved); setTab('detail'); await loadDrafts();
    } catch (e) { toast.error(`저장 거부/실패: ${friendlyError(e, 'Hard Constraint 위반 시 서버가 저장을 거부합니다')}`); }
    finally { setBusy(false); }
  }, [preview, name, loadDrafts]);

  const openDetail = useCallback(async (id: string) => {
    setBusy(true);
    try { setDetail(await fetchAiPlDraftDetail(id)); setTab('detail'); }
    catch (e) { toast.error(`상세 조회 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }, []);

  const changeStatus = useCallback(async (id: string, status: AiPlDraftStatus) => {
    if (status === 'rejected' && !rejectReason.trim()) { toast.error('거절 사유를 입력하세요.'); return; }
    setBusy(true);
    try {
      const d = await setAiPlDraftStatus(id, status, status === 'rejected' ? rejectReason.trim() : undefined);
      setDetail(d); setRejectReason('');
      toast.success(status === 'approved' ? '검토 승인 기록(Publish 아님)' : `상태 변경: ${status}`);
      await loadDrafts();
    } catch (e) { toast.error(`상태 변경 실패: ${friendlyError(e, 'Hard 위반 시 ready_for_review 불가')}`); }
    finally { setBusy(false); }
  }, [rejectReason, loadDrafts]);

  const reevaluate = useCallback(async (id: string) => {
    setBusy(true);
    try { setDetail(await reevaluateAiPlDraft(id)); toast.success('서버 품질 재평가 완료'); await loadDrafts(); }
    catch (e) { toast.error(`재평가 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }, [loadDrafts]);

  return (
    <AdminCard title="Playlist Intelligence Core" subtitle="AI-PLAYLIST-INTEL-1 — Safe Draft Generation (Shadow · 자동 반영 없음)">
      <AdminAlert tone="info">{FIXED_DRAFT_WARNING}</AdminAlert>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
            <t.icon className="mr-1 inline h-3 w-3" />{t.label}
          </button>
        ))}
        <button type="button" onClick={() => void loadDrafts()} disabled={loading || busy}
          className="ml-auto rounded-full bg-bg-deep px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-50">
          <RefreshCw className={`mr-1 inline h-3 w-3 ${loading ? 'animate-spin' : ''}`} />새로고침
        </button>
      </div>

      {err ? (
        <div className="mt-3">
          <AdminAlert tone="danger">불러오기 실패: {err.message}</AdminAlert>
          <button type="button" onClick={() => void loadDrafts()} className="mt-2 rounded bg-bg-deep px-3 py-1.5 text-xs text-ink">다시 시도</button>
        </div>
      ) : null}

      {tab === 'create' ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-[11px] text-ink-mute">이름
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 카페 저에너지 30곡"
                className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">업종(Store Type)
              <select value={storeType} onChange={(e) => setStoreType(e.target.value)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink">
                {Object.values(INDUSTRY_PROFILES).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-ink-mute">목표 곡 수(1~200)
              <input type="number" min={1} max={200} value={target} onChange={(e) => setTarget(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">Seed(결정론)
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)}
                className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">최소 Store Fit(Soft)
              <input type="number" value={minFit} placeholder="미설정" onChange={(e) => setMinFit(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">최소 QC(Hard)
              <input type="number" value={minQc} placeholder="미설정" onChange={(e) => setMinQc(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-[11px] text-ink-mute">최근 재생 제외(일)
              <input type="number" value={recentDays} placeholder="미설정" onChange={(e) => setRecentDays(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <div className="flex items-end gap-3 text-[11px] text-ink">
              <label className="flex items-center gap-1"><input type="checkbox" checked={blockExplicit} onChange={(e) => setBlockExplicit(e.target.checked)} />Explicit 금지</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={requireInstrumental} onChange={(e) => setRequireInstrumental(e.target.checked)} />Instrumental 필수</label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void generatePreview()} disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
              {busy ? '계산 중…' : '후보 조회 + Draft 미리보기'}
            </button>
            <button type="button" onClick={() => void saveDraft()} disabled={busy || !preview}
              className="rounded bg-bg-deep px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50">
              Draft 저장(서버 재검증)
            </button>
          </div>

          {preview ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <Box label="후보" value={NUM(preview.poolCount)} />
                <Box label="선택" value={NUM(preview.result.selected.length)} hint={preview.result.shortfall > 0 ? `부족 ${preview.result.shortfall}곡` : undefined} />
                <Box label="제외" value={NUM(preview.result.excluded.length)} />
                <Box label="Hard 위반 후보" value={NUM(preview.result.hardViolationCount)} hint="완화 불가" />
                <Box label="Quality(미리보기)" value={preview.quality.score == null ? 'insufficient' : `${preview.quality.score} (${preview.quality.grade})`} hint="서버 재계산이 최종" />
              </div>
              {preview.result.relaxations.length > 0 ? (
                <AdminAlert tone="warning">{preview.result.relaxations.map((r) => r.note).join(' ')}</AdminAlert>
              ) : null}
              <div className="rounded-lg bg-bg-deep p-3 text-[11px] leading-5 text-ink">
                {preview.explanation.map((l, i) => <div key={i}>{l}</div>)}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg bg-bg-deep p-2">
                {preview.result.selected.map((c, i) => (
                  <div key={c.trackId} className="flex items-center justify-between border-b border-white/5 py-1 text-[11px]">
                    <span className="text-ink">{i + 1}. {c.title ?? c.trackId} <span className="text-ink-mute">{c.artistKey ?? ''}</span></span>
                    <span className="text-ink-mute">{c.genre ?? '?'} · 점수 {c.selectionScore}{c.missing.length ? ` · ${c.missing.join(',')}` : ''}</span>
                  </div>
                ))}
                {preview.result.selected.length === 0 ? <AdminEmpty icon={<Inbox size={24} />} title="선택된 곡 없음" description="조건을 완화하거나 후보 데이터를 확인하세요." /> : null}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-ink-mute">후보 조회를 실행하면 결정론적 미리보기(동일 입력+Seed → 동일 결과)가 표시됩니다.</p>
          )}
        </div>
      ) : null}

      {tab === 'drafts' ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded bg-bg-deep px-2 py-1 text-[11px] text-ink">
              <option value="">전체 상태</option>
              {(['draft', 'ready_for_review', 'approved', 'rejected', 'expired', 'archived'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {loading ? <p className="text-[11px] text-ink-mute">불러오는 중…</p> : null}
          {!loading && drafts && drafts.length === 0 ? (
            <AdminEmpty icon={<Inbox size={24} />} title="Draft 없음" description="Create 탭에서 첫 Draft를 생성하세요. (0565 미적용 환경에서는 목록이 비어 있습니다)" />
          ) : null}
          {drafts?.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-2 text-[11px]">
              <div>
                <div className="font-semibold text-ink">{d.name} <AdminBadge tone={STATUS_TONE[d.status]}>{d.status}</AdminBadge></div>
                <div className="text-ink-mute">
                  {d.store_type ?? d.generation_mode} · 후보 {NUM(d.candidate_track_count)} · 선택 {NUM(d.selected_track_count)}/{NUM(d.target_track_count)}
                  · Quality {d.quality_score == null ? 'insufficient' : `${d.quality_score} (${d.quality_grade})`}
                  · {relativeTimeKo(d.created_at, nowMs)} · {d.created_by_name ?? '?'}
                </div>
              </div>
              <button type="button" onClick={() => void openDetail(d.id)} disabled={busy}
                className="rounded bg-black/20 px-2 py-1 text-ink hover:text-white disabled:opacity-50">상세</button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'detail' ? (
        detail ? (
          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{detail.draft.name}</span>
              <AdminBadge tone={STATUS_TONE[detail.draft.status]}>{detail.draft.status}</AdminBadge>
              <span className="text-ink-mute">{detail.draft.algorithm_version}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Box label="Quality(서버)" value={detail.draft.quality_score == null ? 'insufficient' : `${detail.draft.quality_score} (${detail.draft.quality_grade})`} />
              <Box label="선택/목표" value={`${NUM(detail.draft.selected_track_count)}/${NUM(detail.draft.target_track_count)}`} />
              <Box label="후보" value={NUM(detail.draft.candidate_track_count)} />
              <Box label="만료" value={detail.draft.expires_at ? relativeTimeKo(detail.draft.expires_at, nowMs) : '—'} />
              <Box label="검토자" value={detail.draft.reviewed_by_name ?? '—'} hint={detail.draft.reviewed_at ? relativeTimeKo(detail.draft.reviewed_at, nowMs) : undefined} />
            </div>
            {detail.draft.warnings.length > 0 ? <AdminAlert tone="warning">{detail.draft.warnings.join(' · ')}</AdminAlert> : null}
            {detail.draft.insufficient_data.length > 0 ? (
              <AdminAlert tone="info">데이터 부족: {detail.draft.insufficient_data.join(', ')}</AdminAlert>
            ) : null}
            <div className="rounded-lg bg-bg-deep p-3 leading-5 text-ink">
              {detail.draft.explanation.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void reevaluate(detail.draft.id)} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">재평가</button>
              {detail.draft.status === 'draft' ? (
                <button type="button" onClick={() => void changeStatus(detail.draft.id, 'ready_for_review')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">Review Ready</button>
              ) : null}
              {detail.draft.status === 'ready_for_review' ? (
                <>
                  <button type="button" onClick={() => void changeStatus(detail.draft.id, 'approved')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-emerald-300 disabled:opacity-50">Approve(기록)</button>
                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="거절 사유(필수)" className="rounded bg-bg-deep px-2 py-1 text-ink" />
                  <button type="button" onClick={() => void changeStatus(detail.draft.id, 'rejected')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-red-300 disabled:opacity-50">Reject</button>
                </>
              ) : null}
              {detail.draft.status !== 'archived' ? (
                <button type="button" onClick={() => void changeStatus(detail.draft.id, 'archived')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink-mute disabled:opacity-50">Archive</button>
              ) : null}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg bg-bg-deep p-2">
              {detail.tracks.map((t) => (
                <div key={t.track_id} className={`border-b border-white/5 py-1 ${t.selected ? 'text-ink' : 'text-ink-mute line-through'}`}>
                  {t.draft_order + 1}. {t.title ?? t.track_id} — {t.artist ?? '?'} · {t.main_genre ?? '?'} · 점수 {t.selection_score ?? '—'}
                  {!t.selected && t.exclusion_reasons.length ? ` · 제외: ${t.exclusion_reasons.map((r) => r.code).join(',')}` : ''}
                </div>
              ))}
              {detail.tracks.length === 0 ? <AdminEmpty icon={<Inbox size={24} />} title="Track 없음" description="Draft 에 저장된 Track 이 없습니다." /> : null}
            </div>
            <div className="rounded-lg bg-bg-deep p-2">
              <div className="mb-1 font-semibold text-ink">Audit</div>
              {detail.events.map((e, i) => (
                <div key={i} className="text-ink-mute">
                  {relativeTimeKo(e.created_at, nowMs)} · {e.event_type}
                  {e.previous_status ? ` (${e.previous_status}→${e.next_status})` : ''} · {e.actor_name ?? 'system'}
                  {e.reason ? ` · ${e.reason}` : ''}
                </div>
              ))}
              {detail.events.length === 0 ? <div className="text-ink-mute">이벤트 없음</div> : null}
            </div>
          </div>
        ) : (
          <div className="mt-3"><AdminEmpty icon={<FileSearch size={24} />} title="선택된 Draft 없음" description="Drafts 탭에서 상세를 열어주세요." /></div>
        )
      ) : null}

      {tab === 'limits' ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-ink-mute">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : null}
    </AdminCard>
  );
}
