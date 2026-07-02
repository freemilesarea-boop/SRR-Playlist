// supabase/functions/generate-enterprise-billing-pdf/index.ts
//
// Phase 3-1: 청구서 PDF 생성 → Storage 저장 → invoice.pdf_url 갱신.
//
// 절대 무수정:
//   - enterprise_billing_invoices 스키마 무영향 (pdf_url 컬럼은 0397 에서 additive)
//   - admin_generate_enterprise_billing_invoice / admin_list_... RPC 무관 (read-only 조회만)
//   - dispatch-contract-emails / dispatch-admin-notifications 무관 (별개 edge fn)
//   - cron / policy / player / announcement 무관
//
// 엔드포인트:
//   POST /generate-enterprise-billing-pdf { invoice_id: uuid }
//   POST /generate-enterprise-billing-pdf { health: true }   ← 진단
//
// 인증:
//   Authorization: Bearer <user_access_token> — super_admin 만 통과 (RPC 게이트)
//
// 응답:
//   200 { ok:true, invoice_id, pdf_url, pdf_generated_at, duration_ms }
//   4xx { error, ... }
//   500 { error, hint }

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';

const MODULE_LOAD_AT = new Date().toISOString();
const BUCKET = 'enterprise-billing-invoices';

// Noto Sans KR (Regular) OTF — 한글 지원. 최초 콜드 스타트 시 다운로드 후 module cache.
const NOTO_SANS_KR_URL =
  'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/Korean/NotoSansKR-Regular.otf';
let cachedFontBytes: Uint8Array | null = null;

async function loadKoreanFont(): Promise<Uint8Array> {
  if (cachedFontBytes) return cachedFontBytes;
  const res = await fetch(NOTO_SANS_KR_URL);
  if (!res.ok) throw new Error(`font fetch failed: HTTP ${res.status}`);
  cachedFontBytes = new Uint8Array(await res.arrayBuffer());
  return cachedFontBytes;
}

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

interface Env {
  SUPABASE_URL: string;
  SERVICE_ROLE: string;
  ANON_KEY: string;
}

function readEnv(): Env {
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  };
}

interface InvoiceDetail {
  id: string;
  enterprise_account_id: string;
  enterprise_account_name: string | null;
  business_registration_number: string | null;
  representative_name: string | null;
  business_address: string | null;
  billing_month: string;
  active_store_count: number;
  monthly_store_price: number;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  status: string;
  due_date: string | null;
  issued_at: string | null;
  memo: string | null;
  items?: Array<{ store_name: string | null; unit_price: number; quantity: number; amount: number; item_type: string }>;
}

