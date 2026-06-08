/**
 * TrackQcDetailModal — 본인 트랙의 QC 결과 상세 (X6.37)
 *
 * 입력: trackId / trackTitle (옵션)
 * 동작:
 *   1) mount 시 validate_track_audio_qc(track_id) RPC 호출
 *   2) status='analyzing' 이면 "분석 중" 안내만
 *   3) status='analyzed' 이면 4 metric verdict + 사용자 친화 메시지 표시
 *   4) Esc / 배경 클릭 / 닫기 버튼으로 dismiss
 *
 * 안전: RLS 가 본인/admin 만 허용. 다른 사람 트랙 ID 넘기면 RPC 가 raise.
 */
import { useEffect, useState } from 'react';
import {
  X, AlertTriangle, AlertCircle, ShieldCheck, Activity,
  Loader2, Info, Music,
} from 'lucide-react';
import {
  validateTrackAudioQc,
  type TrackQcValidation,
  type QcVerdict,
} from '@/lib/audioQcGuideApi';
import Alert from '@/components/Alert';

interface Props {
  trackId: string;
  trackTitle?: string;
  onClose: () => void;
}

export default function TrackQcDetailModal({ trackId, trackTitle, onClose }: Props) {
  const [data, setData] = useState<TrackQcValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    validateTrackAudioQc(trackId)
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [trackId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qc-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="qc-modal-title" className="flex items-center gap-1.5 text-base font-bold">
              <Music size={16} className="text-accent" /> 음질 분석 결과
            </h3>
            {trackTitle && (
              <p className="mt-0.5 truncate text-xs text-ink-mute">{trackTitle}</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-ink/5" aria-label="닫기">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 rounded-xl bg-bg-card px-3 py-4 text-sm text-ink-mute ring-1 ring-line/10">
            <Loader2 size={14} className="animate-spin" /> 분석 결과 불러오는 중…
          </div>
        )}

        {error && (
          <Alert tone="error" title="조회 실패">
            <pre className="whitespace-pre-wrap break-all text-[11px]">{error}</pre>
          </Alert>
        )}

        {data && !data.analyzed && (
          <Alert tone="info">
            <p className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              {data.message ?? 'QC 분석이 진행 중입니다.'}
            </p>
            <p className="mt-1 text-[10px] text-ink-mute">
              보통 업로드 후 5분 이내 완료됩니다. 잠시 뒤 새로고침 후 다시 확인해주세요.
            </p>
          </Alert>
        )}

        {data && data.analyzed && (
          <>
            <OverallVerdict verdict={data.overall_verdict ?? 'unknown'} score={data.qc_score} />

            <div className="grid grid-cols-2 gap-2">
              <MetricCard
                label="Integrated LUFS"
                value={data.metrics?.integrated_lufs}
                unit="LUFS"
                verdict={data.verdicts?.lufs ?? 'unknown'}
                hint="권장 -20 ~ -10"
              />
              <MetricCard
                label="True Peak"
                value={data.metrics?.true_peak_db}
                unit="dBTP"
                verdict={data.verdicts?.true_peak ?? 'unknown'}
                hint="권장 ≤ -1"
              />
              <MetricCard
                label="Clipping"
                value={data.metrics?.clipping_count}
                unit="회"
                verdict={data.verdicts?.clipping ?? 'unknown'}
                hint="권장 0회"
              />
              <MetricCard
                label="종합 점수"
                value={data.qc_score}
                unit="/ 100"
                verdict={data.verdicts?.qc_score ?? 'unknown'}
                hint="권장 ≥ 80"
              />
            </div>

            {data.messages && data.messages.length > 0 && (
              <div className="rounded-xl bg-amber-500/5 px-3 py-2.5 ring-1 ring-amber-500/30">
                <p className="flex items-center gap-1 text-xs font-bold text-ink">
                  <AlertTriangle size={12} className="text-amber-500" /> 개선 제안
                </p>
                <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-ink">
                  {data.messages.map((m, i) => (
                    <li key={i} className="border-l-2 border-amber-500/40 pl-2">{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.overall_verdict === 'ok' && (!data.messages || data.messages.length === 0) && (
              <div className="rounded-xl bg-emerald-500/5 px-3 py-2.5 ring-1 ring-emerald-500/30">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck size={12} /> 모든 권장 기준을 통과했어요. 별도 재마스터링 불필요.
                </p>
              </div>
            )}

            <div className="space-y-1 rounded-xl bg-bg-card px-3 py-2 text-[10px] text-ink-mute ring-1 ring-line/10">
              {data.qc_grade && <p>등급: <span className="font-mono font-bold text-ink">{data.qc_grade}</span></p>}
              {data.risk_level && <p>위험도: <span className="font-mono text-ink">{data.risk_level}</span></p>}
              {data.metrics?.duration && (
                <p>길이: <span className="font-mono text-ink">{Math.round(data.metrics.duration)}초</span></p>
              )}
              {data.measured_at && (
                <p>분석 시각: <span className="font-mono text-ink">{new Date(data.measured_at).toLocaleString('ko-KR')}</span></p>
              )}
            </div>

            <p className="flex items-center gap-1 text-[10px] text-ink-dim">
              <Info size={10} />
              운영자 검수 전 단계 — 자동 분석 결과가 권장 기준 안에 들어도 청취 판단으로 반려될 수 있습니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function OverallVerdict({ verdict, score }: { verdict: QcVerdict; score?: number }) {
  const meta: Record<QcVerdict, { tone: string; label: string; Icon: typeof ShieldCheck }> = {
    ok:      { tone: 'bg-emerald-500/10 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300', label: '권장 기준 통과', Icon: ShieldCheck },
    warning: { tone: 'bg-amber-500/10 ring-amber-500/30 text-amber-700 dark:text-amber-300',        label: '일부 항목 주의 — 마스터링 점검 권장', Icon: AlertTriangle },
    fail:    { tone: 'bg-red-500/10 ring-red-500/30 text-red-700 dark:text-red-300',                 label: '권장 기준 미달 — 재마스터링 권장', Icon: AlertCircle },
    unknown: { tone: 'bg-bg-card ring-line/10 text-ink-mute',                                         label: '판정 불가 — 일부 지표 결측', Icon: Activity },
  };
  const m = meta[verdict];
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ${m.tone}`}>
      <span className="flex items-center gap-2 text-sm font-bold">
        <m.Icon size={16} /> {m.label}
      </span>
      {score != null && (
        <span className="font-mono text-lg font-bold">{Math.round(score)}<span className="text-[10px] font-normal opacity-70">/100</span></span>
      )}
    </div>
  );
}

function MetricCard({
  label, value, unit, verdict, hint,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  verdict: QcVerdict;
  hint: string;
}) {
  const tone: Record<QcVerdict, string> = {
    ok:      'bg-emerald-500/5 ring-emerald-500/30',
    warning: 'bg-amber-500/5 ring-amber-500/30',
    fail:    'bg-red-500/5 ring-red-500/30',
    unknown: 'bg-bg-soft ring-line/10',
  };
  const valueColor: Record<QcVerdict, string> = {
    ok:      'text-emerald-700 dark:text-emerald-300',
    warning: 'text-amber-700 dark:text-amber-300',
    fail:    'text-red-700 dark:text-red-300',
    unknown: 'text-ink',
  };
  const display = value == null ? '—' :
    (Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(2));
  return (
    <div className={`rounded-xl px-3 py-2 ring-1 ${tone[verdict]}`}>
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <p className={`mt-0.5 font-mono text-base font-bold ${valueColor[verdict]}`}>
        {display}
        <span className="ml-0.5 text-[10px] font-normal text-ink-mute">{unit}</span>
      </p>
      <p className="mt-0.5 text-[10px] text-ink-mute">{hint}</p>
    </div>
  );
}
