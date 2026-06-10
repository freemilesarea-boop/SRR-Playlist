import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Edit, Trash2, RotateCcw, AlertTriangle, Ban, CheckCircle2, Calculator,
  Eye, Music, X, Save,
} from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import {
  adminGetPlaylistInspector,
  adminUpdateTrackMetadata,
  adminRemoveTrackFromPlaylist,
  adminRestoreTrackToPlaylist,
  adminChangeTrackFitStatus,
  adminRecomputeTrackFit,
  adminListTrackAudit,
  type InspectorTrack,
  type FitStatus,
  type TrackMetadataPayload,
  type AuditLogRow,
} from '@/lib/adminPlaylistInspectorApi';
import { toast } from '@/store/toastStore';
import FeedbackBadges from '@/components/admin/FeedbackBadges';

interface Props {
  playlistId: string;
}

const STATUS_TONE: Record<FitStatus, string> = {
  active:        'bg-emerald-500/15 text-emerald-500',
  review_needed: 'bg-amber-500/15 text-amber-500',
  excluded:      'bg-rose-500/15 text-rose-500',
};

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(0)}%`;

export default function AdminPlaylistTrackInspector({ playlistId }: Props) {
  const [tracks, setTracks] = useState<InspectorTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [editing, setEditing] = useState<InspectorTrack | null>(null);
  const [removing, setRemoving] = useState<InspectorTrack | null>(null);
  const [statusEdit, setStatusEdit] = useState<{ tr: InspectorTrack; next: FitStatus } | null>(null);
  const [auditFor, setAuditFor] = useState<InspectorTrack | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGetPlaylistInspector(playlistId, includeRemoved);
      setTracks(res.tracks ?? []);
    } catch (e) {
      toast.error(`로딩 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [playlistId, includeRemoved]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const active = tracks.filter((t) => !t.removed_at && t.fit_status === 'active').length;
    const review = tracks.filter((t) => !t.removed_at && t.fit_status === 'review_needed').length;
    const excluded = tracks.filter((t) => !t.removed_at && t.fit_status === 'excluded').length;
    const removed = tracks.filter((t) => t.removed_at).length;
    return { active, review, excluded, removed, total: tracks.length };
  }, [tracks]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1">
            <Music size={14} /> 관리자 트랙 검사기
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={includeRemoved}
                onChange={(e) => setIncludeRemoved(e.target.checked)} />
              제거된 곡 보기
            </label>
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span><b>총</b> {stats.total}</span>
          <span className={`rounded px-1.5 py-0.5 ${STATUS_TONE.active}`}>active {stats.active}</span>
          <span className={`rounded px-1.5 py-0.5 ${STATUS_TONE.review_needed}`}>review {stats.review}</span>
          <span className={`rounded px-1.5 py-0.5 ${STATUS_TONE.excluded}`}>excluded {stats.excluded}</span>
          {includeRemoved && stats.removed > 0 && (
            <span className="rounded bg-ink/15 px-1.5 py-0.5 text-ink-dim">removed {stats.removed}</span>
          )}
        </div>
      </div>

      {tracks.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '로딩 중…' : '트랙 없음'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">곡 / 아티스트</th>
                <th className="px-2 py-2">장르 / 분위기 / 매장</th>
                <th className="px-2 py-2 text-right">BPM</th>
                <th className="px-2 py-2 text-right">energy</th>
                <th className="px-2 py-2 text-right">instr</th>
                <th className="px-2 py-2 text-right">acoust</th>
                <th className="px-2 py-2 text-right">fit</th>
                <th className="px-2 py-2">status</th>
                <th className="px-2 py-2">reason</th>
                <th className="px-2 py-2">액션</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => {
                const removed = !!t.removed_at;
                const st = (t.fit_status ?? 'active') as FitStatus;
                return (
                  <tr key={t.pt_id} className={`border-b border-line/10 ${removed ? 'opacity-40' : ''}`}>
                    <td className="px-2 py-1.5 text-ink-dim tabular-nums">{t.order_index}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-semibold">{t.title}</div>
                      <div className="text-[10px] text-ink-dim">{t.artist ?? '—'}</div>
                      {t.admin_note && (
                        <div className="mt-0.5 text-[10px] text-amber-500">📝 {t.admin_note}</div>
                      )}
                      <div className="mt-0.5">
                        <FeedbackBadges trackId={t.track_id} highlightStore={t.normalized_store_slug} />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-[11px]">
                      <div>{t.main_genre ?? '—'}{t.sub_genre ? ` / ${t.sub_genre}` : ''}</div>
                      <div className="text-ink-dim">{t.mood ?? '—'}</div>
                      <div className="text-ink-dim">{t.suitable_store ?? '—'}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.bpm ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span className={t.af_energy != null && t.af_energy > 0.7 ? 'text-rose-500' : ''}>
                        {fmtPct(t.af_energy)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtPct(t.af_instrumentalness)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtPct(t.af_acousticness)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <span className={`font-bold tabular-nums ${
                        (t.fit_score ?? 0) >= 60 ? 'text-emerald-500'
                        : (t.fit_score ?? 0) >= 40 ? 'text-amber-500'
                        : 'text-rose-500'
                      }`}>
                        {t.fit_score ?? '—'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {removed ? (
                        <span className="rounded bg-ink/15 px-1.5 py-0.5 text-[10px] text-ink-dim">REMOVED</span>
                      ) : (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[st]}`}>
                          {st}
                        </span>
                      )}
                      {t.fit_source === 'admin' && (
                        <div className="mt-0.5 text-[9px] text-indigo-500">admin_override</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 max-w-[180px]">
                      <div className="truncate text-[10px] text-ink-dim" title={t.reason ?? ''}>
                        {t.reason ?? '—'}
                      </div>
                      {t.reason_codes && t.reason_codes.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-0.5">
                          {t.reason_codes.slice(0, 3).map((c) => (
                            <span key={c} className="rounded bg-bg-deep px-1 text-[9px]">{c}</span>
                          ))}
                          {t.reason_codes.length > 3 && (
                            <span className="text-[9px] text-ink-dim">+{t.reason_codes.length - 3}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-0.5">
                        {!removed && (
                          <>
                            <button onClick={() => setEditing(t)} title="메타 수정"
                              className="rounded bg-bg-deep p-1 hover:bg-bg-hover">
                              <Edit size={10} />
                            </button>
                            <button onClick={() => setRemoving(t)} title="이 플레이리스트에서 제거"
                              className="rounded bg-rose-500/15 p-1 text-rose-500 hover:bg-rose-500/25">
                              <Trash2 size={10} />
                            </button>
                            <button onClick={() => setStatusEdit({ tr: t, next: 'review_needed' })} title="검토 필요"
                              className="rounded bg-amber-500/15 p-1 text-amber-500 hover:bg-amber-500/25">
                              <AlertTriangle size={10} />
                            </button>
                            <button onClick={() => setStatusEdit({ tr: t, next: 'excluded' })} title="제외 처리"
                              className="rounded bg-rose-500/15 p-1 text-rose-500 hover:bg-rose-500/25">
                              <Ban size={10} />
                            </button>
                            {st !== 'active' && (
                              <button onClick={() => setStatusEdit({ tr: t, next: 'active' })} title="활성화"
                                className="rounded bg-emerald-500/15 p-1 text-emerald-500 hover:bg-emerald-500/25">
                                <CheckCircle2 size={10} />
                              </button>
                            )}
                            <button onClick={() => void doRecompute(t)} title="재계산"
                              className="rounded bg-indigo-500/15 p-1 text-indigo-500 hover:bg-indigo-500/25">
                              <Calculator size={10} />
                            </button>
                          </>
                        )}
                        {removed && (
                          <button onClick={() => void doRestore(t)} title="복원"
                            className="rounded bg-emerald-500/15 p-1 text-emerald-500 hover:bg-emerald-500/25">
                            <RotateCcw size={10} />
                          </button>
                        )}
                        <button onClick={() => setAuditFor(t)} title="이력"
                          className="rounded bg-bg-deep p-1 hover:bg-bg-hover">
                          <Eye size={10} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="rounded bg-bg-card px-3 py-2 text-[10px] text-ink-dim">
        ⚠️ 메타 수정 후 track_analysis + heuristic audio_features + 영향 playlist fit_score 자동 재계산.
        제거는 soft delete (playlist_tracks.removed_at). 모든 액션은 admin_track_audit_logs 기록.
      </p>

      {editing && (
        <MetadataEditModal track={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }} />
      )}
      {removing && (
        <RemoveConfirmModal track={removing} playlistId={playlistId}
          onClose={() => setRemoving(null)}
          onDone={() => { setRemoving(null); void load(); }} />
      )}
      {statusEdit && (
        <StatusChangeModal track={statusEdit.tr} nextStatus={statusEdit.next} playlistId={playlistId}
          onClose={() => setStatusEdit(null)}
          onDone={() => { setStatusEdit(null); void load(); }} />
      )}
      {auditFor && (
        <AuditModal track={auditFor} playlistId={playlistId}
          onClose={() => setAuditFor(null)} />
      )}
    </div>
  );

  async function doRecompute(t: InspectorTrack) {
    try {
      const r = await adminRecomputeTrackFit(playlistId, t.track_id, false);
      const bef = r.before?.fit_score ?? '—';
      const aft = r.after?.fit_score ?? '—';
      toast.success(`재계산: ${bef} → ${aft}`);
      await load();
    } catch (e) { toast.error(`재계산 실패: ${(e as Error).message}`); }
  }
  async function doRestore(t: InspectorTrack) {
    if (!confirm(`"${t.title}" 을(를) playlist에 복원하시겠습니까?`)) return;
    try {
      await adminRestoreTrackToPlaylist(t.pt_id);
      toast.success('복원 완료');
      await load();
    } catch (e) { toast.error(`복원 실패: ${(e as Error).message}`); }
  }
}

function MetadataEditModal({
  track, onClose, onSaved,
}: { track: InspectorTrack; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TrackMetadataPayload>({
    main_genre: track.main_genre ?? '',
    sub_genre: track.sub_genre ?? '',
    mood: track.mood ?? '',
    suitable_store: track.suitable_store ?? '',
    energy_level: track.energy_level ?? null,
    instrumental: !!track.instrumental,
    vocal_type: track.vocal_type ?? '',
    explicit_content: !!track.explicit_content,
    language: track.language ?? '',
    admin_note: track.admin_note ?? '',
    mood_tags: track.mood_tags ?? [],
    genre_tags: track.genre_tags ?? [],
    business_tags: track.business_tags ?? [],
  });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await adminUpdateTrackMetadata(track.track_id, form, reason.trim() || undefined);
      toast.success('메타 수정 완료 + 영향 playlist fit_score 재계산됨');
      onSaved();
    } catch (e) { toast.error(`수정 실패: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-bg-deep p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold">메타데이터 수정</h3>
            <p className="text-[11px] text-ink-dim">{track.title} · {track.artist}</p>
          </div>
          <button onClick={onClose} className="text-ink-dim hover:text-ink"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="main_genre">
            <input value={form.main_genre ?? ''} onChange={(e) => setForm({ ...form, main_genre: e.target.value })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field label="sub_genre">
            <input value={form.sub_genre ?? ''} onChange={(e) => setForm({ ...form, sub_genre: e.target.value })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field label="mood">
            <input value={form.mood ?? ''} onChange={(e) => setForm({ ...form, mood: e.target.value })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field label="suitable_store">
            <input value={form.suitable_store ?? ''} onChange={(e) => setForm({ ...form, suitable_store: e.target.value })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field label="energy_level (1-5)">
            <input type="number" min={1} max={5} value={form.energy_level ?? ''}
              onChange={(e) => setForm({ ...form, energy_level: e.target.value ? Number(e.target.value) : null })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field label="vocal_type">
            <select value={form.vocal_type ?? ''} onChange={(e) => setForm({ ...form, vocal_type: e.target.value || null })}
              className="w-full rounded bg-bg-card px-2 py-1">
              <option value="">—</option>
              <option value="male">male</option>
              <option value="female">female</option>
              <option value="mixed">mixed</option>
              <option value="instrumental">instrumental</option>
            </select>
          </Field>
          <Field label="language">
            <input value={form.language ?? ''} onChange={(e) => setForm({ ...form, language: e.target.value })}
              className="w-full rounded bg-bg-card px-2 py-1" placeholder="ko / en / jp …" />
          </Field>
          <Field label="instrumental / explicit">
            <div className="flex gap-3 pt-1">
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={!!form.instrumental}
                  onChange={(e) => setForm({ ...form, instrumental: e.target.checked })} />
                instrumental
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={!!form.explicit_content}
                  onChange={(e) => setForm({ ...form, explicit_content: e.target.checked })} />
                explicit
              </label>
            </div>
          </Field>
          <Field label="mood_tags (comma)">
            <input value={(form.mood_tags ?? []).join(', ')}
              onChange={(e) => setForm({ ...form, mood_tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field label="genre_tags (comma)">
            <input value={(form.genre_tags ?? []).join(', ')}
              onChange={(e) => setForm({ ...form, genre_tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field label="business_tags (comma)" span2>
            <input value={(form.business_tags ?? []).join(', ')}
              onChange={(e) => setForm({ ...form, business_tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field label="admin_note" span2>
            <textarea value={form.admin_note ?? ''} rows={2}
              onChange={(e) => setForm({ ...form, admin_note: e.target.value })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field label="변경 사유 (audit log)" span2>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              className="w-full rounded bg-bg-card px-2 py-1"
              placeholder="예: 와인바 분위기 부적합 → mood/genre 조정" />
          </Field>
        </div>
        <p className="mt-2 text-[10px] text-ink-dim">
          ⚠️ 제목/아티스트/ISRC/audio_url/release_date/권리자명 등 유통 메타는 수정 불가.
          저장 시 track_analysis 재유도 + 영향 playlist fit_score 자동 재계산.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="rounded bg-bg-card px-3 py-1.5 text-xs">취소</button>
          <button onClick={() => void submit()} disabled={saving}
            className="inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
            <Save size={11} /> {saving ? '저장 중…' : '저장 + 재계산'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, span2, children }: { label: string; span2?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${span2 ? 'col-span-2' : ''}`}>
      <span className="text-[10px] font-semibold text-ink-dim">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

function RemoveConfirmModal({
  track, playlistId, onClose, onDone,
}: { track: InspectorTrack; playlistId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [removing, setRemoving] = useState(false);
  const submit = async () => {
    setRemoving(true);
    try {
      await adminRemoveTrackFromPlaylist(playlistId, track.track_id, reason.trim() || undefined);
      toast.success('플레이리스트에서 제거 (원본 tracks 보존)');
      onDone();
    } catch (e) { toast.error(`제거 실패: ${(e as Error).message}`); }
    finally { setRemoving(false); }
  };
  const removeDialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(removeDialogRef, { onClose });
  return (
    <div ref={removeDialogRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl bg-bg-deep p-4">
        <h3 className="text-sm font-bold flex items-center gap-1">
          <Trash2 size={14} className="text-rose-500" /> 이 플레이리스트에서 제거
        </h3>
        <p className="mt-2 text-xs text-ink-dim">{track.title} · {track.artist}</p>
        <p className="mt-2 text-[11px] text-amber-500">
          ⚠️ playlist_tracks 만 soft-delete. 원본 tracks 는 보존됩니다.
        </p>
        <label className="mt-3 block">
          <span className="text-[10px] font-semibold text-ink-dim">제거 사유 (audit log)</span>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            className="mt-0.5 w-full rounded bg-bg-card px-2 py-1 text-xs"
            placeholder="예: 와인바 분위기 부적합" />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} disabled={removing}
            className="rounded bg-bg-card px-3 py-1.5 text-xs">취소</button>
          <button onClick={() => void submit()} disabled={removing}
            className="rounded bg-rose-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            {removing ? '제거 중…' : '제거'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusChangeModal({
  track, playlistId, nextStatus, onClose, onDone,
}: { track: InspectorTrack; playlistId: string; nextStatus: FitStatus; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [adminNote, setAdminNote] = useState(track.admin_note ?? '');
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    try {
      await adminChangeTrackFitStatus(playlistId, track.track_id, nextStatus,
        reason.trim() || undefined, adminNote.trim() || undefined);
      toast.success(`status → ${nextStatus}`);
      onDone();
    } catch (e) { toast.error(`status 변경 실패: ${(e as Error).message}`); }
    finally { setSubmitting(false); }
  };
  const statusDialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(statusDialogRef, { onClose });
  return (
    <div ref={statusDialogRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl bg-bg-deep p-4">
        <h3 className="text-sm font-bold">
          상태 변경 →{' '}
          <span className={`rounded px-1.5 py-0.5 ${STATUS_TONE[nextStatus]}`}>{nextStatus}</span>
        </h3>
        <p className="mt-2 text-xs text-ink-dim">{track.title} · {track.artist}</p>
        <p className="text-[11px] text-ink-mute">
          현재 상태: <b>{track.fit_status ?? '—'}</b> (source: {track.fit_source ?? 'algorithm'})
        </p>
        <label className="mt-3 block">
          <span className="text-[10px] font-semibold text-ink-dim">변경 사유 (audit)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            className="mt-0.5 w-full rounded bg-bg-card px-2 py-1 text-xs" />
        </label>
        <label className="mt-2 block">
          <span className="text-[10px] font-semibold text-ink-dim">admin_note (tracks)</span>
          <textarea rows={2} value={adminNote} onChange={(e) => setAdminNote(e.target.value)}
            className="mt-0.5 w-full rounded bg-bg-card px-2 py-1 text-xs" />
        </label>
        <p className="mt-2 text-[10px] text-ink-dim">
          source='admin' 으로 기록되어 알고리즘 자동 변경에서 보호됩니다.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting}
            className="rounded bg-bg-card px-3 py-1.5 text-xs">취소</button>
          <button onClick={() => void submit()} disabled={submitting}
            className="rounded bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
            {submitting ? '저장 중…' : '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AuditModal({
  track, playlistId, onClose,
}: { track: InspectorTrack; playlistId: string; onClose: () => void }) {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    adminListTrackAudit(track.track_id, playlistId, 50)
      .then(setLogs).catch((e) => toast.error(`audit 로딩 실패: ${e.message}`))
      .finally(() => setLoading(false));
  }, [track.track_id, playlistId]);
  const auditDialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(auditDialogRef, { onClose });
  return (
    <div ref={auditDialogRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl bg-bg-deep p-4">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-1">
              <Eye size={14} /> 변경 이력
            </h3>
            <p className="text-[11px] text-ink-dim">{track.title} · {track.artist}</p>
          </div>
          <button onClick={onClose} className="text-ink-dim hover:text-ink"><X size={16} /></button>
        </div>
        {loading ? (
          <p className="text-center text-xs text-ink-dim">로딩 중…</p>
        ) : logs.length === 0 ? (
          <p className="text-center text-xs text-ink-dim">이력 없음</p>
        ) : (
          <div className="space-y-2">
            {logs.map((l) => (
              <div key={l.id} className="rounded bg-bg-card p-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-bg-deep px-1.5 py-0.5 font-bold">{l.action_type}</span>
                  <span className="text-ink-dim">{new Date(l.created_at).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-ink-dim">
                  by {l.admin_name ?? l.admin_user_id.slice(0, 8)}
                  {l.reason && <span> · {l.reason}</span>}
                </div>
                {(l.before_data || l.after_data) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-ink-dim">변경 내용</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-bg-deep p-1 text-[10px]">
{JSON.stringify({ before: l.before_data, after: l.after_data }, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <button onClick={onClose} className="rounded bg-bg-card px-3 py-1.5 text-xs">닫기</button>
        </div>
      </div>
    </div>
  );
}
