// supabase/functions/generate-enterprise-intel-report/index.ts
//
// Phase 3-4b: HQ 브랜드 인텔리전스 월간 리포트 PDF 생성.
//
// 절대 원칙:
//   - 신규 DB migration/table/column/storage bucket 0
//   - 기존 generate-enterprise-billing-pdf 무변경 (별개 파일)
//   - 0402 RPC (get_my_enterprise_intel_*) 재사용만 · 각 RPC 의 HQ scope 게이트 활용
//   - Response bytes 직접 반환 (Storage 우회)
//   - HQ 만 접근 · 다른 브랜드 리포트 접근 금지
//
// 엔드포인트:
//   POST /generate-enterprise-intel-report { month: 'YYYY-MM' }
//   POST /generate-enterprise-intel-report { health: true }
//
// 인증:
//   Authorization: Bearer <user_access_token>
//   → enterprise_accounts.auth_user_id 로 HQ 판정 · 브랜드명 확보.
//   → 이후 모든 0402 RPC 호출은 사용자 Bearer 토큰 forward → 각 RPC 자체 게이트 활용.
//
// 응답:
//   200 application/pdf · Content-Disposition: attachment;
//     filename="brand-report-YYYY-MM.pdf"
//   4xx { error, reason? }
//   5xx { error, message }

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';

const MODULE_LOAD_AT = new Date().toISOString();

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

// -----------------------------------------------------------------------------
// HQ 판정 · 브랜드명
// -----------------------------------------------------------------------------

interface HqIdentity {
  ea_id: string;
  enterprise_name: string;
  brand_code: string | null;
}

async function verifyHqIdentity(env: Env, accessToken: string): Promise<HqIdentity> {
  // 1) user_id 확보
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) throw new Error('invalid_token');
  const u = await userRes.json().catch(() => null) as { id?: string } | null;
  if (!u?.id) throw new Error('no_user');

  // 2) enterprise_accounts 조회 (service_role)
  const url = `${env.SUPABASE_URL}/rest/v1/enterprise_accounts` +
    `?auth_user_id=eq.${u.id}` +
    `&deleted_at=is.null` +
    `&status=in.(active,invited)` +
    `&select=id,enterprise_name,brand_code&limit=1`;
  const eaRes = await fetch(url, {
    headers: { apikey: env.SERVICE_ROLE, Authorization: `Bearer ${env.SERVICE_ROLE}` },
  });
  if (!eaRes.ok) throw new Error(`enterprise_accounts fetch failed: HTTP ${eaRes.status}`);
  const rows = await eaRes.json().catch(() => []) as
    Array<{ id: string; enterprise_name: string; brand_code: string | null }>;
  if (!rows[0]) throw new Error('not_hq');
  return {
    ea_id: rows[0].id,
    enterprise_name: rows[0].enterprise_name,
    brand_code: rows[0].brand_code,
  };
}

// -----------------------------------------------------------------------------
// 0402 RPC (사용자 Bearer 토큰 forward)
// -----------------------------------------------------------------------------

