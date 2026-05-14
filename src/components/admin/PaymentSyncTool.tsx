import { useCallback, useState } from 'react';
import {
  CreditCard,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Search,
  Link2,
} from 'lucide-react';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  adminSyncPayappPayment,
  listManualPaymentImports,
  syncPayappPaymentsAuto,
  searchUsersForLink,
  linkUnmatchedImport,
  listRecentSyncAttempts,
  listRecentWebhookEvents,
  type AdminSyncPaymentResult,
  type AutoSyncSummary,
  type ManualPaymentImportRow,
  type UserSearchRow,
  type SyncAttemptRow,
  type WebhookEventRow,
} from '@/lib/subscriptionApi';
import { toast } from '@/store/toastStore';

const STATUS_LABEL: Record<string, { label: string; tone: string; icon: React.ReactNode }> = {
  matched: { label: '연결 완료', tone: 'bg-emerald-500/15 text-emerald-300', icon: <CheckCircle2 size={11} /> },
  unmatched: { label: '미매칭', tone: 'bg-yellow-500/15 text-yellow-200', icon: <Clock size={11} /> },
  failed: { label: '실패', tone: 'bg-red-500/15 text-red-300', icon: <XCircle size={11} /> },
};

const PLAN_PRICE: Record<'individual' | 'business', number> = {
  individual: 4900,
  business: 6900,
};

function maskAccount(num: string | null): string {
  if (!num) return '—';
  const cleaned = num.replace(/\s+/g, '');
  if (cleaned.length <= 6) return cleaned;
  return `${cleaned.slice(0, 3)}${'*'.repeat(Math.max(cleaned.length - 6, 1))}${cleaned.slice(-3)}`;
}

function ymdKst(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}
function daysAgoKst(days: number): string {
  return ymdKst(new Date(Date.now() - days * 24 * 3600 * 1000));
}

