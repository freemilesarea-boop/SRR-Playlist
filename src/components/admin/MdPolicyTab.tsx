import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Shield, AlertTriangle, FlaskConical, Mic, MicOff, Lock, CheckCircle2, Trash2, Plus } from 'lucide-react';
import {
  adminMdPolicySummary,
  adminListMdPolicyRules,
  adminListMdPolicyViolations,
  adminBackfillStoreGenrePolicyReview,
  adminSetMdPolicyRuleEnabled,
  adminSetMdPolicyRulePriority,
  adminMdPolicyRuleOptions,
  adminAddMdPolicyRule,
  adminDeleteMdPolicyRule,
  type MdPolicyRuleOptions,
  type MdPolicySummary,
  type MdPolicyRule,
  type MdPolicyViolationRow,
  type MdPolicyDryRunResult,
} from '@/lib/aiCuration';
import {
  adminChangeTrackFitStatus,
  adminRemoveTrackFromPlaylist,
} from '@/lib/adminPlaylistInspectorApi';
import { toast } from '@/store/toastStore';

type ViolationTypeFilter = '' | 'md_policy_no_match' | 'md_policy_undefined_store';
type StatusFilter = '' | 'review_needed' | 'excluded' | 'active' | 'no_fit';

const VIOLATION_LABEL: Record<Exclude<ViolationTypeFilter, ''>, string> = {
  md_policy_no_match: '장르/보컬 불일치',
  md_policy_undefined_store: '정책 미정의 매장',
};

const STATUS_LABEL: Record<Exclude<StatusFilter, ''>, string> = {
  review_needed: '검토필요',
  excluded: '제외(보호)',
  active: '활성',
  no_fit: '미산정',
};

const STATUS_TONE: Record<Exclude<StatusFilter, ''>, string> = {
  review_needed: 'bg-amber-500/25 text-amber-300',
  excluded: 'bg-rose-500/25 text-rose-300',
  active: 'bg-emerald-500/25 text-emerald-300',
  no_fit: 'bg-ink/5 text-ink-dim',
};

function matchStatus(row: MdPolicyViolationRow): Exclude<StatusFilter, ''> {
  if (row.fit_status === 'excluded') return 'excluded';
  if (row.fit_status === 'review_needed') return 'review_needed';
  if (row.fit_status == null) return 'no_fit';
  return 'active';
}

