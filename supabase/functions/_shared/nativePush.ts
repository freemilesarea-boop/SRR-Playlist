// supabase/functions/_shared/nativePush.ts
//
// 네이티브 앱 푸시 전송 — Android(FCM HTTP v1) / iOS(APNs HTTP/2).
//
// Web Push 와 전송 경로가 완전히 다르다:
//   • Android → FCM 등록 토큰. 서비스 계정으로 OAuth2 access token 을 받아 v1 API 호출.
//   • iOS     → APNs 디바이스 토큰. p8 키(ES256)로 서명한 JWT 로 APNs 에 직접 호출.
//
// iOS 에 Firebase SDK 를 넣지 않고 APNs 를 직접 쓰는 이유: 네이티브 프로젝트에
// GoogleService-Info.plist / Firebase pod 를 추가하지 않아도 되고, 전송 경로가 짧다.
//
// 필요한 환경변수 (없으면 해당 플랫폼 전송만 조용히 건너뛴다):
//   FCM_SERVICE_ACCOUNT_JSON  — Firebase 서비스 계정 JSON 전체(문자열)
//   APNS_KEY_P8               — APNs 인증 키(.p8) 내용
//   APNS_KEY_ID, APNS_TEAM_ID — 해당 키의 ID / Apple 팀 ID
//   APNS_BUNDLE_ID            — 앱 번들 ID (기본 com.deudda.app)
//   APNS_ENV                  — 'production'(기본) | 'sandbox'(개발 빌드)

export interface NativeToken {
  token: string;
  platform: 'ios' | 'android';
}

export interface PushNotification {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

export type SendStatus = 'sent' | 'gone' | 'failed' | 'skipped';

export interface SendResult {
  token: string;
  platform: 'ios' | 'android';
  status: SendStatus;
  error?: string;
}

/* ------------------------------------------------------------------ *
 * 공통 — base64url / JWT 서명
 * ------------------------------------------------------------------ */

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

/** PEM(-----BEGIN ...-----) → DER 바이트 */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ *
 * Android — FCM HTTP v1
 * ------------------------------------------------------------------ */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

let fcmTokenCache: { token: string; expiresAt: number } | null = null;

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key || !sa.project_id) return null;
    return sa;
  } catch {
    return null;
  }
}

/** 서비스 계정 JWT → OAuth2 access token (1시간 캐시). */
async function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (fcmTokenCache && fcmTokenCache.expiresAt > now + 60) return fcmTokenCache.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key).buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)),
  );
  const assertion = `${signingInput}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`fcm_oauth_${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  fcmTokenCache = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

async function sendFcm(
  sa: ServiceAccount,
  token: string,
  n: PushNotification,
): Promise<{ status: SendStatus; error?: string }> {
  const accessToken = await fcmAccessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: n.title, body: n.body ?? '' },
        // data 는 앱이 탭 시 라우팅에 쓴다(pushNotificationActionPerformed).
        data: { url: n.url ?? '/', tag: n.tag ?? '' },
        android: {
          priority: 'HIGH',
          notification: { tag: n.tag ?? undefined, default_sound: true },
        },
      },
    }),
  });

  if (res.ok) return { status: 'sent' };
  const text = await res.text();
  // 404 NOT_FOUND / UNREGISTERED = 만료된 토큰 → 정리 대상
  if (res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT')) {
    return { status: 'gone', error: `fcm_${res.status}` };
  }
  return { status: 'failed', error: `fcm_${res.status}: ${text.slice(0, 200)}` };
}

/* ------------------------------------------------------------------ *
 * iOS — APNs HTTP/2
 * ------------------------------------------------------------------ */

interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  host: string;
}

let apnsJwtCache: { jwt: string; issuedAt: number } | null = null;