async function callRpc(
  env: Env,
  accessToken: string,
  fnName: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      apikey: env.ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RPC ${fnName} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

interface IntelSet {
  summary: any;
  kpi: any;
  health: any;
  top: any;
  bottom: any;
  risk: any;
  insights: any;
  monthly: any;
}

async function fetchIntelSet(env: Env, accessToken: string, monthYyyyMmDd: string): Promise<IntelSet> {
  const [summary, kpi, health, top, bottom, risk, insights, monthly] = await Promise.all([
    callRpc(env, accessToken, 'get_my_enterprise_intel_executive_summary'),
    callRpc(env, accessToken, 'get_my_enterprise_intel_kpi'),
    callRpc(env, accessToken, 'get_my_enterprise_intel_health_score'),
    callRpc(env, accessToken, 'get_my_enterprise_intel_store_ranking',
      { p_metric: 'health', p_direction: 'top', p_limit: 5 }),
    callRpc(env, accessToken, 'get_my_enterprise_intel_store_ranking',
      { p_metric: 'health', p_direction: 'bottom', p_limit: 5 }),
    callRpc(env, accessToken, 'get_my_enterprise_intel_risk_stores', { p_limit: 10 }),
    callRpc(env, accessToken, 'get_my_enterprise_intel_insights'),
    callRpc(env, accessToken, 'get_my_enterprise_intel_monthly_report', { p_month: monthYyyyMmDd }),
  ]);
  return { summary, kpi, health, top, bottom, risk, insights, monthly };
}

// -----------------------------------------------------------------------------
// PDF 합성
// -----------------------------------------------------------------------------

interface PdfColors {
  black: any;
  ink: any;
  muted: any;
  line: any;
  emerald: any;
  amber: any;
  rose: any;
  sky: any;
  violet: any;
}

function fmtMonthKr(iso: string): string {
  return iso.slice(0, 7).replace('-', '년 ') + '월';
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return `₩${Math.round(n).toLocaleString('en-US')}`;
}

function toneToColor(colors: PdfColors, tone: string) {
  return tone === 'stable' ? colors.emerald
       : tone === 'attention' ? colors.amber
       : tone === 'risk' ? colors.rose
       : colors.ink;
}

function severityToColor(colors: PdfColors, sev: string) {
  return sev === 'critical' ? colors.rose
       : sev === 'warning' ? colors.amber
       : colors.sky;
}

function severityLabelKr(sev: string) {
  return sev === 'critical' ? '위험' : sev === 'warning' ? '주의' : '정보';
}

// A4 · 다중 페이지 · 섹션 별 y-cursor 관리
async function buildPdf(hq: HqIdentity, monthYyyyMm: string, data: IntelSet): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit as any);
  const fontBytes = await loadKoreanFont();
  const korFont = await pdf.embedFont(fontBytes, { subset: true });
  const asciiFont = await pdf.embedFont(StandardFonts.Helvetica);

  const colors: PdfColors = {
    black:   rgb(0.05, 0.05, 0.06),
    ink:     rgb(0.18, 0.18, 0.22),
    muted:   rgb(0.42, 0.42, 0.48),
    line:    rgb(0.85, 0.85, 0.88),
    emerald: rgb(0.06, 0.53, 0.34),
    amber:   rgb(0.85, 0.55, 0.10),
    rose:    rgb(0.85, 0.16, 0.30),
    sky:     rgb(0.05, 0.45, 0.78),
    violet:  rgb(0.48, 0.31, 0.77),
  };

  const pageW = 595.28, pageH = 841.89;
  const marginX = 50, marginTop = 780, marginBottom = 60;
  let page = pdf.addPage([pageW, pageH]);
  let y = marginTop;

  const newPage = () => {
    // Footer
    drawFooter(page, colors, korFont, asciiFont, pageW, marginX);
    page = pdf.addPage([pageW, pageH]);
    y = marginTop;
  };

  const ensureSpace = (need: number) => {
    if (y - need < marginBottom + 20) newPage();
  };

  const draw = (text: string, x: number, yy: number, size = 10, color = colors.ink, font = korFont) => {
    page.drawText(text, { x, y: yy, size, font, color });
  };

  const drawLine = (x1: number, x2: number, yy: number, thickness = 0.5, color = colors.line) => {
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });
  };

  // -----------------------------
  // Header
  // -----------------------------
  draw(hq.enterprise_name, marginX, y, 20, colors.black); y -= 8;
  drawLine(marginX, pageW - marginX, y, 1, colors.line); y -= 22;
  draw(`브랜드 월간 운영 리포트 · ${fmtMonthKr(monthYyyyMm)}`, marginX, y, 12, colors.ink); y -= 18;
  if (hq.brand_code) {
    draw(`brand: ${hq.brand_code}`, marginX, y, 9, colors.muted, asciiFont); y -= 14;
  }
  y -= 6;

  // -----------------------------
  // 1) Executive Summary
  // -----------------------------
  ensureSpace(80);
  draw('Executive Summary', marginX, y, 12, colors.black); y -= 4;
  drawLine(marginX, pageW - marginX, y, 0.5); y -= 16;
  const tone = data.summary?.tone ?? 'stable';
  const lines: string[] = data.summary?.lines ?? [];
  const toneCol = toneToColor(colors, tone);
  for (const line of lines) {
    ensureSpace(18);
    draw(line, marginX, y, 11, toneCol); y -= 16;
  }
  y -= 6;

  // -----------------------------
  // 2) Executive KPI
  // -----------------------------
  ensureSpace(140);
  draw('Executive KPI', marginX, y, 12, colors.black); y -= 4;
  drawLine(marginX, pageW - marginX, y, 0.5); y -= 18;
  const kpiRows: Array<[string, string]> = [
    ['전체 매장', `${(data.kpi?.total_stores ?? 0).toLocaleString('en-US')} 곳`],
    ['온라인', `${(data.kpi?.active_stores ?? 0).toLocaleString('en-US')} 곳`],
    ['이번 달 정산 (이월 포함)', fmtMoney(data.kpi?.mtd_revenue ?? 0)],
    ['이월 예정', `${(data.kpi?.carryover_pending ?? 0).toLocaleString('en-US')} 건`],
    ['주의 매장', `${(data.kpi?.open_alerts ?? 0).toLocaleString('en-US')} 곳`],
  ];
  for (const [label, value] of kpiRows) {
    ensureSpace(18);
    draw(label, marginX, y, 10, colors.muted);
    draw(value, pageW - marginX - 200, y, 11, colors.black, asciiFont);
    y -= 18;
  }
  y -= 4;

  // -----------------------------
  // 3) Brand Health Score
  // -----------------------------
  ensureSpace(140);
  draw('Brand Health Score', marginX, y, 12, colors.black); y -= 4;
  drawLine(marginX, pageW - marginX, y, 0.5); y -= 18;
  const score = data.health?.score ?? 0;
  const scoreCol =
    score >= 80 ? colors.emerald
    : score >= 60 ? colors.amber
    : colors.rose;
  draw(`${score} / 100`, marginX, y, 24, scoreCol, asciiFont); y -= 22;

  const bd = data.health?.breakdown ?? {};
  const bdRows: Array<[string, string]> = [
    ['매장 health 평균', `${bd.avg_store_health ?? 0}`],
    ['온라인 비율', `${bd.online_ratio ?? 0} %`],
    ['정책 sync 비율', `${bd.policy_sync_ratio ?? 0} %`],
    ['재생 성공률', `${bd.playback_success_ratio ?? 0} %`],
  ];
  for (const [label, value] of bdRows) {
    ensureSpace(16);
    draw(label, marginX, y, 9, colors.muted);
    draw(value, pageW - marginX - 200, y, 10, colors.black, asciiFont);
    y -= 15;
  }
  y -= 4;
  const delta = data.health?.delta_7d_signal ?? {};
  draw('최근 7일 신호', marginX, y, 9, colors.muted); y -= 14;
  draw(`강제 동기화 이벤트: ${delta.force_resync_events ?? 0}건 · 지급 차단: ${delta.paid_blocked_events ?? 0}건`,
       marginX, y, 9, colors.ink); y -= 20;

  // -----------------------------
  // 4) Store Ranking
  // -----------------------------
  ensureSpace(140);
  draw('Store Ranking (Health)', marginX, y, 12, colors.black); y -= 4;
  drawLine(marginX, pageW - marginX, y, 0.5); y -= 18;
  const topRows = (data.top?.data ?? []) as any[];
  const botRows = (data.bottom?.data ?? []) as any[];
  draw('상위 5', marginX, y, 10, colors.emerald); y -= 14;
  for (const r of topRows) {
    ensureSpace(14);
    draw(`${r.health_score}`, marginX, y, 10, colors.emerald, asciiFont);
    draw(r.store_name ?? '(매장명 없음)', marginX + 30, y, 10, colors.ink);
    if (r.franchise_name) draw(r.franchise_name, marginX + 220, y, 9, colors.muted);
    y -= 14;
  }
  y -= 8;
  ensureSpace(14 * (botRows.length + 1) + 20);
  draw('하위 5', marginX, y, 10, colors.rose); y -= 14;
  for (const r of botRows) {
    ensureSpace(14);
    draw(`${r.health_score}`, marginX, y, 10, colors.rose, asciiFont);
    draw(r.store_name ?? '(매장명 없음)', marginX + 30, y, 10, colors.ink);
    if (r.franchise_name) draw(r.franchise_name, marginX + 220, y, 9, colors.muted);
    y -= 14;
  }
  y -= 8;

  // -----------------------------
  // 5) Risk Stores
  // -----------------------------
  ensureSpace(120);
  draw('Risk Stores', marginX, y, 12, colors.black); y -= 4;
  drawLine(marginX, pageW - marginX, y, 0.5); y -= 18;
  const riskRows = (data.risk?.data ?? []) as any[];
  if (riskRows.length === 0) {
    draw('현재 리스크 매장이 없습니다.', marginX, y, 10, colors.emerald); y -= 18;
  } else {
    for (const r of riskRows) {
      ensureSpace(16);
      const reason =
        r.is_offline_24h ? '오프라인'
        : r.has_playback_error ? '재생 오류'
        : r.has_policy_outdated ? '정책 지연'
        : r.has_device_missing ? '기기 미등록'
        : '주의';
      draw(`${r.health_score}`, marginX, y, 10, colors.rose, asciiFont);
      draw(r.store_name ?? '(매장명 없음)', marginX + 30, y, 10, colors.ink);
      draw(reason, marginX + 220, y, 9, colors.muted);
      y -= 14;
    }
  }
  y -= 8;

  // -----------------------------
  // 6) AI Insights
  // -----------------------------
  ensureSpace(120);
  draw('AI Insights', marginX, y, 12, colors.black); y -= 4;
  drawLine(marginX, pageW - marginX, y, 0.5); y -= 18;
  const insights = (data.insights?.insights ?? []) as any[];
  if (insights.length === 0) {
    draw('현재 특이사항이 없습니다.', marginX, y, 10, colors.emerald); y -= 18;
  } else {
    for (const ins of insights) {
      ensureSpace(38);
      const sevCol = severityToColor(colors, ins.severity ?? 'info');
      draw(`[${severityLabelKr(ins.severity ?? 'info')}]`, marginX, y, 9, sevCol); y -= 12;
      draw(ins.title ?? '', marginX, y, 11, colors.black); y -= 14;
      const body = String(ins.body ?? '');
      const chunks = wrapText(body, 82);
      for (const c of chunks) {
        ensureSpace(14);
        draw(c, marginX + 8, y, 9, colors.ink); y -= 12;
      }
      y -= 6;
    }
  }
  y -= 4;

  // -----------------------------
  // 7) Monthly Settlement + Carryover
  // -----------------------------
  ensureSpace(180);
  draw('Monthly Settlement Summary', marginX, y, 12, colors.black); y -= 4;
  drawLine(marginX, pageW - marginX, y, 0.5); y -= 18;
  const s = data.monthly?.settlement ?? null;
  if (!s) {
    draw('해당 월 정산 스냅샷이 없습니다.', marginX, y, 10, colors.muted); y -= 18;
  } else {
    const sRows: Array<[string, string]> = [
      ['상태', String(s.status ?? '-')],
      ['활성 매장', `${(s.active_store_count ?? 0).toLocaleString('en-US')} 곳`],
      ['매장 단가', fmtMoney(s.monthly_store_price)],
      ['수수료율', `${s.commission_rate ?? 0} %`],
      ['매장당', fmtMoney(s.per_store_commission)],
      ['총 정산금', fmtMoney(s.total_commission)],
      ['지난 이월', fmtMoney(s.previous_carryover)],
      ['누적 정산금 (effective_total)', fmtMoney(s.effective_total)],
      ['최소 정산금', fmtMoney(s.minimum_payout)],
      ['이월 chain 종료 여부', s.carryover_applied ? 'YES' : 'NO'],
      ['지급 참조', String(s.payment_reference ?? '-')],
    ];
    for (const [label, value] of sRows) {
      ensureSpace(15);
      draw(label, marginX, y, 9, colors.muted);
      draw(value, pageW - marginX - 240, y, 10, colors.black, asciiFont);
      y -= 14;
    }
    y -= 6;
    ensureSpace(60);
    draw('Carryover Summary', marginX, y, 11, colors.violet); y -= 14;
    const carryoverBrief = s.carryover_applied
      ? '이번 정산으로 이월 chain 이 종료됐어요.'
      : (s.previous_carryover && s.previous_carryover > 0)
        ? `${fmtMoney(s.previous_carryover)} 이월분이 이번 정산에 포함되어 있어요.`
        : (s.effective_total < (s.minimum_payout ?? 0))
          ? '이번 정산금이 최소정산금 미달로 다음 달로 자동 이월될 예정이에요.'
          : '해당 월 이월 chain 없음.';
    for (const c of wrapText(carryoverBrief, 70)) {
      ensureSpace(14);
      draw(c, marginX, y, 10, colors.ink); y -= 13;
    }
  }
  y -= 4;

  // -----------------------------
  // 8) Event Counts (monthly)
  // -----------------------------
  ensureSpace(80);
  draw('Event Counts (해당 월)', marginX, y, 12, colors.black); y -= 4;
  drawLine(marginX, pageW - marginX, y, 0.5); y -= 18;
  const evc = data.monthly?.event_counts ?? {};
  const evRows: Array<[string, string]> = [
    ['강제 동기화', `${evc.force_resync ?? 0} 건`],
    ['지급 차단', `${evc.paid_blocked ?? 0} 건`],
    ['이월 chain 생성', `${evc.carryover_created ?? 0} 건`],
    ['총 이벤트', `${evc.total_events ?? 0} 건`],
  ];
  for (const [label, value] of evRows) {
    ensureSpace(15);
    draw(label, marginX, y, 9, colors.muted);
    draw(value, pageW - marginX - 240, y, 10, colors.black, asciiFont);
    y -= 14;
  }

  // Footer for the last page
  drawFooter(page, colors, korFont, asciiFont, pageW, marginX);

  return await pdf.save();
}

