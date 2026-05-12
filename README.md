# 스르륵 플리 (SRR Playlist) — MVP

> 상황 기반 감성 플레이리스트 + 자영업자용 매장 BGM PWA

“음악 자체보다 분위기 / 큐레이션” 에 집중한 1주일 MVP.
유튜브보다 편하게, 카페·필라테스·와인바에서 ‘틀어두기만 해도 되는’ 경험을 목표로 합니다.

## 스택

- **Frontend** — React 18 · Vite · TypeScript · TailwindCSS · Zustand · @dnd-kit
- **Backend** — Supabase (Auth · Postgres · Storage · RLS)
- **PWA** — vite-plugin-pwa (manifest · 오프라인 캐시 · 미디어 Range 캐시)
- **배포** — Vercel

## 주요 기능

| 영역 | 구현 |
| --- | --- |
| 인증 | 이메일/비밀번호 · Google OAuth · 세션 유지 · 환경 미설정 시 친절 안내 |
| 홈 | 시간대 인사말 · 카테고리별 가로 스크롤 · 최근 들은 |
| 플레이리스트 상세 | 트랙 리스트 · 재생/셔플 · 좋아요 · 빈 음원 안전 처리 |
| 플레이어 | 미니 + 풀스크린 · 셔플 · 반복(off/all/one) · 시크/볼륨 · MediaSession · 자동재생 정책 폴백 · 무한루프 방지 |
| 보관함 | 좋아요 · 최근 들은 |
| 사업자 모드 | 큰 CTA · 시간대 카피 · 업종 필터 · WakeLock · 미지원 브라우저 안내 · 홈화면 추가 안내 |
| 구독 | 무료/일반/사업자 · 신청 큐(pending) · 운영진 문의 CTA |
| 관리자 | 플레이리스트 CRUD · mp3 업로드(검증) · 드래그앤드롭 순서 · 썸네일 변경 · 토스트 |
| PWA | manifest · 홈화면 설치 · SW · Storage Range 캐시 |

---

## 1. 시작하기 (로컬 실행)

### 요구사항
- Node.js ≥ 20
- Supabase 계정 (무료)

### 설치

```bash
git clone <repo>
cd SRR-Playlist
npm install
cp .env.example .env
# .env 안 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 입력
npm run dev
```

기본 포트 `http://localhost:5173`. 모바일에서 확인하려면 같은 LAN 에서
`http://<PC_IP>:5173` 으로 접속하면 됩니다.

### `.env` 예시

```env
VITE_SUPABASE_URL=https://abcdefghijk.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi.....
```

> 환경 변수가 없으면 앱이 자동으로 “설정 필요” 화면을 보여줘요.

---

## 2. Supabase 준비 (전체 가이드)

### 2-1. 프로젝트 생성

