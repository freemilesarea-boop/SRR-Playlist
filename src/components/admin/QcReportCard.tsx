/**
 * QcReportCard — 단일 트랙의 AI QC 리포트 카드 (admin 검수 화면용).
 */
import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ShieldCheck, Volume2, Sparkles } from 'lucide-react';
import { getTrackQcReport, gradeTone, riskTone, type AudioQcReport } from '@/lib/qcApi';

export default function QcReportCard({ trackId }: { trackId: string }) {
  const [report, setReport] = useState<AudioQcReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getTrackQcReport(trackId)
      .then((r) => { if (mounted) setReport(r); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [trackId]);

  if (loading) {
    return (
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <p className="py-4 text-center text-xs text-ink-mute">QC 리포트 불러오는 중…</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="flex items-center gap-2 text-xs text-ink-mute">
          <ShieldCheck size={14} className="text-ink-dim" />
          <span>AI QC 리포트 없음 — 분석 대기 중이거나 백필 필요</span>
        </div>
      </div>
    );
  }

  // 분석 실패 케이스 — row 는 있는데 핵심 측정값이 모두 null
  const analysisFailed = report.qc_score == null
    && report.integrated_lufs == null
    && report.true_peak_db == null;

  if (analysisFailed) {
    return (
      <div className="rounded-2xl bg-rose-500/5 p-4 ring-1 ring-rose-500/50">
        <div className="flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle size={14} />
          <span>
            AI QC 분석 실패 — Modal 워커가 응답을 저장했지만 측정값이 비어있음.
            로그 확인 후 백필로 재시도하세요. ({new Date(report.created_at).toLocaleString()})
          </span>
        </div>
      </div>
    );
  }

  const score = report.qc_score ?? 0;
  const grade = report.qc_grade ?? '?';
  const risk = report.risk_level ?? '?';

  return (
    <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-sm font-bold tracking-tight">AI QC 리포트</h3>
          <span className="text-[10px] text-ink-dim">{report.model_version}</span>
        </div>
        <span className="text-[10px] text-ink-dim">
          {new Date(report.created_at).toLocaleString()}
        </span>
      </div>

      {/* 점수 / 등급 / 위험도 */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-bg-soft p-3 text-center ring-1 ring-line/10">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">QC 점수</div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight">
            {score.toFixed(0)}
            <span className="text-xs text-ink-dim">/100</span>
          </div>
        </div>
        <div className={`rounded-xl p-3 text-center ring-1 ${gradeTone(grade)}`}>
          <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">등급</div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight">{grade}</div>
        </div>
        <div className={`rounded-xl p-3 text-center ring-1 ${riskTone(risk)}`}>
          <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">위험도</div>
          <div className="mt-1 text-sm font-extrabold tracking-tight">{risk}</div>
        </div>
      </div>

      {/* 측정 값 */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric icon={<Volume2 size={11} />} label="Integrated LUFS"
          value={report.integrated_lufs != null ? `${report.integrated_lufs.toFixed(1)} LUFS` : '—'}
          target="목표 -14" />
        <Metric icon={<Activity size={11} />} label="True Peak"
          value={report.true_peak_db != null ? `${report.true_peak_db.toFixed(1)} dBTP` : '—'}
          target="≤ -1 dBTP" />
        <Metric label="Dynamic Range"
          value={report.dynamic_range != null ? `${report.dynamic_range.toFixed(1)}` : '—'}
          target="4-20 권장" />
        <Metric label="Stereo Width"
          value={report.stereo_width != null ? `${(report.stereo_width * 100).toFixed(0)}%` : '—'} />
        <Metric label="Noise Floor"
          value={report.noise_floor_db != null ? `${report.noise_floor_db.toFixed(1)} dB` : '—'}
          target="≤ -45 dB" />
        <Metric label="Silence Ratio"
          value={report.silence_ratio != null ? `${(report.silence_ratio * 100).toFixed(1)}%` : '—'}
          target="< 30%" />
        <Metric label="Clipping"
          value={report.clipping_count != null ? `${report.clipping_count} 샘플` : '—'}
          target="0 권장" warn={report.clipping_count != null && report.clipping_count > 100} />
        <Metric label="Duration"
          value={report.duration != null ? `${Math.round(report.duration)}초` : '—'} />
      </div>

      {/* 문제 항목 */}
      {report.issues_json && report.issues_json.length > 0 && (
        <div className="rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
            <AlertTriangle size={11} className="text-amber-300" />
            발견된 문제 {report.issues_json.length}개
          </div>
          <ul className="space-y-1">
            {report.issues_json.map((issue, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px]">
                <span className="mt-0.5 shrink-0 rounded bg-bg-card px-1.5 py-0.5 font-mono text-[9px] font-bold text-ink-mute">
                  {issue.code}
                </span>
                <span className="text-ink">{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon, label, value, target, warn,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  target?: string;
  warn?: boolean;
}) {
  return (
    <div className={`rounded-lg bg-bg-soft px-3 py-2 ring-1 ${warn ? 'ring-rose-500/50' : 'ring-line/10'}`}>
      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-ink-dim">
        {icon}
        {label}
      </div>
      <div className={`mt-0.5 text-xs font-bold ${warn ? 'text-rose-300' : 'text-ink'}`}>
        {value}
      </div>
      {target && <div className="text-[9px] text-ink-dim">{target}</div>}
    </div>
  );
}