function drawFooter(
  page: any, colors: PdfColors,
  korFont: any, asciiFont: any,
  pageW: number, marginX: number,
) {
  const y = 32;
  page.drawLine({
    start: { x: marginX, y: y + 14 }, end: { x: pageW - marginX, y: y + 14 },
    thickness: 0.5, color: colors.line,
  });
  page.drawText(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    { x: marginX, y, size: 8, font: asciiFont, color: colors.muted });
  page.drawText('DEUDDA (듣다) Enterprise Intelligence',
    { x: pageW - marginX - 210, y, size: 8, font: korFont, color: colors.muted });
}

// 텍스트를 대략 col 문자 폭으로 감싸는 헬퍼 (한글/영문 혼합 근사).
function wrapText(text: string, col = 80): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    const w = ch.charCodeAt(0) > 127 ? 2 : 1;
    // 근사: col=80 → 실제 한글 40자
    if ((cur.length * (cur.match(/[^\x00-\x7f]/g)?.length ? 2 : 1) + w) > col) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

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

  const rawMonth = String(body.month ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(rawMonth)) {
    return json({ error: 'validation', message: 'month must be YYYY-MM' }, 400);
  }
  const monthYyyyMmDd = `${rawMonth}-01`;

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'missing_bearer' }, 401);

  const t0 = Date.now();
  try {
    // 1) HQ 판정
    const hq = await verifyHqIdentity(env, token).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`HQ_GATE:${msg}`);
    });

    // 2) 8 RPC 병렬 (사용자 토큰 forward)
    const set = await fetchIntelSet(env, token, monthYyyyMmDd);

    // 3) PDF 합성
    const pdfBytes = await buildPdf(hq, rawMonth, set);

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="brand-report-${rawMonth}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Generation-Ms': String(Date.now() - t0),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('HQ_GATE:')) {
      return json({ error: 'forbidden', reason: msg.slice(8) }, 403);
    }
    return json({ error: 'pdf_generate_failed', message: msg, duration_ms: Date.now() - t0 }, 500);
  }
});
