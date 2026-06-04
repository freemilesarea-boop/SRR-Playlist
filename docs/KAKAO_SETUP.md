# Kakao 통합 설정 가이드 (X6.2)

## 1차 범위 (지금)
- 카카오 로그인 (Supabase Auth OAuth)
- 카카오톡 공유 (트랙 / 플레이리스트)
- 문의 폼 `wants_kakao_contact` 필드 (운영자 수동 응대용)
- 2차 자동 발송용 구조 준비 (DB 컬럼 + Edge Function stub)

## 2차 범위 (추후)
- 운영자 답변 시 사용자 본인 카톡으로 자동 알림 ("나에게 보내기")
- 알림톡 / 친구톡 자동 발송 (별도 솔루션사 계약 필요)

---

## 발급된 키 (테스트 앱: 듣다 DEUDDA-TEST, ID 1477106)

| 키 종류 | 노출 범위 | 저장 위치 |
|---|---|---|
| JavaScript Key | 브라우저 노출 OK | `.env` → `VITE_KAKAO_JS_KEY` |
| REST API Key | 서버 전용 | Supabase Dashboard Auth Provider + Edge Function Secret |
| Admin Key | 서버 전용 | Supabase Edge Function Secret |
| Native App Key | 모바일 앱 전용 (현재 미사용) | 별도 |

⚠️ **운영 배포 전 반드시 키 재발급(rotate)** — 채팅/스크린샷 노출 이력 때문에 보안 안전선 확보.

---

## 수동 설정 단계

### A) Supabase Auth Kakao Provider 활성화
1. Supabase Dashboard → Authentication → Providers → Kakao
2. **Enable Kakao Provider** 토글 ON
3. **Client ID**: Kakao Developers → 앱 → 플랫폼 키 → **REST API Key** 입력
4. **Client Secret**: Kakao Developers → 보안 → **Client Secret** 코드 (없으면 "코드 생성")
   - 활성화 상태 = "사용함" 으로 변경
5. **Authorized Client IDs**: 비워둠 (single client app)
6. **Redirect URL** 복사 (예: `https://nsoesrvwkxqifjcxzvol.supabase.co/auth/v1/callback`)
   → Kakao Developers → 앱 → 카카오 로그인 → Redirect URI 에 등록

### B) Kakao Developers 콘솔 설정
1. **앱 → 카카오 로그인 → 활성화 설정 ON**
2. **앱 → 카카오 로그인 → Redirect URI**:
   - `https://nsoesrvwkxqifjcxzvol.supabase.co/auth/v1/callback`
   - (로컬 개발용) `http://localhost:5173/auth/callback` 등
3. **앱 → 카카오 로그인 → 동의항목** 활성화:
   - 닉네임 (필수)
   - 카카오계정(이메일) (필수)
   - 카카오톡 메시지 전송 (`talk_message`) (선택 — 2차 작업용)
4. **앱 → 앱 설정 → 플랫폼**:
   - Web 플랫폼 추가
   - 도메인: `https://app.deudda.com` (또는 운영 도메인) + `http://localhost:5173`

### C) Supabase Edge Function Secrets (2차 카톡 발송 활성화 시)
```bash
# CLI 로 설정 (or Dashboard → Edge Functions → Secrets)
supabase secrets set \
  KAKAO_REST_API_KEY=<REST_API_KEY> \
  KAKAO_ADMIN_KEY=<ADMIN_KEY>
```

### D) 로컬 `.env`
```bash
# .env (gitignored)
VITE_KAKAO_JS_KEY=<JS_KEY>
```

---

## 테스트 시나리오

### 카카오 로그인
1. `/login` 페이지 → "카카오로 로그인" 버튼 클릭
2. Kakao 동의화면 (닉네임 + 이메일 + talk_message) → 동의
3. `/auth/callback` 으로 redirect → 정상 로그인
4. `auth.users.raw_user_meta_data` 에 Kakao profile 저장됨
5. `auth.users.identities` 에 provider='kakao' identity 생성

### 카카오톡 공유
1. 트랙 상세 페이지 (`/track/:id`) → 공유 영역 "카카오톡" 버튼
2. 카카오톡 앱 (모바일) 또는 카톡 데스크톱 (PC) → 채팅 대상 선택 → 카드 전송
3. `share_events` 테이블에 `method='kakao_share'` row 적재

### 문의 폼
1. 임의 페이지 → 문의하기 모달
2. "카카오톡으로 답변 받기 희망" 체크
3. 문의 저장 → admin 패널 노란 "카톡" 뱃지 표시 → 운영자가 수동 응대

---

## 보안 체크리스트

- [ ] `.env` 가 git 에 커밋되지 않았는지 확인 (`git status` / `git check-ignore .env`)
- [ ] REST API Key / Admin Key 가 클라이언트 번들에 포함되지 않았는지 (`grep -r "<REST_API_KEY_PREFIX>\|<ADMIN_KEY_PREFIX>" dist/` — 실제 키 앞 8자리로 검색)
- [ ] Supabase Edge Function Secret 만 서버 측 키 보관
- [ ] 운영 배포 시 키 재발급 + 운영 전용 앱 분리 권장
- [ ] Kakao Developers → 보안 → IP 화이트리스트 (선택) — Supabase Edge Function 출발 IP 제한 가능
