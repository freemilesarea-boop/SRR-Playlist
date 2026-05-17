import { useCallback, useEffect, useState } from 'react';
import { ScrollText, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle, Info, Trash2 } from 'lucide-react';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  fetchAdminOperationLogs,
  fetchAdminOperationLogKpi,
  clearOldAdminOperationLogs,
  type AdminOperationLog,
  type OperationLogKpi,
  type LogLevel,
  type LogCategory,
} from '@/lib/adminLogsApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

const LEVEL_META: Record<LogLevel, { label: string; tone: string; icon: React.ReactNode }> = {
  info: { label: 'info', tone: 'bg-ink/10 text-ink-mute', icon: <Info size={11} /> },
  success: { label: 'success', tone: 'bg-emerald-500/15 text-emerald-300', icon: <CheckCircle2 size={11} /> },
  warning: { label: 'warning', tone: 'bg-yellow-500/15 text-yellow-200', icon: <AlertTriangle size={11} /> },
  error: { label: 'error', tone: 'bg-red-500/15 text-red-300', icon: <AlertCircle size={11} /> },
};

const CATEGORIES: Array<LogCategory | 'all'> = ['all', 'payment', 'webhook', 'analytics', 'member', 'system', 'rpc'];
const LEVELS: Array<LogLevel | 'all'> = ['all', 'info', 'success', 'warning', 'error'];

export default function AdminOperationLogs() {
  const [rows, setRows] = useState<AdminOperationLog[]>([]);
  const [kpi, setKpi] = useState<OperationLogKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<LogCategory | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState('');
  const [searchText, setSearchText] = useState('');

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [logs, kpiRes] = await Promise.all([
        fetchAdminOperationLogs({
          limit: 200,
          level: levelFilter === 'all' ? null : levelFilter,
          category: categoryFilter === 'all' ? null : categoryFilter,
          source: sourceFilter.trim() || null,
          search: searchText.trim() || null,
        }),
        fetchAdminOperationLogKpi(),
      ]);
      setRows(logs.rows);
      if (logs.error) setLoadError(logs.error);
      setKpi(kpiRes.kpi);
    } finally {
      setLoading(false);
    }
  }, [levelFilter, categoryFilter, sourceFilter, searchText]);

  useFreshFetch(load, [levelFilter, categoryFilter]);
  useEffect(() => {
    // 검색/source 변경 시 디바운스
    const t = window.setTimeout(load, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter, searchText]);

  async function onClearOld() {
    if (!window.confirm('30일 이상 지난 운영 로그를 삭제할까요? 되돌릴 수 없어요.')) return;
    const res = await clearOldAdminOperationLogs(30);
    if (!res.ok) {
      toast.error(res.error ?? '정리 실패');
      return;
    }
    toast.success(`${res.deleted ?? 0}건 정리됨`);
    await load();
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <ScrollText size={16} className="text-accent" /> 운영 로그
          </h2>
          <p className="text-xs text-ink-mute">
            Edge Function / Webhook / 결제 / 분석 / RPC 작업 결과를 누적 기록.
          </p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md bg-bg-card px-2 py-1 text-[11px] text-ink-mute hover:bg-bg-hover"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
          <button
            onClick={onClearOld}
            className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/20"
          >
            <Trash2 size={11} /> 30일 이전 정리
          </button>
        </div>
      </div>

      {loadError && (
        <Alert tone="error" title="로그 RPC 호출 실패">
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] opacity-90">
            {loadError}
          </pre>
          <p className="mt-1 text-[11px] opacity-80">
            0041 마이그레이션이 운영 DB 에 적용되지 않았을 수 있어요. 워크플로 실행 후 재시도.
          </p>
        </Alert>
      )}

      {/* KPI 4종 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="error (24h)" value={kpi?.errors_24h ?? 0} tone="text-red-300" />
        <Kpi label="warning (24h)" value={kpi?.warnings_24h ?? 0} tone="text-yellow-300" />
        <Kpi label="success (24h)" value={kpi?.success_24h ?? 0} tone="text-emerald-300" />
        <Kpi label="payment (24h)" value={kpi?.payment_24h ?? 0} tone="text-accent" />
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-2 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink-dim">level</span>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'all')}
            className="rounded bg-bg-soft px-2 py-1 text-xs"
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink-dim">category</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as LogCategory | 'all')}
            className="rounded bg-bg-soft px-2 py-1 text-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <input
          type="text"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          placeholder="source (e.g. payapp-feedback)"
          className="input h-7 flex-1 min-w-[180px] text-xs"
        />
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="message / related_id / details 검색"
          className="input h-7 flex-1 min-w-[180px] text-xs"
        />
      </div>

      {/* 로그 목록 */}
      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        {loading ? (
          <div className="p-8 text-center text-xs text-ink-mute">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-mute">
            조건에 맞는 로그가 없어요. (필터를 조정하거나 작업을 실행해보세요)
          </div>
        ) : (
          <ul className="divide-y divide-line/10">
            {rows.map((r) => {
              const meta = LEVEL_META[r.level] ?? LEVEL_META.info;
              const isOpen = expanded.has(r.id);
              return (
                <li key={r.id} className="p-3 text-xs">
                  <div className="flex flex-wrap items-start gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}
                    >
                      {meta.icon}
                      {meta.label}
                    </span>
                    <span className="inline-flex rounded-full bg-ink/5 px-2 py-0.5 text-[10px] text-ink-mute">
                      {r.category}
                    </span>
                    <span className="font-mono text-[11px] text-ink-mute">{r.source}</span>
                    <span className="text-[11px] text-ink-mute">· {r.status}</span>
                    {r.related_id && (
                      <span className="ml-auto font-mono text-[10px] text-ink-dim">
                        ref: {r.related_id}
                      </span>
                    )}
                    {r.duration_ms != null && (
                      <span className="text-[10px] text-ink-dim">{r.duration_ms}ms</span>
                    )}
                    <span className="text-[10px] text-ink-dim">
                      {new Date(r.created_at).toLocaleString('ko-KR')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink">{r.message}</p>
                  {r.error_message && (
                    <p className="mt-1 rounded bg-red-100 px-2 py-1 font-mono text-[11px] text-red-800 dark:bg-red-500/10 dark:text-red-300">
                      {r.error_code && <span className="font-bold">[{r.error_code}]</span>}{' '}
                      {r.error_message}
                    </p>
                  )}
                  {(r.user_email || (r.details && Object.keys(r.details).length > 0)) && (
                    <button
                      onClick={() => toggleExpand(r.id)}
                      className="mt-1 text-[10px] text-ink-mute hover:text-ink"
                    >
                      {isOpen ? '▼ 상세 닫기' : '▶ 상세 보기'}
                    </button>
                  )}
                  {isOpen && (
                    <div className="mt-2 space-y-1 rounded bg-bg-deep/60 p-2">
                      {r.user_email && (
                        <p className="text-[11px] text-ink-mute">user: {r.user_email}</p>
                      )}
                      {r.details && Object.keys(r.details).length > 0 && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-mute">
                          {JSON.stringify(r.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">{label}</p>
      <p className={`mt-0.5 text-xl font-extrabold tabular-nums ${tone}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
