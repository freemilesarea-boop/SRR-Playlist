/**
 * Vercel Cron: Enterprise 운영 자동화 실행 레이어 (Phase 1-1)
 *
 * 운영 감사 K(Critical) — "자동 스케줄러 부재" 해소. 기존 RPC/Edge 를 재사용해
 * 아래 3개를 주기 실행한다. 각 기능은 독립 try/catch 로 분리되어 하나가 실패해도
 * 나머지는 계속 진행한다. 기존 정책/청구/알림 "계산 로직" 은 변경하지 않는다.
 *
 *   1) 정책 자동화 평가  : rpc admin_evaluate_policy_automation_rules(p_dry_run=false)
 *                          (due 규칙만 처리 + next_run_at 전진 → 중복 실행 방지 내장)
 *   2) 청구 연체 마킹    : rpc admin_mark_enterprise_billing_overdue()
 *                          (issued + due_date<today → overdue, 멱등)
 *   3) 알림 외부 디스패치: functions/v1/dispatch-admin-notifications {since_ts, limit}
 *                          (admin_notifications 미발송분 Slack/이메일 전송)
 *
 * 인증: Vercel Cron 이 자동 부여하는 Authorization: Bearer <CRON_SECRET> 검증.
 *       내부 호출은 service_role 키 사용 (0391 로 admin RPC 게이트가 service_role 허용).
 *
 * 로그: 기능별 RPC 가 admin_log_operation 으로 내부 로깅. 본 핸들러는 추가로
 *       cron-run 요약을 admin_log_operation(source='cron') 으로 기록 + console 출력.
 *
 * vercel.json crons 에 "path":"/api/cron/enterprise-ops" 로 등록.
 *
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET (필수)
 */

export const config = { runtime: 'edge' };

// 알림 디스패치 조회 윈도우.
// 0392(Phase 1-2)로 dispatch-admin-notifications 가 dispatched_at IS NULL + 채널별 멱등
// 처리하므로 윈도우 겹침 중복 발송이 없음. 윈도우를 24h 로 넓혀 일시 실패(예: Resend 다운)
// 알림이 해소될 때까지 다음 주기에 자동 재시도되게 한다 (성공한 채널은 skip).
const NOTIFY_WINDOW_SEC = 24 * 60 * 60;

interface TaskOutcome {
  ok: boolean;
  status?: number;
  result?: unknown;
  error?: string;
  ms: number;
}

async function callRpc(
  url: string, key: string, rpc: string, body: Record<string, unknown>,
): Promise<TaskOutcome> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    const parsed = (() => { try { return JSON.parse(txt); } catch { return txt; } })();
    return res.ok
      ? { ok: true, status: res.status, result: parsed, ms: Date.now() - t0 }
      : { ok: false, status: res.status, error: typeof parsed === 'string' ? parsed : JSON.stringify(parsed), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown', ms: Date.now() - t0 };
  }
}

async function callEdge(
  url: string, key: string, secret: string, fn: string, body: Record<string, unknown>,
): Promise<TaskOutcome> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${url}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'x-cron-secret': secret,
      },
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    const parsed = (() => { try { return JSON.parse(txt); } catch { return txt; } })();
    return res.ok
      ? { ok: true, status: res.status, result: parsed, ms: Date.now() - t0 }
      : { ok: false, status: res.status, error: typeof parsed === 'string' ? parsed : JSON.stringify(parsed), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown', ms: Date.now() - t0 };
  }
}

/** cron-run 요약 감사 로그 (best-effort — 실패해도 cron 결과에 영향 없음). */
async function logCronRun(
  url: string, key: string, level: string, status: string,
  message: string, details: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${url}/rest/v1/rpc/admin_log_operation`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_source: 'cron',
        p_category: 'enterprise_ops',
        p_level: level,
        p_status: status,
        p_message: message,
        p_details: details,
      }),
    });
  } catch {
    // 감사 로그 실패는 무시 (cron 자체는 성공/실패 그대로 반환)
  }
}

export default async function handler(req: Request) {
  // 1) CRON_SECRET 검증 (운영 RPC 호출 엔드포인트이므로 secret 필수)
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: 'CRON_SECRET 미설정 — 보안상 실행 거부' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return new Response(
      JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const ranAt = new Date().toISOString();
  const results: Record<string, TaskOutcome> = {};

  // (1) 정책 자동화 평가 — 독립 실행
  results.policy_automation = await callRpc(url, key, 'admin_evaluate_policy_automation_rules', {
    p_dry_run: false,
  });

  // (2) 청구 연체 마킹 — 독립 실행
  results.billing_overdue = await callRpc(url, key, 'admin_mark_enterprise_billing_overdue', {});

  // (3) NOC 알림 감시 — 독립 실행. NOC active alerts(major+critical) → admin_notifications 생성
  //     (store:condition dedup + 6h cooldown). 디스패치 전에 실행해 같은 주기에 발송되게 함.
  results.noc_alert_sync = await callRpc(url, key, 'admin_noc_sync_alerts_to_notifications', {
    p_cooldown_hours: 6,
  });

  // (4) 알림 외부 디스패치 — 독립 실행 (위에서 생성된 알림 포함, 0392 멱등)
  const sinceTs = new Date(Date.now() - NOTIFY_WINDOW_SEC * 1000).toISOString();
  results.notifications_dispatch = await callEdge(url, key, secret, 'dispatch-admin-notifications', {
    since_ts: sinceTs,
    limit: 50,
  });

  const allOk = Object.values(results).every((r) => r.ok);
  const failed = Object.entries(results).filter(([, r]) => !r.ok).map(([k]) => k);

  // cron-run 요약 로그 (best-effort)
  await logCronRun(
    url, key,
    allOk ? 'info' : 'warning',
    allOk ? 'success' : 'partial_failure',
    `enterprise-ops cron ran — ${allOk ? 'all ok' : 'failed: ' + failed.join(',')}`,
    { ran_at: ranAt, results },
  );

  // 운영 가시성을 위해 구조화 콘솔 로그 (Vercel logs 에 캡처)
  console.log('[cron:enterprise-ops]', JSON.stringify({ ran_at: ranAt, all_ok: allOk, failed, results }));

  // 일부 실패해도 200 (다음 주기 재시도 가능) — 단 결과에 ok=false 명시
  return new Response(
    JSON.stringify({ ok: allOk, ran_at: ranAt, failed, results }, null, 2),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
