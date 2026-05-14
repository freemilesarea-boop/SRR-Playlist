// supabase/functions/sync-payapp-payments/index.ts
//
// 관리자가 호출하는 PayApp 결제내역 자동 동기화.
// - admin 전용
// - PayApp REST API (cmd=paymentList, 기본) 호출하여 paid 결제 목록 조회
// - 각 결제건에 대해 admin_sync_payapp_payment RPC 호출 (멱등)
// - 결과 집계 + 미매칭 리스트 반환
//
// 보안:
//   - 클라이언트 JWT → admin role 확인 후 service_role 로 RPC 호출
//   - PAYAPP_USERID / PAYAPP_LINKKEY 는 Edge Function 시크릿 — 프론트 노출 금지
//
// deno-lint-ignore-file no-explicit-any

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const PAYAPP_USERID = Deno.env.get('PAYAPP_USERID') ?? '';
const PAYAPP_LINKKEY = Deno.env.get('PAYAPP_LINKKEY') ?? '';
const PAYAPP_API_URL = Deno.env.get('PAYAPP_API_URL') ?? 'https://api.payapp.kr/oapi/apiLoad.html';
// 결제내역 조회 cmd — PayApp 콘솔/문서 기준 변경 가능하도록 env 노출.
//   기본: paymentList (PayApp REST 결제내역 조회 명령)
//   대안: getReqList / req_search 등 환경마다 다를 수 있음 — env 로 override.
const PAYAPP_LIST_CMD = Deno.env.get('PAYAPP_LIST_CMD') ?? 'paymentList';

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

// PayApp 응답 파서 — JSON / URL-encoded / multi-index 모두 지원
function parsePayappList(text: string): Array<Record<string, string>> {
  // JSON 시도
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as any[];
    if (Array.isArray(parsed?.list)) return parsed.list;
    if (Array.isArray(parsed?.data)) return parsed.data;
    if (Array.isArray(parsed?.payments)) return parsed.payments;
    if (parsed && typeof parsed === 'object' && parsed.mul_no) return [parsed as any];
  } catch {
    // not JSON — fall through
  }

  // URL-encoded multi-record:
  //   field_N=value (예: mul_no_0=..., mul_no_1=...)
  //   field[N]=value
  //   field:N=value
  // 단일 record 일 경우엔 그대로 사용.
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
  // singleton — mul_no 가 있을 때만 1건으로 간주
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

// 'YYYY-MM-DD HH:MM:SS' (KST 가정) → ISO with +09:00.
// PayApp 가 ISO 로 주면 그대로 사용.
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
  // KST 캘린더 'YYYY-MM-DD'
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
  return f.format(d);
}

function daysAgoKst(days: number): string {
  return ymdKst(new Date(Date.now() - days * 24 * 3600 * 1000));
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

  // admin 검증
  const { data: me } = await sb
    .from('users')
    .select('role')
    .eq('id', userRes.user.id)
    .maybeSingle();
  if (!me || me.role !== 'admin') return json({ error: 'admin only' }, 403);

  // 입력
  let body: { date_from?: string; date_to?: string; plan_type?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body — ok, defaults will apply */
  }
  const dateFrom = body.date_from || daysAgoKst(30);
  const dateTo = body.date_to || daysAgoKst(0);

  // PayApp API 호출
  const params = new URLSearchParams();
  params.set('cmd', PAYAPP_LIST_CMD);
  params.set('userid', PAYAPP_USERID);
  params.set('linkkey', PAYAPP_LINKKEY);
  params.set('sdate', dateFrom);
  params.set('edate', dateTo);
  params.set('pay_state', '4'); // 결제완료만

  let respText = '';
  try {
    const resp = await fetch(PAYAPP_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    respText = await resp.text();
  } catch (e) {
    return json({ error: 'payapp api request failed: ' + String(e) }, 502);
  }

  const records = parsePayappList(respText);

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
    const mul_no = getField(rec, ['mul_no', 'mulno', 'tno', 'payapp_mul_no', 'no']);
    const priceRaw = getField(rec, ['price', 'amount', 'goodprice']);
    const price = priceRaw ? Number(priceRaw) : 0;
    const pay_state = getField(rec, ['pay_state', 'paystate', 'state']) ?? '';

    // pay_state 가 4(완료) 가 아니면 스킵. 일부 응답에는 pay_state 가 없을 수 있어서 빈 문자열은 통과시킴.
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
    const goodname = getField(rec, ['goodname', 'pname', 'item_name']);
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

  // 미매칭 행은 payapp_manual_payment_imports 에 이미 저장됨 → 클라이언트는 list RPC 로 조회

  return json({
    ok: true,
    date_from: dateFrom,
    date_to: dateTo,
    fetched: records.length,
    matched,
    unmatched,
    already_synced: alreadySynced,
    failed,
    errors,
    processed,
    // 파싱 결과가 0건이면 PayApp 응답을 일부 공개해 운영자가 cmd/필드명 확인할 수 있도록 함.
    raw_response_preview: records.length === 0 ? respText.slice(0, 500) : undefined,
  });
});
