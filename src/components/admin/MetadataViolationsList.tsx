import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, SlidersHorizontal, Ban, Check, X, Save } from 'lucide-react';
import {
  listMetadataViolations,
  resolveMetadataViolation,
  excludeTrackFromPlaylist,
  metadataViolationStats,
  type MetadataViolation,
  type MetadataViolationStats,
} from '@/lib/skipApi';
import {
  adminGetTrackTags,
  adminUpdateTrackTags,
  emptySelectedMeta,
  validateSelectedMeta,
  type SelectedMeta,
} from '@/lib/trackMetadataOptions';
import TrackMetaSelectors from '@/components/artist/TrackMetaSelectors';
import { toast } from '@/store/toastStore';

type StatusFilter = 'pending' | 'reviewed' | 'resolved' | 'ignored' | 'all';

const STATUS_LABEL: Record<MetadataViolation['status'], string> = {
  pending: '검수 대기',
  reviewed: '검수됨',
  resolved: '해결됨',
  ignored: '무시',
};
const STATUS_STYLE: Record<MetadataViolation['status'], string> = {
  pending: 'bg-amber-500/15 text-amber-600',
  reviewed: 'bg-sky-500/15 text-sky-600',
  resolved: 'bg-emerald-500/15 text-emerald-600',
  ignored: 'bg-ink/10 text-ink-mute',
};

function fmtTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function MetadataViolationsList() {
  const [rows, setRows] = useState<MetadataViolation[]>([]);
  const [stats, setStats] = useState<MetadataViolationStats | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // candidate id with open metadata editor
  const [meta, setMeta] = useState<SelectedMeta>(emptySelectedMeta());
  const [metaLoading, setMetaLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, s] = await Promise.all([
        listMetadataViolations(filter === 'all' ? null : filter),
        metadataViolationStats(),
      ]);
      setRows(list);
      setStats(s);
    } catch (e) {
      toast.error(`목록을 불러오지 못했어요: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openEditor(row: MetadataViolation) {
    if (editing === row.id) {
      setEditing(null);
      return;
    }
    setEditing(row.id);
    setMetaLoading(true);
    try {
      const tags = await adminGetTrackTags(row.track_id);
      setMeta({
        genre_tags: tags.genre_tags,
        mood_tags: tags.mood_tags,
        business_type_tags: tags.business_type_tags,
        vocal_type: tags.vocal_type,
        recommended_dayparts: tags.recommended_dayparts,
        language: tags.language ?? '',
      });
    } catch (e) {
      toast.error(`메타데이터를 불러오지 못했어요: ${(e as Error).message}`);
      setEditing(null);
    } finally {
      setMetaLoading(false);
    }
  }

  // 메타데이터 재세팅 → 트랙 태그 갱신 + 후보 resolved 처리
  async function saveMeta(row: MetadataViolation) {
    const invalid = validateSelectedMeta(meta);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setSaving(true);
    try {
      await adminUpdateTrackTags(row.track_id, meta);
      await resolveMetadataViolation(row.id, 'resolved', '메타데이터 재세팅 완료');
      toast.success('메타데이터를 재세팅하고 해결 처리했어요.');
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(row: MetadataViolation, status: MetadataViolation['status']) {
    try {
      await resolveMetadataViolation(row.id, status, noteDraft[row.id]);
      toast.success(`상태를 '${STATUS_LABEL[status]}'(으)로 변경했어요.`);
      await load();
    } catch (e) {
      toast.error(`상태 변경 실패: ${(e as Error).message}`);
    }
  }

  async function exclude(row: MetadataViolation) {
    if (!window.confirm(`'${row.title}' 곡을 '${row.playlist_title}' 플레이리스트에서 제외할까요?`)) return;
    try {
      await excludeTrackFromPlaylist(row.playlist_id, row.track_id);
      toast.success('플레이리스트에서 제외했어요.');
      await load();
    } catch (e) {
      toast.error(`제외 실패: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <AlertTriangle size={18} className="text-amber-500" />
            메타데이터 위반 의심
          </h2>
          <p className="text-xs text-ink-mute">
            플레이리스트에서 반복 스킵된 곡(30일 distinct 스킵 3회+)을 메타데이터 불일치 후보로 자동 등록합니다.
            자동 제외는 비활성 — 검수 후 직접 제외/재세팅하세요.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>

      {/* 통계 */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="최근 7일 후보" value={stats.recent7d_candidates} />
          <StatCard label="검수 대기" value={stats.pending_candidates} />
          <StatCard label="스킵 多 트랙(30일)" value={stats.top_skipped_tracks.length} />
          <StatCard label="스킵 多 플리(30일)" value={stats.top_skipped_playlists.length} />
        </div>
      )}

      {stats && (stats.top_skipped_tracks.length > 0 || stats.top_skipped_playlists.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-bg-card p-3">
            <h3 className="mb-2 text-xs font-bold text-ink-mute">가장 많이 스킵된 트랙 (30일)</h3>
            <ol className="space-y-1 text-xs">
              {stats.top_skipped_tracks.slice(0, 10).map((t) => (
                <li key={t.track_id} className="flex justify-between gap-2">
                  <span className="truncate">{t.title ?? '(제목없음)'} · <span className="text-ink-dim">{t.artist ?? ''}</span></span>
                  <span className="shrink-0 font-mono text-amber-600">{t.skips}</span>
                </li>
              ))}
              {stats.top_skipped_tracks.length === 0 && <li className="text-ink-dim">데이터 없음</li>}
            </ol>
          </div>
          <div className="rounded-xl bg-bg-card p-3">
            <h3 className="mb-2 text-xs font-bold text-ink-mute">가장 많이 스킵된 플레이리스트 (30일)</h3>
            <ol className="space-y-1 text-xs">
              {stats.top_skipped_playlists.slice(0, 10).map((p) => (
                <li key={p.playlist_id} className="flex justify-between gap-2">
                  <span className="truncate">{p.title ?? '(제목없음)'} <span className="text-ink-dim">· {p.category ?? ''}</span></span>
                  <span className="shrink-0 font-mono text-amber-600">{p.skips}</span>
                </li>
              ))}
              {stats.top_skipped_playlists.length === 0 && <li className="text-ink-dim">데이터 없음</li>}
            </ol>
          </div>
        </div>
      )}

      {/* 상태 필터 */}
      <div className="flex flex-wrap gap-1.5">
        {(['pending', 'reviewed', 'resolved', 'ignored', 'all'] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              filter === f ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'
            }`}
          >
            {f === 'all' ? '전체' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-10 text-center text-sm text-ink-dim">
          {loading ? '불러오는 중…' : '해당 상태의 위반 후보가 없어요.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const songWide = row.total_skip_count >= row.playlist_skip_count * 2 && row.total_skip_count >= 6;
            return (
              <li key={row.id} className="rounded-xl bg-bg-card p-4 ring-1 ring-line/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{row.title ?? '(제목없음)'}</span>
                      <span className="text-sm text-ink-mute">· {row.artist ?? '미상'}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                    </div>
                    <p className="text-xs text-ink-mute">
                      플레이리스트: <b className="text-ink">{row.playlist_title ?? '-'}</b>
                      {row.playlist_category ? ` · ${row.playlist_category}` : ''}
                    </p>
                    <p className="text-[11px] text-ink-dim">
                      현재 메타데이터: 장르 {row.main_genre || row.genre || '-'} · 무드 {row.mood || '-'}
                      {row.energy_level != null ? ` · 에너지 ${row.energy_level}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <div className="font-mono text-amber-600">
                      이 플리 스킵 {row.playlist_skip_count} · 전체 {row.total_skip_count}
                    </div>
                    <div className="text-ink-dim">
                      평균 청취 {row.avg_played_before_skip ?? '-'}초 · 최근 {fmtTime(row.last_detected_at)}
                    </div>
                    <div className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${songWide ? 'bg-rose-500/15 text-rose-600' : 'bg-indigo-500/15 text-indigo-600'}`}>
                      {songWide ? '곡 자체 문제 의심 (전반적 스킵)' : '메타 불일치 의심 (이 플리 한정)'}
                    </div>
                  </div>
                </div>

                {row.admin_note && (
                  <p className="mt-2 rounded-lg bg-bg-soft/40 px-2.5 py-1.5 text-[11px] text-ink-mute">메모: {row.admin_note}</p>
                )}

                {/* 액션 */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => void openEditor(row)}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25"
                  >
                    <SlidersHorizontal size={12} />
                    {editing === row.id ? '메타 편집 닫기' : '메타데이터 재세팅'}
                  </button>
                  <button
                    onClick={() => void exclude(row)}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-500/20"
                  >
                    <Ban size={12} /> 플리에서 제외
                  </button>
                  <button
                    onClick={() => void setStatus(row, 'resolved')}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/20"
                  >
                    <Check size={12} /> 이상 없음(해결)
                  </button>
                  <button
                    onClick={() => void setStatus(row, 'reviewed')}
                    className="inline-flex items-center gap-1 rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-xs font-semibold text-sky-600 hover:bg-sky-500/20"
                  >
                    검수 표시
                  </button>
                  <button
                    onClick={() => void setStatus(row, 'ignored')}
                    className="inline-flex items-center gap-1 rounded-lg bg-ink/5 px-2.5 py-1.5 text-xs font-semibold text-ink-mute hover:bg-ink/10"
                  >
                    <X size={12} /> 무시
                  </button>
                </div>

                {/* 메모 입력 */}
                <input
                  type="text"
                  value={noteDraft[row.id] ?? ''}
                  onChange={(e) => setNoteDraft((d) => ({ ...d, [row.id]: e.target.value }))}
                  placeholder="관리자 메모 (상태 변경 시 함께 저장)"
                  className="mt-2 w-full rounded-lg bg-bg-soft/40 px-2.5 py-1.5 text-xs ring-1 ring-line/10 placeholder:text-ink-dim focus:outline-none focus:ring-accent/40"
                />

                {/* 메타데이터 편집기 */}
                {editing === row.id && (
                  <div className="mt-3 border-t border-line/10 pt-3">
                    {metaLoading ? (
                      <p className="py-4 text-center text-xs text-ink-dim">메타데이터 불러오는 중…</p>
                    ) : (
                      <>
                        <TrackMetaSelectors value={meta} onChange={setMeta} disabled={saving} />
                        <button
                          onClick={() => void saveMeta(row)}
                          disabled={saving}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-black disabled:opacity-50"
                        >
                          <Save size={13} />
                          {saving ? '저장 중…' : '재세팅 저장 + 해결 처리'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-bg-card p-3">
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="text-[11px] text-ink-mute">{label}</div>
    </div>
  );
}
