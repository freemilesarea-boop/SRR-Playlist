/**
 * StartPanel — UX-2 Preset-First 시작 화면.
 *   시작 방법: Preset / 최근 조건 / 조건 없이 / 기존 Playlist 편집 / Template 복제.
 *   Preset 은 "적용될 조건"을 먼저 보여주고(Preview), 관리자가 확정해야 Builder 로 진입.
 *   Preset 선택만으로 저장/배포하지 않는다.
 */
import { useMemo, useState } from 'react';
import { Sparkles, Clock, Pencil, Copy, ListMusic, X } from 'lucide-react';
import type { PlaylistRow } from '@/types/db';
import { type BuilderPreset, type PresetConditions, presetSummaryLines } from '@/lib/playlistPresets';
import type { RecentCondition } from '@/lib/playlistBuilderRecent';

export interface StartMeta {
  storeKey: string;
  label: string;
  openEditor: boolean;
}

export function StartPanel({
  presets,
  recents,
  playlists,
  loading,
  onStart,
  onEdit,
  onOpenTemplates,
  onClearRecents,
}: {
  presets: BuilderPreset[];
  recents: RecentCondition[];
  playlists: PlaylistRow[];
  loading: boolean;
  onStart: (playlistId: string, conditions: PresetConditions | null, meta: StartMeta) => void;
  onEdit: (playlistId: string) => void;
  onOpenTemplates: () => void;
  onClearRecents: () => void;
}) {
  // 미리보기 대상(Preset 또는 최근조건). null 이면 그리드만 표시.
  const [preview, setPreview] = useState<BuilderPreset | null>(null);
  const [targetId, setTargetId] = useState('');

  const previewLines = useMemo(() => (preview ? presetSummaryLines(preview) : []), [preview]);

  const startPreview = (openEditor: boolean) => {
    if (!preview) return;
    onStart(targetId || '', preview.conditions, { storeKey: preview.storeKey, label: preview.storeLabel, openEditor });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ListMusic size={18} className="text-accent" />
        <h2 className="text-base font-semibold">플레이리스트 빌더 — 시작 방법 선택</h2>
      </div>

      {preview ? (
        // ---- Preset Preview ----
        <div className="rounded-xl border border-line/10 bg-bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <h3 className="text-sm font-semibold">{preview.storeLabel}</h3>
            <button className="btn-ghost ml-auto h-7 px-2" onClick={() => setPreview(null)} aria-label="닫기">
              <X size={15} />
            </button>
          </div>
          <p className="mb-2 text-xs text-ink-mute">적용될 조건(먼저 확인 후 시작):</p>
          <ul className="mb-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {previewLines.map((l, i) => (
              <li key={i} className="rounded bg-line/5 px-2 py-1 text-xs">
                {l}
              </li>
            ))}
          </ul>
          <label className="mb-1 block text-xs text-ink-mute">적용할 플레이리스트</label>
          <select
            className="input mb-3 h-9 w-full max-w-sm text-sm"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">플레이리스트 선택…</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.status === 'draft' ? ' (초안)' : ''}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary h-9 px-3 text-sm disabled:opacity-50"
              onClick={() => startPreview(false)}
              disabled={!targetId}
            >
              이 조건으로 시작
            </button>
            <button
              className="btn-ghost h-9 px-3 text-sm disabled:opacity-50"
              onClick={() => startPreview(true)}
              disabled={!targetId}
            >
              조건 수정 후 시작
            </button>
            <button className="btn-ghost h-9 px-3 text-sm" onClick={() => setPreview(null)}>
              다른 방법 선택
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ---- Preset 그리드 ---- */}
          <section className="rounded-xl border border-line/10 bg-bg-card p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <Sparkles size={14} className="text-accent" /> 운영 Preset 으로 시작
            </p>
            {loading ? (
              <p className="text-xs text-ink-mute">불러오는 중…</p>
            ) : presets.length === 0 ? (
              <p className="text-xs text-ink-mute">사용 가능한 Preset 이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
                {presets.map((p) => (
                  <button
                    key={p.storeKey}
                    className="btn-ghost h-9 justify-start truncate px-2 text-xs"
                    onClick={() => {
                      setPreview(p);
                      setTargetId('');
                    }}
                    title={p.storeLabel}
                  >
                    {p.storeLabel}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ---- 최근 조건 ---- */}
          {recents.length > 0 && (
            <section className="rounded-xl border border-line/10 bg-bg-card p-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <Clock size={14} className="text-accent" /> 최근 사용 조건
                <button className="btn-ghost ml-auto h-6 px-2 text-[11px]" onClick={onClearRecents}>
                  지우기
                </button>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recents.map((r, i) => (
                  <button
                    key={`${r.storeKey}-${i}`}
                    className="btn-ghost h-8 rounded-full px-2.5 text-xs"
                    onClick={() => {
                      setPreview({
                        source: 'store_profile',
                        storeKey: r.storeKey,
                        storeLabel: r.label,
                        preferredGenres: r.conditions.includeGenres,
                        preferredMoods: [],
                        vocalPreferenceLabel: '제한 없음',
                        conditions: r.conditions,
                      });
                      setTargetId('');
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ---- 기존 Playlist 편집 / Template / 조건 없이 ---- */}
          <section className="rounded-xl border border-line/10 bg-bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Pencil size={14} className="text-accent" /> 기존 플레이리스트 편집
              </p>
              <button className="btn-ghost ml-auto h-7 gap-1 px-2 text-xs" onClick={onOpenTemplates}>
                <Copy size={13} /> Template 복제
              </button>
            </div>
            {loading ? (
              <p className="text-xs text-ink-mute">불러오는 중…</p>
            ) : playlists.length === 0 ? (
              <p className="text-xs text-ink-mute">편집 가능한(수동) 플레이리스트가 없습니다.</p>
            ) : (
              <ul className="max-h-64 divide-y divide-line/10 overflow-y-auto">
                {playlists.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5">
                    <button className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => onEdit(p.id)}>
                      {p.title}
                    </button>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        p.status === 'released' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {p.status === 'released' ? '발매' : '초안'}
                    </span>
                    <button className="btn-ghost h-7 px-2 text-xs" onClick={() => onEdit(p.id)}>
                      편집
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
