import { useState } from 'react';
import { Pencil, Wand2, RefreshCw, XCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  GENRE_OPTIONS, MOOD_OPTIONS, BUSINESS_OPTIONS, VOCAL_OPTIONS, LANGUAGE_OPTIONS, DAYPART_OPTIONS, TEMPO_OPTIONS,
  SENSITIVE_BUSINESS, META_CAPS,
  adminBulkUpdateTrackMetadata, adminBulkApplyAiMetadata, adminBulkRecomputeTracks,
  type BulkMetaResult, type BulkMetaPatch, type Option,
} from '@/lib/trackMetadataOptions';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

/**
 * 선택 음원 일괄 작업 바 — 검수/재검수/고위험/음원관리 탭 공용.
 * - 일괄 메타 수정 (필드별 "변경 안 함"), AI 메타 일괄 적용, 일괄 재계산, 선택 해제.
 * - 권한/검증/cap/audit 는 서버 RPC 가 강제. released 곡도 메타만 수정(상태 불변).
 */
export default function BulkMetaActions({
  selectedIds, onClear, onRefresh, max = 100,
}: {
  selectedIds: string[];
  onClear: () => void;
  onRefresh: () => void | Promise<void>;
  max?: number;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ title: string; data: BulkMetaResult } | null>(null);
  const n = selectedIds.length;
  const over = n > max;

  async function runBulk(title: string, fn: () => Promise<BulkMetaResult>, confirmMsg?: string) {
    if (n === 0) return;
    if (over) { toast.error(`한 번에 최대 ${max}곡까지 가능합니다 (선택: ${n}곡)`); return; }
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const data = await fn();
      setResult({ title, data });
      if (data.failed === 0) toast.success(`${title} — ${data.success}곡 완료`);
      else toast.warning(`${title} — ${data.success}곡 완료 · ${data.failed}곡 실패`);
      await onRefresh();
    } catch (e) {
      const err = e as { message?: string; hint?: string; details?: string };
      toast.error(`${title} 실패: ${err.hint || err.details || err.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {over && <span className="text-[11px] font-semibold text-rose-600">최대 {max}곡까지만 일괄 처리</span>}
      <button
        onClick={() => setEditOpen(true)}
        disabled={n === 0 || busy || over}
        className="inline-flex items-center gap-1 rounded-md bg-indigo-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-500/25 disabled:opacity-40"
      >
        <Pencil size={11} /> 일괄 메타 수정
      </button>
      <button
        onClick={() => void runBulk('AI 메타 일괄 적용', () => adminBulkApplyAiMetadata(selectedIds), `선택한 ${n}곡에 AI 분석 메타(장르/무드)를 적용하고 재계산합니다. 계속할까요?`)}
        disabled={n === 0 || busy || over}
        className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-40"
      >
        <Wand2 size={11} /> AI 메타 일괄 적용
      </button>
      <button
        onClick={() => void runBulk('일괄 재계산', () => adminBulkRecomputeTracks(selectedIds))}
        disabled={n === 0 || busy || over}
        className="inline-flex items-center gap-1 rounded-md bg-bg-card px-2.5 py-1.5 text-[11px] font-semibold ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-40"
      >
        <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> 일괄 재계산
      </button>
      <button
        onClick={onClear}
        disabled={n === 0}
        className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2.5 py-1.5 text-[11px] font-semibold text-ink-mute hover:bg-ink/10 disabled:opacity-40"
      >
        <XCircle size={11} /> 선택 해제
      </button>

      {editOpen && (
        <BulkMetaEditModal
          count={n}
          onClose={() => setEditOpen(false)}
          onSubmit={async (patch) => {
            await runBulk('일괄 메타 수정', () => adminBulkUpdateTrackMetadata(selectedIds, patch));
            setEditOpen(false);
          }}
          busy={busy}
        />
      )}
      {result && <BulkResultModal title={result.title} data={result.data} onClose={() => setResult(null)} />}
    </>
  );
}

// ── 일괄 메타 수정 모달 ──
function BulkMetaEditModal({
  count, onClose, onSubmit, busy,
}: {
  count: number;
  onClose: () => void;
  onSubmit: (patch: BulkMetaPatch) => void | Promise<void>;
  busy: boolean;
}) {
  // 필드별 "변경" 토글 (off = 변경 안 함)
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [genre, setGenre] = useState('');
  const [moods, setMoods] = useState<string[]>([]);
  const [business, setBusiness] = useState<string[]>([]);
  const [vocal, setVocal] = useState('');
  const [language, setLanguage] = useState('');
  const [dayparts, setDayparts] = useState<string[]>([]);
  const [tempo, setTempo] = useState('');

  const sensitive = business.filter((b) => SENSITIVE_BUSINESS.includes(b));

  function toggleArr(arr: string[], set: (v: string[]) => void, v: string, capN: number) {
    if (arr.includes(v)) set(arr.filter((x) => x !== v));
    else { if (arr.length >= capN) { toast.error(`최대 ${capN}개까지 선택할 수 있습니다`); return; } set([...arr, v]); }
  }

  function buildPatch(): BulkMetaPatch | string {
    const patch: BulkMetaPatch = {};
    if (enabled.genre) { if (!genre) return '장르를 선택하거나 "변경 안 함"으로 두세요'; patch.genre = [genre]; }
    if (enabled.moods) { if (moods.length === 0) return '분위기를 1개 이상 선택하세요'; patch.moods = moods; }
    if (enabled.business) { if (business.length === 0) return '추천 매장을 1개 이상 선택하세요'; patch.business_type_tags = business; }
    if (enabled.vocal) { if (!vocal) return '보컬 유형을 선택하세요'; patch.vocal_type = vocal; }
    if (enabled.language) { if (!language) return '언어를 선택하세요'; patch.language = language; }
    if (enabled.dayparts) { if (dayparts.length === 0) return '추천 시간대를 1개 이상 선택하세요'; patch.time_tags = dayparts; }
    if (enabled.tempo) { if (!tempo) return '체감 템포를 선택하세요'; patch.tempo_feel = tempo; }
    if (Object.keys(patch).length === 0) return '변경할 필드를 1개 이상 선택하세요';
    return patch;
  }

  function submit() {
    const p = buildPatch();
    if (typeof p === 'string') { toast.error(p); return; }
    void onSubmit(p);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-bg-card p-4 ring-1 ring-line/15 sm:rounded-2xl">
        <h3 className="mb-1 text-sm font-bold">선택 음원 일괄 메타 수정 · {count}곡</h3>
        <p className="mb-3 text-[11px] text-ink-dim">체크한 필드만 모든 선택 곡에 적용됩니다. 체크 안 한 필드는 <b>변경 안 함</b>(기존 값 유지). 발매곡도 메타만 수정되며 발매 상태는 바뀌지 않습니다.</p>

        <div className="space-y-3">
          <Field label="장르" on={!!enabled.genre} onToggle={(v) => setEnabled((s) => ({ ...s, genre: v }))}>
            <select value={genre} onChange={(e) => setGenre(e.target.value)} className="input text-sm">
              <option value="">선택…</option>
              {GENRE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          <Field label={`분위기 (최대 ${META_CAPS.mood})`} on={!!enabled.moods} onToggle={(v) => setEnabled((s) => ({ ...s, moods: v }))}>
            <Chips options={MOOD_OPTIONS} selected={moods} onToggle={(v) => toggleArr(moods, setMoods, v, META_CAPS.mood)} />
          </Field>

          <Field label={`추천 매장 (최대 ${META_CAPS.business})`} on={!!enabled.business} onToggle={(v) => setEnabled((s) => ({ ...s, business: v }))}>
            <Chips options={BUSINESS_OPTIONS} selected={business} onToggle={(v) => toggleArr(business, setBusiness, v, META_CAPS.business)} />
            {sensitive.length > 0 && (
              <p className="mt-1.5 flex items-start gap-1 rounded bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" /> 민감 매장({sensitive.join(', ')}) 태그가 포함되어 있습니다. Guardrail 위반 곡은 자동으로 재검수 대상으로 표시됩니다.
              </p>
            )}
          </Field>

          <Field label="보컬 타입" on={!!enabled.vocal} onToggle={(v) => setEnabled((s) => ({ ...s, vocal: v }))}>
            <select value={vocal} onChange={(e) => setVocal(e.target.value)} className="input text-sm">
              <option value="">선택…</option>
              {VOCAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          <Field label="언어" on={!!enabled.language} onToggle={(v) => setEnabled((s) => ({ ...s, language: v }))}>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input text-sm">
              <option value="">선택…</option>
              {LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>

          <Field label={`추천 시간대 (최대 ${META_CAPS.daypart})`} on={!!enabled.dayparts} onToggle={(v) => setEnabled((s) => ({ ...s, dayparts: v }))}>
            <Chips options={DAYPART_OPTIONS} selected={dayparts} onToggle={(v) => toggleArr(dayparts, setDayparts, v, META_CAPS.daypart)} />
          </Field>

          <Field label="체감 템포" on={!!enabled.tempo} onToggle={(v) => setEnabled((s) => ({ ...s, tempo: v }))}>
            <Chips options={TEMPO_OPTIONS} selected={tempo ? [tempo] : []} onToggle={(v) => setTempo(tempo === v ? '' : v)} />
          </Field>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-ghost px-3 py-2 text-xs">취소</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-black disabled:opacity-50">
            {busy ? '처리 중…' : `${count}곡 적용`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, on, onToggle, children }: { label: string; on: boolean; onToggle: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-bg-soft/50 p-2.5 ring-1 ring-line/10">
      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        {label}
        {!on && <span className="text-[10px] font-normal text-ink-dim">· 변경 안 함</span>}
      </label>
      {on && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Chips({ options, selected, onToggle }: { options: Option[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onToggle(o.value)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${selected.includes(o.value) ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── 결과 모달 (성공/실패 목록) ──
function BulkResultModal({ title, data, onClose }: { title: string; data: BulkMetaResult; onClose: () => void }) {
  const failed = data.results.filter((r) => r.status === 'failed');
  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-bg-card p-4 ring-1 ring-line/15 sm:rounded-2xl">
        <h3 className="flex items-center gap-1.5 text-sm font-bold">
          {data.failed === 0 ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}
          {title} 결과
        </h3>
        <p className="mt-1 text-xs text-ink-mute">{data.total}곡 중 <b className="text-emerald-600">{data.success}곡 완료</b>{data.failed > 0 && <>, <b className="text-rose-600">{data.failed}곡 실패</b></>}</p>
        {failed.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-xl bg-rose-500/5 p-2.5 text-[11px] ring-1 ring-rose-500/15">
            {failed.map((f) => (
              <li key={f.track_id} className="text-ink-mute"><b className="text-rose-600">{f.title ?? f.track_id.slice(0, 8)}</b> — {f.error}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg bg-bg-soft px-4 py-2 text-xs font-semibold hover:bg-bg-hover">닫기</button>
        </div>
      </div>
    </div>
  );
}
