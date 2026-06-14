# Sentry Alert 설정 — 매장 무인 운영 가시성

X6.67 (2026-06-14) 정리.

## 배경

매장(business) 모드는 사용자가 화면을 보지 않는 무인환경에서 8~24시간 연속으로 음악을 재생함.
이 환경에서 발생하는 silent failure (무음, 자동 스킵, 메타 타임아웃 등) 는
운영자가 직접 매장에 가지 않으면 인지하기 어려움. **Sentry alert 로 즉시 통지** 한다.

## 통합 현황

- SDK: `@sentry/react@^10.53.1` (이미 설치)
- 초기화: `src/main.tsx` → `initSentry()` (DSN 없으면 silent skip, production 만 활성)
- DSN 환경변수: `VITE_SENTRY_DSN` (Vercel Project Settings → Environment Variables)
- PII 마스킹: 이메일, API key, token, secret, password 자동 마스킹 (`src/lib/sentry.ts`)

## Capture 헬퍼

| 헬퍼 | 용도 | tag |
|---|---|---|
| `captureError(err, ctx)` | 일반 오류 | (없음) |
| `captureBusinessError(err, scope, ctx)` | **매장 무인환경 critical** | `business_mode=true`, `alert_priority=high`, `scope=<scope>` |

## 매장 모드 capture 지점 (X6.67)

| Scope tag | 트리거 | 원인/추정 |
|---|---|---|
| `player.meta_timeout` | 12초 안에 loadedmetadata 없음 | iOS 가 못 읽는 WAV / 손상 파일 / 네트워크 stall |
| `player.network_retry_exhausted` | NETWORK(code 2) 3회 재시도 모두 실패 | 매장 네트워크 단절 / Supabase Storage 다운 / CDN 차단 |
| `player.permanent_error_business` | DECODE/SRC_NOT_SUPPORTED + 자동 스킵 | 잘못된 mime / 손상 audio / iOS 미지원 형식 |
| `useStartBusinessMode` | 매장 모드 시작 실패 | 플레이리스트 fetch 실패 / 권한 |
| `useBusinessAutoSwitch.prefetch` | 다음 스케줄 트랙 prefetch 실패 | RLS / 네트워크 |
| `useBusinessAutoSwitch.autoswitch` | 시간대 자동 전환 실패 | RPC 오류 / 권한 |

## Sentry UI 에서 Alert Rule 설정

### 권장 Alert 1: 매장 critical 즉시 통지 (1순위)

**조건:**
- Issue 가 **새로 발생** (First seen) OR 분당 발생률이 0→1 이상
- Filter: `tags["business_mode"] = "true"` AND `tags["alert_priority"] = "high"`

**Action:**
- Email: 운영팀 이메일 그룹
- Slack: `#srr-store-alerts` 채널 (Slack integration 설치 필요)
- (선택) Webhook: 매장 dashboard 로 push

**Frequency:** 가능한 한 즉시 (Sentry 기본 ~1분 latency)

### 권장 Alert 2: 매장 오류 burst (네트워크/장애)

**조건:**
- `tags["business_mode"] = "true"` AND `tags["scope"] = "player.network_retry_exhausted"`
- 10분 안에 동일 매장(사용자 ID) 에서 5건 이상

**Action:**
- Slack 만 (이메일 폭주 방지)
- 메시지: "매장 X — 10분 내 네트워크 오류 5건. 인터넷 확인 필요"

### 권장 Alert 3: 신규 이슈만 Daily Digest

**조건:**
- 신규 issue (지난 24시간)
- 매장 외 일반 사용자도 포함

**Action:**
- 매일 09:00 KST 이메일 1통 (Daily digest)

## Sentry 가입 / DSN 발급

1. https://sentry.io 가입 (Free tier 5K events/mo 매장 1~2개 충분)
2. New Project → **React** 선택
3. DSN 복사 (`https://...@oXXX.ingest.sentry.io/YYY`)
4. Vercel Project Settings → Environment Variables:
   - `VITE_SENTRY_DSN` = 위 DSN
   - Environment: Production (only)
5. Redeploy

## 검증

배포 후 다음 명령어로 capture 동작 테스트:

```js
// 운영 콘솔에서 (production 빌드만 작동)
import('@/lib/sentry').then(m => m.captureBusinessError(
  new Error('TEST_BUSINESS_ALERT'),
  'manual.test',
  { note: '운영자 알림 테스트' }
));
```

→ Sentry Issues 페이지에 `TEST_BUSINESS_ALERT` 가 `business_mode:true` tag 와 함께 나타나야 함.

## 운영 비용

- Free tier: 5,000 events/mo
- 매장 1개 24h 운영 + 정상 동작 시 일평균 capture 0~5건 → 월 30~150 event
- 매장 10개까지는 free tier 충분
- 매장 100개+ Team plan ($26/mo, 50K events) 권장