export default function PaymentSyncTool() {
  const [rows, setRows] = useState<ManualPaymentImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);

  // 자동 동기화 상태
  const [autoBusy, setAutoBusy] = useState(false);
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('30d');
  const [autoResult, setAutoResult] = useState<AutoSyncSummary | null>(null);

  // 진단: 최근 sync attempts + webhook events + RPC 에러
  const [attempts, setAttempts] = useState<SyncAttemptRow[]>([]);
  const [webhookRows, setWebhookRows] = useState<WebhookEventRow[]>([]);
  const [webhookSearch, setWebhookSearch] = useState('');
  const [rpcErrors, setRpcErrors] = useState<Array<{ name: string; message: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [imports, attemptsList, webhooks] = await Promise.all([
        listManualPaymentImports(100),
        listRecentSyncAttempts(20),
        listRecentWebhookEvents({ minutes: 1440, limit: 30 }),
      ]);
      setRows(imports.rows);
      setAttempts(attemptsList.rows);
      setWebhookRows(webhooks.rows);
      const errs: Array<{ name: string; message: string }> = [];
      if (imports.error) errs.push({ name: 'list_manual_payment_imports', message: imports.error });
      if (attemptsList.error) errs.push({ name: 'list_recent_sync_attempts', message: attemptsList.error });
      if (webhooks.error) errs.push({ name: 'list_recent_webhook_events', message: webhooks.error });
      setRpcErrors(errs);
    } finally {
      setLoading(false);
    }
  }, []);
  useFreshFetch(load, []);

  async function onSearchWebhook() {
    if (webhookSearch.trim().length < 3) {
      toast.error('3글자 이상 입력해주세요 (mul_no / order_no / 일부 텍스트)');
      return;
    }
    const res = await listRecentWebhookEvents({
      search: webhookSearch.trim(),
      minutes: 60 * 24 * 7,
      limit: 30,
    });
    setWebhookRows(res.rows);
    if (res.error) toast.error('검색 실패: ' + res.error);
  }

  async function onAutoSync() {
    if (!window.confirm('PayApp 결제내역을 자동으로 조회하고 동기화합니다. 진행할까요?')) return;
    setAutoBusy(true);
    setAutoResult(null);
    try {
      const dateFrom =
        period === 'today' ? daysAgoKst(0) : period === '7d' ? daysAgoKst(7) : daysAgoKst(30);
      const dateTo = daysAgoKst(0);
      const res = await syncPayappPaymentsAuto({ date_from: dateFrom, date_to: dateTo });
      setAutoResult(res);
      if (res.ok) {
        toast.success(
          `완료 — 조회 ${res.fetched ?? 0} · 매칭 ${res.matched ?? 0} · 미매칭 ${res.unmatched ?? 0} · 기존 ${res.already_synced ?? 0} · 실패 ${res.failed ?? 0}`,
        );
        await load();
      } else {
        toast.error(res.error ?? '자동 동기화 실패');
      }
    } finally {
      setAutoBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <CreditCard size={16} className="text-accent" /> 결제 동기화
        </h2>
        <p className="text-xs text-ink-mute">
          PayApp 결제내역을 자동 조회하고 매칭. webhook 누락 시 보완 용도.
        </p>
      </div>

      {/* RPC 호출 실패 배너 — 마이그레이션 누락 진단용 */}
      {rpcErrors.length > 0 && (
        <div className="rounded-2xl bg-red-500/10 p-3 ring-1 ring-red-500/30">
          <p className="text-xs font-bold text-red-200">
            ⚠️ 진단용 RPC 가 실패했어요 ({rpcErrors.length}건)
          </p>
          <p className="mt-1 text-[11px] text-red-100/85">
            DB 마이그레이션(0026/0027/0028) 이 운영 DB 에 적용되지 않았을 수 있습니다. GitHub Actions
            의 "DB · 추천 메타데이터 시드 적용" 워크플로를 실행해주세요.
          </p>
          <ul className="mt-2 space-y-0.5 text-[11px] text-red-100/85">
            {rpcErrors.map((e, i) => (
              <li key={i} className="font-mono">
                {e.name}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* === 자동 동기화 === */}
      <section className="space-y-3 rounded-2xl bg-gradient-to-br from-accent/10 to-accent-soft/5 p-4 ring-1 ring-accent/20">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
            <Zap size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold">PayApp 결제내역 자동 동기화</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-mute">
              PayApp API 로 결제완료 건을 조회 → 우리 DB 와 자동 매칭 → users / subscriptions /
              payment_orders 적용. 중복 실행해도 멱등.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-ink-mute">기간:</span>
          {([
            ['today', '오늘'],
            ['7d', '최근 7일'],
            ['30d', '최근 30일'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                period === k
                  ? 'bg-accent text-bg'
                  : 'bg-bg-card text-ink-mute ring-1 ring-line/15 hover:bg-bg-hover'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={onAutoSync}
          disabled={autoBusy}
          className="btn-primary w-full py-3 text-sm font-bold"
        >
          {autoBusy ? '조회/동기화 중…' : 'PayApp 결제내역 자동 동기화'}
        </button>

        {autoResult && (
          <div
            className={`rounded-xl p-3 ring-1 ${
              autoResult.ok
                ? 'bg-bg-deep/60 ring-line/15'
                : 'bg-red-500/10 ring-red-500/30'
            }`}
          >
            {autoResult.ok ? (
              <>
                <p className="mb-2 text-[11px] text-ink-mute">
                  기간: {autoResult.date_from} ~ {autoResult.date_to}
                  {autoResult.success_cmd && (
                    <> · 성공한 cmd: <span className="font-mono text-emerald-300">{autoResult.success_cmd}</span></>
                  )}
                </p>
                <div className="grid grid-cols-5 gap-1.5">
                  <Stat label="조회" value={autoResult.fetched ?? 0} tone="text-ink" />
                  <Stat label="신규 매칭" value={autoResult.matched ?? 0} tone="text-emerald-300" />
                  <Stat label="미매칭" value={autoResult.unmatched ?? 0} tone="text-yellow-300" />
                  <Stat label="기존 동기화" value={autoResult.already_synced ?? 0} tone="text-ink-mute" />
                  <Stat label="실패" value={autoResult.failed ?? 0} tone="text-red-300" />
                </div>
                {autoResult.hint && (
                  <p className="mt-2 rounded bg-yellow-500/10 px-2 py-1.5 text-[11px] text-yellow-200">
                    💡 {autoResult.hint}
                  </p>
                )}
                {(autoResult.errors?.length ?? 0) > 0 && (
                  <details className="mt-3 text-[11px]">
                    <summary className="cursor-pointer text-red-300">오류 {autoResult.errors!.length}건 보기</summary>
                    <ul className="mt-1 space-y-0.5 text-ink-mute">
                      {autoResult.errors!.map((e, i) => (
                        <li key={i} className="font-mono">{e.mul_no}: {e.message}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {/* 시도된 cmd 별 raw 응답 — 조회 0건이면 자동 펼침 */}
                {(autoResult.attempts?.length ?? 0) > 0 && (
                  <details className="mt-3 text-[11px]" open={(autoResult.fetched ?? 0) === 0}>
                    <summary className="cursor-pointer text-ink-mute">
                      PayApp API 시도 {autoResult.attempts!.length}회 — raw 응답 보기
                    </summary>
                    {(autoResult.fetched ?? 0) === 0 && (
                      <p className="mt-2 rounded-md bg-yellow-500/10 p-2 text-yellow-200">
                        ⚠️ PayApp API 조회 명령이 맞지 않거나 응답 필드가 다릅니다. 아래 raw 응답을
                        확인하고 PAYAPP_LIST_CMD 시크릿 또는 응답 파서를 조정하세요.
                      </p>
                    )}
                    <div className="mt-2 space-y-2">
                      {autoResult.attempts!.map((a, i) => (
                        <div key={i} className="rounded-md bg-bg-deep/60 p-2 ring-1 ring-line/10">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-mono font-semibold text-ink">{a.cmd}</span>
                            <span className="text-ink-dim">HTTP {a.http_status ?? '—'}</span>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                a.success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-ink/10 text-ink-mute'
                              }`}
                            >
                              {a.parsed_count}건 파싱
                            </span>
                            {a.error && <span className="text-red-300">{a.error}</span>}
                          </div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-mute">
                            {a.raw_preview || '(empty)'}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            ) : (
              <div className="space-y-2 text-xs">
                <p className="font-bold text-red-200">자동 동기화 실패</p>
                <p className="font-mono text-red-300">{autoResult.error}</p>
                {autoResult.missing_env && autoResult.missing_env.length > 0 && (
                  <div className="rounded-md bg-bg-deep/60 p-2">
                    <p className="font-semibold text-red-200">누락된 환경변수:</p>
                    <ul className="mt-1 space-y-0.5 font-mono text-red-300">
                      {autoResult.missing_env.map((e) => (
                        <li key={e}>· {e}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-ink-mute">
                      해결: <code>supabase secrets set {'<NAME>'}=...</code> 후{' '}
                      <code>supabase functions deploy sync-payapp-payments</code>
                    </p>
                  </div>
                )}
                {autoResult.details && (
                  <p className="rounded bg-bg-deep/60 p-2 font-mono text-red-300">
                    details: {autoResult.details}
                  </p>
                )}
                {autoResult.hint && (
                  <p className="rounded bg-yellow-500/10 p-2 text-yellow-200">
                    💡 {autoResult.hint}
                  </p>
                )}
                {autoResult.user_id && (
                  <p className="text-ink-mute">user_id: {autoResult.user_id}</p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* === Webhook 수신 진단 === */}
      <section className="space-y-2 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold tracking-tight">PayApp Webhook 수신 진단</h3>
          <div className="flex gap-1">
            <input
              type="text"
              value={webhookSearch}
              onChange={(e) => setWebhookSearch(e.target.value)}
              placeholder="mul_no 또는 텍스트"
              className="input h-7 text-[11px]"
            />
            <button
              onClick={onSearchWebhook}
              className="rounded-md bg-bg-deep px-2 text-[11px] font-semibold ring-1 ring-line/15 hover:bg-bg-hover"
            >
              검색
            </button>
          </div>
        </div>
        {webhookRows.length === 0 ? (
          <p className="rounded-md bg-bg-deep/40 p-3 text-[11px] text-ink-mute">
            최근 24시간 내 수신된 webhook 이벤트가 없어요. PayApp 콘솔의 feedbackurl 설정과 함수
            배포 상태를 확인하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[11px]">
              <thead className="text-ink-dim">
                <tr className="border-b border-line/10">
                  <th className="px-2 py-1.5 text-left font-semibold">time</th>
                  <th className="px-2 py-1.5 text-left font-semibold">mul_no</th>
                  <th className="px-2 py-1.5 text-left font-semibold">order_no</th>
                  <th className="px-2 py-1.5 text-right font-semibold">state</th>
                  <th className="px-2 py-1.5 text-right font-semibold">price</th>
                  <th className="px-2 py-1.5 text-left font-semibold">검증</th>
                  <th className="px-2 py-1.5 text-left font-semibold">처리</th>
                </tr>
              </thead>
              <tbody>
                {webhookRows.map((w) => (
                  <tr key={w.id} className="border-b border-line/10 last:border-b-0">
                    <td className="px-2 py-1.5 text-ink-mute">
                      {new Date(w.created_at).toLocaleTimeString('ko-KR')}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{w.payapp_mul_no ?? '—'}</td>
                    <td className="px-2 py-1.5 font-mono text-ink-mute">{w.order_no ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right">{w.pay_state ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{w.price ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          w.linkval_verified
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {w.linkval_verified ? 'OK' : 'FAIL'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-ink-mute">
                      {w.processed_at ? '✓' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* === API 시도 이력 === */}
      {attempts.length > 0 && (
        <section className="space-y-2 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <h3 className="text-sm font-bold tracking-tight">PayApp API 시도 이력 ({attempts.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[11px]">
              <thead className="text-ink-dim">
                <tr className="border-b border-line/10">
                  <th className="px-2 py-1.5 text-left font-semibold">time</th>
                  <th className="px-2 py-1.5 text-left font-semibold">cmd</th>
                  <th className="px-2 py-1.5 text-right font-semibold">HTTP</th>
                  <th className="px-2 py-1.5 text-right font-semibold">parsed</th>
                  <th className="px-2 py-1.5 text-left font-semibold">성공</th>
                  <th className="px-2 py-1.5 text-left font-semibold">오류</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id} className="border-b border-line/10 last:border-b-0">
                    <td className="px-2 py-1.5 text-ink-mute">
                      {new Date(a.created_at).toLocaleTimeString('ko-KR')}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{a.requested_cmd}</td>
                    <td className="px-2 py-1.5 text-right">{a.http_status ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.parsed_count}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          a.success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-ink/10 text-ink-mute'
                        }`}
                      >
                        {a.success ? 'OK' : '-'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-red-300">{a.error_message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* === 미매칭 결제 목록 === */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold tracking-tight">
            미매칭 결제 ({rows.filter((r) => r.status === 'unmatched').length})
          </h3>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md bg-bg-card px-2 py-1 text-[11px] text-ink-mute hover:bg-bg-hover"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
          {loading ? (
            <div className="p-8 text-center text-xs text-ink-mute">불러오는 중…</div>
          ) : rows.filter((r) => r.status === 'unmatched').length === 0 ? (
            <div className="p-8 text-center text-xs text-ink-mute">
              미매칭 결제가 없어요.
            </div>
          ) : (
            <ul className="divide-y divide-line/10">
              {rows
                .filter((r) => r.status === 'unmatched')
                .map((r) => (
                  <UnmatchedRow
                    key={r.id}
                    row={r}
                    busy={linkBusyId === r.id}
                    setBusy={(v) => setLinkBusyId(v ? r.id : null)}
                    onLinked={load}
                  />
                ))}
            </ul>
          )}
        </div>
      </section>

      {/* === 전체 동기화 이력 === */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold tracking-tight">동기화 이력 ({rows.length})</h3>
        <div className="overflow-x-auto rounded-2xl bg-bg-card ring-1 ring-line/10">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                <th className="px-3 py-2.5 text-left font-semibold">mul_no</th>
                <th className="px-3 py-2.5 text-left font-semibold">승인번호</th>
                <th className="px-3 py-2.5 text-left font-semibold">사용자</th>
                <th className="px-3 py-2.5 text-left font-semibold">요금제</th>
                <th className="px-3 py-2.5 text-right font-semibold">금액</th>
                <th className="px-3 py-2.5 text-right font-semibold">결제일시</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-ink-mute">
                    동기화 이력이 없어요.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.failed;
                return (
                  <tr key={r.id} className="border-b border-line/10 last:border-b-0">
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.tone}`}>
                        {s.icon}
                        {s.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.payapp_mul_no}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-mute">{r.approval_no ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.matched_user_email ?? r.buyer_email ?? '—'}
                      {r.buyer_phone && (
                        <p className="text-[10px] text-ink-dim">{maskAccount(r.buyer_phone)}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{r.plan_type}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">{r.amount.toLocaleString()}원</td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-ink-mute">
                      {new Date(r.paid_at).toLocaleString('ko-KR')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* === 고급 옵션 — 수동 입력 폼 === */}
      <details className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <summary className="cursor-pointer text-sm font-bold tracking-tight">
          고급 옵션 — 수동 입력으로 결제 동기화
        </summary>
        <ManualSyncForm onSynced={load} />
      </details>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-bg-card/60 p-2 text-center ring-1 ring-line/10">
      <p className="text-[9px] uppercase tracking-wider text-ink-dim">{label}</p>
      <p className={`mt-0.5 text-base font-extrabold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function UnmatchedRow({
  row,
  busy,
  setBusy,
  onLinked,
}: {
  row: ManualPaymentImportRow;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onLinked: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(row.buyer_email ?? '');
  const [candidates, setCandidates] = useState<UserSearchRow[]>([]);
  const [searching, setSearching] = useState(false);

  async function onSearch() {
    if (query.trim().length < 2) {
      toast.error('2글자 이상 입력해주세요');
      return;
    }
    setSearching(true);
    try {
      setCandidates(await searchUsersForLink(query.trim(), 10));
    } finally {
      setSearching(false);
    }
  }

  async function onLink(userId: string) {
    if (!window.confirm('이 사용자에게 결제를 연결할까요?')) return;
    setBusy(true);
    try {
      const res = await linkUnmatchedImport(row.id, userId);
      if (!res.ok) {
        toast.error(res.error ?? '연결 실패');
        return;
      }
      toast.success('연결 완료 — 사용자 권한 활성화됨');
      setOpen(false);
      await onLinked();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-semibold text-yellow-200">
          <Clock size={9} /> 미매칭
        </span>
        <p className="font-mono text-xs">{row.payapp_mul_no}</p>
        <p className="text-xs text-ink-mute">{row.goodname ?? '—'}</p>
        <p className="text-xs font-semibold tabular-nums">{row.amount.toLocaleString()}원</p>
        <p className="text-[11px] text-ink-dim">{row.plan_type}</p>
        <p className="ml-auto text-[11px] text-ink-mute">
          {new Date(row.paid_at).toLocaleString('ko-KR')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
        <span>이메일: {row.buyer_email ?? '—'}</span>
        <span>전화: {maskAccount(row.buyer_phone)}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/25"
        >
          <Link2 size={11} /> {open ? '닫기' : '사용자 연결'}
        </button>
      </div>

      {open && (
        <div className="rounded-lg bg-bg-deep/40 p-3 ring-1 ring-line/10">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이메일 또는 닉네임 검색"
              className="input flex-1"
            />
            <button
              onClick={onSearch}
              disabled={searching}
              className="inline-flex items-center gap-1 rounded-md bg-bg-card px-3 py-1.5 text-[11px] font-semibold ring-1 ring-line/15 hover:bg-bg-hover disabled:opacity-50"
            >
              <Search size={11} /> {searching ? '검색중…' : '검색'}
            </button>
          </div>
          {candidates.length > 0 && (
            <ul className="mt-2 divide-y divide-line/10 rounded-md bg-bg-card ring-1 ring-line/10">
              {candidates.map((c) => (
                <li key={c.user_id} className="flex items-center gap-2 p-2">
                  <div className="min-w-0 flex-1 truncate">
                    <p className="truncate text-xs font-medium">{c.email ?? '—'}</p>
                    <p className="truncate text-[10px] text-ink-mute">{c.nickname ?? '—'}</p>
                  </div>
                  <button
                    onClick={() => onLink(c.user_id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    <Link2 size={11} /> 연결
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function ManualSyncForm({ onSynced }: { onSynced: () => void | Promise<void> }) {
  const [mulNo, setMulNo] = useState('');
  const [approvalNo, setApprovalNo] = useState('');
  const [goodname, setGoodname] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [amount, setAmount] = useState<number>(4900);
  const [planType, setPlanType] = useState<'individual' | 'business'>('individual');
  const [paidAtLocal, setPaidAtLocal] = useState<string>(toLocalInput(new Date()));
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<AdminSyncPaymentResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  function onPlanChange(p: 'individual' | 'business') {
    setPlanType(p);
    setAmount(PLAN_PRICE[p]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLastError(null);
    setLastResult(null);
    if (!mulNo.trim()) {
      setLastError('결제요청번호(mul_no)를 입력하세요');
      return;
    }
    if (amount !== PLAN_PRICE[planType]) {
      setLastError(
        `${planType} 요금제는 ${PLAN_PRICE[planType].toLocaleString()}원이어야 합니다 (현재 ${amount})`,
      );
      return;
    }
    setBusy(true);
    try {
      const res = await adminSyncPayappPayment({
        payapp_mul_no: mulNo.trim(),
        amount,
        plan_type: planType,
        approval_no: approvalNo.trim() || undefined,
        buyer_email: buyerEmail.trim() || undefined,
        buyer_phone: buyerPhone.trim() || undefined,
        paid_at: new Date(paidAtLocal).toISOString(),
        goodname: goodname.trim() || undefined,
      });
      if (!res.ok || !res.result) {
        setLastError(res.error ?? '동기화 실패');
        return;
      }
      setLastResult(res.result);
      toast.success(`결과: ${res.result.status} — ${res.result.message}`);
      await onSynced();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="결제요청번호(mul_no) *">
          <input type="text" required value={mulNo} onChange={(e) => setMulNo(e.target.value)} className="input" />
        </Field>
        <Field label="승인번호">
          <input type="text" value={approvalNo} onChange={(e) => setApprovalNo(e.target.value)} className="input" />
        </Field>
        <Field label="구매자 이메일">
          <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className="input" autoComplete="off" />
        </Field>
        <Field label="구매자 전화">
          <input type="tel" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} className="input" autoComplete="off" />
        </Field>
        <Field label="요금제 *">
          <select required value={planType} onChange={(e) => onPlanChange(e.target.value as 'individual' | 'business')} className="input">
            <option value="individual">individual (4,900원)</option>
            <option value="business">business (6,900원)</option>
          </select>
        </Field>
        <Field label="결제 금액 *">
          <input type="number" required value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="input" />
        </Field>
        <Field label="결제일시 *">
          <input type="datetime-local" required value={paidAtLocal} onChange={(e) => setPaidAtLocal(e.target.value)} className="input" />
        </Field>
        <Field label="상품명">
          <input type="text" value={goodname} onChange={(e) => setGoodname(e.target.value)} className="input" />
        </Field>
      </div>
      {lastError && (
        <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">{lastError}</p>
      )}
      <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
        {busy ? '동기화 중…' : '수동 동기화 실행'}
      </button>
      {lastResult && (
        <p className="text-[11px] text-ink-mute">
          결과: <span className="font-mono">{lastResult.status}</span> — {lastResult.message}
        </p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
    </label>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
