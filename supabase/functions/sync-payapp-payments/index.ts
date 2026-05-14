// supabase/functions/sync-payapp-payments/index.ts
//
// PayApp 결제내역 자동 동기화 (admin only).
//
// 동작:
//   1) admin 검증
//   2) PayApp list API 를 후보 cmd 순차 시도 (env PAYAPP_LIST_CMD 가 있으면 그것만 사용)
//   3) 각 시도 raw response 를 payapp_api_sync_attempts 에 저장 (운영 진단용)
//   4) 첫 번째 parsed_count > 0 인 cmd 로 records 채택
//   5) 각 record 별 admin_sync_payapp_payment RPC 호출 (멱등)
//   6) 결과 + attempts 요약 반환

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_API_URL = Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html';
// 명시적 override 가 있으면 그 cmd 만 사용. 없으면 후보 5개를 순차 시도.
const PAYAPP_LIST_CMD = Deno.env.get('PAYAPP_LIST_CMD') ?? '';

// 후보 cmd 목록 — PayApp 콘솔/문서마다 명칭이 다를 수 있어 순차 시도.
const CANDIDATE_CMDS = ['paymentList', 'getReqList', 'req_search', 'paylist', 'payment_list'];

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

function parsePayappList(text: string): Array<Record<string, string>> {
  // JSON 시도
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as any[];
    if (Array.isArray(parsed?.list)) return parsed.list;
    if (Array.isArray(parsed?.data)) return parsed.data;
    if (Array.isArray(parsed?.payments)) return parsed.payments;
    if (parsed && typeof parsed === 'object' && (parsed.mul_no || parsed.mulno)) return [parsed as any];
  } catch {
    /* not JSON */
  }

  // URL-encoded multi-record
  const params = new URLSearchParams(text);
  const records = new Map<string, Record<string, string>>();
  const singleton: Record<string, string> = {};
  let multiDetected = false;

  for (const [rawKey, value] of params.entries()) {
    const m = rawKey.match(/^(.+?)[_\[:](\d+)\]?$/);
    if (m) {
      multiDetected = true;
      const fieldName = m[1];
      const idx = m[2];
      if (!records.has(idx)) records.set(idx, {});
      records.get(idx)![fieldName] = value;
    } else {
      singleton[rawKey] = value;
    }
  }

  if (multiDetected) return Array.from(records.values());
  if (singleton.mul_no || singleton.mulno) return [singleton];
  return [];
}

function getField(rec: Record<string, string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (rec[c] != null && String(rec[c]).trim() !== '') return String(rec[c]).trim();
  }
  return null;
}

function planFromAmount(amount: number): 'individual' | 'business' | null {
  if (amount === 4900) return 'individual';
  if (amount === 6900) return 'business';
  return null;
}

function normalizePayState(raw: string | null): string {
  if (!raw) return '';
  const s = String(raw).trim();
  // 완료 후보: '4', 'paid', 'complete', 'completed', '결제완료', '완료'
  if (/^(4|paid|complete|completed|결제완료|완료)$/i.test(s)) return '4';
  return s;
}

function toIsoKst(raw: string): string {
  if (!raw) return new Date().toISOString();
  if (raw.includes('T') || raw.includes('+') || raw.endsWith('Z')) {
    return new Date(raw).toISOString();
  }
  const isoCandidate = raw.replace(' ', 'T') + '+09:00';
  const d = new Date(isoCandidate);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function ymdKst(d: Date): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
  return f.format(d);
}
function daysAgoKst(days: number): string {
  return ymdKst(new Date(Date.now() - days * 24 * 3600 * 1000));
}

interface AttemptResult {
  cmd: string;
  http_status: number | null;
  records: Array<Record<string, string>>;
  raw_response: string;
  error: string | null;
}

