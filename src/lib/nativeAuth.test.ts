// 딥링크 콜백 판별 — 여기가 틀리면 앱 로그인이 통째로 죽는다.
//
// 실제로 죽어 있었다. 서버 로그에는 구글 인증이 정상으로 끝난 302 가 남는데
// (authorize → accounts.google.com → callback, code 까지 발급) 앱은 매번
// 로그인 실패로 처리했다. ?code= 만 읽었기 때문이다. 우리 supabase 클라이언트는
// flowType 을 지정하지 않아 implicit 이고, implicit 은 토큰을 프래그먼트로 보낸다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseOAuthCallback, NATIVE_OAUTH_REDIRECT } from './nativeAuth';

const REDIRECT = 'com.deudda.app://auth/callback';

describe('parseOAuthCallback', () => {
  it('implicit — 프래그먼트의 토큰을 읽는다 (지금 우리 설정)', () => {
    const url = `${REDIRECT}#access_token=AAA&refresh_token=BBB&expires_in=3600&token_type=bearer`;
    expect(parseOAuthCallback(url)).toEqual({
      kind: 'tokens',
      accessToken: 'AAA',
      refreshToken: 'BBB',
    });
  });

  it('pkce — 쿼리의 코드를 읽는다 (나중에 flowType 을 바꿔도 동작)', () => {
    expect(parseOAuthCallback(`${REDIRECT}?code=xyz789`)).toEqual({
      kind: 'code',
      code: 'xyz789',
    });
  });

  it('access_token 만 있고 refresh_token 이 없으면 세션을 세울 수 없다', () => {
    // 반쪽짜리 자격증명으로 setSession 을 부르면 토큰 갱신이 안 되는 세션이 생긴다.
    const r = parseOAuthCallback(`${REDIRECT}#access_token=AAA&expires_in=3600`);
    expect(r.kind).toBe('error');
  });

  it('쿼리 에러를 알아본다', () => {
    const r = parseOAuthCallback(`${REDIRECT}?error=access_denied&error_description=user%20denied`);
    expect(r).toEqual({ kind: 'error', message: 'user denied' });
  });

  it('프래그먼트 에러도 알아본다 — implicit 은 에러도 프래그먼트로 온다', () => {
    const r = parseOAuthCallback(`${REDIRECT}#error=server_error&error_description=boom`);
    expect(r).toEqual({ kind: 'error', message: 'boom' });
  });

  it('에러와 자격증명이 같이 오면 에러가 이긴다', () => {
    const r = parseOAuthCallback(`${REDIRECT}?error=access_denied#access_token=AAA&refresh_token=BBB`);
    expect(r.kind).toBe('error');
  });

  it('아무것도 없으면 실패로 본다 — 조용히 성공으로 넘기지 않는다', () => {
    expect(parseOAuthCallback(REDIRECT).kind).toBe('error');
  });

  it('URL 이 아니면 실패로 본다', () => {
    expect(parseOAuthCallback('!!! not a url').kind).toBe('error');
  });
});

// 딥링크가 코드에만 있고 Supabase 허용 목록에 없으면 인증은 성공하는데 앱으로 못 돌아온다.
// 브라우저에 그대로 갇히고, 앱에는 아무 로그도 안 남아서 원인을 찾기 어렵다.
describe('Supabase 리다이렉트 허용 목록', () => {
  const configToml = readFileSync(
    fileURLToPath(new URL('../../supabase/config.toml', import.meta.url)),
    'utf8',
  );

  it('네이티브 딥링크가 additional_redirect_urls 에 있다', () => {
    expect(configToml).toContain(`"${NATIVE_OAUTH_REDIRECT}"`);
  });

  it('운영 도메인도 그대로 남아 있다', () => {
    // 딥링크를 넣다가 웹 콜백을 지우면 웹 로그인이 통째로 죽는다.
    expect(configToml).toContain('"https://deudda.com"');
    expect(configToml).toContain('"https://www.deudda.com"');
  });
});
