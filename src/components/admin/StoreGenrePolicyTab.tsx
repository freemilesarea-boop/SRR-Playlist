import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Store, ShieldAlert, Play, ExternalLink, Music2 } from 'lucide-react';
import {
  listStoreGenrePolicies,
  storeGenrePolicySummary,
  setStoreGenreRuleEnabled,
  setStoreGenreRulePriority,
  listStoreGenreViolations,
  backfillStoreGenrePolicyReview,
  type StoreGenreRule,
  type StoreGenrePolicySummary,
  type StoreGenreViolation,
  type VocalPolicy,
  type BackfillResult,
} from '@/lib/storeGenrePolicy';
import { toast } from '@/store/toastStore';
import TrackPlacementEditor from '@/components/admin/TrackPlacementEditor';

// 정규화 슬러그 → 한글 라벨
const STORE_KO: Record<string, string> = {
  cafe: '카페', hospital: '병원/클리닉', select_shop: '편집샵', hair_salon: '미용실',
  korean_food: '한식', japanese_food: '일식', chinese_food: '중식', western_food: '양식',
  fine_dining: '파인다이닝', izakaya: '이자카야', pub: '술집/펍', winebar: '와인바',
  gym: '헬스', hotel: '호텔/라운지', office: '사무실', nail_shop: '네일샵',
  studio: '스튜디오', bookstore: '서점', flower_shop: '플라워샵', showroom: '쇼룸',
};
const VOCAL_LABEL: Record<VocalPolicy, string> = {
  vocal: '보컬', instrumental: '연주', vocal_rap: '보컬/랩',
};
const VOCAL_COLOR: Record<VocalPolicy, string> = {
  vocal: 'bg-indigo-500/20 text-indigo-400',
  instrumental: 'bg-emerald-500/20 text-emerald-300',
  vocal_rap: 'bg-fuchsia-500/20 text-fuchsia-400',
};
const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-rose-600 text-white',
  HIGH: 'bg-rose-500/20 text-rose-300',
  MEDIUM: 'bg-amber-500/20 text-amber-300',
  LOW: 'bg-gray-500/20 text-slate-500 dark:text-gray-400',
};

