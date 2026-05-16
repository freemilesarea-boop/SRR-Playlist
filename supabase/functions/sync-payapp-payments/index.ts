// supabase/functions/sync-payapp-payments/index.ts
//
// PayApp 결제 webhook 재처리 (admin only).
//
// === 배경 (중요) =========================================================
// PayApp REST API (`/oapi/apiLoad.html`) 는 결제내역 일괄 조회 cmd 를 제공하지
// 않습니다. 공식 PayApp 라이브러리(ssut/payapp, BoxbillingPayApp 등) 및 PayApp
// 매뉴얼 상 해당 endpoint 가 지원하는 cmd 는 다음으로 한정됨:
//   - payrequest / paycancel / paycancelreq        (결제 요청/취소 계열)
//   - rebillRegist / rebillPay / rebillStop        (정기결제 계열)
// `paymentList / payList / tradeList / list` 등 조회용 cmd 는 존재하지 않으며,
// 이전 구현이 받아온 `errno=70040 "cmd을 가져오지 못했습니다"` 는 PayApp 이
// 해당 cmd 를 알지 못한다는 정확한 신호였음.
//
// === 새 동작 =============================================================
// 결제 데이터의 유일한 진실 원천은 PayApp webhook(feedbackurl) 으로 들어와
// `payapp_webhook_events` 에 저장된 raw payload. 따라서 "동기화" 의 진짜 의미는
// **저장된 webhook event 를 다시 처리해서 누락된 매칭/권한부여를 복구하는 것**.
//
//   1) admin 검증
//   2) 기간 내 webhook events 조회 — 매칭 실패/미처리만:
//        - pay_state IN (4, 64)  (승인대기 OR 결제완료)
//        - membership_updated = false  (또는 processed_at IS NULL)
//        - linkval_verified = true     (위변조 webhook 제외)
//   3) 각 event 에 대해 admin_replay_webhook_event RPC 호출 (멱등)
//   4) 결과 집계 + 운영 로그
// =========================================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

function ymdKst(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}
function daysAgoKst(days: number): string {
  return ymdKst(new Date(Date.now() - days * 24 * 3600 * 1000));
}

function planFromAmount(amount: number | null): 'individual' | 'business' | null {
  if (amount === 4900) return 'individual';
  if (amount === 6900) return 'business';
  return null;
}

interface WebhookEventRow {
  id: string;
  payapp_mul_no: string | null;
  order_no: string | null;
  pay_state: number | null;
  price: number | null;
  linkval_verified: boolean;
  membership_updated: boolean;
  processed_at: string | null;
  created_at: string;
}

interface ReplayResult {
  matched_user_id: string | null;
  matched_order_id: string | null;
  matched_subscription_id: string | null;
  membership_updated: boolean;
  final_membership_tier: string | null;
  message: string | null;
}

async function logOp(
  sb: ReturnType<typeof createClient>,
  payload: {
    level: 'info' | 'success' | 'warning' | 'error';
    status: string;
    message: string;
    details?: Record<string, unknown>;
    user_id?: string | null;
    duration_ms?: number | null;
    error_code?: string | null;
    error_message?: string | null;
  },
) {
  try {
    await sb.rpc('admin_log_operation', {
      p_source: 'sync-payapp-payments',
      p_category: 'payment',
      p_level: payload.level,
      p_status: payload.status,
      p_message: payload.message,
      p_details: payload.details ?? {},
      p_user_id: payload.user_id ?? null,
      p_related_id: null,
      p_duration_ms: payload.duration_ms ?? null,
      p_error_code: payload.error_code ?? null,
      p_error_message: payload.error_message ?? null,
    });
  } catch (e) {
    console.warn('[sync-payapp] logOp failed (non-fatal):', e);
  }
}

