/**
 * Vercel Cron 핸들러: 정기결제 재청구 디스패처 트리거 (Phase BILLING-SCHEDULER-RECOVERY-1)
 *
 * ⚠️ 이 핸들러는 vercel.json 의 "crons" 에 **의도적으로 등록되어 있지 않다.**
 *    등록(= 자동 실행 활성화)은 운영자 승인 이후의 별도 단계다. 등록 전에는
 *    자동 호출되지 않으며, 존재하더라도 아래 이중 게이트로 fail-closed 이다.
 *
 * 이중 안전 게이트:
 *   1) CRON_SECRET 검증 (Vercel Cron 이 Authorization: Bearer <CRON_SECRET> 부여)
 *   2) BILLING_REBILL_ENABLED 가 명확히 'true'/'1' 일 때만 dry_run=false 로 호출.
 *      그 외에는 dry_run=true 로만 호출(실청구 없음). Edge Function 도 동일 Kill
 *      Switch 로 재차 fail-closed 하므로, 어느 한쪽만 열려도 실청구되지 않는다.
 *
 * 대상: SQL RPC 가 chargeable=FUTURE_DUE 로 확정한 미래 도래분만. 과거 누락분
 *       (LEGACY_OVERDUE)은 Edge/RPC 단에서 항상 격리된다.
 *
 * 활성화 절차(운영자 승인 후):
 *   1) BILLING_REBILL_ENABLED=true (Vercel env)
 *   2) vercel.json crons 에 { "path": "/api/cron/subscription-rebill", "schedule": "10 0 * * *" } 추가
 *      (10 0 * * * UTC = 09:10 KST — docs/BILLING_REBILL_RECOVERY.md 근거 참조)
 *
 * 환경변수: SUPABASE_URL, CRON_SECRET(필수), BILLING_REBILL_ENABLED, APP_URL/VERCEL_URL
 */

export const config = { runtime: 'edge' };

const REBILL_LIMIT = 20;

export default async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET 미설정 — 실행 거부(fail-closed)' }),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return new Response(JSON.stringify({ error: 'SUPABASE_URL 미설정' }),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }

  // Kill Switch — 명확히 참일 때만 실청구. (billingRebill.ts resolveKillSwitch 미러)
  const rebillEnabledRaw = (process.env.BILLING_REBILL_ENABLED ?? '').trim().toLowerCase();
  const killSwitch = rebillEnabledRaw === 'true' || rebillEnabledRaw === '1';

  const ranAt = new Date().toISOString();
  const target = `${supabaseUrl}/functions/v1/dispatch-subscription-rebill`;

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify({
        dry_run: !killSwitch, // Kill Switch off → dry run only
        mode: 'future_due',
        limit: REBILL_LIMIT,
        execution_id: `cron_${Date.now().toString(36)}`,
      }),
    });
    const txt = await res.text();
    const parsed = (() => { try { return JSON.parse(txt); } catch { return txt; } })();

    // 구조화 로그(Vercel logs). 개인정보 없음.
    console.log('[cron:subscription-rebill]', JSON.stringify({ ran_at: ranAt, kill_switch: killSwitch, upstream_status: res.status }));

    return new Response(JSON.stringify({ ok: res.ok, ran_at: ranAt, kill_switch: killSwitch, dry_run: !killSwitch, upstream: parsed }, null, 2),
      { status: res.ok ? 200 : 502, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, ran_at: ranAt, error: errMsg }),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