async function verifyAdmin(env: Env, accessToken: string): Promise<{ ok: boolean; reason?: string; user_id?: string }> {
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) return { ok: false, reason: 'invalid_token' };
  const u = await userRes.json().catch(() => null) as { id?: string } | null;
  if (!u?.id) return { ok: false, reason: 'no_user' };

  const roleRes = await fetch(`${env.SUPABASE_URL}/rest/v1/users?id=eq.${u.id}&select=role`, {
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}` },
  });
  const rows = await roleRes.json().catch(() => []) as Array<{ role?: string }>;
  if (!rows[0] || rows[0].role !== 'admin') return { ok: false, reason: 'not_admin' };
  return { ok: true, user_id: u.id };
}

async function fetchInvoiceDetail(env: Env, invoiceId: string): Promise<InvoiceDetail> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/admin_get_enterprise_billing_invoice_detail`, {
    method: 'POST',
    headers: {
      apikey: env.SERVICE_ROLE,
      Authorization: `Bearer ${env.SERVICE_ROLE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_invoice_id: invoiceId }),
  });
  if (!res.ok) throw new Error(`fetch invoice detail failed: HTTP ${res.status} ${await res.text()}`);
  const body = await res.json();
  const inv = body?.invoice ?? body;
  if (!inv?.id) throw new Error('invoice_not_found');
  return inv;
}

function fmtMoney(n: number, currency = 'KRW'): string {
  const v = Math.round(n).toLocaleString('en-US');
  return currency === 'KRW' ? `₩${v}` : `${v} ${currency}`;
}

function fmtMonth(iso: string): string {
  return iso.slice(0, 7).replace('-', '년 ') + '월';
}

async function buildPdf(inv: InvoiceDetail): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit as any);
  const fontBytes = await loadKoreanFont();
  const korFont = await pdf.embedFont(fontBytes, { subset: true });
  const asciiFont = await pdf.embedFont(StandardFonts.Helvetica);

  const page = pdf.addPage([595.28, 841.89]);          // A4
  const { width } = page.getSize();
  const marginX = 50;
  const black = rgb(0.09, 0.09, 0.09);
  const ink = rgb(0.2, 0.2, 0.24);
  const line = rgb(0.85, 0.85, 0.88);

  const draw = (text: string, x: number, y: number, size = 10, color = ink, font = korFont) => {
    page.drawText(text, { x, y, size, font, color });
  };

  // Header
  draw('찭구서 (Enterprise Billing Invoice)', marginX, 780, 18, black);
  page.drawLine({ start: { x: marginX, y: 770 }, end: { x: width - marginX, y: 770 }, thickness: 1, color: line });

  // Meta block
  let y = 748;
  const metaLabel = (label: string, value: string) => {
    draw(label, marginX, y, 9, ink);
    draw(value, marginX + 96, y, 11, black);
    y -= 20;
  };
  metaLabel('찭구월', fmtMonth(inv.billing_month));
  metaLabel('발행일', new Date(inv.issued_at ?? new Date().toISOString()).toISOString().slice(0, 10));
  metaLabel('상태', inv.status.toUpperCase());
  if (inv.due_date) metaLabel('납기한', inv.due_date);

  // Brand / business info
  y -= 6;
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 0.5, color: line });
  y -= 20;
  draw('브랜드 / 사업자 정보', marginX, y, 11, black);
  y -= 18;
  const brand = inv.enterprise_account_name ?? '-';
  const brn   = inv.business_registration_number ?? '-';
  const rep   = inv.representative_name ?? '-';
  const addr  = inv.business_address ?? '-';
  metaLabel('브랜드명', brand);
  metaLabel('사업자번호', brn);
  metaLabel('대표자', rep);
  metaLabel('주소', addr);

  // Line items summary
  y -= 6;
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 0.5, color: line });
  y -= 22;
  draw('산출 내역 (매장 이용료)', marginX, y, 11, black);
  y -= 18;

  const rows: Array<[string, string]> = [
    ['매장수', `${inv.active_store_count.toLocaleString('en-US')} 개`],
    ['단가',       fmtMoney(inv.monthly_store_price, inv.currency)],
    ['공급가', fmtMoney(inv.subtotal_amount, inv.currency)],
    ['할인',       fmtMoney(-inv.discount_amount, inv.currency)],
    ['부가세', fmtMoney(inv.tax_amount, inv.currency)],
  ];
  for (const [k, v] of rows) {
    draw(k, marginX, y, 10, ink);
    draw(v, width - marginX - 160, y, 10, black, asciiFont);
    y -= 18;
  }

  // Total
  y -= 4;
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 1, color: line });
  y -= 24;
  draw('총 청구금액', marginX, y, 13, black);
  draw(fmtMoney(inv.total_amount, inv.currency), width - marginX - 160, y, 15, black, asciiFont);

  // Footer memo
  if (inv.memo) {
    y -= 40;
    draw('메모', marginX, y, 9, ink);
    draw(inv.memo.slice(0, 200), marginX, y - 14, 9, ink);
  }

  // Bottom brand line
  draw(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`, marginX, 30, 8, ink, asciiFont);
  draw('DEUDDA (듣다) Enterprise Billing', width - marginX - 180, 30, 8, ink);

  return await pdf.save();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const env = readEnv();
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE || !env.ANON_KEY) {
    return json({
      error: 'missing_env',
      hint: JSON.stringify({
        SUPABASE_URL: Boolean(env.SUPABASE_URL),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SERVICE_ROLE),
        SUPABASE_ANON_KEY: Boolean(env.ANON_KEY),
      }),
    }, 500);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  if (body.health === true) {
    return json({
      ok: true, module_load_at: MODULE_LOAD_AT,
      font_cached: cachedFontBytes !== null,
      env_presence: {
        SUPABASE_URL: Boolean(env.SUPABASE_URL),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SERVICE_ROLE),
        SUPABASE_ANON_KEY: Boolean(env.ANON_KEY),
      },
    });
  }

  const invoiceId = String(body.invoice_id ?? '').trim();
  if (!invoiceId) return json({ error: 'invoice_id required' }, 400);

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'missing_bearer' }, 401);

  const gate = await verifyAdmin(env, token);
  if (!gate.ok) return json({ error: 'forbidden', reason: gate.reason }, 403);

  const t0 = Date.now();
  try {
    const inv = await fetchInvoiceDetail(env, invoiceId);
    const pdfBytes = await buildPdf(inv);

    // Upload via service_role (bucket private, super_admin write policy)
    const filename = `${inv.enterprise_account_id}/${inv.billing_month.slice(0, 7)}/${inv.id}.pdf`;
    const supabase = createClient(env.SUPABASE_URL, env.SERVICE_ROLE);
    const upload = await supabase.storage.from(BUCKET).upload(filename, pdfBytes, {
      contentType: 'application/pdf', upsert: true,
    });
    if (upload.error) throw new Error(`storage upload failed: ${upload.error.message}`);

    // Signed URL 24h — 클라이언트 다운로드용
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(filename, 60 * 60 * 24);
    if (signed.error || !signed.data?.signedUrl) throw new Error(`signed URL failed: ${signed.error?.message}`);

    // invoice.pdf_url 갱신 (RPC)
    const markRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/admin_mark_billing_invoice_pdf`, {
      method: 'POST',
      headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_invoice_id: invoiceId, p_pdf_url: filename }),
    });
    if (!markRes.ok) throw new Error(`mark pdf RPC failed: HTTP ${markRes.status} ${await markRes.text()}`);

    return json({
      ok: true, invoice_id: invoiceId,
      pdf_storage_path: filename,
      pdf_signed_url: signed.data.signedUrl,
      pdf_signed_expires_in: 60 * 60 * 24,
      duration_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: 'pdf_generate_failed', message: msg, duration_ms: Date.now() - t0 }, 500);
  }
});
