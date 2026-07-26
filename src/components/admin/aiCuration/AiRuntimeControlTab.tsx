// AiRuntimeControlTab — Phase AI-RUNTIME-CONNECTION-1
//
// 관리자 전용. 매장별 AI 런타임 모드(off/preview/shadow)를 승인·변경하고, 그 효과를
// Static Queue vs AI Queue 로 미리 비교한다. 실제 재생 반영은 매장 Player 가 서버 mode 를
// 읽어 결정한다(이 화면은 설정+미리보기).
//
// 안전:
//   • 승인(enable + non-off)은 platform admin 만 (서버 admin_set_ai_runtime_store_settings 강제).
//   • Production project 에서는 활성화 컨트롤을 잠근다(이중 안전 — 서버 테이블도 prod 엔 없음).
//   • Preview 는 읽기 전용 계산. 재생/큐/스케줄러에 영향 없음.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, Save, GitCompareArrows } from 'lucide-react';

import { fetchPlaylists } from '@/lib/api';
import { fetchPlaylistTracks } from '@/lib/api';
import { fetchMemberList, type MemberRow } from '@/lib/adminApi';
import type { PlaylistRow, TrackRow } from '@/types/db';
import { toast } from '@/store/toastStore';
import { adminTones } from '@/lib/adminTones';
import { supabaseProjectRef } from '@/lib/supabase';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import {
  adminGetAiRuntimeStoreSettings,
  adminSetAiRuntimeStoreSettings,
  type AiRuntimeStoreSettings,
} from '@/lib/api/aiRuntimeApi';
import { adminAiBuildStoreQueue } from '@/lib/api/aiRuntimePreviewApi';
import {
  composeRuntimeQueue,
  parseCandidateItems,
  type RuntimeQueueResult,
} from '@/lib/aiRuntimeResolver';

// 알려진 Production project ref — 이 화면에서 활성화 잠금(이중 안전).
const PRODUCTION_PROJECT_REF = 'nsoesrvwkxqifjcxzvol';

type Mode = 'off' | 'preview' | 'shadow';

interface DiffRow {
  position: number;
  staticId: string | null;
  aiId: string | null;
  changed: boolean;
}

