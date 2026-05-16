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
  replayWebhookEvent,
  replayWebhookByMulNo,
  forceActivateMembership,
  backfillSubscriptionCancels,
  type BackfillCancelResult,
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
      // 콘솔 + 토스트로 즉시 가시화
      errs.forEach((e) => {
        console.error('[admin RPC failed]', e.name, e.message);
      });
      if (errs.length > 0) {
        toast.error(`진단 RPC ${errs.length}건 실패 — ${errs[0].name} : ${errs[0].message.slice(0, 120)}`);
      }
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

      {/* RPC 호출 실패 배너 — 정확한 실패 RPC 이름 + postgres 에러 메시지 노출 */}
      {rpcErrors.length > 0 && (
        <div className="rounded-2xl bg-red-500/10 p-4 ring-2 ring-red-500/50">
          <p className="text-sm font-bold text-red-200">
            ⚠️ 진단용 RPC 가 실패했어요 ({rpcErrors.length}건)
          </p>
          <p className="mt-1 text-[11px] text-red-100/85">
            DB 마이그레이션(0026~0039) 이 운영 DB 에 적용되지 않았거나 시그니처가 맞지 않습니다.
            아래 정확한 RPC 이름과 postgres 에러 메시지를 확인 후 누락된 마이그레이션을 적용하세요.
          </p>
          <ul className="mt-2 space-y-2">
            {rpcErrors.map((e, i) => (
              <li key={i} className="rounded-md bg-red-500/15 p-2 ring-1 ring-red-500/30">
                <p className="font-mono text-[11px] font-bold text-red-200">{e.name}</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-red-100/85">
                  {e.message}
                </pre>
              </li>
            ))}
          </ul>
          <details className="mt-2 text-[11px] text-red-100/80">
            <summary className="cursor-pointer">해결 방법</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>GitHub Actions → 'DB · 추천 메타데이터 시드 적용' 워크플로 실행</li>
              <li>또는 SQL Editor 에 supabase/payment_hotfix.sql 통째 붙여넣고 Run</li>
              <li>적용 후 페이지 새로고침</li>
            </ol>
          </details>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold tracking-tight">PayApp Webhook 수신 진단</h3>
          <div className="flex flex-wrap gap-1">
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
            <button
              onClick={async () => {
                const v = window.prompt('재처리할 mul_no 입력');
                if (!v || !v.trim()) return;
                const res = await replayWebhookByMulNo(v.trim());
                if (!res.ok) toast.error(res.error ?? '재처리 실패');
                else
                  toast.success(
                    res.result?.membership_updated
                      ? `재처리 성공 — tier=${res.result.final_membership_tier}`
                      : `재처리됨 — ${res.result?.message ?? ''}`,
                  );
                await load();
              }}
              className="rounded-md bg-accent/15 px-2 text-[11px] font-semibold text-accent hover:bg-accent/25"
            >
              mul_no 재처리
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
            <table className="w-full min-w-[900px] text-[11px]">
              <thead className="text-ink-dim">
                <tr className="border-b border-line/10">
                  <th className="px-2 py-1.5 text-left font-semibold">time</th>
                  <th className="px-2 py-1.5 text-left font-semibold">mul_no</th>
                  <th className="px-2 py-1.5 text-right font-semibold">state</th>
                  <th className="px-2 py-1.5 text-right font-semibold">price</th>
                  <th className="px-2 py-1.5 text-left font-semibold">검증</th>
                  <th className="px-2 py-1.5 text-left font-semibold">매칭 사용자</th>
                  <th className="px-2 py-1.5 text-left font-semibold">membership</th>
                  <th className="px-2 py-1.5 text-left font-semibold">처리오류</th>
                  <th className="px-2 py-1.5 text-right font-semibold">replay</th>
                </tr>
              </thead>
              <tbody>
                {webhookRows.map((w) => (
                  <WebhookRow key={w.id} row={w} onReplayed={load} />
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

      {/* === 정기결제 해지 백필 === */}
      <SubscriptionCancelBackfill onCompleted={load} />

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

const STATE_LABEL: Record<number, { label: string; tone: string }> = {
  1: { label: '요청수신', tone: 'bg-ink/10 text-ink-mute' },
  4: { label: '승인대기', tone: 'bg-yellow-500/15 text-yellow-200' },
  8: { label: '요청취소', tone: 'bg-red-500/15 text-red-300' },
  9: { label: '승인취소', tone: 'bg-red-500/15 text-red-300' },
  10: { label: '입금대기', tone: 'bg-blue-500/15 text-blue-200' },
  32: { label: '요청취소', tone: 'bg-red-500/15 text-red-300' },
  64: { label: '승인완료', tone: 'bg-emerald-500/15 text-emerald-300' },
  70: { label: '환불', tone: 'bg-red-500/15 text-red-300' },
  71: { label: '환불', tone: 'bg-red-500/15 text-red-300' },
};

function stateBadge(
  state: number | null,
  approval_no?: string | null,
): { label: string; tone: string } {
  if (state == null) return { label: '—', tone: 'text-ink-dim' };
  // 정책: state=4 + approval_no → 결제완료 (자동 처리됨)
  if (state === 4 && approval_no && approval_no.length > 0) {
    return { label: '결제완료', tone: 'bg-emerald-500/15 text-emerald-300' };
  }
  return STATE_LABEL[state] ?? { label: String(state), tone: 'bg-ink/10 text-ink-mute' };
}

function WebhookRow({
  row,
  onReplayed,
}: {
  row: WebhookEventRow;
  onReplayed: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function onReplay() {
    setBusy(true);
    try {
      const res = await replayWebhookEvent(row.id);
      if (!res.ok) {
        toast.error(res.error ?? '재처리 실패');
        return;
      }
      if (res.result?.membership_updated) {
        toast.success(`재처리 성공 — tier=${res.result.final_membership_tier ?? '?'}`);
      } else {
        toast.info(`재처리됨 — ${res.result?.message ?? ''}`);
      }
      await onReplayed();
    } finally {
      setBusy(false);
    }
  }

  async function onForce() {
    if (!row.matched_user_id) {
      toast.error('매칭된 user_id 가 없어요. 먼저 재처리/연결 필요.');
      return;
    }
    const reason = window.prompt(
      'state=64 미도착 강제 승인 사유 (감사 로그에 기록):',
      `state=64 webhook missing — mul_no=${row.payapp_mul_no}`,
    );
    if (!reason) return;
    setBusy(true);
    try {
      const planType: 'individual' | 'business' = row.price === 6900 ? 'business' : 'individual';
      const res = await forceActivateMembership({
        user_id: row.matched_user_id,
        plan_type: planType,
        reason,
        amount: row.price ?? undefined,
      });
      if (!res.ok) {
        toast.error(res.error ?? '강제 승인 실패');
        return;
      }
      toast.success(`강제 승인 완료 — tier=${res.result?.final_membership_tier ?? '?'}`);
      await onReplayed();
    } finally {
      setBusy(false);
    }
  }

  const state = stateBadge(row.pay_state, row.approval_no);
  const isRefundOrCancel =
    row.pay_state != null && [8, 9, 32, 70, 71].includes(row.pay_state);
  const rowTone = isRefundOrCancel
    ? 'bg-red-500/5 hover:bg-red-500/10'
    : row.pay_state === 64 && row.membership_updated
      ? 'bg-emerald-500/5'
      : '';
  return (
    <tr className={`border-b border-line/10 last:border-b-0 ${rowTone}`}>
      <td className="px-2 py-1.5 text-ink-mute">
        {new Date(row.created_at).toLocaleTimeString('ko-KR')}
      </td>
      <td className="px-2 py-1.5 font-mono">{row.payapp_mul_no ?? '—'}</td>
      <td className="px-2 py-1.5">
        <div className="flex flex-col gap-1">
          <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${state.tone}`}>
            {row.pay_state ?? '—'} · {state.label}
          </span>
          {row.approval_no && (
            <span className="text-[9px] font-mono text-ink-dim" title="승인번호">
              승인 {row.approval_no}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">{row.price ?? '—'}</td>
      <td className="px-2 py-1.5">
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            row.linkval_verified
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-red-500/15 text-red-300'
          }`}
        >
          {row.linkval_verified ? 'OK' : 'FAIL'}
        </span>
      </td>
      <td className="px-2 py-1.5 text-ink-mute">{row.matched_user_email ?? '—'}</td>
      <td className="px-2 py-1.5">
        {row.membership_updated && row.final_membership_tier && row.final_membership_tier !== 'free' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
            ✓ {row.final_membership_tier}
          </span>
        ) : row.membership_updated && row.final_membership_tier === 'free' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
            ⊘ free (회수)
          </span>
        ) : (
          <span className="text-ink-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-red-300">{row.processing_error ?? '—'}</td>
      <td className="px-2 py-1.5">
        <div className="flex justify-end gap-1">
          <button
            onClick={onReplay}
            disabled={busy}
            className="rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
            title="저장된 webhook payload 로 라우터 재실행"
          >
            {busy ? '…' : '재처리'}
          </button>
          {/* 강제승인 (예외 처리용): matched user 있는데 자동 적용 안 된 케이스 */}
          {row.matched_user_id && !row.membership_updated && row.pay_state != null && (
            <button
              onClick={onForce}
              disabled={busy}
              className="rounded-md bg-yellow-500/15 px-2 py-0.5 text-[10px] font-semibold text-yellow-200 hover:bg-yellow-500/25 disabled:opacity-50"
              title="예외 처리용. 일반 결제는 자동 처리됨 — 자동 처리 실패 시에만 사용."
            >
              강제승인
            </button>
          )}
        </div>
      </td>
    </tr>
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

function SubscriptionCancelBackfill({ onCompleted }: { onCompleted: () => void | Promise<void> }) {
  const [since, setSince] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState<'dry' | 'apply' | null>(null);
  const [result, setResult] = useState<BackfillCancelResult | null>(null);
  const [resultMode, setResultMode] = useState<'dry' | 'apply' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(mode: 'dry' | 'apply') {
    setErr(null);
    setResult(null);
    if (mode === 'apply') {
      if (
        !window.confirm(
          '정기결제 해지 webhook 행을 일괄 적용해 사용자 권한을 free 로 회수합니다.\n' +
            'dry-run 결과를 먼저 확인했나요? 계속할까요?',
        )
      )
        return;
    }
    setBusy(mode);
    try {
      const res = await backfillSubscriptionCancels({
        since: new Date(since + 'T00:00:00+09:00').toISOString(),
        dryRun: mode === 'dry',
      });
      if (!res.ok) {
        setErr(res.error ?? '백필 실패');
        toast.error(res.error ?? '백필 실패');
        return;
      }
      setResult(res.result ?? null);
      setResultMode(mode);
      if (mode === 'apply') {
        toast.success(`백필 완료 — ${res.result?.applied ?? 0}건 적용`);
        await onCompleted();
      } else {
        toast.info(`dry-run — ${res.result?.scanned ?? 0}건 매칭 가능`);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div>
        <h3 className="text-sm font-bold tracking-tight">정기결제 해지 백필 (0042)</h3>
        <p className="mt-0.5 text-[11px] text-ink-mute">
          PayApp 정기결제 해지 webhook 이 누락되어 active 로 남아있는 사용자를 일괄로 free 회수.
          반드시 <strong>dry-run</strong> 먼저 실행해서 대상 확인 후 적용.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-ink-mute">
          기준일 이후
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="input h-7 text-xs"
          />
        </label>
        <button
          onClick={() => run('dry')}
          disabled={busy !== null}
          className="rounded-md bg-bg-deep px-2 py-1 text-[11px] font-semibold ring-1 ring-line/15 hover:bg-bg-hover disabled:opacity-50"
        >
          {busy === 'dry' ? '확인 중…' : 'dry-run (변경 없음)'}
        </button>
        <button
          onClick={() => run('apply')}
          disabled={busy !== null}
          className="rounded-md bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
        >
          {busy === 'apply' ? '적용 중…' : '백필 적용'}
        </button>
      </div>
      {err && <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">{err}</p>}
      {result && (
        <div className="rounded-md bg-bg-deep/40 p-2 text-[11px]">
          <p className="text-ink-mute">
            mode: <span className="font-mono">{resultMode}</span> · scanned:{' '}
            <span className="font-semibold">{result.scanned}</span> · applied:{' '}
            <span className="font-semibold text-emerald-300">{result.applied}</span>
          </p>
          {Array.isArray(result.events) && result.events.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-ink-mute">결과 상세 ({result.events.length})</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-mute">
                {JSON.stringify(result.events, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