export default function MdPolicyTab() {
  const [summary, setSummary] = useState<MdPolicySummary | null>(null);
  const [rules, setRules] = useState<MdPolicyRule[]>([]);
  const [violations, setViolations] = useState<MdPolicyViolationRow[]>([]);
  const [storeFilter, setStoreFilter] = useState<string>('');
  const [violationFilter, setViolationFilter] = useState<ViolationTypeFilter>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('review_needed');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastDryRun, setLastDryRun] = useState<MdPolicyDryRunResult | null>(null);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [applyConfirmText, setApplyConfirmText] = useState('');
  const [actingKey, setActingKey] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, rs, vs] = await Promise.all([
        adminMdPolicySummary(),
        adminListMdPolicyRules(storeFilter || null),
        adminListMdPolicyViolations(storeFilter || null),
      ]);
      setSummary(sum);
      setRules(rs);
      setViolations(vs);
    } catch (e) {
      toast.error(`MD 정책 로딩 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [storeFilter]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // 규칙 변경 뒤 위반 목록·요약을 다시 계산 (규칙 목록은 바로 반영)
  const [ruleBusyId, setRuleBusyId] = useState<string | null>(null);
  async function toggleRule(r: MdPolicyRule) {
    const next = !r.is_enabled;
    setRuleBusyId(r.id);
    try {
      await adminSetMdPolicyRuleEnabled(r.id, next);
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_enabled: next } : x)));
      toast.success(`${r.store_type} · ${r.genre} 규칙을 ${next ? '켰어요' : '껐어요'}`);
      void loadAll();
    } catch (e) {
      toast.error(`규칙 변경 실패: ${(e as Error).message}`);
    } finally { setRuleBusyId(null); }
  }
  async function deleteRule(r: MdPolicyRule) {
    setRuleBusyId(r.id);
    try {
      await adminDeleteMdPolicyRule(r.id);
      setRules((prev) => prev.filter((x) => x.id !== r.id));
      toast.success(`${r.store_type} · ${r.genre} 규칙을 삭제했어요`);
      void loadAll();
    } catch (e) {
      toast.error(`규칙 삭제 실패: ${(e as Error).message}`);
    } finally { setRuleBusyId(null); }
  }
  async function changePriority(r: MdPolicyRule, priority: number) {
    if (priority === r.priority) return;
    setRuleBusyId(r.id);
    try {
      await adminSetMdPolicyRulePriority(r.id, priority);
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, priority } : x)));
      toast.success(`${r.store_type} · ${r.genre} 우선순위 ${r.priority} → ${priority}`);
      void loadAll();
    } catch (e) {
      toast.error(`우선순위 변경 실패: ${(e as Error).message}`);
    } finally { setRuleBusyId(null); }
  }

  async function reDryRun() {
    setBusy(true);
    try {
      const r = await adminBackfillStoreGenrePolicyReview(true);
      setLastDryRun(r);
      toast.success(`dry_run 완료 — 위반 ${r.violations} / excluded 보호 ${r.excluded_protected}`);
    } catch (e) {
      toast.error(`dry_run 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function approveActive(row: MdPolicyViolationRow) {
    const key = `${row.playlist_id}:${row.track_id}`;
    setActingKey(key);
    try {
      await adminChangeTrackFitStatus(row.playlist_id, row.track_id, 'active',
        `md_policy_approved: ${row.store_slug ?? '-'} / ${row.main_genre ?? '-'}`);
      toast.success(`승인 — ${row.track_title ?? row.track_id.slice(0, 8)} 재생 복구`);
      setViolations((prev) => prev.map((v) =>
        v.playlist_id === row.playlist_id && v.track_id === row.track_id
          ? { ...v, fit_status: 'active', fit_source: 'admin' }
          : v));
    } catch (e) {
      toast.error(`승인 실패: ${(e as Error).message}`);
    } finally { setActingKey(null); }
  }

  async function removeFromPlaylist(row: MdPolicyViolationRow) {
    if (!confirm(`정말 제거하시겠습니까?\n\n${row.track_title ?? ''} · ${row.artist ?? ''}\n→ ${row.playlist_name ?? row.playlist_id.slice(0, 8)}`)) return;
    const key = `${row.playlist_id}:${row.track_id}`;
    setActingKey(key);
    try {
      await adminRemoveTrackFromPlaylist(row.playlist_id, row.track_id,
        `md_policy_removed: ${row.store_slug ?? '-'} / ${row.main_genre ?? '-'}`);
      toast.success(`제거 완료 — ${row.track_title ?? row.track_id.slice(0, 8)}`);
      setViolations((prev) => prev.filter((v) =>
        !(v.playlist_id === row.playlist_id && v.track_id === row.track_id)));
    } catch (e) {
      toast.error(`제거 실패: ${(e as Error).message}`);
    } finally { setActingKey(null); }
  }

  async function applyForReal() {
    if (applyConfirmText.trim() !== 'APPLY') {
      toast.error('확인 문구가 일치하지 않습니다');
      return;
    }
    setBusy(true);
    try {
      const r = await adminBackfillStoreGenrePolicyReview(false);
      setLastDryRun(r);
      setShowApplyConfirm(false);
      setApplyConfirmText('');
      toast.success(`적용 완료 — review_needed 마킹 ${r.marked_review_needed}`);
      await loadAll();
    } catch (e) {
      toast.error(`적용 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  const storeOptions = useMemo(() => {
    if (!summary?.by_store) return [];
    return Object.entries(summary.by_store)
      .sort((a, b) => b[1] - a[1])
      .map(([slug, n]) => ({ slug, n }));
  }, [summary]);

  const filteredViolations = useMemo(() => {
    return violations.filter((v) => {
      if (violationFilter && v.reason !== violationFilter) return false;
      if (statusFilter && matchStatus(v) !== statusFilter) return false;
      return true;
    });
  }, [violations, violationFilter, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<Exclude<StatusFilter, ''>, number> = {
      review_needed: 0, excluded: 0, active: 0, no_fit: 0,
    };
    for (const v of violations) counts[matchStatus(v)]++;
    return counts;
  }, [violations]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1 text-sm font-bold">
            <Shield size={14} /> 매장 장르 정책 (X5.4)
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => void loadAll()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={() => void reDryRun()} disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-amber-500/25 px-2 py-1 font-bold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50">
              <FlaskConical size={11} /> dry_run 재검사
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          MD 시드 정책(195 규칙 × 20 매장) 기반 매장별 허용 장르/보컬 검증.
          <b className="ml-1 text-amber-300">review_needed</b> 마킹 시 사업자 재생 큐에서 자동 숨김 (0274).
          <b className="ml-1 text-rose-300">excluded</b> 보호 유지. <b>승인</b> = active 복구, <b>제거</b> = 플리에서 soft delete.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={`켜진 규칙 (전체 ${summary.total_rules})`} v={summary.enabled_rules ?? summary.total_rules} />
          <Stat label="매장 수" v={summary.distinct_stores} />
          <Stat label="vocal" v={summary.by_vocal_policy?.vocal ?? 0} icon={Mic} />
          <Stat label="instrumental" v={summary.by_vocal_policy?.instrumental ?? 0} icon={MicOff} />
        </div>
      )}

      {lastDryRun && (
        <div className="rounded-xl bg-bg-card p-3 text-xs ring-1 ring-amber-500/50">
          <div className="mb-2 flex items-center gap-2 font-bold">
            <FlaskConical size={12} className="text-amber-300" />
            마지막 {lastDryRun.dry_run ? 'dry_run' : '적용'} 결과
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <KV label="scanned" v={lastDryRun.total_playlist_tracks_scanned} />
            <KV label="with_policy" v={lastDryRun.with_policy_defined} />
            <KV label="violations" v={lastDryRun.violations} tone="text-rose-300" />
            <KV label="admin_protected" v={lastDryRun.admin_overrides_protected} />
            <KV label="excluded_protected" v={lastDryRun.excluded_protected} tone="text-rose-300" />
            <KV label="marked" v={lastDryRun.marked_review_needed} tone="text-amber-300" />
          </div>
          <p className="mt-1 text-[10px] text-ink-dim">{lastDryRun.note}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <span className="font-bold">매장:</span>
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체</option>
          {storeOptions.map(({ slug, n }) => (
            <option key={slug} value={slug}>{slug} ({n})</option>
          ))}
        </select>
        <span className="font-bold">위반 유형:</span>
        <select value={violationFilter} onChange={(e) => setViolationFilter(e.target.value as ViolationTypeFilter)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체</option>
          <option value="md_policy_no_match">{VIOLATION_LABEL.md_policy_no_match}</option>
          <option value="md_policy_undefined_store">{VIOLATION_LABEL.md_policy_undefined_store}</option>
        </select>
        <span className="font-bold">상태:</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체 ({violations.length})</option>
          <option value="review_needed">{STATUS_LABEL.review_needed} ({statusCounts.review_needed})</option>
          <option value="excluded">{STATUS_LABEL.excluded} ({statusCounts.excluded})</option>
          <option value="active">{STATUS_LABEL.active} ({statusCounts.active})</option>
          <option value="no_fit">{STATUS_LABEL.no_fit} ({statusCounts.no_fit})</option>
        </select>
        <span className="text-ink-dim">{filteredViolations.length} 행</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[380px_1fr]">
        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 flex items-center gap-1 text-xs font-bold">
            <Shield size={11} /> 매장별 규칙
            {storeFilter && <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">{storeFilter}</span>}
          </h4>
          <p className="mb-2 text-[10px] text-ink-dim">
            끈 규칙은 판정에서 빠져요. 우선순위 숫자가 낮을수록 먼저 적용돼요 (1~100).
          </p>
          <AddRuleForm defaultStore={storeFilter} onAdded={() => void loadAll()} />
          {rules.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-ink-dim">
              {loading ? '로딩 중…' : '규칙 없음'}
            </p>
          ) : (
            <ul className="max-h-[480px] space-y-1 overflow-y-auto text-[11px]">
              {rules.map((r) => (
                <RuleRow key={r.id} rule={r} showStore={!storeFilter}
                  busy={ruleBusyId === r.id}
                  onToggle={() => void toggleRule(r)}
                  onDelete={() => void deleteRule(r)}
                  onPriority={(p) => void changePriority(r, p)} />
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 flex items-center gap-1 text-xs font-bold">
            <AlertTriangle size={11} className="text-amber-300" /> 위반 곡
            <span className="text-ink-dim font-normal">({filteredViolations.length}/{violations.length})</span>
          </h4>
          {filteredViolations.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-ink-dim">
              {loading ? '로딩 중…' : '필터 조건 해당 곡 없음'}
            </p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-bg-card text-ink-dim">
                  <tr className="border-b border-line/10">
                    <th className="px-1.5 py-1">상태</th>
                    <th className="px-1.5 py-1">플레이리스트</th>
                    <th className="px-1.5 py-1">곡 / 아티스트</th>
                    <th className="px-1.5 py-1">장르</th>
                    <th className="px-1.5 py-1">매장</th>
                    <th className="px-1.5 py-1">사유</th>
                    <th className="px-1.5 py-1 text-right">fit</th>
                    <th className="px-1.5 py-1 text-right">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredViolations.map((v) => {
                    const st = matchStatus(v);
                    const key = `${v.playlist_id}:${v.track_id}`;
                    const acting = actingKey === key;
                    const isExcluded = st === 'excluded';
                    return (
                      <tr key={key} className="border-b border-line/5">
                        <td className="px-1.5 py-1">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[st]}`}>
                            {STATUS_LABEL[st]}
                          </span>
                        </td>
                        <td className="px-1.5 py-1 max-w-[140px] truncate" title={v.playlist_name ?? ''}>
                          {v.playlist_name ?? '—'}
                        </td>
                        <td className="px-1.5 py-1 max-w-[200px]">
                          <div className="truncate font-semibold" title={v.track_title ?? ''}>
                            {v.track_title ?? '(제목없음)'}
                          </div>
                          <div className="truncate text-ink-dim" title={v.artist ?? ''}>
                            {v.artist ?? '—'}
                          </div>
                        </td>
                        <td className="px-1.5 py-1">
                          <span className="flex items-center gap-1">
                            <span className="font-mono">{v.main_genre ?? '—'}</span>
                            {v.instrumental
                              ? <MicOff size={9} className="text-violet-400" />
                              : <Mic size={9} className="text-sky-300" />}
                          </span>
                        </td>
                        <td className="px-1.5 py-1 font-mono">{v.store_slug ?? '—'}</td>
                        <td className="px-1.5 py-1 text-ink-dim">
                          {v.reason
                            ? (VIOLATION_LABEL[v.reason as Exclude<ViolationTypeFilter, ''>] ?? v.reason)
                            : '—'}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums">
                          {v.fit_score != null ? v.fit_score : '—'}
                          {v.fit_source === 'admin' && <Lock size={9} className="ml-0.5 inline text-amber-300" />}
                        </td>
                        <td className="px-1.5 py-1 text-right">
                          <div className="inline-flex gap-1">
                            <button onClick={() => void approveActive(v)}
                              disabled={acting || isExcluded || st === 'active'}
                              title={isExcluded ? 'excluded 보호 — 변경 불가' : 'active 로 복구 (재생 노출)'}
                              className="inline-flex items-center gap-0.5 rounded bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-30">
                              <CheckCircle2 size={10} /> 승인
                            </button>
                            <button onClick={() => void removeFromPlaylist(v)}
                              disabled={acting}
                              title="플레이리스트에서 제거 (soft delete)"
                              className="inline-flex items-center gap-0.5 rounded bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/25 disabled:opacity-30">
                              <Trash2 size={10} /> 제거
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <details className="rounded-xl bg-bg-card p-3 text-xs">
        <summary className="cursor-pointer font-bold text-rose-300">
          위험: 실제 적용 (p_dry_run=false)
        </summary>
        <div className="mt-2 space-y-2">
          <p className="rounded bg-rose-500/20 p-2 text-[11px] text-rose-300">
            <b>주의:</b> p_dry_run=false 는 이미 실행되었습니다. 다시 실행하면 중복 마킹/예상치 못한 상태 변경이 발생할 수 있습니다.
            excluded 13건과 admin 오버라이드는 보호되지만, 신규 위반 곡이 review_needed 로 추가 마킹됩니다.
            <br />
            계속하려면 아래에 <b>APPLY</b> 를 입력하세요.
          </p>
          {!showApplyConfirm ? (
            <button onClick={() => setShowApplyConfirm(true)}
              className="rounded bg-rose-500/20 px-3 py-1.5 text-[11px] font-bold text-rose-300 hover:bg-rose-500/30">
              실제 적용 단계 열기
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input value={applyConfirmText} onChange={(e) => setApplyConfirmText(e.target.value)}
                placeholder="APPLY 입력"
                className="rounded bg-bg-deep px-2 py-1 font-mono text-[11px]" />
              <button onClick={() => void applyForReal()} disabled={busy || applyConfirmText.trim() !== 'APPLY'}
                className="rounded bg-rose-500 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">
                실행
              </button>
              <button onClick={() => { setShowApplyConfirm(false); setApplyConfirmText(''); }}
                disabled={busy}
                className="rounded bg-bg-deep px-3 py-1.5 text-[11px]">
                취소
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function AddRuleForm({ defaultStore, onAdded }: { defaultStore: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<MdPolicyRuleOptions | null>(null);
  const [storeType, setStoreType] = useState(defaultStore);
  const [genre, setGenre] = useState('');
  const [vocalPolicy, setVocalPolicy] = useState<'vocal' | 'instrumental'>('vocal');
  const [isAllowed, setIsAllowed] = useState(true);
  const [priority, setPriority] = useState('50');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setStoreType(defaultStore); }, [defaultStore]);
  useEffect(() => {
    if (!open || options) return;
    adminMdPolicyRuleOptions()
      .then(setOptions)
      .catch((e) => toast.error(`후보 불러오기 실패: ${(e as Error).message}`));
  }, [open, options]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = Number(priority);
    if (!storeType) { toast.error('매장 종류를 골라 주세요'); return; }
    if (!genre.trim()) { toast.error('장르를 입력해 주세요'); return; }
    if (!Number.isInteger(p) || p < 1 || p > 100) { toast.error('우선순위는 1~100 사이 숫자로 넣어 주세요'); return; }
    setSaving(true);
    try {
      await adminAddMdPolicyRule({ storeType, genre: genre.trim(), vocalPolicy, isAllowed, priority: p });
      toast.success(`${storeType} · ${genre.trim()} 규칙을 추가했어요`);
      setGenre('');
      onAdded();
    } catch (err) {
      toast.error(`규칙 추가 실패: ${(err as Error).message}`);
    } finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mb-2 inline-flex items-center gap-1 rounded bg-accent/20 px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/30">
        <Plus size={11} /> 규칙 추가
      </button>
    );
  }
  const field = 'rounded bg-bg-deep px-1.5 py-1';
  return (
    <form onSubmit={(e) => void submit(e)} className="mb-2 grid grid-cols-2 gap-1.5 rounded bg-bg-deep/60 p-2 text-[11px]">
      <label className="flex flex-col gap-0.5">
        <span className="text-ink-dim">매장 종류</span>
        <select value={storeType} onChange={(e) => setStoreType(e.target.value)} className={field} required>
          <option value="">선택</option>
          {(options?.store_types ?? (defaultStore ? [defaultStore] : [])).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-ink-dim">장르</span>
        <input value={genre} onChange={(e) => setGenre(e.target.value)} list="md-policy-genres"
          placeholder="예: indie_pop" className={field} required />
        <datalist id="md-policy-genres">
          {(options?.genres ?? []).map((g) => <option key={g} value={g} />)}
        </datalist>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-ink-dim">보컬</span>
        <select value={vocalPolicy} onChange={(e) => setVocalPolicy(e.target.value as 'vocal' | 'instrumental')} className={field}>
          <option value="vocal">보컬 있음 (vocal)</option>
          <option value="instrumental">연주곡 (instrumental)</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-ink-dim">허용 / 차단</span>
        <select value={isAllowed ? 'allow' : 'block'} onChange={(e) => setIsAllowed(e.target.value === 'allow')} className={field}>
          <option value="allow">허용</option>
          <option value="block">차단</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-ink-dim">우선순위 (낮을수록 먼저)</span>
        <input type="number" min={1} max={100} value={priority} onChange={(e) => setPriority(e.target.value)}
          className={`${field} tabular-nums`} />
      </label>
      <div className="flex items-end gap-1">
        <button type="submit" disabled={saving}
          className="flex-1 rounded bg-accent px-2 py-1 font-bold text-white disabled:opacity-50">
          {saving ? '추가 중…' : '추가'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded bg-ink/5 px-2 py-1 text-ink-dim">
          닫기
        </button>
      </div>
    </form>
  );
}

function RuleRow({ rule: r, showStore, busy, onToggle, onPriority, onDelete }: {
  rule: MdPolicyRule;
  showStore: boolean;
  busy: boolean;
  onToggle: () => void;
  onPriority: (p: number) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirming]);
  const [draft, setDraft] = useState(String(r.priority));
  useEffect(() => { setDraft(String(r.priority)); }, [r.priority]);
  function commit() {
    const n = Number(draft);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      toast.error('우선순위는 1~100 사이 숫자로 넣어 주세요');
      setDraft(String(r.priority));
      return;
    }
    onPriority(n);
  }
  return (
    <li className={`flex items-center justify-between gap-1 rounded bg-bg-deep px-2 py-1 ${r.is_enabled ? '' : 'opacity-50'}`}>
      <span className="flex min-w-0 items-center gap-1.5">
        {showStore && <span className="font-mono text-ink-dim">{r.store_type}</span>}
        <span className={`truncate font-bold ${r.is_enabled ? '' : 'line-through'}`}>{r.genre}</span>
        {r.vocal_policy === 'vocal'
          ? <Mic size={10} className="shrink-0 text-sky-300" />
          : <MicOff size={10} className="shrink-0 text-violet-400" />}
        {!r.is_allowed && (
          <span className="shrink-0 rounded bg-rose-500/25 px-1 py-0.5 text-[9px] font-bold text-rose-300">차단</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <input type="number" min={1} max={100} value={draft} disabled={busy}
          aria-label={`${r.store_type} ${r.genre} 우선순위`}
          title="우선순위 — 낮을수록 먼저 적용"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-11 rounded bg-bg-card px-1 py-0.5 text-right tabular-nums" />
        <button type="button" onClick={onToggle} disabled={busy}
          aria-pressed={r.is_enabled}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-40 ${
            r.is_enabled ? 'bg-emerald-500/25 text-emerald-300' : 'bg-ink/5 text-ink-dim'}`}>
          {r.is_enabled ? '켜짐' : '꺼짐'}
        </button>
        {confirming ? (
          <button type="button" onClick={() => { setConfirming(false); onDelete(); }} disabled={busy}
            className="rounded bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 disabled:opacity-40">
            삭제?
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} disabled={busy}
            aria-label={`${r.store_type} ${r.genre} 규칙 삭제`} title="규칙 삭제"
            className="rounded px-1 py-0.5 text-ink-dim hover:text-rose-300 disabled:opacity-40">
            <Trash2 size={11} />
          </button>
        )}
      </span>
    </li>
  );
}

function Stat({ label, v, icon: Icon }: { label: string; v: number; icon?: typeof Mic }) {
  return (
    <div className="rounded-lg bg-bg-card p-3 text-center ring-1 ring-line/10">
      <div className="flex items-center justify-center gap-1 text-lg font-extrabold tabular-nums">
        {Icon && <Icon size={14} className="text-ink-mute" />}
        {v}
      </div>
      <div className="text-[10px] text-ink-mute">{label}</div>
    </div>
  );
}

function KV({ label, v, tone }: { label: string; v: number; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-1 rounded bg-bg-deep px-2 py-1">
      <span className="text-ink-dim">{label}</span>
      <span className={`font-bold tabular-nums ${tone ?? ''}`}>{v}</span>
    </div>
  );
}
