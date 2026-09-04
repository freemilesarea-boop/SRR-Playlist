// supabase/functions/verify-business-number/index.ts
//
// 사업자등록번호 진위확인 (요금제 화면 · 엔터프라이즈 본사 셀프 신청 전 단계).
//
//  1) 형식 + 체크섬(KS X 1003) 검증 — 항상 수행
//  2) NTS_BUSINESS_API_KEY 가 설정돼 있으면 국세청(공공데이터포털) 진위확인 API 호출
//     → 대표자명/개업일자까지 실제 대조. 미설정이면 checksum 만 통과시키고
//       verification_status='manual_review' 로 남겨 관리자가 확인한다.
//       (fail-open 으로 'verified' 를 찍지 않는다 — 검증하지 않은 것을 검증했다고
//        기록하면 안 된다.)
//  3) 결과를 business_verification_profiles 에 service_role 로 기록.
//     이 엣지함수가 business_verified / verification_status 의 유일한 기록자다.
//     apply_enterprise_hq_selfserve RPC 는 이 행이 있어야만 본사 계정을 만든다.
//
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const NTS_KEY = (Deno.env.get('NTS_BUSINESS_API_KEY') ?? '').trim();
const NTS_URL = Deno.env.get('NTS_BUSINESS_API_URL')
  ?? 'https://api.odcloud.kr/api/nts-businessman/v1/validate';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

/** 사업자등록번호 체크섬 — src/lib/businessVerification.ts / _kr_business_number_valid 와 동일 알고리즘 */
function checksumOk(input: string): boolean {
  const d = (input ?? '').replace(/\D/g, '');
  if (d.length !== 10) return false;
  if (/^0+$/.test(d)) return false;   // 000-00-00000 은 체크섬을 통과해버린다
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(d[9]);
}

/** YYYY-MM-DD → YYYYMMDD (국세청 API 형식) */
function compactDate(s: string): string {
  return (s ?? '').replace(/\D/g, '').slice(0, 8);
}

interface NtsOutcome {
  checked: boolean;              // 국세청 API 를 실제로 호출했는가
  match: boolean;                // valid === '01'
  business_state?: string;       // 계속사업자 / 휴업자 / 폐업자 …
  tax_type?: string;
  message?: string;
}

async function callNts(p: {
  b_no: string; start_dt: string; p_nm: string; b_nm?: string;
}): Promise<NtsOutcome> {
  if (!NTS_KEY) return { checked: false, match: false, message: 'NTS_BUSINESS_API_KEY 미설정' };
  const url = `${NTS_URL}?serviceKey=${encodeURIComponent(NTS_KEY)}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        businesses: [{
          b_no: p.b_no, start_dt: p.start_dt, p_nm: p.p_nm,
          p_nm2: '', b_nm: p.b_nm ?? '', corp_no: '', b_sector: '', b_type: '', b_adr: '',
        }],
      }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      return { checked: false, match: false, message: `국세청 API 오류 (HTTP ${resp.status}) ${text.slice(0, 200)}` };
    }
    const body = JSON.parse(text) as any;
    const row = body?.data?.[0];
    if (!row) return { checked: false, match: false, message: '국세청 API 응답을 해석하지 못했습니다.' };
    return {
      checked: true,
      match: String(row.valid ?? '') === '01',
      business_state: row?.status?.b_stt ?? undefined,
      tax_type: row?.status?.tax_type ?? undefined,
      message: String(row.valid_msg ?? '') || undefined,
    };
  } catch (e) {
    return { checked: false, match: false, message: `국세청 API 호출 실패: ${String(e)}` };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);
  const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: 'unauthorized' }, 401);
  const uid = userRes.user.id;

  let body: Record<string, string | undefined> = {};
  try { body = await req.json(); } catch { body = {}; }

  const digits = (body.business_number ?? '').replace(/\D/g, '');
  const repName = (body.representative_name ?? '').trim();
  const openDate = compactDate(body.business_open_date ?? '');
  const bizName = (body.business_name ?? '').trim();

  if (!checksumOk(digits)) {
    return json({
      ok: false, business_verified: false, verification_status: 'rejected',
      message: '사업자등록번호 형식(체크섬)이 올바르지 않습니다.',
    }, 400);
  }
  if (!repName || openDate.length !== 8) {
    return json({
      ok: false, business_verified: false, verification_status: 'rejected',
      message: '대표자명과 개업일자를 입력해주세요.',
    }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 같은 사업자번호가 다른 회원에게 이미 등록돼 있으면 중단 (business_number UNIQUE)
  const { data: owner } = await sb
    .from('business_verification_profiles')
    .select('user_id')
    .eq('business_number', digits)
    .maybeSingle();
  if (owner && owner.user_id !== uid) {
    return json({
      ok: false, business_verified: false, verification_status: 'rejected',
      message: '이미 다른 계정에 등록된 사업자등록번호입니다. 고객센터로 문의해주세요.',
    }, 409);
  }

  const nts = await callNts({ b_no: digits, start_dt: openDate, p_nm: repName, b_nm: bizName });

  let status: 'verified' | 'manual_review' | 'rejected';
  let verified: boolean;
  let message: string;

  if (nts.checked && nts.match) {
    status = 'verified'; verified = true;
    message = `국세청 확인 완료${nts.business_state ? ` · ${nts.business_state}` : ''}`;
  } else if (nts.checked && !nts.match) {
    status = 'rejected'; verified = false;
    message = nts.message ?? '국세청 등록 정보와 일치하지 않습니다. 사업자번호·대표자명·개업일자를 확인해주세요.';
  } else {
    // 국세청 조회를 못 했다 — 체크섬만 통과. 검증했다고 기록하지 않는다.
    status = 'manual_review'; verified = false;
    message = '형식 확인 완료 · 국세청 실시간 조회는 진행되지 않아 담당자가 확인 후 승인합니다.';
  }

  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = {
    user_id: uid,
    business_number: digits,
    business_name: bizName || null,
    representative_name: repName,
    business_open_date: (body.business_open_date ?? '').slice(0, 10) || null,
    business_address: (body.business_address ?? '').trim() || null,
    business_type: (body.business_type ?? '').trim() || null,
    store_name: (body.store_name ?? '').trim() || null,
    store_address: (body.store_address ?? '').trim() || null,
    business_verified: verified,
    verification_status: status,
    business_state: nts.business_state ?? null,
    tax_type: nts.tax_type ?? null,
    verified_at: verified ? nowIso : null,
    updated_at: nowIso,
  };

  const { error: upErr } = await sb
    .from('business_verification_profiles')
    .upsert(row, { onConflict: 'user_id' });
  if (upErr) return json({ error: 'profile save failed', detail: upErr.message }, 500);

  return json({
    ok: status !== 'rejected',
    business_verified: verified,
    verification_status: status,
    business_state: nts.business_state ?? null,
    tax_type: nts.tax_type ?? null,
    nts_checked: nts.checked,
    verified_at: verified ? nowIso : null,
    message,
  }, status === 'rejected' ? 400 : 200);
});
