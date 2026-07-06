import { useCallback, useEffect, useRef, useState } from 'react';
import { X, RefreshCw, Save, Sparkles, Ban, Trash2, Calculator } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import {
  adminGetTrackPlacementDetail,
  adminUpdateTrackMetadata,
  adminApplyAiMetadataWithAudit,
  adminAddTrackExclusion,
  adminRemoveTrackExclusion,
  adminPreviewPlacementChanges,
  adminRemoveMisplacedPlaylistTracks,
  adminRecomputeTrackFitScores,
  adminListTrackMetadataAudit,
  listTaxonomyStoreTypes,
  type TrackPlacementDetail,
  type PreviewPlacementChanges,
  type TrackAuditEntry,
  type StoreTypeOption,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';

type Tab = 'meta' | 'ai' | 'exclude' | 'placements' | 'preview' | 'audit';

export default function TrackPlacementEditor({
  trackId,
  onClose,
  onMutated,
}: {
  trackId: string;
  onClose: () => void;
  onMutated?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('meta');
  const [detail, setDetail] = useState<TrackPlacementDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await adminGetTrackPlacementDetail(trackId);
      setDetail(d);
    } catch (e) {
      toast.error(`불러오기 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [trackId]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    await load();
    onMutated?.();
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 md:p-4">
      <div className="flex h-[92vh] w-full max-w-5xl flex-col rounded-2xl bg-bg-deep shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold">
              AI 메타·배치 관리: {detail?.track?.title ?? '...'}
            </h2>
            <p className="truncate text-xs text-ink-dim">
              {detail?.track?.artist ?? ''} · track_id={trackId.slice(0, 8)}…
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-card"><X size={18} /></button>
        </div>
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line/10 px-3 py-2">
          {([
            ['meta', '1) 현재 메타'],
            ['ai', '2) AI 추천'],
            ['exclude', '3) 금지 장소'],
            ['placements', '4) 현재 플레이리스트'],
            ['preview', '5) 재배치 Preview'],
            ['audit', '6) 변경 이력'],
          ] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${tab === k ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading || !detail ? (
            <p className="text-center text-sm text-ink-dim">로딩 중…</p>
          ) : (
            <>
              {tab === 'meta' && <MetaTab detail={detail} busy={busy} setBusy={setBusy} onSaved={refresh} />}
              {tab === 'ai' && <AiTab detail={detail} busy={busy} setBusy={setBusy} onApplied={refresh} />}
              {tab === 'exclude' && <ExcludeTab detail={detail} busy={busy} setBusy={setBusy} onChanged={refresh} />}
              {tab === 'placements' && <PlacementsTab detail={detail} />}
              {tab === 'preview' && <PreviewTab trackId={trackId} busy={busy} setBusy={setBusy} onCleaned={refresh} />}
              {tab === 'audit' && <AuditTab trackId={trackId} />}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-line/10 px-4 py-2 text-xs text-ink-dim">
          <span>
            🔒 잠금 필드: {detail?.track?.locked_fields?.join(', ') ?? '—'}
          </span>
          <span>정책: 자동 메타/삭제/차단 금지 · 모든 변경 audit 기록</span>
        </div>
      </div>
    </div>
  );
}

// ===== Tab 1: 현재 메타 (편집 + 저장) =====
function MetaTab({
  detail, busy, setBusy, onSaved,
}: { detail: TrackPlacementDetail; busy: boolean; setBusy: (b: boolean) => void; onSaved: () => Promise<void> }) {
  const t = detail.track;
  const [title, setTitle] = useState(t.title ?? '');
  const [artist, setArtist] = useState(t.artist ?? '');
  const [mainGenre, setMainGenre] = useState(t.main_genre ?? '');
  const [mood, setMood] = useState(t.mood ?? '');
  const [suitableStore, setSuitableStore] = useState(t.suitable_store ?? '');
  const [reason, setReason] = useState('');

  useEffect(() => {
    setTitle(t.title ?? ''); setArtist(t.artist ?? '');
    setMainGenre(t.main_genre ?? ''); setMood(t.mood ?? '');
    setSuitableStore(t.suitable_store ?? '');
  }, [t.title, t.artist, t.main_genre, t.mood, t.suitable_store]);

  const dirty =
    (title !== (t.title ?? '')) || (artist !== (t.artist ?? '')) ||
    (mainGenre !== (t.main_genre ?? '')) || (mood !== (t.mood ?? '')) ||
    (suitableStore !== (t.suitable_store ?? ''));

  const save = async () => {
    if (!dirty) { toast.error('변경 사항이 없습니다.'); return; }
    setBusy(true);
    try {
      await adminUpdateTrackMetadata(t.id, {
        title: title !== (t.title ?? '') ? title : undefined,
        artist: artist !== (t.artist ?? '') ? artist : undefined,
        main_genre: mainGenre !== (t.main_genre ?? '') ? mainGenre : undefined,
        mood: mood !== (t.mood ?? '') ? mood : undefined,
        suitable_store: suitableStore !== (t.suitable_store ?? '') ? suitableStore : undefined,
      }, reason || undefined);
      toast.success('메타데이터를 저장했어요.');
      setReason('');
      await onSaved();
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const field = (label: string, value: string, setter: (v: string) => void, placeholder?: string, locked = false) => (
    <label className="block">
      <span className="text-xs font-semibold text-ink-mute">{label}{locked && ' 🔒'}</span>
      <input type="text" value={value} onChange={(e) => setter(e.target.value)}
        disabled={locked || busy} placeholder={placeholder ?? ''}
        className="mt-1 w-full rounded bg-bg-card px-2 py-1.5 text-sm disabled:opacity-50" />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {field('Title', title, setTitle)}
        {field('Artist', artist, setArtist)}
        {field('Main Genre', mainGenre, setMainGenre, '예: Rock, K-Pop, Jazz')}
        {field('Mood', mood, setMood, '예: chill, energetic')}
        {field('Suitable Store', suitableStore, setSuitableStore, '예: 와인바, 카페')}
        <div>
          <span className="text-xs font-semibold text-ink-mute">잠금 필드 (수정 불가)</span>
          <div className="mt-1 space-y-1 rounded bg-bg-card p-2 text-[11px] text-ink-dim">
            <div>audio_url: {t.audio_url_present ? '✓ present' : '—'}</div>
            <div>ISRC: {t.isrc_present ? '✓ present' : '—'}</div>
            <div>release_date: {t.release_date ?? '—'}</div>
            <div>release_status: {t.release_status ?? '—'}</div>
          </div>
        </div>
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-ink-mute">변경 사유 (audit 기록)</span>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="예: AI 추천과 매칭, 운영자 판단" className="mt-1 w-full rounded bg-bg-card px-2 py-1.5 text-sm" />
      </label>
      <button onClick={() => void save()} disabled={busy || !dirty}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
        <Save size={13} /> 저장
      </button>
    </div>
  );
}

// ===== Tab 2: AI 추천 (적용 버튼 4종) =====
function AiTab({
  detail, busy, setBusy, onApplied,
}: { detail: TrackPlacementDetail; busy: boolean; setBusy: (b: boolean) => void; onApplied: () => Promise<void> }) {
  const ai = detail.ai_prediction;
  const [reason, setReason] = useState('');

  if (!ai) {
    return <p className="text-sm text-ink-dim">이 트랙에 AI taxonomy-v1 예측 데이터가 없습니다. 먼저 백필을 실행하세요.</p>;
  }

  const apply = async (scope: { genre: boolean; mood: boolean; store: boolean }, label: string) => {
    if (!scope.genre && !scope.mood && !scope.store) { toast.error('적용할 항목을 선택하세요.'); return; }
    if (!confirm(`${label} 을 적용하시겠어요? (자동 배치 안 함)`)) return;
    setBusy(true);
    try {
      await adminApplyAiMetadataWithAudit(detail.track.id, scope, reason || undefined);
      toast.success(`${label} 적용 완료. fit_score 재계산 별도 실행 필요.`);
      setReason('');
      await onApplied();
    } catch (e) {
      toast.error(`적용 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-bg-card p-3">
          <div className="text-[10px] uppercase text-ink-dim">predicted_main_genre</div>
          <div className="mt-1 text-base font-bold">{ai.predicted_main_genre_ko ?? ai.predicted_main_genre ?? '—'}</div>
          <div className="text-[10px] text-ink-dim">slug: {ai.predicted_main_genre ?? '—'}</div>
          <div className="text-[10px] text-ink-dim">conf: {ai.genre_confidence != null ? `${(ai.genre_confidence * 100).toFixed(1)}%` : '—'}</div>
          {ai.predicted_sub_genres && ai.predicted_sub_genres.length > 0 && (
            <div className="mt-1 text-[10px] text-ink-mute">sub: {ai.predicted_sub_genres.join(', ')}</div>
          )}
        </div>
        <div className="rounded-xl bg-bg-card p-3">
          <div className="text-[10px] uppercase text-ink-dim">predicted_moods (top3)</div>
          <div className="mt-1 text-sm font-semibold">{(ai.predicted_moods_ko ?? ai.predicted_moods ?? []).join(' · ') || '—'}</div>
          <div className="text-[10px] text-ink-dim">slugs: {(ai.predicted_moods ?? []).join(', ') || '—'}</div>
          <div className="text-[10px] text-ink-dim">conf: {ai.mood_confidence != null ? `${(ai.mood_confidence * 100).toFixed(1)}%` : '—'}</div>
        </div>
        <div className="rounded-xl bg-bg-card p-3">
          <div className="text-[10px] uppercase text-ink-dim">predicted_store_types (top3)</div>
          <div className="mt-1 text-sm font-semibold">{(ai.predicted_store_types_ko ?? ai.predicted_store_types ?? []).join(' · ') || '—'}</div>
          <div className="text-[10px] text-ink-dim">slugs: {(ai.predicted_store_types ?? []).join(', ') || '—'}</div>
          <div className="text-[10px] text-ink-dim">conf: {ai.store_type_confidence != null ? `${(ai.store_type_confidence * 100).toFixed(1)}%` : '—'}</div>
        </div>
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-ink-mute">적용 사유 (audit)</span>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded bg-bg-card px-2 py-1.5 text-sm" placeholder="예: AI 분류 신뢰" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void apply({ genre: true, mood: true, store: true }, '전체 AI 메타')} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
          <Sparkles size={13} /> 전체 AI 메타 적용
        </button>
        <button onClick={() => void apply({ genre: true, mood: false, store: false }, '장르만')} disabled={busy}
          className="rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">장르만</button>
        <button onClick={() => void apply({ genre: false, mood: true, store: false }, '무드만')} disabled={busy}
          className="rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">무드만</button>
        <button onClick={() => void apply({ genre: false, mood: false, store: true }, '매장만')} disabled={busy}
          className="rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">매장만</button>
      </div>
      <p className="text-[11px] text-ink-dim">
        ⚠️ AI 메타 적용은 tracks 운영 메타만 변경합니다. 자동 배치 없음.
        fit_score 재계산은 '5) 재배치 Preview' 탭에서 별도 실행.
      </p>
    </div>
  );
}

// ===== Tab 3: 금지 장소 =====
function ExcludeTab({
  detail, busy, setBusy, onChanged,
}: { detail: TrackPlacementDetail; busy: boolean; setBusy: (b: boolean) => void; onChanged: () => Promise<void> }) {
  const [storeTypes, setStoreTypes] = useState<StoreTypeOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    listTaxonomyStoreTypes().then(setStoreTypes).catch((e) => toast.error(`store type 로딩 실패: ${e.message}`));
  }, []);

  const add = async () => {
    if (!selectedSlug) { toast.error('금지할 store_type 을 선택하세요.'); return; }
    if (!confirm(`이 트랙을 "${selectedSlug}" 에서 영구 금지하시겠어요? (hard block, AI boost 우회 불가)`)) return;
    setBusy(true);
    try {
      await adminAddTrackExclusion(detail.track.id, selectedSlug, reason || undefined);
      toast.success(`${selectedSlug} 금지 추가됨.`);
      setSelectedSlug(''); setReason('');
      await onChanged();
    } catch (e) {
      toast.error(`추가 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const remove = async (id: string, slug: string) => {
    if (!confirm(`"${slug}" 금지를 해제하시겠어요?`)) return;
    setBusy(true);
    try {
      await adminRemoveTrackExclusion(id);
      toast.success(`${slug} 금지 해제.`);
      await onChanged();
    } catch (e) {
      toast.error(`해제 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const activeSlugs = new Set(detail.exclusions.map((e) => e.store_type_slug));
  const availableTypes = storeTypes.filter((s) => !activeSlugs.has(s.slug));

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-sm font-bold">현재 활성 금지 ({detail.exclusions.length})</h3>
        {detail.exclusions.length === 0 ? (
          <p className="text-xs text-ink-dim">활성 금지가 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {detail.exclusions.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1.5 text-xs">
                <div className="min-w-0">
                  <span className="rounded bg-rose-500/20 px-1.5 font-bold text-rose-300">{e.store_type_slug}</span>
                  {e.store_type_name_ko && <span className="ml-1 text-ink-mute">({e.store_type_name_ko})</span>}
                  {e.reason && <span className="ml-2 text-ink-dim">— {e.reason}</span>}
                  <div className="text-[10px] text-ink-dim/70">{new Date(e.created_at).toLocaleString()} · {e.created_by_name ?? 'unknown'}</div>
                </div>
                <button onClick={() => void remove(e.id, e.store_type_slug)} disabled={busy}
                  className="shrink-0 rounded bg-ink/10 px-2 py-0.5 font-semibold text-ink-mute disabled:opacity-50">해제</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-sm font-bold">금지 장소 추가</h3>
        <div className="space-y-2">
          <select value={selectedSlug} onChange={(e) => setSelectedSlug(e.target.value)} disabled={busy}
            className="w-full rounded bg-bg-deep px-2 py-1.5 text-sm">
            <option value="">— 선택 —</option>
            {availableTypes.map((s) => (
              <option key={s.slug} value={s.slug}>{s.name_ko} ({s.slug})</option>
            ))}
          </select>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="금지 사유 (예: Rock 트랙 와인바 부적합)"
            className="w-full rounded bg-bg-deep px-2 py-1.5 text-sm" />
          <button onClick={() => void add()} disabled={busy || !selectedSlug}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/25 px-3 py-1.5 text-xs font-bold text-rose-300 disabled:opacity-50">
            <Ban size={13} /> 금지 추가
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-dim">
          금지 추가 시 fit_score 즉시 0 으로 변경되지 않음. '5) 재배치 Preview' 에서 재계산 + 기존 잘못된 배치 제거.
        </p>
      </div>
    </div>
  );
}

// ===== Tab 4: 현재 플레이리스트 =====
function PlacementsTab({ detail }: { detail: TrackPlacementDetail }) {
  if (detail.placements.length === 0) {
    return <p className="text-sm text-ink-dim">현재 배치된 플레이리스트가 없습니다.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-bg-card">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
            <th className="px-2 py-2">플레이리스트</th>
            <th className="px-2 py-2">매장</th>
            <th className="px-2 py-2">fit</th>
            <th className="px-2 py-2">status</th>
            <th className="px-2 py-2">manual/AI</th>
            <th className="px-2 py-2">배치됨?</th>
            <th className="px-2 py-2">금지?</th>
          </tr>
        </thead>
        <tbody>
          {detail.placements.map((p) => (
            <tr key={p.playlist_id} className="border-b border-line/10">
              <td className="px-2 py-1.5">
                <div className="font-semibold">{p.playlist_title}</div>
                <div className="text-[10px] text-ink-dim">{p.daypart ?? '—'} · key={p.ai_store_key ?? '—'}</div>
              </td>
              <td className="px-2 py-1.5 text-ink-mute">{p.business_category ?? '—'}</td>
              <td className="px-2 py-1.5 font-bold">{p.fit_score ?? '—'}</td>
              <td className="px-2 py-1.5">
                <span className={`rounded px-1.5 text-[10px] font-bold ${
                  p.fit_status === 'excluded' ? 'bg-rose-500/20 text-rose-300'
                    : p.fit_status === 'active' ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-ink/10 text-ink-mute'}`}>{p.fit_status ?? '—'}</span>
              </td>
              <td className="px-2 py-1.5 text-[10px] text-ink-mute">m{p.manual_score ?? 0}/+{p.ai_boost_total ?? 0}</td>
              <td className="px-2 py-1.5">{p.in_playlist ? <span className="text-emerald-300">✓</span> : '—'}</td>
              <td className="px-2 py-1.5">{p.is_excluded_by_admin ? <span className="rounded bg-rose-500/20 px-1.5 font-bold text-rose-300">금지</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== Tab 5: 재배치 Preview + 실행 =====
function PreviewTab({
  trackId, busy, setBusy, onCleaned,
}: { trackId: string; busy: boolean; setBusy: (b: boolean) => void; onCleaned: () => Promise<void> }) {
  const [preview, setPreview] = useState<PreviewPlacementChanges | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setPreview(await adminPreviewPlacementChanges(trackId)); }
    catch (e) { toast.error(`preview 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [trackId]);

  useEffect(() => { void load(); }, [load]);

  const removeMisplaced = async () => {
    if (!preview || preview.remove_count === 0) { toast.error('제거할 항목이 없습니다.'); return; }
    if (!confirm(`${preview.remove_count}개 잘못된 배치를 제거하시겠어요? (되돌릴 수 없음. audit 기록 남음)`)) return;
    setBusy(true);
    try {
      const res = await adminRemoveMisplacedPlaylistTracks(trackId, true, reason || undefined);
      toast.success(`${res.count}개 제거 완료.`);
      setReason('');
      await load();
      await onCleaned();
    } catch (e) {
      toast.error(`제거 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const recompute = async () => {
    if (!confirm('이 트랙의 모든 fit_score 를 재계산하시겠어요?')) return;
    setBusy(true);
    try {
      const count = await adminRecomputeTrackFitScores(trackId);
      toast.success(`${count}개 fit_score 재계산 완료.`);
      await load();
      await onCleaned();
    } catch (e) {
      toast.error(`재계산 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  if (loading || !preview) return <p className="text-sm text-ink-dim">Preview 로딩 중…</p>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-rose-500/20 p-2">
          <div className="text-[10px] text-ink-dim">제거 대상</div>
          <div className="text-2xl font-bold text-rose-300">{preview.remove_count}</div>
        </div>
        <div className="rounded bg-emerald-500/20 p-2">
          <div className="text-[10px] text-ink-dim">유지</div>
          <div className="text-2xl font-bold text-emerald-300">{preview.keep_count}</div>
        </div>
        <div className="rounded bg-blue-500/20 p-2">
          <div className="text-[10px] text-ink-dim">신규 후보</div>
          <div className="text-2xl font-bold text-blue-500">{preview.new_candidate_count}</div>
        </div>
      </div>

      {preview.to_remove.length > 0 && (
        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 text-xs font-bold text-rose-300">제거될 playlist_tracks</h4>
          <ul className="space-y-1 text-xs">
            {preview.to_remove.map((r) => (
              <li key={r.playlist_id} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1">
                <span><span className="font-semibold">{r.playlist_title}</span> · <span className="text-ink-dim">{r.business_category}</span></span>
                <span className="text-ink-dim">fit={r.current_fit_score ?? '—'} · idx={r.order_index ?? '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.to_keep.length > 0 && (
        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 text-xs font-bold text-emerald-300">유지될 playlist_tracks</h4>
          <ul className="space-y-1 text-xs">
            {preview.to_keep.map((r) => (
              <li key={r.playlist_id} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1">
                <span><span className="font-semibold">{r.playlist_title}</span> · <span className="text-ink-dim">{r.business_category}</span></span>
                <span className="text-ink-dim">fit={r.current_fit_score ?? '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.new_candidates.length > 0 && (
        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 text-xs font-bold text-blue-500">신규 추천 후보 (auto_place 가 들어갈 만한 곳)</h4>
          <ul className="space-y-1 text-xs">
            {preview.new_candidates.map((r) => (
              <li key={r.playlist_id} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1">
                <span><span className="font-semibold">{r.playlist_title}</span> · <span className="text-ink-dim">{r.business_category}</span></span>
                <span className="text-ink-dim">score={r.estimated_score} · {r.decision}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="제거 사유 (audit)" className="flex-1 min-w-[200px] rounded bg-bg-card px-2 py-1.5 text-xs" />
        <button onClick={() => void load()} disabled={busy || loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
        <button onClick={() => void recompute()} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-bold text-accent disabled:opacity-50">
          <Calculator size={13} /> fit_score 재계산
        </button>
        <button onClick={() => void removeMisplaced()} disabled={busy || preview.remove_count === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/25 px-3 py-1.5 text-xs font-bold text-rose-300 disabled:opacity-50">
          <Trash2 size={13} /> 잘못된 배치 제거 ({preview.remove_count})
        </button>
      </div>
      <p className="text-[11px] text-ink-dim">
        ⚠️ 제거는 되돌릴 수 없습니다. fit_score 재계산은 안전 — exclusion 매칭 시 자동으로 fit=0 처리됩니다.
      </p>
    </div>
  );
}

// ===== Tab 6: 변경 이력 =====
function AuditTab({ trackId }: { trackId: string }) {
  const [entries, setEntries] = useState<TrackAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await adminListTrackMetadataAudit(trackId, 100)); }
    catch (e) { toast.error(`이력 조회 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [trackId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-sm text-ink-dim">로딩 중…</p>;
  if (entries.length === 0) return <p className="text-sm text-ink-dim">변경 이력이 없습니다.</p>;

  return (
    <div className="space-y-2">
      <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded bg-bg-card px-2 py-1 text-xs hover:bg-bg-hover">
        <RefreshCw size={11} /> 새로고침
      </button>
      <ul className="space-y-2">
        {entries.map((a) => (
          <li key={a.id} className="rounded bg-bg-card p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="rounded bg-accent/15 px-1.5 py-0.5 font-bold text-accent">{a.action_type}</span>
              <span className="text-[10px] text-ink-dim">{new Date(a.created_at).toLocaleString()} · {a.admin_name ?? 'unknown'}</span>
            </div>
            {a.reason && <p className="mt-1 text-ink-mute">사유: {a.reason}</p>}
            {(a.before_json || a.after_json) && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-ink-dim">before/after</summary>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
                  <pre className="rounded bg-bg-deep p-2 text-rose-300">{JSON.stringify(a.before_json, null, 2)}</pre>
                  <pre className="rounded bg-bg-deep p-2 text-emerald-300">{JSON.stringify(a.after_json, null, 2)}</pre>
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
