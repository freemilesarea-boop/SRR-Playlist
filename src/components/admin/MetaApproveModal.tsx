import { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, History } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import TrackMetaSelectors from '@/components/artist/TrackMetaSelectors';
import {
  adminGetTrackTags, adminUpdateTrackTags, adminUpdateMetadataAndApprove, fetchMetadataAudit,
  validateSelectedMeta, emptySelectedMeta, type SelectedMeta, type MetaApproveResult, type MetadataAuditEntry,
} from '@/lib/trackMetadataOptions';
import { toast } from '@/store/toastStore';

const TEMPO_KO: Record<string, string> = { slow: '느림', medium: '보통', fast: '빠름' };
const VOCAL_KO: Record<string, string> = { male_vocal: '남성보컬', female_vocal: '여성보컬', mixed_vocal: '혼성', instrumental: '인스트루멘탈', chorus: '코러스', rap: '랩' };
function fmtVal(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '없음';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '없음';
  const s = String(v);
  if (field === 'tempo') return TEMPO_KO[s] ?? s;
  if (field === 'vocal') return VOCAL_KO[s] ?? s;
  return s;
}

/**
 * 관리자 메타 수정 + 승인 모달 (검수/재검수/고위험/음원관리 공용).
 * - 메타만 저장 / 수정 후 승인 / AI 메타 적용 후 승인
 * - 승인 가능 상태(submitted/review_pending/changes_requested)일 때만 승인 버튼 노출
 */
export default function MetaApproveModal({
  trackId, title, canApprove, onClose, onDone,
}: {
  trackId: string; title?: string | null; canApprove: boolean;
  onClose: () => void; onDone?: (approved: boolean) => void;
}) {
  const [meta, setMeta] = useState<SelectedMeta>(emptySelectedMeta);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MetaApproveResult | null>(null);
  const [audit, setAudit] = useState<MetadataAuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setResult(null); setShowAudit(false);
    adminGetTrackTags(trackId)
      .then((t) => { if (alive) setMeta({ genre_tags: t.genre_tags, mood_tags: t.mood_tags, business_type_tags: t.business_type_tags, vocal_type: t.vocal_type, recommended_dayparts: t.recommended_dayparts, language: t.language, tempo_feel: t.tempo_feel }); })
      .catch((e) => toast.error(`불러오기 실패: ${(e as Error).message}`))
      .finally(() => alive && setLoading(false));
    fetchMetadataAudit(trackId, 30).then((a) => { if (alive) setAudit(a); }).catch(() => { /* noop */ });
    return () => { alive = false; };
  }, [trackId]);

  async function saveOnly() {
    const err = validateSelectedMeta(meta);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try { await adminUpdateTrackTags(trackId, meta); toast.success('메타데이터 저장 + 재계산 완료'); onDone?.(false); onClose(); }
    catch (e) { toast.error(`저장 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function saveAndApprove(force = false) {
    const err = validateSelectedMeta(meta);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const r = await adminUpdateMetadataAndApprove(trackId, { meta, approve: true, force });
      setResult(r);
      if (r.approved) { toast.success('수정 후 승인 완료'); onDone?.(true); onClose(); }
      else toast.warning(r.note ?? '승인되지 않았습니다 — 사유를 확인하세요');
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function aiApplyAndApprove(force = false) {
    setBusy(true);
    try {
      const r = await adminUpdateMetadataAndApprove(trackId, { useAi: true, approve: true, force });
      setResult(r);
      if (r.approved) { toast.success('AI 메타 적용 후 승인 완료'); onDone?.(true); onClose(); }
      else toast.warning(r.note ?? '승인되지 않았습니다 — 사유를 확인하세요');
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const blocked = result?.blocked_reasons ?? [];
  const sensitive = (result?.warnings?.length ?? 0) > 0;
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-bg-card p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="truncate text-sm font-bold">메타데이터 수정/승인 · {title ?? ''}</h3>
          <button onClick={onClose} aria-label="닫기" className="rounded-lg p-1 hover:bg-bg-hover"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="h-48 animate-pulse rounded-xl bg-bg-soft" />
        ) : (
          <>
            <TrackMetaSelectors value={meta} onChange={setMeta} disabled={busy} />

            {result && (blocked.length > 0 || sensitive) && (
              <div className="mt-3 space-y-1.5 rounded-xl bg-rose-500/20 p-3 ring-1 ring-rose-500/50">
                {blocked.map((b, i) => <p key={i} className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-300"><AlertTriangle size={12} /> {b}</p>)}
                {result.warnings.map((w, i) => <p key={`w${i}`} className="text-[11px] text-amber-300">{w}</p>)}
                {blocked.length > 0 && canApprove && (
                  <button disabled={busy} onClick={() => void saveAndApprove(true)} className="mt-1 rounded-lg bg-rose-500/20 px-3 py-1.5 text-[11px] font-bold text-rose-300 disabled:opacity-50">경고 무시하고 강제 승인</button>
                )}
              </div>
            )}

            {audit.length > 0 && (
              <div className="mt-3">
                <button onClick={() => setShowAudit((v) => !v)} className="flex items-center gap-1 text-[11px] font-semibold text-ink-mute hover:text-ink">
                  <History size={12} /> 수정 이력 {audit.length}건 {showAudit ? '▲' : '▼'}
                </button>
                {showAudit && (
                  <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-xl bg-bg-soft/50 p-2.5 text-[10px]">
                    {audit.map((a) => (
                      <li key={a.id} className="border-b border-line/10 pb-1.5 last:border-0">
                        <p className="text-ink-dim">{new Date(a.changed_at).toLocaleString('ko-KR')} · <b className="text-ink-mute">{a.editor_email ?? a.editor ?? '시스템'}</b></p>
                        {a.changes.map((c, i) => (
                          <p key={i}><span className="text-ink-dim">{c.label}:</span> {fmtVal(c.field, c.from)} <span className="text-accent">→</span> {fmtVal(c.field, c.to)}</p>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button disabled={busy} onClick={() => void saveOnly()} className="rounded-lg bg-bg-soft px-3 py-2 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">메타만 저장</button>
              {canApprove && (
                <>
                  <button disabled={busy} onClick={() => void aiApplyAndApprove(false)} className="rounded-lg bg-accent/15 px-3 py-2 text-xs font-bold text-accent disabled:opacity-50">AI 메타 적용 후 승인</button>
                  <button disabled={busy} onClick={() => void saveAndApprove(false)} className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{busy ? '처리 중…' : '수정 후 승인'}</button>
                </>
              )}
            </div>
            {!canApprove && <p className="mt-2 text-right text-[10px] text-ink-dim">발매됨/승인 불가 상태 — 메타데이터 수정만 가능합니다.</p>}
          </>
        )}
      </div>
    </div>
  );
}
