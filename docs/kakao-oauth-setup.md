# 카카오 로그인 설정 가이드 (X6.11)

운영자/관리자가 **Supabase Dashboard** + **Kakao Developers 콘솔**에서 직접 설정해야 합니다.
코드 측은 X6.11 에서 이미 정상 처리됨 (scope 단순화 + 친절 에러 핸들링).

---

## 1) Kakao Developers 콘솔
URL: <https://developers.kakao.com/console/app>

### 1-1. 앱 생성 또는 기존 앱 선택
- 앱 이름: `DEUDDA` (또는 운영 명칭)
- 사업자명 / 카테고리 입력

### 1-2. 카카오 로그인 활성화
1. 좌측 메뉴 **제품 설정 → 카카오 로그인**
2. **활성화 설정 ON**
3. **OpenID Connect 활성화 ON** (Supabase 가 OIDC 요구)

### 1-3. Redirect URI 등록 (필수)
**카카오 로그인 → Redirect URI** 에 정확히 1개 등록:
```
https://nsoesrvwkxqifjcxzvol.supabase.co/auth/v1/callback
```

> ⚠️ Supabase URL 의 callback 경로를 등록해야 합니다.
> 우리 도메인 (`deudda.com/auth/callback`) 이 아닙니다.

### 1-4. Web 플랫폼 도메인 등록
**플랫폼 → Web** 에서 사이트 도메인 추가:
```
https://www.deudda.com
https://deudda.com
http://localhost:5173
```

### 1-5. 동의항목 (필수 / 선택)
**카카오 로그인 → 동의항목** 설정:

| 항목 | 권장 설정 |
|---|---|
| 닉네임 (`profile_nickname`) | **필수 동의** |
| 카카오계정 (이메일) (`account_email`) | **필수 동의** |
| `talk_message` | **제거** (X6.11 에서 코드에서도 제외함) |
| 그 외 | 사용 안 함 |

> `account_email` 은 비즈 앱이 아니면 "선택 동의" 만 가능합니다. 별도 비즈 앱 전환 시 필수 가능.

### 1-6. REST API 키 / Client Secret 확보
- **앱 설정 → 일반** 페이지의 **REST API 키** 복사 → Supabase Client ID
- **카카오 로그인 → 보안 → Client Secret** 코드 활성화 후 생성 → 복사

---

## 2) Supabase Dashboard
URL: <https://supabase.com/dashboard/project/nsoesrvwkxqifjcxzvol/auth/providers>

### 2-1. Kakao provider 활성화
1. **Authentication → Providers → Kakao**
2. **Enable Kakao provider** 토글 ON
3. **Kakao client ID (REST API key)** 입력 → 위 1-6 의 REST API 키
4. **Kakao client secret** 입력 → 위 1-6 의 Client Secret
5. **Save**

### 2-2. Redirect URL 확인
Supabase 가 자동으로 표시하는 callback URL:
```
https://nsoesrvwkxqifjcxzvol.supabase.co/auth/v1/callback
```
이 값이 Kakao Developers 의 Redirect URI 와 **정확히 일치**해야 합니다 (1-3 참고).

### 2-3. (옵션) Site URL / Additional Redirect URLs
**Authentication → URL Configuration**:
- Site URL: `https://www.deudda.com`
- Redirect URLs:
  - `https://www.deudda.com/auth/callback`
  - `https://deudda.com/auth/callback`
  - `http://localhost:5173/auth/callback`

> 이 설정이 없으면 카카오 → Supabase 콜백 후 우리 사이트로 돌아올 때 차단됩니다.

---

## 3) 코드 측 변경 (X6.11 적용 완료)
- `src/store/authStore.ts` — scope 에서 `talk_message` 제거. `profile_nickname account_email` 만 요청
- `src/pages/LoginPage.tsx` — `validation_failed` / `provider is not enabled` 메시지 감지 시 친절한 한국어 토스트 + 인라인 안내
- `src/components/FloatingSupportButton.tsx` — fallback 동일 처리

---

## 4) 테스트 체크리스트
- [ ] Supabase Dashboard → Kakao provider Enable 토글 **ON** 확인
- [ ] Kakao Developers → 카카오 로그인 활성화 + Redirect URI 등록 확인
- [ ] 운영 사이트 (`/login`) 에서 "카카오로 로그인" 클릭
- [ ] 카카오 동의 화면 진입 (`profile_nickname` + `account_email` 표시)
- [ ] 동의 후 `https://nsoesrvwkxqifjcxzvol.supabase.co/auth/v1/callback` 거쳐 우리 사이트 `/auth/callback` 진입
- [ ] `public.users` 행 자동 생성 (handle_new_user 트리거)
- [ ] `profile.nickname` 카카오 닉네임으로 채워짐
- [ ] 기존 이메일 계정과 충돌 시 Supabase 가 별도 row 생성 (동일 이메일이라도 identities 가 다름) — 충돌 시 운영팀이 수동 머지

---

## 5) 운영 발생 가능 에러 → 처리

| 에러 메시지 | 원인 | 해결 |
|---|---|---|
| `provider is not enabled` | Supabase Provider OFF | 2-1 단계 토글 ON |
| `redirect_uri_mismatch` | Kakao 에 등록된 Redirect URI 가 Supabase 와 다름 | 1-3 URL 정확히 복사 |
| `invalid_client` | Client Secret 잘못 입력 | 1-6 → 2-1 Client Secret 재발급 + 재입력 |
| `KOE006 (서비스 환경 미등록)` | Web 플랫폼 도메인 누락 | 1-4 도메인 추가 |
| 동의 화면에 이메일 없음 | account_email 동의항목 비활성화 | 1-5 필수 동의 ON |
