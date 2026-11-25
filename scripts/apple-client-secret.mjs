#!/usr/bin/env node
/**
 * apple-client-secret.mjs — Supabase "Sign in with Apple" 에 넣을 Secret Key(JWT)를 만든다.
 *
 *   npm run apple-secret -- --p8 ~/Downloads/AuthKey_XXXXXXXXXX.p8 --team ABCDE12345 --key XXXXXXXXXX
 *
 *   --p8      Apple Developer → Keys 에서 받은 .p8 파일 경로
 *   --team    Team ID (Apple Developer 오른쪽 위 계정 이름 아래)
 *   --key     Key ID  (키 상세 화면)
 *   --client  Services ID (기본값 com.deudda.app.signin)
 *
 * 비밀키는 이 Mac 밖으로 나가지 않는다 — 외부 생성 사이트에 .p8 을 올리지 않기 위한 스크립트.
 * 결과(JWT)는 Supabase → Authentication → Providers → Apple → Secret Key 에 붙여 넣는다.
 *
 * ⏰ Apple 은 이 JWT 의 유효기간을 최대 6개월로 제한한다. 만료되면 Apple 로그인만 조용히 실패하므로
 *    출력되는 만료일 전에 같은 명령으로 다시 만들어 교체한다.
 */
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { homedir } from 'node:os';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const p8Path = arg('p8')?.replace(/^~(?=\/)/, homedir());
const teamId = arg('team');
const keyId = arg('key');
const clientId = arg('client', 'com.deudda.app.signin');

if (!p8Path || !teamId || !keyId) {
  console.error('사용법: npm run apple-secret -- --p8 <AuthKey_XXXX.p8 경로> --team <Team ID> --key <Key ID> [--client <Services ID>]');
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const now = Math.floor(Date.now() / 1000);
const exp = now + 180 * 24 * 60 * 60 - 60; // Apple 상한(6개월)보다 조금 짧게

const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
const payload = { iss: teamId, iat: now, exp, aud: 'https://appleid.apple.com', sub: clientId };

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const key = createPrivateKey(readFileSync(p8Path, 'utf8'));
// JWT 의 ES256 서명은 DER 이 아니라 r||s(64바이트) 형식이어야 한다.
const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });

console.log(`${signingInput}.${b64url(signature)}`);
console.error(`\n✅ Services ID: ${clientId}`);
console.error(`⏰ 만료: ${new Date(exp * 1000).toLocaleDateString('ko-KR')} — 그 전에 다시 만들어 Supabase 에 교체하세요.`);
