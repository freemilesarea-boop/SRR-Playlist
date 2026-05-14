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

// HTML <table> 파서: <thead>/<th> 또는 첫 <tr> 의 <td> 를 헤더로 사용.
function parseHtmlTable(text: string): Array<Record<string, string>> {
  const tableMatch = text.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[1];
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(tableHtml)) !== null) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let c;
    while ((c = cellRe.exec(m[1])) !== null) {
      cells.push(c[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.replace(/\s+/g, '_').toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (r[i] != null) obj[h] = r[i];
    });
    return obj;
  });
}

// XML 파서: <item>/<row>/<payment> 같은 wrapper element 안의 child element 추출
function parseXmlRecords(text: string): Array<Record<string, string>> {
  // 가장 흔한 wrapper 이름들 — PayApp 가 어느 걸 쓰는지 모르므로 후보 순회
  const wrappers = ['item', 'row', 'payment', 'record', 'list', 'entry'];
  for (const w of wrappers) {
    const re = new RegExp(`<${w}[^>]*>([\\s\\S]*?)<\\/${w}>`, 'gi');
    const out: Array<Record<string, string>> = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const inner = m[1];
      const obj: Record<string, string> = {};
      const fieldRe = /<([a-z_][\w]*?)[^>]*>([\s\S]*?)<\/\1>/gi;
      let f;
      while ((f = fieldRe.exec(inner)) !== null) {
        obj[f[1].toLowerCase()] = f[2].replace(/<[^>]+>/g, '').trim();
      }
      if (Object.keys(obj).length > 0) out.push(obj);
    }
    if (out.length > 0) return out;
  }
  return [];
}

function parsePayappList(text: string): Array<Record<string, string>> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // JSON
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as any[];
    if (Array.isArray(parsed?.list)) return parsed.list;
    if (Array.isArray(parsed?.data)) return parsed.data;
    if (Array.isArray(parsed?.payments)) return parsed.payments;
    if (Array.isArray(parsed?.result)) return parsed.result;
    if (parsed && typeof parsed === 'object' && (parsed.mul_no || parsed.mulno)) return [parsed as any];
  } catch {
    /* not JSON */
  }

  // XML
  if (trimmed.startsWith('<?xml') || /<(item|row|payment|record|entry)[\s>]/i.test(trimmed)) {
    const xmlRecs = parseXmlRecords(trimmed);
    if (xmlRecs.length > 0) return xmlRecs;
  }

  // HTML <table>
  if (/<table[\s>]/i.test(trimmed)) {
    const tableRecs = parseHtmlTable(trimmed);
    if (tableRecs.length > 0) return tableRecs;
  }

  // URL-encoded multi-record (field_N / field[N] / field:N)
  const params = new URLSearchParams(trimmed);
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

  // 마지막 fallback: 줄바꿈 + key=value (PayApp 일부 응답 포맷)
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() && l.includes('='));
  const obj: Record<string, string> = {};
  for (const line of lines) {
    const [k, ...rest] = line.split('=');
    obj[k.trim()] = rest.join('=').trim();
  }
  if (obj.mul_no || obj.mulno) return [obj];

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
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  // env check — 어떤 env 가 비었는지 명확히 알려준다
  const missingEnv: string[] = [];
  if (!SUPABASE_URL) missingEnv.push('SUPABASE_URL');
  if (!SERVICE_ROLE) missingEnv.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!PAYAPP_USERID) missingEnv.push('PAYAPP_USERID');
  if (!PAYAPP_LINKKEY) missingEnv.push('PAYAPP_LINKKEY');
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
    return json(
      { ok: false, error: 'admin lookup failed', details: meErr.message },
      500,
    );
  }
  if (!me || me.role !== 'admin') {
    return json({ ok: false, error: 'admin only', user_id: userRes.user.id }, 403);
  }

  // 입력 (body 비어 있으면 기본값 — 최근 7일)
  let body: { date_from?: string; date_to?: string; plan_type?: string } = {};
  try {
    const text = await req.text();
    if (text && text.trim().length > 0) {
      body = JSON.parse(text);
    }
  } catch {
    // 잘못된 JSON 도 무시하고 기본값 진행. 절대 400 으로 죽지 않게.
  }
  const dateFrom = body.date_from || daysAgoKst(7);
  const dateTo = body.date_to || daysAgoKst(0);

  console.log('[sync-payapp] request preview:', {
    cmd_override: PAYAPP_LIST_CMD || null,
    candidate_cmds: PAYAPP_LIST_CMD ? [PAYAPP_LIST_CMD] : CANDIDATE_CMDS,
    date_from: dateFrom,
    date_to: dateTo,
    userid_present: PAYAPP_USERID.length > 0,
    api_url: PAYAPP_API_URL,
    plan_filter: body.plan_type ?? null,
  });

  // 후보 cmd 순차 시도
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
  let logFailures = 0;

  for (const cmd of cmdsToTry) {
    const r = await tryFetchPayApp(cmd, dateFrom, dateTo);
    const success = r.records.length > 0;

    // payapp_api_sync_attempts 에 기록 — 테이블이 없으면(0028 미적용) 조용히 무시
    try {
      const { error: insertErr } = await sb.from('payapp_api_sync_attempts').insert({
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
      if (insertErr) {
        logFailures++;
        console.warn('[sync-payapp] attempt log insert failed:', insertErr.message);
      }
    } catch (e) {
      logFailures++;
      console.warn('[sync-payapp] attempt log threw:', String(e));
    }

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
    log_failures: logFailures,
    // 진단용: 0건이고 attempts 도 비었으면 PayApp 호출 자체에 실패
    hint:
      records.length === 0
        ? logFailures > 0
          ? 'payapp_api_sync_attempts 테이블이 없거나 RLS 차단. 0028 마이그레이션 적용 필요.'
          : successCmd
            ? `${successCmd} 가 0건 반환했어요. 기간/필터 또는 PayApp 응답 필드명 확인.`
            : 'PayApp API 가 모든 cmd 에서 0건 또는 에러 반환. attempts.raw_preview 확인.'
        : undefined,
  });
});