async function tryFetchPayApp(cmd: string, sdate: string, edate: string): Promise<AttemptResult> {
  const params = new URLSearchParams();
  params.set('cmd', cmd);
  params.set('userid', PAYAPP_USERID);
  params.set('linkkey', PAYAPP_LINKKEY);
  params.set('sdate', sdate);
  params.set('edate', edate);
  params.set('pay_state', '4');

  try {
    const resp = await fetch(PAYAPP_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const text = await resp.text();
    const records = parsePayappList(text);
    return { cmd, http_status: resp.status, records, raw_response: text, error: null };
  } catch (e) {
    return { cmd, http_status: null, records: [], raw_response: '', error: String(e) };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!PAYAPP_USERID || !PAYAPP_LINKKEY) {
    return json({ error: 'server misconfigured: PAYAPP_USERID / PAYAPP_LINKKEY missing' }, 500);
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);

  const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: 'unauthorized' }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: me } = await sb
    .from('users')
    .select('role')
    .eq('id', userRes.user.id)
    .maybeSingle();
  if (!me || me.role !== 'admin') return json({ error: 'admin only' }, 403);

  let body: { date_from?: string; date_to?: string; plan_type?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults */
  }
  const dateFrom = body.date_from || daysAgoKst(30);
  const dateTo = body.date_to || daysAgoKst(0);

  // 디버그 preview (민감값 제외)
  console.log('[sync-payapp] request preview:', {
    cmd_override: PAYAPP_LIST_CMD || null,
    candidate_cmds: PAYAPP_LIST_CMD ? [PAYAPP_LIST_CMD] : CANDIDATE_CMDS,
    date_from: dateFrom,
    date_to: dateTo,
    userid_present: PAYAPP_USERID.length > 0,
    api_url: PAYAPP_API_URL,
    plan_filter: body.plan_type ?? null,
  });

  // 후보 cmd 순차 시도. 각 시도 결과 DB 에 영구 기록.
  const cmdsToTry = PAYAPP_LIST_CMD ? [PAYAPP_LIST_CMD] : CANDIDATE_CMDS;
  const attempts: Array<{
    cmd: string;
    http_status: number | null;
    parsed_count: number;
    success: boolean;
    error: string | null;
    raw_preview: string;
  }> = [];
  let records: Array<Record<string, string>> = [];
  let successCmd: string | null = null;

  for (const cmd of cmdsToTry) {
    const r = await tryFetchPayApp(cmd, dateFrom, dateTo);
    const success = r.records.length > 0;

    // DB 영구 기록 (raw_response 일부만 — 4000자 cap)
    await sb.from('payapp_api_sync_attempts').insert({
      requested_cmd: cmd,
      date_from: dateFrom,
      date_to: dateTo,
      http_status: r.http_status,
      raw_response: r.raw_response.slice(0, 4000),
      parsed_count: r.records.length,
      success,
      error_message: r.error,
      created_by: userRes.user.id,
    });

    attempts.push({
      cmd,
      http_status: r.http_status,
      parsed_count: r.records.length,
      success,
      error: r.error,
      raw_preview: r.raw_response.slice(0, 2000),
    });

    if (success) {
      records = r.records;
      successCmd = cmd;
      break;
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

  for (const rec of records) {
    const mul_no = getField(rec, ['mul_no', 'mulno', 'tno', 'payapp_mul_no', 'reqno', 'req_no', 'request_no', 'no']);
    const priceRaw = getField(rec, ['price', 'amount', 'goodprice']);
    const price = priceRaw ? Number(priceRaw) : 0;
    const pay_state = normalizePayState(getField(rec, ['pay_state', 'paystate', 'state', 'status']));

    if (pay_state && pay_state !== '4') continue;
    if (!mul_no || !price) continue;

    const plan_type = planFromAmount(price);
    if (!plan_type) {
      failed++;
      errors.push({ mul_no, message: `unsupported amount ${price}` });
      processed.push({ mul_no, status: 'failed', amount: price, plan_type: null });
      continue;
    }
    if (body.plan_type && body.plan_type !== plan_type) continue;

    const buyer_email = getField(rec, ['recvemail', 'buyer_email', 'email', 'useremail']);
    const buyer_phone = getField(rec, ['recvphone', 'buyer_phone', 'phone', 'userphone']);
    const goodname = getField(rec, ['goodname', 'goodsname', 'pname', 'item_name']);
    const approval_no = getField(rec, ['approval_no', 'apv_no', 'card_apv_no', 'cardno']);
    const paid_at_raw = getField(rec, ['paid_at', 'pay_date', 'paydate', 'completedate', 'pdate']);
    const paid_at = paid_at_raw ? toIsoKst(paid_at_raw) : new Date().toISOString();

    const { data: rpcData, error: rpcErr } = await sb.rpc('admin_sync_payapp_payment', {
      p_payapp_mul_no: String(mul_no),
      p_amount: price,
      p_plan_type: plan_type,
      p_approval_no: approval_no,
      p_buyer_email: buyer_email,
      p_buyer_phone: buyer_phone,
      p_paid_at: paid_at,
      p_goodname: goodname,
    });

    if (rpcErr) {
      failed++;
      errors.push({ mul_no, message: rpcErr.message });
      processed.push({ mul_no, status: 'failed', amount: price, plan_type });
      continue;
    }

    const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
      | { status?: string; message?: string }
      | undefined;
    const status = row?.status ?? 'unknown';
    if (status === 'matched' && (row?.message ?? '').includes('already')) {
      alreadySynced++;
      processed.push({ mul_no, status: 'already_synced', amount: price, plan_type });
    } else if (status === 'matched') {
      matched++;
      processed.push({ mul_no, status: 'matched', amount: price, plan_type });
    } else if (status === 'unmatched') {
      unmatched++;
      processed.push({ mul_no, status: 'unmatched', amount: price, plan_type });
    } else {
      failed++;
      processed.push({ mul_no, status: 'failed', amount: price, plan_type });
    }
  }

  return json({
    ok: true,
    date_from: dateFrom,
    date_to: dateTo,
    success_cmd: successCmd,
    attempts,
    fetched: records.length,
    matched,
    unmatched,
    already_synced: alreadySynced,
    failed,
    errors,
    processed,
  });
});
