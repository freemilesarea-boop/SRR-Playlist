import { useEffect, useState } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { fetchMetadataTrainingStats, type MetadataTrainingStats } from '@/lib/metadataTraining';

const CORRECTION_LABEL: Record<string, string> = {
  ai_correct: 'AI 정답',
  ai_wrong: 'AI 오답(유저 정답)',
  user_wrong: '유저 오답',
  both_wrong: '둘 다 오답',
  admin_override: '관리자 신규분류',
};

export default function MetadataTrainingPanel() {
  const [days, setDays] = useState(90);
  const [stats, setStats] = useState<MetadataTrainingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    fetchMetadataTrainingStats(days)
      .then((s) => { if (alive) setStats(s); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <Brain size={15} className="text-accent" /> 메타데이터 학습 데이터
        </h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input w-auto text-xs">
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
          <option value={90}>최근 90일</option>
          <option value={365}>최근 1년</option>
        </select>
      </header>
      <p className="text-[11px] leading-relaxed text-ink-mute">
        업로더 입력값 · AI 예측값 · 관리자 최종 확정값(정답)을 비교해 누적합니다. 관리자가 메타를 수정/확정할 때 자동 기록되며,
        모델 자동 변경은 하지 않고 향후 가중치 보정(관리자 승인)에 사용합니다.
      </p>

      {loading && <div className="flex items-center gap-2 text-xs text-ink-mute"><Loader2 size={14} className="animate-spin" /> 불러오는 중…</div>}
      {err && <div className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-600 ring-1 ring-rose-400/20">{err}</div>}

      {stats && !loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="총 학습 예시" value={stats.total_examples} />
            <Stat label="AI 평가 대상" value={stats.ai_evaluated} />
            <Stat label="AI 정답률" value={stats.ai_accuracy != null ? `${stats.ai_accuracy}%` : '—'} accent />
            <Stat label="기간(일)" value={stats.window_days} />
          </div>

          <Section title="유형별 분포">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.by_correction_type ?? {}).map(([k, v]) => (
                <span key={k} className="rounded-full bg-bg-soft px-2.5 py-1 text-[11px] ring-1 ring-line/10">
                  {CORRECTION_LABEL[k] ?? k}: <b>{v}</b>
                </span>
              ))}
              {Object.keys(stats.by_correction_type ?? {}).length === 0 && <Empty />}
            </div>
          </Section>

          <Section title="매장별 AI 오답률 (관리자 최종 기준)">
            <BarList items={(stats.ai_wrong_by_store ?? []).map((s) => ({ label: s.store, sub: `${s.wrong}/${s.total}`, rate: s.wrong_rate ?? 0 }))} />
          </Section>

          <Section title="장르별 AI 오답">
            <BarList items={(stats.ai_wrong_by_genre ?? []).map((g) => ({ label: g.genre, sub: `${g.wrong}/${g.total}`, rate: g.total ? Math.round((100 * g.wrong) / g.total) : 0 }))} />
          </Section>

          <Section title="AI가 자주 틀리는 패턴 (AI 예측 → 관리자 최종)">
            {(stats.frequent_ai_miss ?? []).length === 0 ? <Empty /> : (
              <ul className="space-y-1 text-[11px]">
                {stats.frequent_ai_miss.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600">{m.ai || '(없음)'}</span>
                    <span className="text-ink-dim">→</span>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600">{m.admin || '(없음)'}</span>
                    <span className="ml-auto font-mono text-ink-dim">{m.n}건</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="업로더 과장 태그 빈도 (user_wrong)">
            {(stats.uploader_user_wrong ?? []).length === 0 ? <Empty /> : (
              <ul className="space-y-1 text-[11px]">
                {stats.uploader_user_wrong.map((u) => (
                  <li key={u.owner_user_id} className="flex items-center gap-2">
                    <span className="font-mono text-ink-dim">{u.owner_user_id.slice(0, 8)}…</span>
                    <span className="ml-auto">오답 <b className="text-rose-600">{u.user_wrong}</b> / {u.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-bg-soft/60 p-3 ring-1 ring-line/10">
      <div className="text-[10px] uppercase tracking-wide text-ink-dim">{label}</div>
      <div className={`text-lg font-extrabold ${accent ? 'text-accent' : ''}`}>{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <h3 className="mb-2 text-xs font-semibold text-ink-mute">{title}</h3>
      {children}
    </section>
  );
}
function BarList({ items }: { items: Array<{ label: string; sub: string; rate: number }> }) {
  if (items.length === 0) return <Empty />;
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-2 text-[11px]">
          <span className="w-28 shrink-0 truncate">{it.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-bg-soft">
            <div className="h-full bg-rose-400/70" style={{ width: `${Math.min(100, it.rate)}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-ink-dim">{it.rate}% ({it.sub})</span>
        </li>
      ))}
    </ul>
  );
}
function Empty() {
  return <p className="text-[11px] text-ink-dim">아직 데이터가 없어요.</p>;
}