1. [https://supabase.com](https://supabase.com) 로그인 → **New project**
2. 이름·DB 비밀번호·리전(Seoul) 입력 → 생성 (~2분)

### 2-2. URL · anon key 복사

**Project Settings → API** 에서:
- `Project URL` → `VITE_SUPABASE_URL`
- `anon public` 키 → `VITE_SUPABASE_ANON_KEY`

### 2-3. 스키마 실행

**SQL Editor** → New query → 아래 파일 내용을 붙여넣고 **Run**.

```text
supabase/schema.sql
```

내용:
- 테이블: `users`, `tracks`, `playlists`, `playlist_tracks`, `likes`, `recent_plays`, `subscription_requests`
- 가입 시 users row 자동 생성 트리거
- RLS 정책 (본인 데이터만 read/write, 관리자만 콘텐츠 write)
- Storage 버킷용 정책 (audio/covers public read, 인증 사용자 write, 관리자 delete)

### 2-4. 시드 데이터 (선택)

UI 확인용 더미 플레이리스트 13개 + 트랙 30개 + 매핑.

```text
supabase/seed.sql
```

`audio_url` 은 빈 문자열 placeholder. UI 가 **샘플 음원 없음** 으로 안전하게 표시하고
재생 시 자동으로 다음 곡으로 넘어갑니다. 실제 음원은 관리자 페이지에서
업로드한 뒤 트랙의 audio_url 이 자동으로 채워져요.

### 2-5. Storage 버킷 생성

**Storage** → New bucket — 두 개 만들고 **Public** 체크:

| 이름 | 용도 | Public |
| --- | --- | --- |
| `audio` | mp3 등 음원 | ✅ |
| `covers` | 커버/썸네일 이미지 | ✅ |

> Public 으로 안 하면 mp3 가 외부에서 재생 안 돼요.
> RLS 정책은 schema.sql 실행 시 자동 적용됩니다.

### 2-6. Auth Provider 활성화

**Authentication → Providers**:
- ✅ Email — 메일 인증 활성화 (배포 후 전송 도메인 설정)
- ✅ Google — OAuth Client ID/Secret 입력
  - 리디렉트 URL: `https://<your-domain>/auth/v1/callback`

---

## 3. 관리자 계정 설정

처음 가입한 계정을 관리자로 승격합니다.

### 방법 A — SQL Editor

```sql
-- 본인 이메일로 user_id 확인
select id, email from auth.users where email = 'your@email.com';

-- 위에서 얻은 UUID 로 role 변경
update public.users set role = 'admin' where id = 'YOUR-USER-UUID';
```

### 방법 B — Table Editor

1. `users` 테이블 열기
2. 본인 row 의 `role` 셀을 `admin` 으로 수정 → 저장

이후 앱에서 `/admin` 메뉴가 노출됩니다 (프로필 페이지에서도 보임).

---

## 4. 샘플 음원 업로드 (관리자 흐름)

1. `/admin` → **트랙** 탭 → **트랙 업로드**
2. 음원(mp3 등 ≤ 50MB) + 제목 입력 → 업로드
   - 길이는 자동 분석
   - 커버 이미지(선택, ≤ 5MB)
3. **플레이리스트** 탭 → 새 플레이리스트 → 카테고리 선택 → 만들기
4. 편집 화면에서 **트랙 추가** → 드래그로 순서 변경
5. 홈 / 매장 페이지에서 즉시 확인

> seed.sql 로 더미 플레이리스트가 이미 있다면, 빈 트랙 자리에 본인 mp3 를
> 업로드해서 추가하면 가장 빠릅니다.

---

## 5. 배포 (Vercel)

1. GitHub push (이 저장소를 그대로 push)
2. [vercel.com](https://vercel.com) → **Import Project** → 선택
3. **Build Command**: `npm run build` / **Output**: `dist`
4. **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy → 즉시 배포

`vercel.json` 에 SPA fallback (`/(.*)` → `/`) 가 포함돼 있어서 별도 설정 불필요.
서비스 워커는 자동 생성됩니다.

### Supabase Auth 콜백 도메인 추가
**Authentication → URL Configuration → Redirect URLs** 에 배포 URL 추가:
- `https://<your-app>.vercel.app/**`

---

## 6. 폴더 구조

```
src/
  components/        AppShell · BottomNav · PlaylistCard · Toaster · ConfigMissingScreen
  components/player/ 미니 + 풀스크린 플레이어
  components/admin/  TrackUploader · PlaylistEditor (dnd-kit)
  pages/             라우트 단위 페이지
  store/             Zustand (auth · player · business · toast)
  lib/               supabase · api · format · constants
  types/             DB row 타입
  hooks/             useWakeLock · useInstallPrompt
supabase/
  schema.sql         테이블 / RLS / Storage 정책 / 트리거
  seed.sql           더미 플레이리스트 + 트랙 + 매핑
public/              favicon · PWA 아이콘
```

---

## 7. 검증

```bash
npm install
npm run lint     # tsc --noEmit
npx tsc -b
npm run build    # tsc -b && vite build (PWA 매니페스트/SW 생성)
```

모두 exit 0 이면 OK.

---

## 8. 의식적으로 제외한 것 (MVP 범위 보호)

- AI 추천, AI DJ
- 실시간 정산
- DRM / 워터마크
- 네이티브 앱
- 복잡한 분석 대시보드
- 채팅 / SNS / 댓글
- 자체 CDN

→ 검증 이후에 붙입니다.

## 9. 다음 단계

- [ ] PayApp 정기결제 연동 (구독 신청 큐는 이미 구현됨)
- [ ] Web Push 알림
- [ ] 매장별 재생 통계 (재생 시간 / 인기 트랙)
- [ ] 오프라인 다운로드
- [ ] 직원 공유 링크 (사업자 플랜)
