/**
 * AudioQcGuideCard — 아티스트 업로드 전 음질 기준 안내 (X6.35)
 *
 * 위치: ArtistBatchUploadForm 상단 — 업로드 시작 전 사용자가 가이드 확인.
 * 운영 데이터 분석 결과 released vs removed 의 DSP 지표가 거의 동일 →
 * 자동 차단보다 명확한 기준 + 자가 검토 유도가 효과적.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import {
  fetchAudioUploadGuidelines,
  type AudioUploadGuidelines,
} from '@/lib/audioQcGuideApi';

export default function AudioQcGuideCard({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [data, setData] = useState<AudioUploadGuidelines | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAudioUploadGuidelines()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return null; // 가이드 fetch 실패해도 업로드 폼 자체는 살아있어야

  return (
    <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Info size={16} className="text-accent" />
          <span className="text-sm font-bold">음질 기준 및 업로드 가이드</span>
          <span className="text-[10px] text-ink-mute">(업로드 전 한 번 확인)</span>
        </span>
        {open ? <ChevronUp size={16} className="text-ink-mute" /> : <ChevronDown size={16} className="text-ink-mute" />}
      </button>

      {open && data && (
        <div className="mt-3 space-y-3 text-xs">
          {/* 핵심 음질 기준 */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Metric
              label="Integrated LUFS"
              recommended={`${data.integrated_lufs.recommended_min} ~ ${data.integrated_lufs.recommended_max}`}
              ideal={`이상치 ${data.integrated_lufs.ideal_target}`}
              note={data.integrated_lufs.note}
            />
            <Metric
              label="True Peak"
              recommended={`≤ ${data.true_peak_db.recommended_max} dBTP`}
              ideal={`이상치 ≤ ${data.true_peak_db.ideal_max} dBTP`}
              note={data.true_peak_db.note}
            />
            <Metric
              label="Clipping"
              recommended={`${data.clipping_count.recommended_max} 회`}
              ideal={`${data.clipping_count.fail_threshold} 회 이상 시 재작업`}
              note={data.clipping_count.note}
            />
            <Metric
              label="종합 점수 (QC Score)"
              recommended={`≥ ${data.qc_score.recommended_min} / 100`}
              ideal={`우수 ≥ ${data.qc_score.excellent}`}
              note={data.qc_score.note}
            />
          </div>

          {/* 파일 / 길이 */}
          <div className="rounded-xl bg-bg-soft px-3 py-2 ring-1 ring-line/10">
            <p className="font-bold text-ink">파일 / 길이</p>
            <ul className="mt-1 space-y-0.5 text-ink-mute">
              <li>• 포맷: {data.file_format.accepted.join(' / ')} (최대 {data.file_format.max_size_mb}MB)</li>
              <li>• 권장: {data.file_format.preferred}</li>
              <li>
                • 길이: {Math.round(data.duration.recommended_min_seconds / 60)}분 ~{' '}
                {Math.round(data.duration.recommended_max_seconds / 60)}분 권장
              </li>
            </ul>
          </div>

          {/* 자주 반려되는 사유 */}
          <div className="rounded-xl bg-amber-500/5 px-3 py-2 ring-1 ring-amber-500/20">
            <p className="flex items-center gap-1 font-bold text-ink">
              <AlertTriangle size={12} className="text-amber-500" />
              자주 반려되는 사유 + 대응 팁
            </p>
            <ul className="mt-1 space-y-1.5">
              {data.common_rejection_reasons.map((r, i) => (
                <li key={i} className="border-l-2 border-amber-500/40 pl-2">
                  <p className="font-semibold text-ink">{r.reason}</p>
                  <p className="text-ink-mute">{r.tips}</p>
                </li>
              ))}
            </ul>
          </div>

          {/* 일반 팁 */}
          <div className="rounded-xl bg-emerald-500/5 px-3 py-2 ring-1 ring-emerald-500/20">
            <p className="flex items-center gap-1 font-bold text-ink">
              <CheckCircle2 size={12} className="text-emerald-500" /> 통과 확률 높이기
            </p>
            <ul className="mt-1 space-y-0.5 text-ink-mute">
              {data.general_tips.map((t, i) => (<li key={i}>• {t}</li>))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label, recommended, ideal, note,
}: {
  label: string; recommended: string; ideal: string; note: string;
}) {
  return (
    <div className="rounded-xl bg-bg-soft px-3 py-2 ring-1 ring-line/10">
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-bold text-ink">{recommended}</p>
      <p className="text-[10px] text-accent">{ideal}</p>
      <p className="mt-1 text-[10px] leading-snug text-ink-mute">{note}</p>
    </div>
  );
}
