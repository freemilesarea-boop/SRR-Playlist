'use strict';
/*
 * BRAND-PLAYER-PREVIEW-QA-2-RERUN — portable automated browser QA harness.
 *
 * Runs the full persistent-binding brand-player flow against a running app URL
 * (a Vercel Preview, or a local `vite preview`) that is BUILT WITH THE TEST
 * Supabase env and has network egress to the Test Supabase host.
 *
 * It NEVER prints secrets. Password is read from QA_PASSWORD (env). The run
 * FAILS CLOSED (exit 2) if any request targets the Production Supabase host.
 *
 * Usage:
 *   npm i -D playwright   # or use a global/system Chromium via CHROMIUM_PATH
 *   QA_BASE_URL="https://<preview-url>" \
 *   QA_EMAIL="qa-brand-user@test.invalid" \
 *   QA_PASSWORD="********" \
 *   QA_TEST_HOST="haojpuhztegecbrwqorr.supabase.co" \
 *   QA_PROD_HOST="nsoesrvwkxqifjcxzvol.supabase.co" \
 *   QA_STORE_A="QA-STORE-ALPHA-7X3K9" QA_STORE_B="QA-STORE-BETA-4M8P2" \
 *   QA_BRAND_A="b0000000-0000-4000-8000-0000000000a1" \
 *   QA_BRAND_B="b0000000-0000-4000-8000-0000000000b2" \
 *   [CHROMIUM_PATH=/opt/pw-browsers/chromium] \
 *   node qa_brand_player.js
 *
 * Note: revoked / expired binding checks require a Test-SQL mutation on
 * public.brand_player_sessions (revoked_at / expires_at) between steps; those
 * are left to the operator runbook. This harness covers login, first connect,
 * refresh / new-tab / browser-restart auto-entry, controls presence, store
 * switch, device disconnect, tampered-binding fail-closed, and logout.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CFG = {
  base: process.env.QA_BASE_URL,
  email: process.env.QA_EMAIL || 'qa-brand-user@test.invalid',
  password: process.env.QA_PASSWORD,
  testHost: process.env.QA_TEST_HOST || 'haojpuhztegecbrwqorr.supabase.co',
  prodHost: process.env.QA_PROD_HOST || 'nsoesrvwkxqifjcxzvol.supabase.co',
  storeA: process.env.QA_STORE_A,
  storeB: process.env.QA_STORE_B,
  brandA: process.env.QA_BRAND_A,
  brandB: process.env.QA_BRAND_B,
  exe: process.env.CHROMIUM_PATH || undefined,
  shots: process.env.QA_SHOTS_DIR || path.join(os.tmpdir(), 'brand-qa-shots'),
};
for (const k of ['base', 'password', 'storeA', 'storeB', 'brandA', 'brandB']) {
  if (!CFG[k]) { console.error(`Missing required env for "${k}". See header.`); process.exit(1); }
}
fs.mkdirSync(CFG.shots, { recursive: true });

const results = [];
const supabaseHosts = new Set();
let prodViolation = false;
const rec = (name, status, detail) => { results.push({ name, status, detail: detail || '' }); console.log(`[${status}] ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function guard(ctx) {
  ctx.on('request', (req) => {
    let host; try { host = new URL(req.url()).host; } catch { return; }
    if (host.endsWith('supabase.co')) supabaseHosts.add(host);
    if (host === CFG.prodHost) { prodViolation = true; console.error('P0 PRODUCTION-HOST REQUEST:', req.method(), req.url().split('?')[0]); }
  });
}
const dump = (page) => page.evaluate(() => (typeof window.__brandPlayerDebug === 'function' ? window.__brandPlayerDebug() : null)).catch(() => null);
async function waitPlayer(page, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const d = await dump(page); if (d && d.queueLength > 0) return d; await sleep(400); }
  return dump(page);
}
async function enterStore(page, code, brand) {
  await page.goto(`${CFG.base}/brand`, { waitUntil: 'domcontentloaded' });
  const onCode = await page.waitForSelector('#store-code', { timeout: 6000 }).then(() => true).catch(() => false);
  if (!onCode) return { auto: true };
  await page.fill('#store-code', code);
  await page.click('button[type="submit"]');
  await page.waitForFunction((b) => location.pathname.includes(`/brand/player/${b}`), brand, { timeout: 20000 });
  return { auto: false };
}

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-qa-'));
  let ctx = await chromium.launchPersistentContext(userDir, { executablePath: CFG.exe, headless: true, viewport: { width: 1440, height: 900 } });
  guard(ctx);
  const envLines = [];
  ctx.on('console', (m) => { const t = m.text(); if (t.includes('[SupabaseEnv]')) envLines.push(t); });
  let page = ctx.pages()[0] || await ctx.newPage();
  try {
    // login
    await page.goto(`${CFG.base}/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { try { localStorage.setItem('srr-onboarding-seen', 'true'); } catch {} });
    await page.waitForSelector('#email-input', { timeout: 20000 });
    await page.fill('#email-input', CFG.email);
    await page.fill('input[type="password"]', CFG.password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 25000 });
    rec('login', 'PASS', new URL(page.url()).pathname);

    rec('supabase_env_host', (!prodViolation && [...supabaseHosts].every((h) => h === CFG.testHost)) ? 'PASS' : 'FAIL', `hosts=${[...supabaseHosts].join(',')}`);

    // first connect (store A)
    await enterStore(page, CFG.storeA, CFG.brandA);
    let d = await waitPlayer(page);
    rec('store_a_first_connect', d && d.queueLength === 15 && d.mediaCount === 4 ? 'PASS' : 'FAIL', `queue=${d?.queueLength} media=${d?.mediaCount}`);
    await page.screenshot({ path: path.join(CFG.shots, '01_player_a.png') });

    // refresh
    await page.reload({ waitUntil: 'domcontentloaded' });
    d = await waitPlayer(page);
    rec('refresh_auto_entry', page.url().includes(CFG.brandA) && d?.queueLength === 15 ? 'PASS' : 'FAIL', `queue=${d?.queueLength}`);

    // new tab
    const t2 = await ctx.newPage();
    await t2.goto(`${CFG.base}/brand`, { waitUntil: 'domcontentloaded' });
    await t2.waitForFunction((b) => location.pathname.includes(`/brand/player/${b}`), CFG.brandA, { timeout: 15000 }).catch(() => {});
    const d2 = await waitPlayer(t2);
    rec('new_tab_auto_entry', t2.url().includes(CFG.brandA) && d2?.queueLength === 15 ? 'PASS' : 'FAIL', `queue=${d2?.queueLength}`);
    await t2.close();

    // controls presence
    const c = await page.evaluate(() => ({ buttons: document.querySelectorAll('button').length, range: !!document.querySelector('input[type="range"]'), sw: !!document.querySelector('button[title="다른 매장 코드 입력"]'), dc: !!document.querySelector('button[title="이 기기의 매장 연결 해제"]') }));
    rec('player_controls_present', c.buttons > 3 && c.sw && c.dc ? 'PASS' : 'PARTIAL', `buttons=${c.buttons} range=${c.range}`);
    await page.screenshot({ path: path.join(CFG.shots, '02_controls.png') });

    // browser restart
    await ctx.close();
    ctx = await chromium.launchPersistentContext(userDir, { executablePath: CFG.exe, headless: true, viewport: { width: 1440, height: 900 } });
    guard(ctx);
    page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(`${CFG.base}/brand/player/${CFG.brandA}`, { waitUntil: 'domcontentloaded' });
    d = await waitPlayer(page);
    rec('browser_restart_auto_entry', page.url().includes(CFG.brandA) && d?.queueLength === 15 ? 'PASS' : 'FAIL', `queue=${d?.queueLength}`);
    await page.screenshot({ path: path.join(CFG.shots, '03_restart.png') });

    // switch store A -> B
    await page.click('button[title="다른 매장 코드 입력"]').catch(() => {});
    await page.waitForSelector('#store-code', { timeout: 10000 });
    await page.fill('#store-code', CFG.storeB);
    await page.click('button[type="submit"]');
    await page.waitForFunction((b) => location.pathname.includes(`/brand/player/${b}`), CFG.brandB, { timeout: 20000 });
    d = await waitPlayer(page);
    rec('store_switch_a_to_b', d && d.queueLength === 15 ? 'PASS' : 'FAIL', `queue=${d?.queueLength} media=${d?.mediaCount}`);
    await page.screenshot({ path: path.join(CFG.shots, '04_player_b.png') });

    // tampered binding fail-closed
    await page.evaluate((b) => { try { localStorage.setItem('srr.brand.binding.' + b, 'tampered-invalid-token'); } catch {} }, CFG.brandB);
    await page.goto(`${CFG.base}/brand/player/${CFG.brandB}`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const blocked = !!(await page.$('#store-code')) || !page.url().includes(`/brand/player/${CFG.brandB}`);
    rec('tampered_binding_block', blocked ? 'PASS' : 'FAIL', `url=${new URL(page.url()).pathname}`);
    await page.screenshot({ path: path.join(CFG.shots, '05_tamper.png') });

    // device disconnect (reconnect B first)
    await enterStore(page, CFG.storeB, CFG.brandB);
    await waitPlayer(page);
    await page.click('button[title="이 기기의 매장 연결 해제"]').catch(() => {});
    await sleep(2000);
    const discBack = !!(await page.$('#store-code')) || page.url().endsWith('/brand');
    rec('device_disconnect', discBack ? 'PASS' : 'FAIL', `url=${new URL(page.url()).pathname}`);

    // logout
    await enterStore(page, CFG.storeA, CFG.brandA);
    await waitPlayer(page);
    await page.goto(`${CFG.base}/profile`, { waitUntil: 'domcontentloaded' });
    await page.getByText('로그아웃', { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
    await sleep(2500);
    await page.goto(`${CFG.base}/brand/player/${CFG.brandA}`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const loggedOut = page.url().includes('/login');
    rec('logout_blocks_auto_entry', loggedOut ? 'PASS' : 'FAIL', `url=${new URL(page.url()).pathname}`);
    await page.screenshot({ path: path.join(CFG.shots, '06_logout.png') });

  } catch (e) {
    rec('EXCEPTION', 'FAIL', String(e && e.message ? e.message : e));
  } finally {
    const summary = { base: CFG.base, prodViolation, supabaseHosts: [...supabaseHosts], envLines, results };
    const out = path.join(CFG.shots, 'qa_results.json');
    fs.writeFileSync(out, JSON.stringify(summary, null, 2));
    console.log('\n=== hosts:', [...supabaseHosts].join(', '), '| prodViolation:', prodViolation, '| results →', out);
    await ctx.close();
    process.exit(prodViolation ? 2 : 0);
  }
})();