export default function StoreGenrePolicyTab() {
  const [sub, setSub] = useState<'rules' | 'violations'>('rules');
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button onClick={() => setSub('rules')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sub === 'rules' ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
          정책 규칙
        </button>
        <button onClick={() => setSub('violations')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sub === 'violations' ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
          정책 위반 곡
        </button>
      </div>
      {sub === 'rules' ? <RulesInner /> : <ViolationsInner />}
    </div>
  );
}

function RulesInner() {
  const [rules, setRules] = useState<StoreGenreRule[]>([]);
  const [summary, setSummary] = useState<StoreGenrePolicySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storeFilter, setStoreFilter] = useState('');
  const [vocalFilter, setVocalFilter] = useState<VocalPolicy | ''>('');
  const [backfill, setBackfill] = useState<BackfillResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        listStoreGenrePolicies(storeFilter || undefined, vocalFilter || undefined),
        storeGenrePolicySummary(),
      ]);
      setRules(list);
      setSummary(sum);
    } catch (e) {
      toast.error(`정책 로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [storeFilter, vocalFilter]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (rule: StoreGenreRule) => {
    setBusy(true);
    try {
      await setStoreGenreRuleEnabled(rule.id, !rule.is_allowed);
      toast.success(`${rule.genre} ${!rule.is_allowed ? '활성화' : '비활성화'}`);
      await load();
    } catch (e) {
      toast.error(`변경 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const editPriority = async (rule: StoreGenreRule) => {
    const next = prompt(`우선순위 (priority) 수정:`, String(rule.priority));
    if (next == null) return;
    const n = parseInt(next, 10);
    if (Number.isNaN(n)) { toast.error('숫자를 입력하세요'); return; }
    setBusy(true);
    try {
      await setStoreGenreRulePriority(rule.id, n);
      toast.success('priority 저장');
      await load();
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const runRecheck = async (dryRun: boolean) => {
    if (!dryRun && !confirm('전체 등록곡을 정책 기준으로 재검사하여 위반 곡을 review_needed/QC 후보로 올립니다.\n(자동 삭제 없음) 진행할까요?')) return;
    setBusy(true);
    try {
      const r = await backfillStoreGenrePolicyReview(dryRun, 5000);
      setBackfill(r);
      toast.success(dryRun
        ? `Dry-run: ${r.checked_count} 검사 · 위반 ${r.mismatch_count}`
        : `재검사 완료: 위반 ${r.mismatch_count} · review ${r.review_needed_created} · QC ${r.qc_created}`);
    } catch (e) {
      toast.error(`재검사 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  // store_type 별 그룹핑
  const grouped = useMemo(() => {
    const m = new Map<string, StoreGenreRule[]>();
    rules.forEach((r) => {
      const arr = m.get(r.normalized_store_type) ?? [];
      arr.push(r);
      m.set(r.normalized_store_type, arr);
    });
    return Array.from(m.entries());
  }, [rules]);

  const storeOptions = useMemo(() => {
    const keys = Object.keys(summary?.by_store ?? {}).sort();
    return keys;
  }, [summary]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <Store size={15} className="text-accent" /> 매장 장르 정책
          </h3>
          <div className="flex gap-2">
            <button onClick={() => void runRecheck(true)} disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-bg-deep px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
              <Play size={12} /> 재검사 (dry-run)
            </button>
            <button onClick={() => void runRecheck(false)} disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
              <ShieldAlert size={12} /> 정책 기준 재검사
            </button>
          </div>
        </div>
        {summary && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <Stat label="매장 수" v={summary.store_count} />
            <Stat label="정책 rule 수" v={summary.rule_count} />
            <Stat label="활성 rule" v={summary.active_count} />
            <Stat label="비활성" v={summary.rule_count - summary.active_count} />
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-dim">
          매장별 허용 장르/보컬 정책입니다. 비활성(OFF) 규칙은 auto_place_track / 재검사에서 무시됩니다.
          기존 플레이리스트 곡은 자동 삭제되지 않고 위반 시 review_needed + AI 검수 큐 후보로 올라갑니다.
        </p>
      </div>

      {backfill && (
        <div className="rounded-xl bg-bg-card p-3 text-xs">
          <h4 className="mb-1 font-bold">재검사 리포트 {backfill.dry_run && <span className="text-amber-300">(dry-run)</span>}</h4>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="검사" v={backfill.checked_count} />
            <Stat label="정상" v={backfill.matched_count} />
            <Stat label="위반" v={backfill.mismatch_count} color="rose" />
            <Stat label="review 생성" v={backfill.review_needed_created} color="amber" />
            <Stat label="QC 생성" v={backfill.qc_created} color="amber" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(backfill.by_store).map(([k, v]) => (
              <span key={k} className="rounded bg-bg-deep px-1.5 py-0.5">{STORE_KO[k] ?? k}: {v}</span>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {Object.entries(backfill.by_issue_type).map(([k, v]) => (
              <span key={k} className="rounded bg-rose-500/20 px-1.5 py-0.5 text-rose-300">{k}: {v}</span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">모든 매장</option>
          {storeOptions.map((s) => <option key={s} value={s}>{STORE_KO[s] ?? s}</option>)}
        </select>
        <select value={vocalFilter} onChange={(e) => setVocalFilter(e.target.value as VocalPolicy | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">보컬+연주</option>
          <option value="vocal">보컬</option>
          <option value="instrumental">연주</option>
          <option value="vocal_rap">보컬/랩</option>
        </select>
        <button onClick={() => void load()} disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {grouped.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '로딩 중…' : '정책이 없습니다.'}
        </p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([store, list]) => (
            <div key={store} className="rounded-xl bg-bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-sm font-bold">
                  <Music2 size={13} className="text-accent" />
                  {STORE_KO[store] ?? store}
                  <span className="text-[10px] font-normal text-ink-dim">({store})</span>
                </h4>
                <div className="flex items-center gap-1 text-[10px]">
                  {list[0]?.enforcement && (
                    <span className={`rounded px-1.5 py-0.5 font-bold ${list[0].enforcement === 'hard' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}`}>
                      {list[0].enforcement === 'hard' ? 'HARD BLOCK' : 'SOFT'}
                    </span>
                  )}
                  {list[0]?.default_severity && (
                    <span className={`rounded px-1.5 py-0.5 font-bold ${SEVERITY_COLOR[list[0].default_severity] ?? ''}`}>
                      {list[0].default_severity}
                    </span>
                  )}
                  <span className="text-ink-dim">{list.length} rules</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((rule) => (
                  <div key={rule.id}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs ${rule.is_allowed ? 'bg-bg-deep' : 'bg-bg-deep/40 opacity-60'}`}>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{rule.genre}</div>
                      <div className="flex items-center gap-1">
                        <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${VOCAL_COLOR[rule.vocal_policy]}`}>
                          {VOCAL_LABEL[rule.vocal_policy]}
                        </span>
                        <button onClick={() => void editPriority(rule)} disabled={busy}
                          className="text-[9px] text-ink-dim hover:text-ink disabled:opacity-50">
                          p{rule.priority}
                        </button>
                      </div>
                    </div>
                    <button onClick={() => void toggle(rule)} disabled={busy}
                      className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold ${rule.is_allowed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-500/20 text-slate-500 dark:text-gray-400'} disabled:opacity-50`}>
                      {rule.is_allowed ? 'ON' : 'OFF'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ViolationsInner() {
  const [rows, setRows] = useState<StoreGenreViolation[]>([]);
  const [loading, setLoading] = useState(false);
  const [storeFilter, setStoreFilter] = useState('');
  const [issueFilter, setIssueFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [editorTrackId, setEditorTrackId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listStoreGenreViolations({
        storeType: storeFilter || undefined,
        issueType: issueFilter || undefined,
        status: statusFilter,
        limit: 500,
      }));
    } catch (e) {
      toast.error(`위반 목록 로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [storeFilter, issueFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const storeOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.normalized_store_type) set.add(r.normalized_store_type); });
    return Array.from(set).sort();
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="open">open</option>
          <option value="reviewing">reviewing</option>
          <option value="resolved">resolved</option>
          <option value="dismissed">dismissed</option>
          <option value="all">all</option>
        </select>
        <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">모든 이슈</option>
          <option value="unsupported_store_genre">미허용 매장 장르</option>
          <option value="vocal_policy_mismatch">보컬 정책 위반</option>
          <option value="store_genre_policy_mismatch">매장 장르 정책 불일치</option>
        </select>
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">모든 매장</option>
          {storeOptions.map((s) => <option key={s} value={s}>{STORE_KO[s] ?? s}</option>)}
        </select>
        <button onClick={() => void load()} disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '로딩 중…' : '정책 위반 곡이 없습니다. "정책 기준 재검사" 로 후보를 생성하세요.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
                <th className="px-2 py-2">곡</th>
                <th className="px-2 py-2">이슈</th>
                <th className="px-2 py-2">severity</th>
                <th className="px-2 py-2">사유</th>
                <th className="px-2 py-2">상태</th>
                <th className="px-2 py-2">조치</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/10">
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{r.title ?? '(제목없음)'}</div>
                    <div className="text-ink-dim">{r.artist ?? ''}</div>
                    <div className="text-[10px] text-ink-dim/70">{r.main_genre ?? '—'}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="rounded bg-bg-deep px-1.5 py-0.5 text-[10px] font-bold">{r.issue_type}</span>
                    {r.normalized_store_type && (
                      <div className="text-[10px] text-ink-dim">{STORE_KO[r.normalized_store_type] ?? r.normalized_store_type}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${SEVERITY_COLOR[r.severity] ?? ''}`}>
                      {r.severity}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 max-w-xs text-[11px] text-ink-mute">{r.reason}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      r.status === 'open' ? 'bg-rose-500/20 text-rose-300' :
                      r.status === 'reviewing' ? 'bg-amber-500/20 text-amber-300' :
                      r.status === 'resolved' ? 'bg-emerald-500/20 text-emerald-300' :
                      'bg-gray-500/20 text-slate-500 dark:text-gray-400'
                    }`}>{r.status}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => setEditorTrackId(r.track_id)}
                      className="inline-flex items-center gap-1 rounded bg-indigo-500/25 px-2 py-0.5 font-semibold text-indigo-500">
                      <ExternalLink size={10} /> 편집기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorTrackId && (
        <TrackPlacementEditor
          trackId={editorTrackId}
          onClose={() => setEditorTrackId(null)}
          onMutated={() => { void load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, v, color }: { label: string; v: number; color?: string }) {
  const colorMap: Record<string, string> = {
    rose: 'text-rose-300', amber: 'text-amber-300', emerald: 'text-emerald-300',
  };
  return (
    <div className="rounded bg-bg-deep p-2">
      <div className="text-[10px] text-ink-dim">{label}</div>
      <div className={`text-xl font-bold ${color ? colorMap[color] : 'text-blue-500'}`}>{v}</div>
    </div>
  );
}
