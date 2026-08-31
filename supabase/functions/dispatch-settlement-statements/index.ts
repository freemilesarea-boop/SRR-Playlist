// supabase/functions/dispatch-settlement-statements/index.ts
//
// 정산 지급명세서 발송 — settlement_statement_jobs(pending) → PDF 생성 → Storage 저장
//   → Resend 로 PDF 첨부 발송 → 잡 상태 갱신.
//
// 관리자가 "지급완료" 후 "명세서 발송" 을 누르면 admin_queue_settlement_statement 가
// 잡을 쌓고, 이 함수가 그 잡을 소비한다. 지급 처리와 대외 문서 발송이 분리돼 있어
// 메일/PDF 실패가 지급 자체를 깨지 않는다.
//
// 금액은 전부 잡의 snapshot 에서 읽는다. 발송 후 정산이 재산정돼도 보낸 명세서와
// 저장된 스냅샷은 그대로다(대외 문서 불변성).
//
// 엔드포인트:
//   POST { job_id: uuid }   ← 특정 잡 1건 발송
//   POST { limit?: number } ← pending 잡 일괄 발송 (기본 20, 최대 100)
//   POST { health: true }   ← 진단
//
// 인증: Authorization: Bearer <service_role> 또는 <admin user token>
//
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';

const MODULE_LOAD_AT = new Date().toISOString();
const BUCKET = 'settlement-statements';
const RESEND_FROM_FALLBACK = '듣다 <no-reply@deudda.com>';

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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });

interface Env {
  SUPABASE_URL: string;
  SERVICE_ROLE: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  RESEND_FROM_IS_FALLBACK: boolean;
}
function readEnv(): Env {
  const fromRaw = Deno.env.get('RESEND_FROM');
  const from = fromRaw && fromRaw.trim() !== '' ? fromRaw.trim() : RESEND_FROM_FALLBACK;
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? '',
    RESEND_FROM: from,
    RESEND_FROM_IS_FALLBACK: !(fromRaw && fromRaw.trim() !== ''),
  };
}