export default function AiRuntimeControlTab() {
  const isProduction = supabaseProjectRef === PRODUCTION_PROJECT_REF;

  const [stores, setStores] = useState<MemberRow[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [storeId, setStoreId] = useState('');
  const [pid, setPid] = useState('');

  const [settings, setSettings] = useState<AiRuntimeStoreSettings | null>(null);
  const [mode, setMode] = useState<Mode>('off');
  const [enabled, setEnabled] = useState(false);
  const [maxTracks, setMaxTracks] = useState(50);
  const [minFit, setMinFit] = useState(0);
  const [saving, setSaving] = useState(false);

  const [diff, setDiff] = useState<DiffRow[] | null>(null);
  const [preview, setPreview] = useState<RuntimeQueueResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Load selectable stores + playlists.
  useEffect(() => {
    fetchMemberList({ role: undefined, limit: 200 })
      .then((rows) => {
        const biz = rows.filter((r) => r.account_type === 'business' && !r.withdrawn_at);
        setStores(biz);
        if (biz[0]) setStoreId((prev) => prev || biz[0].id);
      })
      .catch((e) => console.warn('[AiRuntimeControlTab] members failed', e));
    fetchPlaylists()
      .then((p) => { setPlaylists(p); if (p[0]) setPid((prev) => prev || p[0].id); })
      .catch((e) => console.warn('[AiRuntimeControlTab] playlists failed', e));
  }, []);

  const loadSettings = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      const s = await adminGetAiRuntimeStoreSettings(sid);
      setSettings(s);
      setMode(s.mode);
      setEnabled(s.enabled);
      setMaxTracks(s.max_ai_tracks);
      setMinFit(s.minimum_fit_score);
    } catch (e) {
      toast.error(`설정 조회 실패: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { void loadSettings(storeId); }, [storeId, loadSettings]);

  const save = useCallback(async () => {
    if (!storeId) return;
    if (isProduction && enabled && mode !== 'off') {
      toast.error('Production 프로젝트에서는 AI 런타임 활성화가 금지됩니다.');
      return;
    }
    setSaving(true);
    try {
      const s = await adminSetAiRuntimeStoreSettings({
        storeId, mode, enabled, maxAiTracks: maxTracks, minimumFitScore: minFit,
      });
      setSettings(s);
      toast.success('AI 런타임 설정이 저장되었습니다.');
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [storeId, mode, enabled, maxTracks, minFit, isProduction]);

  // Compute static vs AI diff (read-only, mirrors runtime resolver exactly).
  const runPreview = useCallback(async () => {
    if (!storeId || !pid) return;
    setPreviewing(true);
    setDiff(null);
    setPreview(null);
    try {
      const [rawTracks, aiQueue] = await Promise.all([
        fetchPlaylistTracks(pid, storeId),
        adminAiBuildStoreQueue(storeId, pid, maxTracks),
      ]);
      const staticTracks: TrackRow[] = filterPlayableTracks(rawTracks).playable;
      const candidates = parseCandidateItems(aiQueue.queue);
      const result = composeRuntimeQueue(staticTracks, candidates, {
        minimumFitScore: minFit, maxAiTracks: maxTracks,
      });
      setPreview(result);

      const aiTracks = result.source === 'ai_preview' ? result.tracks : [];
      const rows: DiffRow[] = [];
      const n = Math.max(staticTracks.length, aiTracks.length);
      for (let i = 0; i < n; i++) {
        const s = staticTracks[i]?.id ?? null;
        const a = aiTracks[i]?.id ?? null;
        rows.push({ position: i + 1, staticId: s, aiId: a, changed: s !== a });
      }
      setDiff(rows);
    } catch (e) {
      toast.error(`미리보기 실패: ${(e as Error).message}`);
    } finally {
      setPreviewing(false);
    }
  }, [storeId, pid, maxTracks, minFit]);

  const dirty =
    !!settings &&
    (settings.mode !== mode || settings.enabled !== enabled ||
     settings.max_ai_tracks !== maxTracks || settings.minimum_fit_score !== minFit);

  return (
    <div className="space-y-4">
      {isProduction && (
        <p className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${adminTones.danger.badge}`}>
          <ShieldAlert size={13} /> Production 프로젝트 — AI 런타임 활성화가 잠겨 있습니다(읽기/미리보기만 가능).
        </p>
      )}

      {/* selectors */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          title="매장(사업자 계정)"
          className="min-w-[12rem] rounded-lg bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10"
        >
          {stores.length === 0 && <option value="">사업자 계정 없음</option>}
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.nickname || s.email || s.id.slice(0, 8)}</option>
          ))}
        </select>
        <button
          onClick={() => void loadSettings(storeId)}
          className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold text-ink-mute hover:bg-bg-hover"
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      {/* settings form */}
      <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
        <h4 className="mb-3 text-xs font-bold">런타임 모드 설정</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-mute">모드</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="rounded-lg bg-bg-deep px-2.5 py-1.5 ring-1 ring-line/10"
            >
              <option value="off">off — 기존 Static Playlist만</option>
              <option value="shadow">shadow — 계산만, 재생 미반영</option>
              <option value="preview">preview — AI 재정렬 재생(승인 매장)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-xs">
            <input
              type="checkbox"
              checked={enabled}
              disabled={isProduction}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 accent-accent"
            />
            <span>활성화 (enabled)</span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-mute">최대 AI 트랙 수</span>
            <input
              type="number" min={1} max={500} value={maxTracks}
              onChange={(e) => setMaxTracks(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              className="rounded-lg bg-bg-deep px-2.5 py-1.5 ring-1 ring-line/10"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-mute">최소 적합도(fit − penalty)</span>
            <input
              type="number" min={0} max={100} value={minFit}
              onChange={(e) => setMinFit(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="rounded-lg bg-bg-deep px-2.5 py-1.5 ring-1 ring-line/10"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saving || !dirty || (isProduction && enabled && mode !== 'off')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
          >
            <Save size={12} /> 저장
          </button>
          {settings && (
            <span className="text-[11px] text-ink-dim">
              현재: <b>{settings.mode}</b>{settings.enabled ? ' · 활성' : ' · 비활성'}
              {settings.approved_at ? ' · 승인됨' : ' · 미승인'}
            </span>
          )}
        </div>
      </div>

      {/* static vs AI preview */}
      <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-xs font-bold">
            <GitCompareArrows size={13} className="text-accent" /> Static vs AI 큐 비교 (읽기 전용)
          </h4>
          <div className="flex items-center gap-2">
            <select
              value={pid}
              onChange={(e) => setPid(e.target.value)}
              title="플레이리스트"
              className="min-w-[10rem] rounded-lg bg-bg-deep px-2.5 py-1.5 text-xs ring-1 ring-line/10"
            >
              {playlists.length === 0 && <option value="">플레이리스트 없음</option>}
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <button
              onClick={() => void runPreview()}
              disabled={previewing || !storeId || !pid}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
            >
              <RefreshCw size={12} className={previewing ? 'animate-spin' : ''} /> 비교 계산
            </button>
          </div>
        </div>

        {preview && (
          <p className="mb-2 text-[11px] text-ink-dim">
            결과 소스: <b>{preview.source}</b>
            {preview.fallbackUsed && preview.fallbackReason && (
              <span className={`ml-1 rounded px-1.5 py-0.5 ${adminTones.warning.badge}`}>
                fallback: {preview.fallbackReason}
              </span>
            )}
            {' · '}static {preview.summary.staticCount} → 사용 {preview.summary.usedCount}
            {' · '}변경 {diff?.filter((d) => d.changed).length ?? 0}
          </p>
        )}

        {!diff ? (
          <p className="py-6 text-center text-xs text-ink-dim">
            {previewing ? '계산 중…' : '매장·플레이리스트를 고르고 "비교 계산"을 누르세요.'}
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-bg-card text-ink-dim">
                <tr>
                  <th className="py-1 pr-2 font-semibold">#</th>
                  <th className="py-1 pr-2 font-semibold">Static</th>
                  <th className="py-1 pr-2 font-semibold">AI</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((d) => (
                  <tr key={d.position} className={d.changed ? adminTones.warning.text : ''}>
                    <td className="py-1 pr-2 tabular-nums text-ink-dim">{d.position}</td>
                    <td className="py-1 pr-2 font-mono">{d.staticId ? d.staticId.slice(0, 8) : '—'}</td>
                    <td className="py-1 pr-2 font-mono">{d.aiId ? d.aiId.slice(0, 8) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