/** APNs 인증 JWT(ES256). Apple 권고에 따라 ~50분마다 갱신. */
async function apnsJwt(cfg: ApnsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwtCache && now - apnsJwtCache.issuedAt < 3000) return apnsJwtCache.jwt;

  const header = { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' };
  const claims = { iss: cfg.teamId, iat: now };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(cfg.keyP8).buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)),
  );
  const jwt = `${signingInput}.${b64url(sig)}`;
  apnsJwtCache = { jwt, issuedAt: now };
  return jwt;
}

async function sendApns(
  cfg: ApnsConfig,
  token: string,
  n: PushNotification,
): Promise<{ status: SendStatus; error?: string }> {
  const jwt = await apnsJwt(cfg);
  const res = await fetch(`${cfg.host}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': cfg.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      ...(n.tag ? { 'apns-collapse-id': n.tag.slice(0, 64) } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      aps: {
        alert: { title: n.title, body: n.body ?? '' },
        sound: 'default',
      },
      // 앱이 탭 시 라우팅에 쓴다.
      url: n.url ?? '/',
    }),
  });

  if (res.ok) return { status: 'sent' };
  const text = await res.text();
  // 410 Unregistered / 400 BadDeviceToken = 만료 토큰 → 정리 대상
  if (res.status === 410 || text.includes('BadDeviceToken') || text.includes('Unregistered')) {
    return { status: 'gone', error: `apns_${res.status}` };
  }
  return { status: 'failed', error: `apns_${res.status}: ${text.slice(0, 200)}` };
}

/* ------------------------------------------------------------------ *
 * 공개 API
 * ------------------------------------------------------------------ */

export interface NativePushEnv {
  FCM_SERVICE_ACCOUNT_JSON?: string;
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_ENV?: string;
}

export function readNativePushEnv(get: (k: string) => string | undefined): NativePushEnv {
  return {
    FCM_SERVICE_ACCOUNT_JSON: get('FCM_SERVICE_ACCOUNT_JSON'),
    APNS_KEY_P8: get('APNS_KEY_P8'),
    APNS_KEY_ID: get('APNS_KEY_ID'),
    APNS_TEAM_ID: get('APNS_TEAM_ID'),
    APNS_BUNDLE_ID: get('APNS_BUNDLE_ID') || 'com.deudda.app',
    APNS_ENV: get('APNS_ENV') || 'production',
  };
}

function apnsConfig(env: NativePushEnv): ApnsConfig | null {
  if (!env.APNS_KEY_P8 || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return null;
  return {
    keyP8: env.APNS_KEY_P8,
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    bundleId: env.APNS_BUNDLE_ID || 'com.deudda.app',
    host: env.APNS_ENV === 'sandbox'
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com',
  };
}

/** 어떤 플랫폼 전송이 설정돼 있는지 — 진단/응답용. */
export function nativePushReadiness(env: NativePushEnv): { android: boolean; ios: boolean } {
  return {
    android: !!parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON ?? ''),
    ios: !!apnsConfig(env),
  };
}

/**
 * 네이티브 토큰들에 발송.
 * 자격증명이 없는 플랫폼은 'skipped' — 에러가 아니라 미설정이다.
 */
export async function sendNativePush(
  env: NativePushEnv,
  tokens: readonly NativeToken[],
  n: PushNotification,
): Promise<SendResult[]> {
  const sa = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON ?? '');
  const apns = apnsConfig(env);
  const out: SendResult[] = [];

  for (const t of tokens) {
    try {
      if (t.platform === 'android') {
        if (!sa) {
          out.push({ ...t, status: 'skipped', error: 'FCM_SERVICE_ACCOUNT_JSON 미설정' });
          continue;
        }
        const r = await sendFcm(sa, t.token, n);
        out.push({ ...t, ...r });
      } else {
        if (!apns) {
          out.push({ ...t, status: 'skipped', error: 'APNS_* 미설정' });
          continue;
        }
        const r = await sendApns(apns, t.token, n);
        out.push({ ...t, ...r });
      }
    } catch (e) {
      out.push({ ...t, status: 'failed', error: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}