// ── 포맷 헬퍼 ────────────────────────────────────────────────────────────────
const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString('en-US')} 원`;
const int = (n: number) => `${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const ymKo = (d: string) => {
  const [y, m] = String(d).slice(0, 7).split('-');
  return `${y}년 ${Number(m)}월`;
};
const dateKo = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';

interface Snapshot {
  settlement_month: string;
  paid_at: string | null;
  artist_email: string;
  gross_settlement_amount: number;
  company_fee_amount: number;
  sales_agent_fee_amount: number;
  artist_net_settlement: number;
  previous_carried_amount: number;
  total_settlement_amount: number;
  withholding_tax_amount: number;
  final_payout_amount: number;
  carried_over_amount: number;
  payout_bank_name: string | null;
  payout_account_holder: string | null;
  masked_account_number: string | null;
  payout_memo: string | null;
  withholding_tax_ratio: number | string | null;
  items: Array<{
    track_code: string | null; track_title: string | null; isrc: string | null;
    release_title: string | null; stream_count: number; amount: number;
  }>;
  total_streams: number;
}

// ── PDF ─────────────────────────────────────────────────────────────────────
async function buildPdf(s: Snapshot): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const kor = await pdf.embedFont(await loadKoreanFont(), { subset: true });
  const mono = await pdf.embedFont(StandardFonts.Helvetica);

  const black = rgb(0.09, 0.09, 0.11);
  const ink = rgb(0.42, 0.44, 0.5);
  const line = rgb(0.85, 0.86, 0.89);
  const accent = rgb(0.35, 0.31, 0.85);

  const W = 595.28, H = 841.89;      // A4
  const MX = 48;
  const taxPct = ((Number(s.withholding_tax_ratio) || 0.033) * 100).toFixed(1);

  let page = pdf.addPage([W, H]);
  let y = 0;

  const text = (t: string, x: number, yy: number, size = 10, color = ink, font = kor) =>
    page.drawText(t ?? '', { x, y: yy, size, font, color });
  const hline = (yy: number, thickness = 0.5, color = line) =>
    page.drawLine({ start: { x: MX, y: yy }, end: { x: W - MX, y: yy }, thickness, color });

  const header = (title: string) => {
    page = pdf.addPage([W, H]);
    y = H - 56;
    text(title, MX, y, 17, black);
    y -= 12;
    hline(y, 1);
    y -= 24;
  };

  const footer = () => {
    text('본 명세서는 듣다(DEUDDA) 정산 시스템에서 자동 생성되었습니다.', MX, 42, 8, ink);
    text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`, MX, 30, 7, ink, mono);
  };

  // ── 1페이지: 지급 요약 ────────────────────────────────────────────────────
  header('정산 지급명세서');

  const meta = (label: string, value: string) => {
    text(label, MX, y, 9, ink);
    text(value, MX + 110, y, 11, black);
    y -= 20;
  };
  meta('정산 월', ymKo(s.settlement_month));
  meta('지급일', dateKo(s.paid_at));
  meta('수신', s.artist_email);
  if (s.payout_bank_name || s.masked_account_number) {
    meta('입금 계좌', `${s.payout_bank_name ?? '-'}  ${s.masked_account_number ?? '-'}  ${s.payout_account_holder ?? ''}`.trim());
  }

  y -= 8; hline(y); y -= 26;
  text('지급 내역', MX, y, 12, black); y -= 22;

  const row = (label: string, value: number, opts: { sign?: boolean; strong?: boolean; note?: string } = {}) => {
    const c = opts.strong ? black : ink;
    text(label, MX, y, opts.strong ? 11 : 10, c);
    if (opts.note) text(opts.note, MX + 150, y, 8, ink);
    const v = (opts.sign && value > 0 ? '- ' : '') + won(value);
    const size = opts.strong ? 11 : 10;
    text(v, W - MX - (size * 0.55 * v.length), y, size, opts.strong ? black : c, kor);
    y -= 19;
  };

  // 총 유효 스트림
  text('총 유효 스트림', MX, y, 10, ink);
  const tsHead = `${int(s.total_streams)} 회`;
  text(tsHead, W - MX - (10 * 0.55 * tsHead.length), y, 10, ink, kor);
  y -= 19;

  y -= 2; hline(y); y -= 18;
  row('정산 금액', s.total_settlement_amount, {
    strong: true,
    note: Number(s.previous_carried_amount) !== 0 ? '이월 누적분 포함' : undefined,
  });
  row(`원천징수 (${taxPct}%)`, s.withholding_tax_amount, { sign: true, note: '소득세 3% + 지방소득세 0.3%' });

  y -= 6; hline(y, 1.2, accent); y -= 28;
  text('세후 입금액', MX, y, 14, black);
  const total = won(s.final_payout_amount);
  text(total, W - MX - (14 * 0.58 * total.length), y, 16, accent);

  y -= 40;
  hline(y); y -= 18;
  text('· 원천징수세액은 소득세법에 따라 지급자가 원천징수하여 신고·납부합니다.', MX, y, 8.5, ink); y -= 14;
  text(`· 트랙 ${s.items.length}곡의 스트리밍 내역은 다음 장에 있습니다.`, MX, y, 8.5, ink); y -= 14;
  if (s.payout_memo) { text(`· 메모: ${s.payout_memo.slice(0, 90)}`, MX, y, 8.5, ink); y -= 14; }
  text('· 내역에 이견이 있으시면 앱 내 문의하기로 알려주세요.', MX, y, 8.5, ink);
  footer();

  // ── 2페이지~: 스트리밍 내역서 ─────────────────────────────────────────────
  header('스트리밍 내역서');
  text(`${ymKo(s.settlement_month)} · 유효 스트림만 집계 (본인 재생 · 미리듣기 · 중복 재생 제외)`, MX, y, 9, ink);
  y -= 24;

  const COL_T = MX, COL_I = W - MX - 240, COL_S = W - MX - 70;
  const thead = () => {
    text('트랙', COL_T, y, 9, ink);
    text('ISRC', COL_I, y, 9, ink);
    text('스트림', COL_S, y, 9, ink);
    y -= 6; hline(y); y -= 15;
  };
  thead();

  if (s.items.length === 0) {
    text('해당 월에 집계된 유효 스트림이 없습니다.', MX, y, 9.5, ink);
    y -= 18;
  }

  for (const it of s.items) {
    if (y < 90) { footer(); header('스트리밍 내역서 (계속)'); thead(); }
    const title = (it.track_title ?? it.track_code ?? '-').slice(0, 34);
    text(title, COL_T, y, 9.5, black);
    text((it.isrc ?? '-').slice(0, 18), COL_I, y, 8.5, ink, it.isrc ? mono : kor);
    const sc = int(it.stream_count);
    text(sc, COL_S + 56 - sc.length * 5, y, 9.5, black, mono);
    y -= 17;
  }

  y -= 4; hline(y, 1); y -= 18;
  text('합계', COL_T, y, 10.5, black);
  const ts = int(s.total_streams);
  text(ts, COL_S + 56 - ts.length * 5.5, y, 10.5, black, mono);

  y -= 26;
  text('※ 유효 스트림은 30초 이상 재생 기준이며, 본인 재생·미리듣기·중복 재생은 제외됩니다.', MX, y, 8, ink);
  y -= 13;
  text('※ 지급 금액은 1면의 지급 내역을 따릅니다.', MX, y, 8, ink);
  footer();

  return await pdf.save();
}

// ── 메일 본문 ────────────────────────────────────────────────────────────────
function buildHtml(s: Snapshot): string {
  const taxPct = ((Number(s.withholding_tax_ratio) || 0.033) * 100).toFixed(1);
  return `<!doctype html><html lang="ko"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#16161a">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px">
  <p style="margin:0 0 4px;font-size:12px;color:#6b6e7b">듣다 DEUDDA</p>
  <h1 style="margin:0 0 18px;font-size:19px">${ymKo(s.settlement_month)} 정산 지급명세서</h1>
  <p style="margin:0 0 20px;font-size:14px;line-height:1.65;color:#3c3f4a">
    안녕하세요. ${ymKo(s.settlement_month)} 정산이 지급 완료되었습니다.<br>
    트랙별 스트리밍 내역서는 첨부된 PDF에서 확인하실 수 있습니다.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:7px 0;color:#6b6e7b">정산 금액</td>
        <td style="padding:7px 0;text-align:right">${won(s.total_settlement_amount)}</td></tr>
    <tr><td style="padding:7px 0;color:#6b6e7b">원천징수 (${taxPct}%)</td>
        <td style="padding:7px 0;text-align:right;color:#8a8d99">- ${won(s.withholding_tax_amount)}</td></tr>
    <tr><td colspan="2" style="border-top:1px solid #e6e7ec;padding-top:2px"></td></tr>
    <tr><td style="padding:10px 0;font-weight:700">세후 입금액</td>
        <td style="padding:10px 0;text-align:right;font-weight:700;font-size:17px;color:#5a4fdb">${won(s.final_payout_amount)}</td></tr>
  </table>
  <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#8a8d99">
    입금 계좌: ${s.payout_bank_name ?? '-'} ${s.masked_account_number ?? ''}<br>
    유효 스트림 ${int(s.total_streams)}회 · 트랙 ${s.items.length}곡<br>
    원천징수세액은 소득세법에 따라 지급자가 원천징수하여 신고·납부합니다.
  </p>
  <p style="margin:20px 0 0;font-size:12px;color:#8a8d99">내역에 이견이 있으시면 앱 내 문의하기로 알려주세요.</p>
</div></body></html>`;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ── 잡 1건 처리 ──────────────────────────────────────────────────────────────
async function processJob(env: Env, sb: any, job: any): Promise<{ ok: boolean; error?: string }> {
  const s = job.snapshot as Snapshot;
  let pdfPath: string | null = null;
  try {
    const pdfBytes = await buildPdf(s);
    pdfPath = `${job.artist_user_id}/${String(job.settlement_month).slice(0, 7)}/${job.id}.pdf`;
    const up = await sb.storage.from(BUCKET).upload(pdfPath, pdfBytes, {
      contentType: 'application/pdf', upsert: true,
    });
    if (up.error) throw new Error(`storage upload failed: ${up.error.message}`);

    const filename = `듣다_정산명세서_${String(job.settlement_month).slice(0, 7)}.pdf`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [job.recipient_email],
        subject: job.subject,
        html: buildHtml(s),
        attachments: [{ filename, content: toBase64(pdfBytes) }],
      }),
    });
    const raw = await res.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { /* non-json */ }
    if (!res.ok) {
      const msg = (data && (data.message || data.error || data.name)) || `HTTP ${res.status}`;
      throw new Error(`[${res.status}] ${String(msg)}`.slice(0, 1200));
    }

    await sb.rpc('_internal_mark_statement_job_result', {
      p_job_id: job.id, p_status: 'sent', p_error: null,
      p_provider_message_id: data?.id ?? null, p_pdf_path: pdfPath,
    });
    return { ok: true };
  } catch (e) {
    const err = String((e as Error)?.message ?? e).slice(0, 1500);
    await sb.rpc('_internal_mark_statement_job_result', {
      p_job_id: job.id, p_status: 'failed', p_error: err,
      p_provider_message_id: null, p_pdf_path: pdfPath,
    });
    return { ok: false, error: err };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const env = readEnv();
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  if (body.health === true) {
    return json({
      ok: true, module_load_at: MODULE_LOAD_AT, font_cached: cachedFontBytes !== null,
      env_presence: {
        SUPABASE_URL: Boolean(env.SUPABASE_URL),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SERVICE_ROLE),
        RESEND_API_KEY: Boolean(env.RESEND_API_KEY),
        RESEND_FROM: env.RESEND_FROM,
        RESEND_FROM_IS_FALLBACK: env.RESEND_FROM_IS_FALLBACK,
      },
    });
  }

  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) return json({ error: 'missing_env' }, 500);
  if (!env.RESEND_API_KEY) return json({ error: 'missing_env', hint: 'RESEND_API_KEY' }, 500);

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'missing_bearer' }, 401);
  if (token !== env.SERVICE_ROLE) {
    // admin 사용자 토큰 허용 — users.role='admin' 확인
    const asUser = createClient(env.SUPABASE_URL, token, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: me } = await asUser.auth.getUser();
    if (!me?.user?.id) return json({ error: 'forbidden', reason: 'invalid_token' }, 403);
    const admin = createClient(env.SUPABASE_URL, env.SERVICE_ROLE);
    const { data: row } = await admin.from('users').select('role').eq('id', me.user.id).maybeSingle();
    if (row?.role !== 'admin') return json({ error: 'forbidden', reason: 'not_admin' }, 403);
  }

  const sb = createClient(env.SUPABASE_URL, env.SERVICE_ROLE, { auth: { persistSession: false } });
  const jobId = body.job_id ? String(body.job_id) : null;
  const limit = Math.min(Math.max(Number(body.limit ?? 20) || 20, 1), 100);

  let q = sb.from('settlement_statement_jobs')
    .select('id, settlement_id, artist_user_id, settlement_month, recipient_email, subject, snapshot')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  q = jobId ? q.eq('id', jobId) : q.limit(limit);

  const { data: jobs, error } = await q;
  if (error) return json({ error: 'query_failed', detail: error.message }, 500);
  if (!jobs || jobs.length === 0) return json({ ok: true, processed: 0, sent: 0, failed: 0, results: [] });

  const results: Array<Record<string, unknown>> = [];
  let sent = 0, failed = 0;
  for (const job of jobs) {
    const r = await processJob(env, sb, job);
    if (r.ok) sent++; else failed++;
    results.push({ job_id: job.id, to: job.recipient_email, ok: r.ok, error: r.error });
  }
  return json({ ok: true, processed: jobs.length, sent, failed, results });
});
