import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Eye, Check, Pause, Trash2, ShieldCheck, Scan } from 'lucide-react';
import {
  flagPlacementRisks, listPlacementRisks, decidePlacementRisk,
  getPlacementRiskStatus, explainPlacement,
  EXCLUDED_GENRE_PATTERNS,
  type PlacementRiskFlag, type RiskStatusFilter,
  type PlacementRiskStatus, type PlacementExplanation,
} from '@/lib/placementAuditApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

/**
 * AI 배치 진단 — 관찰 모드 (0232):
 *  - 의심 배치 자동 검출 → placement_risk_flags 큐 적재
 *  - 관리자가 행별로 [승인 / 유지 / 삭제] 선택
 *  - 자동 차단 정책 보류 (taxonomy-v1 precision 검증 단계)
 */

const FILTERS: Array<{ key: RiskStatusFilter; label: string }> = [
  { key: 'pending', label: '대기' },
  { key: 'approve', label: '승인됨' },
  { key: 'keep', label: '유지됨' },
  { key: 'remove', label: '삭제됨' },
  { key: 'all', label: '전체' },
];

export default function PlacementAuditPanel() {
  const [filter, setFilter] = useState<RiskStatusFilter>('pending');
  const [rows, setRows] = useState<PlacementRiskFlag[]>([]);
  const [status, setStatus] = useState<PlacementRiskStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [explainOpen, setExplainOpen] = useState<PlacementExplanation | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [items, st] = await Promise.all([
        listPlacementRisks(filter, 100),
        getPlacementRiskStatus(),
      ]);
      setRows(items);
      setStatus(st);
    } catch (err) {
      toast.error(friendlyError(err, '큐 조회 실패'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void reload(); }, [reload]);

  async function onScan(dryRun: boolean) {
    setScanning(true);
    try {
      const res = await flagPlacementRisks(dryRun);
      if (res.dryRun) {
        toast.success(`스캔 결과: 의심 배치 ${res.candidate_count}건 (저장 안 함)`);
      } else {
        toast.success(`스캔 결과: 후보 ${res.candidate_count}건 → 신규 플래그 ${res.inserted_count}건 적재`);
        await reload();
      }
    } catch (err) {
      toast.error(friendlyError(err, '스캔 실패'));
    } finally {
      setScanning(false);
    }
  }

  async function onDecide(row: PlacementRiskFlag, decision: 'approve' | 'keep' | 'remove') {
    const labels: Record<typeof decision, string> = { approve: '승인', keep: '유지', remove: '삭제' };
    if (decision === 'remove' && !confirm(`"${row.title}" 을 "${row.playlist_title}" 에서 실제 삭제합니다. 진행?`)) return;
    setDecidingId(row.flag_id);
    try {
      await decidePlacementRisk(row.flag_id, decision);
      toast.success(`${labels[decision]} 처리 완료`);
      await reload();
    } catch (err) {
      toast.error(friendlyError(err, '결정 처리 실패'));
    } finally {
      setDecidingId(null);
    }
  }

  async function onExplain(row: PlacementRiskFlag) {
    try {
      const r = await explainPlacement(row.track_id, row.playlist_id);
      setExplainOpen(r);
    } catch (err) {
      toast.error(friendlyError(err, '점수 분해 실패'));
    }
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <ShieldCheck size={16} className="text-accent" /> AI 배치 진단 — 장르 불일치 의심 큐
        </h2>
        <p className="text-xs text-ink-mute">
          호텔/와인바/카페 라운지 등 매장 카테고리에 부적합 의심 장르 (rock/metal/punk 등) 가 배치된 트랙을 검출.
          <span className="ml-1 font-semibold text-amber-400">자동 차단 정책 보류 — taxonomy-v1 precision &gt; 90% 검증 후 재검토.</span>
        </p>
      </header>

      {/* 상단 통계 + 스캔 */}
      <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10 space-y-3">
        {status && (
          <div className="flex flex-wrap items-center gap-2">
            <Stat label="대기" value={status.pending_count} tone={status.pending_count > 0 ? 'warn' : undefined} />
            <Stat label="승인" value={status.approved_count} tone="success" />
            <Stat label="유지" value={status.kept_count} />
            <Stat label="삭제" value={status.removed_count} />
            <span className="ml-auto text-[10px] text-ink-dim font-mono">
              {status.last_run_at ? `마지막 스캔 ${new Date(status.last_run_at).toLocaleString('ko-KR')}` : '아직 스캔 안 됨'}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void onScan(true)} disabled={scanning}
            className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-3 py-1.5 text-xs font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink disabled:opacity-50">
            <Scan size={12} /> dryRun 스캔
          </button>
          <button onClick={() => void onScan(false)} disabled={scanning}
            className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-soft disabled:opacity-50">
            <Scan size={12} /> {scanning ? '스캔 중…' : '플래그 적재'}
          </button>
          <span className="text-[10px] text-ink-dim">검출 대상: {EXCLUDED_GENRE_PATTERNS.join(' / ')}</span>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={'rounded-full px-3 py-1.5 text-xs font-semibold transition ' +
              (filter === f.key ? 'bg-accent text-white' : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink')}>
            {f.label}
          </button>
        ))}
        <button onClick={() => void reload()} disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-full bg-bg-soft px-3 py-1.5 text-xs ring-1 ring-line/10 hover:text-ink">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {/* 큐 */}
      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-bg-soft text-left font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">
              <th className="px-3 py-2">플레이리스트</th>
              <th className="px-3 py-2">업종</th>
              <th className="px-3 py-2">트랙 / 아티스트</th>
              <th className="px-3 py-2">main_genre · mood</th>
              <th className="px-3 py-2">AI 예측</th>
              <th className="px-3 py-2 w-20 text-right">score</th>
              <th className="px-3 py-2 w-12 text-center">디버그</th>
              <th className="px-3 py-2 w-48 text-center">결정</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-ink-mute">불러오는 중…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-ink-dim">
                {filter === 'pending' ? (
                  <>
                    <AlertTriangle size={14} className="inline mr-1 text-emerald-400" /> 대기 중 의심 플래그가 없습니다.
                    <p className="mt-1 text-[10px]">스캔 적재 버튼으로 새 플래그를 만드세요.</p>
                  </>
                ) : '해당 상태의 항목이 없습니다.'}
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.flag_id} className="border-t border-line/10">
                <td className="px-3 py-2 font-semibold">{r.playlist_title}</td>
                <td className="px-3 py-2 text-ink-mute">{r.business_category}</td>
                <td className="px-3 py-2">
                  <div>{r.title}</div>
                  <div className="text-[10px] text-ink-dim">{r.artist ?? '—'}</div>
                </td>
                <td className="px-3 py-2">
                  <span className="font-mono text-rose-300">{r.main_genre ?? '—'}</span>
                  <span className="ml-1 text-[10px] text-ink-mute">· {r.mood ?? '—'}</span>
                </td>
                <td className="px-3 py-2">
                  {r.ai_pred_main_genre ? (
                    <>
                      <span className="font-mono text-violet-300">{r.ai_pred_main_genre}</span>
                      {r.ai_pred_confidence != null && <span className="ml-1 text-[10px] text-ink-dim">{(Number(r.ai_pred_confidence) * 100).toFixed(0)}%</span>}
                    </>
                  ) : <span className="text-ink-dim">—</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono">{r.match_score != null ? Number(r.match_score).toFixed(1) : '—'}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => void onExplain(r)} title="점수 분해"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink">
                    <Eye size={12} />
                  </button>
                </td>
                <td className="px-3 py-2 text-center">
                  {r.decision === 'pending' ? (
                    <div className="inline-flex items-center gap-1">
                      <DecideBtn label="승인" icon={<Check size={11} />} tone="emerald" disabled={decidingId === r.flag_id}
                        onClick={() => void onDecide(r, 'approve')} title="배치 유지 + 학습 데이터 표시" />
                      <DecideBtn label="유지" icon={<Pause size={11} />} tone="slate" disabled={decidingId === r.flag_id}
                        onClick={() => void onDecide(r, 'keep')} title="배치 유지 (학습 표시 안 함)" />
                      <DecideBtn label="삭제" icon={<Trash2 size={11} />} tone="rose" disabled={decidingId === r.flag_id}
                        onClick={() => void onDecide(r, 'remove')} title="placement_tracks 에서 실제 삭제" />
                    </div>
                  ) : (
                    <span className={
                      'rounded-full px-2 py-0.5 text-[10px] font-bold ' +
                      (r.decision === 'approve' ? 'bg-emerald-500/15 text-emerald-400'
                       : r.decision === 'keep' ? 'bg-slate-500/15 text-slate-300'
                       : 'bg-rose-500/15 text-rose-400')
                    }>
                      {r.decision === 'approve' ? '승인됨' : r.decision === 'keep' ? '유지됨' : '삭제됨'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10 text-[11px] leading-relaxed text-ink-dim">
        <p className="mb-1 font-semibold text-ink">결정 가이드</p>
        <ul className="space-y-0.5">
          <li>• <span className="font-mono text-emerald-300">승인</span> — AI 의심은 오탐. 배치 유지 + 학습 데이터로 마크 (precision 측정에 사용).</li>
          <li>• <span className="font-mono text-slate-300">유지</span> — 일단 그대로 둠 (예: 검토 보류 / 추후 결정).</li>
          <li>• <span className="font-mono text-rose-300">삭제</span> — playlist_tracks 에서 실제 제거 + 플래그 'remove' 마크.</li>
        </ul>
        <p className="mt-2">
          현재 운영 데이터 수집 단계 — 충분한 결정 표본이 모이면 (≈100건+ 승인/삭제 분포)
          taxonomy-v1 모델 precision 측정 → &gt;90% 시 자동 차단 정책 활성화 검토.
        </p>
      </div>

      {explainOpen && <ExplainModal data={explainOpen} onClose={() => setExplainOpen(null)} />}
    </div>
  );
}

function DecideBtn({ label, icon, tone, disabled, onClick, title }: {
  label: string; icon: React.ReactNode;
  tone: 'emerald' | 'slate' | 'rose';
  disabled: boolean; onClick: () => void; title: string;
}) {
  const toneClass =
    tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/20'
    : tone === 'rose' ? 'bg-rose-500/10 text-rose-300 ring-rose-500/30 hover:bg-rose-500/20'
    : 'bg-bg-soft text-ink-mute ring-line/10 hover:text-ink';
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[10px] font-semibold ring-1 transition disabled:opacity-50 ${toneClass}`}>
      {icon} {label}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warn' }) {
  const toneClass = tone === 'success' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : 'text-ink';
  return (
    <div className="flex items-baseline gap-1.5 rounded-full bg-bg-soft px-3 py-1 ring-1 ring-line/10">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">{label}</span>
      <span className={`text-sm font-bold ${toneClass}`}>{value}</span>
    </div>
  );
}

function ExplainModal({ data, onClose }: { data: PlacementExplanation; onClose: () => void }) {
  const items: Array<{ label: string; value: number; group?: 'manual' | 'ai' | 'audio' }> = [
    { label: 'genre_manual', value: data.scores.genre_manual, group: 'manual' },
    { label: 'genre_ai', value: data.scores.genre_ai, group: 'ai' },
    { label: 'mood_manual', value: data.scores.mood_manual, group: 'manual' },
    { label: 'mood_ai', value: data.scores.mood_ai, group: 'ai' },
    { label: 'store_manual', value: data.scores.store_manual, group: 'manual' },
    { label: 'store_ai', value: data.scores.store_ai, group: 'ai' },
    { label: 'daypart', value: data.scores.daypart, group: 'audio' },
    { label: 'bpm', value: data.scores.bpm, group: 'audio' },
    { label: 'energy', value: data.scores.energy, group: 'audio' },
    { label: 'vocal', value: data.scores.vocal, group: 'audio' },
    { label: 'quality', value: data.scores.quality, group: 'audio' },
    { label: 'freshness', value: data.scores.freshness, group: 'audio' },
  ];
  const manual_total = data.scores.genre_manual + data.scores.mood_manual + data.scores.store_manual;
  const ai_total = data.scores.genre_ai + data.scores.mood_ai + data.scores.store_ai;
  const audio_total = data.scores.daypart + data.scores.bpm + data.scores.energy
                    + data.scores.vocal + data.scores.quality + data.scores.freshness;
  function toneOf(v: number): string {
    if (v > 0) return 'text-emerald-400';
    if (v < 0) return 'text-rose-400';
    return 'text-ink-dim';
  }

  // Store Fit Gate v1
  const gate = data.gate;
  const gateSignals: Array<{ key: string; label: string; match: boolean }> = gate ? [
    { key: 'genre', label: 'genre', match: gate.genre_match },
    { key: 'mood', label: 'mood', match: gate.mood_match },
    { key: 'business', label: 'business', match: gate.business_match },
    { key: 'ai_store', label: 'AI store', match: gate.ai_store_match },
    { key: 'allow', label: 'allow rule', match: gate.allow_rule_matched },
  ] : [];
  const decisionLabel: Record<string, { text: string; tone: string }> = {
    auto_place: { text: '✓ 자동 배치', tone: 'bg-emerald-500/15 text-emerald-400' },
    skip_gate_failed: { text: '⚠️ 최소 게이트 실패', tone: 'bg-amber-500/15 text-amber-400' },
    skip_blocked: { text: '🚫 Block 룰 매치', tone: 'bg-rose-500/15 text-rose-400' },
    skip_below_threshold: { text: '✕ Threshold 미달', tone: 'bg-slate-500/15 text-slate-300' },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-bg-card p-5 ring-1 ring-line/10" onClick={(e) => e.stopPropagation()}>
        <header className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">배치 점수 분해</h3>
            <p className="mt-0.5 text-[11px] text-ink-mute">
              <span className="font-semibold">{data.track.title}</span> ({data.track.manual_main_genre}) → <span className="font-semibold">{data.playlist.title}</span> ({data.playlist.business_category})
            </p>
          </div>
          <button onClick={onClose} className="text-ink-mute hover:text-ink">✕</button>
        </header>

        <div className="space-y-2 rounded-xl bg-bg-soft p-3">
          <div className="flex items-center justify-between text-[10px] font-mono text-ink-dim">
            <span>점수 분해 — manual / ai / audio</span>
            <span>총합 = manual({manual_total}) + ai({ai_total}) + audio({audio_total})</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {items.map((i) => (
              <div key={i.label} className="flex items-center justify-between text-[11px]">
                <span className="font-mono text-ink-mute">
                  {i.group === 'ai' && <span className="mr-1 text-violet-400">🆕</span>}
                  {i.label}
                </span>
                <span className={`font-mono font-bold ${toneOf(i.value)}`}>
                  {i.value > 0 ? '+' : ''}{i.value}
                </span>
              </div>
            ))}
          </div>
          {data.ai_boost_breakdown && (
            <div className="border-t border-line/10 pt-2 text-[10px] text-ink-dim space-y-0.5">
              <p className="font-mono">AI Boost (X2.1): max +34 (genre 5 + mood 9 + store 20)</p>
              <p>· genre_ai_match: {data.ai_boost_breakdown.genre_ai_match ? '✓' : '✕'}</p>
              <p>· mood_ai overlap: {data.ai_boost_breakdown.mood_ai_overlap_count} 매치 (× 3, max 9)</p>
              <p>· store_ai overlap: {data.ai_boost_breakdown.store_ai_overlap_count} 매치 (× 10, max 20)</p>
              {/* 🆕 X1.3.3 alias normalize 정보 */}
              {data.ai_boost_breakdown.normalized_store_key && (
                <p className="text-violet-300">
                  · normalized_store_key:{' '}
                  <span className="font-mono">{data.ai_boost_breakdown.normalized_store_key}</span>
                  {data.ai_boost_breakdown.alias_match_source && (
                    <span className="ml-1 text-[9px]">
                      (alias source: {data.ai_boost_breakdown.alias_match_source})
                    </span>
                  )}
                </p>
              )}
              {!data.ai_boost_breakdown.normalized_store_key && data.playlist.business_category && (
                <p className="text-amber-400">
                  ⚠️ business_category "{data.playlist.business_category}" alias 미매핑 — store_ai 비활성
                </p>
              )}
            </div>
          )}
        </div>

        <div className={`mt-3 rounded-xl p-3 text-center ${data.would_place ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">최종 점수 (threshold {data.threshold})</p>
          <p className={`mt-1 text-2xl font-bold ${data.would_place ? 'text-emerald-400' : 'text-rose-400'}`}>
            {Number(data.final_score).toFixed(1)} {data.would_place ? '✓ 배치' : '✕ 거부'}
          </p>
        </div>

        {/* Store Fit Gate v1 */}
        {gate && (
          <div className="mt-3 space-y-2 rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">Store Fit Gate v1</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${decisionLabel[gate.final_decision]?.tone ?? 'bg-bg-card text-ink-mute'}`}>
                {decisionLabel[gate.final_decision]?.text ?? gate.final_decision}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {gateSignals.map((s) => (
                <span key={s.key}
                  className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono ' +
                    (s.match ? 'bg-emerald-500/15 text-emerald-300' : 'bg-bg-card text-ink-dim')}>
                  {s.match ? '✓' : '·'} {s.label}
                </span>
              ))}
              {gate.block_rule_matched && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-mono text-rose-300">
                  ⚠️ block matched
                </span>
              )}
            </div>
            <p className="text-[10px] text-ink-dim">
              <span className="font-semibold">최소 게이트:</span> {gate.minimum_gate_passed ? '통과' : '실패'}
              {gate.gate_reasons.length > 0 && <span className="ml-2">(사유: {gate.gate_reasons.join(', ')})</span>}
            </p>
          </div>
        )}

        {(data.block_reasons || data.allow_exceptions) && (
          <div className="mt-3 space-y-2">
            {data.block_reasons && data.block_reasons.length > 0 && (
              <div className="rounded-lg bg-rose-500/5 p-2 ring-1 ring-rose-500/20">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-rose-400">Block 패턴 매치 (정보용)</p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-rose-300">{data.block_reasons.map((r, i) => <li key={i}>· {r}</li>)}</ul>
              </div>
            )}
            {data.allow_exceptions && data.allow_exceptions.length > 0 && (
              <div className="rounded-lg bg-emerald-500/5 p-2 ring-1 ring-emerald-500/20">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-400">Allow 예외</p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-emerald-300">{data.allow_exceptions.map((r, i) => <li key={i}>· {r}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-bg-soft p-2">
            <p className="font-mono text-[10px] uppercase text-ink-dim">메타데이터 출처</p>
            <p className="mt-0.5 font-semibold">{data.metadata_source}</p>
            <p className="mt-1 text-ink-mute">main_genre: <span className="font-mono text-ink">{data.track.manual_main_genre ?? '—'}</span></p>
            <p className="text-ink-mute">mood: <span className="font-mono text-ink">{data.track.manual_mood ?? '—'}</span></p>
            <p className="text-ink-mute">suitable_store: <span className="font-mono text-ink">{data.track.suitable_store ?? '—'}</span></p>
          </div>
          <div className="rounded-lg bg-bg-soft p-2">
            <p className="font-mono text-[10px] uppercase text-ink-dim">AI 예측 (taxonomy-v1)</p>
            {data.ai_prediction_taxonomy_v1 ? (
              <>
                <p className="mt-0.5 font-semibold">{data.ai_prediction_taxonomy_v1.main ?? '—'}</p>
                <p className="text-ink-mute">subs: <span className="font-mono text-ink">{data.ai_prediction_taxonomy_v1.subs?.slice(0, 3).join(', ') ?? '—'}</span></p>
                <p className="text-ink-mute">confidence: <span className="font-mono text-ink">
                  {data.ai_prediction_taxonomy_v1.confidence != null ? `${(Number(data.ai_prediction_taxonomy_v1.confidence) * 100).toFixed(1)}%` : '—'}
                </span></p>
                <p className="text-ink-mute">applied: <span className="font-mono text-ink">{data.ai_prediction_taxonomy_v1.applied_at ? '✓' : '✕'}</span></p>
              </>
            ) : <p className="mt-0.5 text-ink-mute italic">(예측 없음)</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