serve(async (req) => {
  const t0 = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  const missingEnv: string[] = [];
  if (!SUPABASE_URL) missingEnv.push('SUPABASE_URL');
  if (!SERVICE_ROLE) missingEnv.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missingEnv.length > 0) {
    return json(
      {
        ok: false,
        error: 'server misconfigured',
        missing_env: missingEnv,
        hint: 'Edge Function secrets 가 비어 있어요. supabase secrets set <NAME>=... 로 등록 후 함수 재배포 필요.',
      },
      500,
    );
  }

  // 인증
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ ok: false, error: 'unauthorized', hint: 'Authorization header 누락' }, 401);

  const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes?.user) {
    return json(
      { ok: false, error: 'unauthorized', hint: 'JWT 검증 실패: ' + (userErr?.message ?? 'no user') },
      401,
    );
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // admin 검증
  const { data: me, error: meErr } = await sb
    .from('users')
    .select('role')
    .eq('id', userRes.user.id)
    .maybeSingle();
  if (meErr) {
    return json({ ok: false, error: 'admin lookup failed', details: meErr.message }, 500);
  }
  if (!me || me.role !== 'admin') {
    return json({ ok: false, error: 'admin only', user_id: userRes.user.id }, 403);
  }

  // 입력 (기본값 — 최근 7일)
  let body: { date_from?: string; date_to?: string; plan_type?: string } = {};
  try {
    const text = await req.text();
    if (text && text.trim().length > 0) body = JSON.parse(text);
  } catch {
    /* invalid JSON → 기본값으로 계속 */
  }
  const dateFrom = body.date_from || daysAgoKst(7);
  const dateTo = body.date_to || daysAgoKst(0);

  // 기간 → KST 자정 기준 timestamptz 변환
  const fromTs = new Date(`${dateFrom}T00:00:00+09:00`).toISOString();
  const toTs = new Date(`${dateTo}T23:59:59.999+09:00`).toISOString();

  console.log('[sync-payapp] webhook replay window:', { dateFrom, dateTo, fromTs, toTs });

  // 미처리 webhook events 조회.
  //   조건: linkval_verified=true (위변조 제외)
  //         pay_state IN (4, 64) (승인대기 OR 결제완료)
  //         membership_updated=false (아직 권한 부여 안 됨)
  //         created_at in range
  //   raw_payload 까지 select — state=4 케이스에서 approval_no 유무로 사전 필터.
  const { data: events, error: evtErr } = await sb
    .from('payapp_webhook_events')
    .select(
      'id, payapp_mul_no, order_no, pay_state, price, linkval_verified, membership_updated, processed_at, created_at, raw_payload',
    )
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
    .eq('linkval_verified', true)
    .eq('membership_updated', false)
    .in('pay_state', [4, 64])
    .order('created_at', { ascending: true })
    .limit(500);

  if (evtErr) {
    await logOp(sb, {
      level: 'error',
      status: 'failed',
      message: `webhook event scan failed: ${evtErr.message}`,
      user_id: userRes.user.id,
      error_code: 'SCAN_FAILED',
      error_message: evtErr.message,
      duration_ms: Date.now() - t0,
    });
    return json({
      ok: false,
      error: 'webhook scan failed',
      details: evtErr.message,
      date_from: dateFrom,
      date_to: dateTo,
    }, 500);
  }

  // approval_no 추출 — admin_replay_webhook_event 의 coalesce 순서와 동일.
  function pickApprovalNo(payload: Record<string, unknown> | null | undefined): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    const cand = [p.approval_no, p.apv_no, p.card_apv_no, p['승인번호']];
    for (const v of cand) {
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  }

  // state=4 (승인대기) 이벤트 중 approval_no 가 전혀 없는 row 는 정상 보류 상태라
  // 재처리해도 "no membership change" no-op. 시각적 노이즈만 만드므로 사전 필터:
  //   - state=64                       → 모두 포함 (paid 실패 복구 대상)
  //   - state=4 + approval_no 존재     → 포함 (paid_candidate 실패 복구 대상)
  //   - state=4 + approval_no 없음     → 보류중(pending)로 분류, RPC 호출 생략
  type WebhookEventRowFull = WebhookEventRow & { raw_payload: Record<string, unknown> | null };
  const allRows: WebhookEventRowFull[] = (events ?? []) as WebhookEventRowFull[];
  const actionable: WebhookEventRowFull[] = [];
  let skippedPending = 0;
  for (const r of allRows) {
    if (r.pay_state === 64) {
      actionable.push(r);
    } else if (r.pay_state === 4 && pickApprovalNo(r.raw_payload)) {
      actionable.push(r);
    } else {
      skippedPending++;
    }
  }

  let matched = 0;
  let unmatched = 0;
  let alreadySynced = 0;
  let failed = 0;
  const errors: Array<{ mul_no: string; message: string }> = [];
  const processed: Array<{
    mul_no: string;
    status: string;
    amount: number;
    plan_type: string | null;
  }> = [];

  for (const row of actionable) {
    const mul_no = row.payapp_mul_no ?? `(event:${row.id.slice(0, 8)})`;
    const amount = row.price ?? 0;
    const plan_type = planFromAmount(amount);

    // plan filter (요청 시)
    if (body.plan_type && plan_type !== body.plan_type) continue;

    if (!plan_type) {
      failed++;
      errors.push({ mul_no, message: `unsupported amount ${amount}` });
      processed.push({ mul_no, status: 'failed', amount, plan_type: null });
      continue;
    }

    // ⚠️ admin_replay_webhook_event 는 내부에서 auth.uid() 로 admin 검증을 함.
    //    service_role 클라이언트(sb)로 호출하면 auth.uid() = NULL → 'admin only'
    //    예외가 던져져서 모든 호출이 실패로 카운트됨. 위에서 이미 EF 가 admin 을
    //    확인했으므로, 사용자 JWT 가 실린 sbUser 로 호출해야 admin 체크 통과.
    const { data: rpcData, error: rpcErr } = await sbUser.rpc('admin_replay_webhook_event', {
      p_event_id: row.id,
    });

    if (rpcErr) {
      failed++;
      errors.push({ mul_no, message: rpcErr.message });
      processed.push({ mul_no, status: 'failed', amount, plan_type });
      continue;
    }

    const result = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ReplayResult | undefined;
    if (result?.membership_updated) {
      matched++;
      processed.push({ mul_no, status: 'matched', amount, plan_type });
    } else if (result?.matched_user_id) {
      // 매칭은 됐지만 membership tier 가 free 로 회수된 케이스 (refund 등) — 정상 처리.
      alreadySynced++;
      processed.push({ mul_no, status: 'already_synced', amount, plan_type });
    } else {
      unmatched++;
      processed.push({ mul_no, status: 'unmatched', amount, plan_type });
    }
  }

  // 전체 미처리 webhook 수 (참고용 — 위 query 가 limit 500 으로 잘렸을 때 확인)
  const { count: pendingTotal } = await sb
    .from('payapp_webhook_events')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
    .eq('linkval_verified', true)
    .eq('membership_updated', false)
    .in('pay_state', [4, 64]);

  const overallLevel: 'success' | 'warning' =
    failed > 0 || (actionable.length === 0 && (pendingTotal ?? 0) === 0) ? 'warning' : 'success';
  await logOp(sb, {
    level: overallLevel,
    status: failed > 0 ? 'failed' : actionable.length === 0 ? 'skipped' : 'completed',
    message:
      `webhook replay ${dateFrom}~${dateTo}: actionable=${actionable.length} ` +
      `(skipped_pending=${skippedPending}) matched=${matched} unmatched=${unmatched} ` +
      `already=${alreadySynced} failed=${failed}`,
    details: {
      date_from: dateFrom,
      date_to: dateTo,
      scanned: allRows.length,
      actionable: actionable.length,
      skipped_pending: skippedPending,
      pending_total: pendingTotal ?? null,
      matched,
      unmatched,
      already_synced: alreadySynced,
      failed,
      mode: 'webhook_replay',
    },
    user_id: userRes.user.id,
    duration_ms: Date.now() - t0,
    error_code: failed > 0 ? 'PARTIAL_FAILED' : null,
    error_message:
      errors.length > 0
        ? errors.map((e) => `${e.mul_no}:${e.message}`).join('; ').slice(0, 500)
        : null,
  });

  // 안내 hint:
  //   - actionable=0 + skipped_pending>0 → 기간 내 webhook 은 있지만 전부 정상
  //     보류(state=4 + no approval_no) 상태로, 처리할 게 없음. PayApp 가 결제
  //     완료를 보내면 자동 활성화됨.
  //   - actionable=0 + skipped_pending=0 + pending_total=0 → 기간 내 webhook
  //     자체 없음. 결제 누락이면 order_no 강제완료/수동 입력.
  //   - 그 외에는 hint 생략.
  let hint: string | undefined;
  if (actionable.length === 0) {
    if (skippedPending > 0) {
      hint =
        `${dateFrom}~${dateTo} 기간 내 미처리 webhook ${skippedPending}건은 모두 ` +
        `정상 보류 상태(state=4 승인대기, approval_no 없음)에요. PayApp 가 결제완료 ` +
        `webhook(state=64) 을 보내는 순간 자동 활성화됩니다. 현재 액션 필요 없음.`;
    } else {
      hint =
        `${dateFrom}~${dateTo} 기간 내 처리 대상 webhook 이 없습니다. ` +
        `웹훅이 아예 오지 않은 (PayApp 콘솔 → feedbackurl 미호출) 결제는 이 도구로 ` +
        `복구 불가능 — 아래 "order_no 강제완료" 또는 "수동 입력 동기화" 사용.`;
    }
  }

  return json({
    ok: true,
    mode: 'webhook_replay',
    date_from: dateFrom,
    date_to: dateTo,
    // scanned: 새 UI 는 actionable 기준으로 표시. 구 UI 호환 위해 actionable 값.
    scanned: actionable.length,
    fetched: actionable.length, // 구 필드 호환
    skipped_pending: skippedPending,
    pending_total: pendingTotal ?? null,
    matched,
    unmatched,
    already_synced: alreadySynced,
    failed,
    errors,
    processed,
    hint,
  });
});
