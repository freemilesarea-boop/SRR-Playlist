import { useCallback, useEffect, useState } from 'react';
import {
  Play, Pause, Music, Trash2, Ban, AlertTriangle, CheckCircle2, Calculator, Edit, X, Save,
} from 'lucide-react';
import {
  adminGetQcTrackContext,
  adminQcActAndResolve,
  type QcTrackContext,
  type QcInlineAction,
} from '@/lib/aiCuration';
import type { TrackMetadataPayload } from '@/lib/adminPlaylistInspectorApi';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import FeedbackBadges from '@/components/admin/FeedbackBadges';
import type { TrackRow } from '@/types/db';

const STATUS_TONE: Record<string, string> = {
  active:        'bg-emerald-500/25 text-emerald-300',
  review_needed: 'bg-amber-500/25 text-amber-300',
  excluded:      'bg-rose-500/25 text-rose-300',
};

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(0)}%`;

interface Props {
  queueId: string;
  trackId: string;
  onChanged: () => void;  // 부모에서 list reload
  onResolved?: () => void;  // 큐가 resolved 처리되었을 때
}

export default function QcQueueRowDetail({ queueId, trackId, onChanged, onResolved }: Props) {
  const [ctx, setCtx] = useState<QcTrackContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolveAfter, setResolveAfter] = useState(true);
  const [editingMeta, setEditingMeta] = useState(false);

  const setQueue = usePlayerStore((s) => s.setQueue);
  const playing = usePlayerStore((s) => s.playing);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);
  const togglePlay = usePlayerStore((s) => s.toggle);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminGetQcTrackContext(queueId);
      setCtx(r);
    } catch (e) {
      toast.error(`컨텍스트 로딩 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [queueId]);

  useEffect(() => { void load(); }, [load]);

  const playPreview = () => {
    if (!ctx?.track?.audio_url) {
      toast.error('audio_url 없음');
      return;
    }
    if (currentTrackId === trackId && playing) {
      togglePlay();
      return;
    }
    if (currentTrackId === trackId && !playing) {
      togglePlay();
      return;
    }
    setQueue([ctx.track as unknown as TrackRow], 0, null);
  };

  const isCurrent = currentTrackId === trackId;

  const act = useCallback(async (input: {
    action: QcInlineAction;
    playlistId?: string;
    payload?: Record<string, unknown>;
    status?: 'active' | 'review_needed' | 'excluded';
    reason?: string;
    adminNote?: string;
  }) => {
    setBusy(true);
    try {
      const r = await adminQcActAndResolve({
        queueId, action: input.action,
        playlistId: input.playlistId ?? null,
        payload: input.payload ?? null,
        status: input.status ?? null,
        reason: input.reason ?? null,
        adminNote: input.adminNote ?? null,
        resolveAfter,
      });
      toast.success(
        `${input.action} 완료` + (r.resolved ? ' · 큐 resolved' : ''),
      );
      await load();
      onChanged();
      if (r.resolved && onResolved) onResolved();
    } catch (e) {
      toast.error(`실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }, [queueId, resolveAfter, load, onChanged, onResolved]);

  const removeFromPlaylist = async (playlistId: string, playlistName: string) => {
    const reason = prompt(`"${playlistName}" 에서 제거 사유:`) ?? '';
    if (reason === null) return;
    await act({ action: 'remove', playlistId, reason: reason || undefined });
  };

  const changeStatus = async (playlistId: string, playlistName: string, status: 'active' | 'review_needed' | 'excluded') => {
    const reason = prompt(`"${playlistName}" 상태 → ${status} 사유:`) ?? '';
    if (reason === null) return;
    await act({ action: 'change_status', playlistId, status, reason: reason || undefined });
  };

  const recompute = async (playlistId: string) => {
    await act({ action: 'recompute', playlistId });
  };

  if (loading) {
    return <div className="p-4 text-center text-xs text-ink-dim">로딩 중…</div>;
  }
  if (!ctx) return null;

  const af = ctx.audio_features;
  const t = ctx.track;
  const activePlaylists = ctx.playlists.filter((p) => !p.removed_at);
  const removedPlaylists = ctx.playlists.filter((p) => p.removed_at);

  return (
    <div className="space-y-3 rounded-xl border border-line/15 bg-bg-deep p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {t.cover_url && (
            <img src={t.cover_url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
          )}
          <div className="min-w-0">
            <div className="font-bold">{t.title ?? '—'}</div>
            <div className="text-xs text-ink-dim truncate">{t.artist ?? '—'}</div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
              <span className="rounded bg-bg-card px-1.5 py-0.5">{t.main_genre ?? '—'}</span>
              <span className="rounded bg-bg-card px-1.5 py-0.5">{t.mood ?? '—'}</span>
              {t.instrumental && <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-emerald-300">instrumental</span>}
              {t.explicit_content && <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">explicit</span>}
            </div>
            <div className="mt-1">
              <FeedbackBadges trackId={trackId} hideIfEmpty />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={playPreview} disabled={!t.audio_url}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
              isCurrent && playing ? 'bg-rose-500 text-white' : 'bg-accent text-black'
            }`}>
            {isCurrent && playing ? <><Pause size={12} /> 일시정지</> : <><Play size={12} /> 미리듣기</>}
          </button>
          <button onClick={() => setEditingMeta(true)}
            className="inline-flex items-center gap-1 rounded bg-indigo-500/25 px-2 py-1 text-[11px] font-semibold text-indigo-500">
            <Edit size={10} /> 메타 편집
          </button>
        </div>
      </div>

      {af && (
        <div className="grid grid-cols-3 gap-1 rounded bg-bg-card p-2 text-[10px] md:grid-cols-6">
          <Stat l="energy" v={fmtPct(af.energy)} />
          <Stat l="instr" v={fmtPct(af.instrumentalness)} />
          <Stat l="acoust" v={fmtPct(af.acousticness)} />
          <Stat l="speech" v={fmtPct(af.speechiness)} />
          <Stat l="dance" v={fmtPct(af.danceability)} />
          <Stat l="valence" v={fmtPct(af.valence)} />
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h4 className="text-xs font-bold flex items-center gap-1">
            <Music size={11} /> 플레이리스트 소속
            <span className="text-ink-dim">({activePlaylists.length} active{removedPlaylists.length ? ` + ${removedPlaylists.length} removed` : ''})</span>
          </h4>
          <label className="inline-flex items-center gap-1 text-[10px] cursor-pointer">
            <input type="checkbox" checked={resolveAfter}
              onChange={(e) => setResolveAfter(e.target.checked)} />
            조치 후 큐 자동 해결
          </label>
        </div>
        {ctx.playlists.length === 0 ? (
          <p className="rounded bg-bg-card p-3 text-center text-[11px] text-ink-dim">
            이 곡은 어떤 playlist 에도 없습니다.
          </p>
        ) : (
          <div className="space-y-1.5">
            {ctx.playlists.map((p) => {
              const removed = !!p.removed_at;
              const st = p.fit_status ?? 'active';
              return (
                <div key={p.pt_id} className={`rounded bg-bg-card p-2 text-[11px] ${removed ? 'opacity-40' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate">{p.playlist_name ?? p.playlist_id.slice(0, 8)}</div>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-ink-dim">
                        <span>{p.business_category ?? '—'}</span>
                        {p.normalized_slug && <span>· {p.normalized_slug}</span>}
                        {p.placed_by && <span>· by {p.placed_by}</span>}
                      </div>
                      {p.reason && (
                        <details className="mt-0.5">
                          <summary className="cursor-pointer text-[10px] text-ink-mute truncate">
                            {p.reason.slice(0, 80)}
                          </summary>
                          <div className="mt-0.5 text-[10px] text-ink-dim">{p.reason}</div>
                        </details>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {removed ? (
                        <span className="rounded bg-ink/15 px-1.5 py-0.5 text-[9px] text-ink-dim">REMOVED</span>
                      ) : (
                        <>
                          <span className={`font-bold tabular-nums ${
                            (p.fit_score ?? 0) >= 60 ? 'text-emerald-300'
                            : (p.fit_score ?? 0) >= 40 ? 'text-amber-300'
                            : 'text-rose-300'
                          }`}>{p.fit_score ?? '—'}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${STATUS_TONE[st]}`}>
                            {st}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {!removed && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <button onClick={() => void removeFromPlaylist(p.playlist_id, p.playlist_name ?? '?')}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded bg-rose-500/25 px-2 py-0.5 text-[10px] font-semibold text-rose-300 disabled:opacity-50">
                        <Trash2 size={9} /> 제거
                      </button>
                      <button onClick={() => void changeStatus(p.playlist_id, p.playlist_name ?? '?', 'excluded')}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded bg-rose-500/25 px-2 py-0.5 text-[10px] font-semibold text-rose-300 disabled:opacity-50">
                        <Ban size={9} /> excluded
                      </button>
                      <button onClick={() => void changeStatus(p.playlist_id, p.playlist_name ?? '?', 'review_needed')}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded bg-amber-500/25 px-2 py-0.5 text-[10px] font-semibold text-amber-300 disabled:opacity-50">
                        <AlertTriangle size={9} /> review
                      </button>
                      {st !== 'active' && (
                        <button onClick={() => void changeStatus(p.playlist_id, p.playlist_name ?? '?', 'active')}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded bg-emerald-500/25 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 disabled:opacity-50">
                          <CheckCircle2 size={9} /> active
                        </button>
                      )}
                      <button onClick={() => void recompute(p.playlist_id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-500 disabled:opacity-50">
                        <Calculator size={9} /> 재계산
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editingMeta && (
        <QuickMetaModal track={t} onClose={() => setEditingMeta(false)}
          onSubmit={async (payload, reason) => {
            await act({ action: 'update_metadata', payload: payload as Record<string, unknown>, reason });
            setEditingMeta(false);
          }} />
      )}
    </div>
  );
}

function Stat({ l, v }: { l: string; v: string | number }) {
  return (
    <div className="rounded bg-bg-deep px-1.5 py-1">
      <div className="text-[9px] uppercase text-ink-dim">{l}</div>
      <div className="font-bold tabular-nums">{v}</div>
    </div>
  );
}

function QuickMetaModal({
  track, onClose, onSubmit,
}: {
  track: QcTrackContext['track'];
  onClose: () => void;
  onSubmit: (payload: TrackMetadataPayload, reason: string | undefined) => Promise<void>;
}) {
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
      await onSubmit(form, reason.trim() || undefined);
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl bg-bg-deep p-4">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold">메타 Quick Edit</h3>
            <p className="text-[11px] text-ink-dim">{track.title} · {track.artist}</p>
          </div>
          <button onClick={onClose}><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <Field l="main_genre"><input value={form.main_genre ?? ''}
            onChange={(e) => setForm({ ...form, main_genre: e.target.value })}
            className="w-full rounded bg-bg-card px-2 py-1" /></Field>
          <Field l="sub_genre"><input value={form.sub_genre ?? ''}
            onChange={(e) => setForm({ ...form, sub_genre: e.target.value })}
            className="w-full rounded bg-bg-card px-2 py-1" /></Field>
          <Field l="mood"><input value={form.mood ?? ''}
            onChange={(e) => setForm({ ...form, mood: e.target.value })}
            className="w-full rounded bg-bg-card px-2 py-1" /></Field>
          <Field l="suitable_store"><input value={form.suitable_store ?? ''}
            onChange={(e) => setForm({ ...form, suitable_store: e.target.value })}
            className="w-full rounded bg-bg-card px-2 py-1" /></Field>
          <Field l="energy (1-5)">
            <input type="number" min={1} max={5} value={form.energy_level ?? ''}
              onChange={(e) => setForm({ ...form, energy_level: e.target.value ? Number(e.target.value) : null })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field l="vocal_type">
            <select value={form.vocal_type ?? ''} onChange={(e) => setForm({ ...form, vocal_type: e.target.value || null })}
              className="w-full rounded bg-bg-card px-2 py-1">
              <option value="">—</option>
              <option value="male">male</option>
              <option value="female">female</option>
              <option value="mixed">mixed</option>
              <option value="instrumental">instrumental</option>
            </select>
          </Field>
          <Field l="language"><input value={form.language ?? ''}
            onChange={(e) => setForm({ ...form, language: e.target.value })}
            className="w-full rounded bg-bg-card px-2 py-1" placeholder="ko / en / jp" /></Field>
          <Field l="flags">
            <div className="flex gap-2 pt-1">
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={!!form.instrumental}
                  onChange={(e) => setForm({ ...form, instrumental: e.target.checked })} />
                instr
              </label>
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={!!form.explicit_content}
                  onChange={(e) => setForm({ ...form, explicit_content: e.target.checked })} />
                explicit
              </label>
            </div>
          </Field>
          <Field l="mood_tags (comma)" span2>
            <input value={(form.mood_tags ?? []).join(', ')}
              onChange={(e) => setForm({ ...form, mood_tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field l="genre_tags (comma)" span2>
            <input value={(form.genre_tags ?? []).join(', ')}
              onChange={(e) => setForm({ ...form, genre_tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field l="admin_note" span2>
            <textarea rows={2} value={form.admin_note ?? ''}
              onChange={(e) => setForm({ ...form, admin_note: e.target.value })}
              className="w-full rounded bg-bg-card px-2 py-1" />
          </Field>
          <Field l="변경 사유 (audit)" span2>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              className="w-full rounded bg-bg-card px-2 py-1"
              placeholder="예: 와인바 분위기에 맞게 mood 조정" />
          </Field>
        </div>
        <p className="mt-2 text-[10px] text-ink-dim">
          ⚠️ 유통 메타 (title/artist/isrc 등) 는 수정 불가. 저장 시 track_analysis +
          영향 playlist fit_score 자동 재계산.
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

function Field({ l, span2, children }: { l: string; span2?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${span2 ? 'col-span-2' : ''}`}>
      <span className="text-[10px] font-semibold text-ink-dim">{l}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
