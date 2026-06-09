// AiCuration shared utilities (X6.49 — extracted from AiCurationPanel.tsx)
import { useState } from 'react';
import {
  setTrackAudioFeatures,
  getTrackGuardrails,
  setGuardrailOverride,
  type AiCurationRow,
  type GuardrailStoreResult,
} from '@/lib/aiCuration';
import { analyzeAudioFromUrl, generateMockFeatures } from '@/lib/audioAnalysis';
import { toast } from '@/store/toastStore';

export const APPROVABLE_STATUSES = ['submitted', 'review_pending', 'changes_requested'];
export const canApproveStatus = (s: string | null | undefined) => APPROVABLE_STATUSES.includes(s ?? '');

// 곡 1건 분석: 실분석(webaudio) 시도 → 실패 시 호출자가 처리
export async function analyzeOne(row: AiCurationRow, useMock: boolean): Promise<void> {
  if (useMock) {
    await setTrackAudioFeatures(row.track_id, generateMockFeatures(row.track_id, row.duration));
    return;
  }
  if (!row.audio_url) throw new Error('audio_url 없음');
  const features = await analyzeAudioFromUrl(row.audio_url, row.duration);
  await setTrackAudioFeatures(row.track_id, features);
}

export const BATCH = 15;

export const STORE_LABELS: Record<string, string> = {
  gym: '헬스장', pilates: '필라테스', yoga: '요가', hospital: '병원',
  cafe_independent: '카페_개인', cafe_franchise: '카페_프차', winebar: '와인바', cocktail_bar: '칵테일바',
  restaurant: '식당', korean_restaurant: '한식당', brunch_cafe: '브런치', office: '사무실',
  coworking: '코워킹', salon: '미용실', nail_shop: '네일샵', hotel_lobby: '호텔로비',
  select_shop: '편집샵', clothing_store: '의류매장', kids_cafe: '키즈카페', dog_cafe: '애견카페',
  pc_bang: 'PC방', fine_dining: '파인다이닝',
  cafe_morning: '카페(오전)', cafe_afternoon: '카페(오후)', winebar_evening: '와인바', lounge: '라운지',
};

// RereviewTab/FlowTab 전용 라벨 (cafe_franchise/brunch_cafe 의 다른 표기 사용)
export const REREVIEW_STORE_LABELS: Record<string, string> = {
  gym: '헬스장', pilates: '필라테스', yoga: '요가', hospital: '병원', cafe_independent: '카페_개인',
  cafe_franchise: '카페_프렌차이즈', winebar: '와인바', cocktail_bar: '칵테일바', restaurant: '식당',
  korean_restaurant: '한식당', brunch_cafe: '브런치카페', office: '사무실', coworking: '코워킹스페이스',
  salon: '미용실', nail_shop: '네일샵', hotel_lobby: '호텔로비', select_shop: '편집샵',
  clothing_store: '의류매장', kids_cafe: '키즈카페', dog_cafe: '애견카페', pc_bang: 'PC방', fine_dining: '파인다이닝',
};
export const storeLabel = (k: string) => REREVIEW_STORE_LABELS[k] ?? k;

export const FLOW_ISSUE_LABELS: Record<string, string> = {
  bpm_jump: 'BPM 급변', energy_jump: '에너지 급변', brightness_jump: '밝기 급변', vocal_collision: '보컬 충돌',
  drop_shock: '에너지 급락', mood_collision: '무드 충돌', repetitive_similarity: '과도한 유사(단조)', missing_features: '분석 결측',
};
export const flowColor = (s: number | null) =>
  s == null ? 'text-ink-dim' : s >= 80 ? 'text-emerald-600' : s >= 65 ? 'text-amber-600' : 'text-rose-600';

export function Metric({ label, v }: { label: string; v: number }) {
  return <span className="rounded bg-ink/5 px-1.5 py-0.5">{label} <b className="tabular-nums">{typeof v === 'number' && v <= 1 ? v.toFixed(2) : v}</b></span>;
}

export function PStat({ label, v }: { label: string; v: number | string }) {
  return (
    <div className="rounded-lg bg-bg-soft/40 p-2 text-center">
      <div className="text-lg font-extrabold tabular-nums">{v}</div>
      <div className="text-[10px] text-ink-mute">{label}</div>
    </div>
  );
}

export function GuardrailBadges({ trackId, ready }: { trackId: string; ready: boolean }) {
  const [rows, setRows] = useState<GuardrailStoreResult[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try { setRows(await getTrackGuardrails(trackId)); setOpen(true); }
    catch (e) { toast.error(`guardrail 조회 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function override(storeKey: string) {
    try { await setGuardrailOverride(trackId, storeKey, true, '관리자 override'); toast.success(`${storeKey} guardrail override`); setRows(await getTrackGuardrails(trackId)); }
    catch (e) { toast.error(`override 실패: ${(e as Error).message}`); }
  }
  if (!ready) return null;
  const blocked = rows?.filter((r) => r.gr.blocked) ?? [];
  const soft = rows?.filter((r) => !r.gr.blocked && r.gr.severity === 'soft_block') ?? [];
  const warn = rows?.filter((r) => !r.gr.blocked && r.gr.severity === 'warning') ?? [];
  return (
    <div className="mt-2">
      {!open ? (
        <button onClick={() => void load()} disabled={busy} className="rounded bg-ink/5 px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-ink/10 disabled:opacity-50">
          {busy ? '조회 중…' : '🛡 매장 금지규칙 검사'}
        </button>
      ) : (rows && rows.length === 0) ? (
        <p className="text-[10px] text-emerald-600">금지규칙 위반 없음 (모든 매장 통과)</p>
      ) : (
        <div className="space-y-1">
          {blocked.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-bold text-rose-600">차단:</span>
              {blocked.map((b) => (
                <span key={b.store_key} className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600"
                  title={b.gr.violations.map((v) => v.reason).join(', ')}>
                  {STORE_LABELS[b.store_key] ?? b.store_key}
                  <button onClick={() => void override(b.store_key)} className="ml-0.5 rounded bg-rose-500/20 px-1 text-[9px] hover:bg-rose-500/30">override</button>
                </span>
              ))}
            </div>
          )}
          {soft.length > 0 && <div className="flex flex-wrap items-center gap-1"><span className="text-[10px] font-bold text-amber-600">감점:</span>{soft.map((s) => <span key={s.store_key} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700">{STORE_LABELS[s.store_key] ?? s.store_key}</span>)}</div>}
          {warn.length > 0 && <div className="flex flex-wrap items-center gap-1"><span className="text-[10px] font-bold text-yellow-600">주의:</span>{warn.map((w) => <span key={w.store_key} className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-700">{STORE_LABELS[w.store_key] ?? w.store_key}</span>)}</div>}
        </div>
      )}
    </div>
  );
}
