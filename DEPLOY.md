# 스르륵 플리 — 배포 런북

> 코드는 끝났고 이제 실제 인프라만 연결하면 됩니다.
> 위에서 아래로 그대로 따라가면 약 10~15분 안에 베타 시연이 가능해요.

목차
- [0. 준비](#0-준비)
- [1. Supabase 프로젝트 생성](#1-supabase-프로젝트-생성)
- [2. 환경 변수 (.env)](#2-환경-변수-env)
- [3. DB 스키마 & 시드 적용](#3-db-스키마--시드-적용)
- [4. Storage 버킷 (audio · covers)](#4-storage-버킷-audio--covers)
- [5. 인증 Provider 설정](#5-인증-provider-설정)
- [6. 로컬 검증](#6-로컬-검증)
- [7. 관리자 계정 설정](#7-관리자-계정-설정)
- [8. Vercel 배포](#8-vercel-배포)
- [9. 배포 후 점검 체크리스트](#9-배포-후-점검-체크리스트)
- [10. 자주 터지는 문제](#10-자주-터지는-문제)

---

## 0. 준비

```bash
git checkout claude/playlist-mvp-development-2JmTJ
git pull
```

가입/로그인 계정 미리 준비:
- [supabase.com](https://supabase.com) (GitHub 로그인 가능)
- [vercel.com](https://vercel.com) (GitHub 로그인 권장)

---

## 1. Supabase 프로젝트 생성

1. https://supabase.com → 우측 상단 **Start your project**
2. **New project**
   - Name: `sruruk-playlist`
   - Database Password: **꼭 따로 저장** (DB push 시 필요)
   - Region: **Northeast Asia (Seoul) - ap-northeast-2** (한국 사용자 기준 최적)
   - Pricing Plan: Free
3. 생성 완료까지 약 2분

생성 후 좌측 메뉴 **⚙️ Project Settings → API** 에서 두 값을 복사:

| 항목 | 사용처 |
| --- | --- |
| Project URL (`https://xxxxxxxx.supabase.co`) | `VITE_SUPABASE_URL` |
| Project API keys → **anon public** | `VITE_SUPABASE_ANON_KEY` |

---

## 2. 환경 변수 (.env)

프로젝트 루트에서:

```bash
cp .env.example .env
```

`.env` 파일을 열어 값을 채워주세요 (vim 또는 VS Code):

```env
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs.....

# 데모 모드는 기본 false 유지 (실 음원 업로드 권장)
VITE_ENABLE_DEMO_MODE=false
VITE_DEMO_AUDIO_URLS=
```

검증:

```bash
npm run check-env
```

`✓ Supabase 응답 OK (HTTP 200 또는 404)` 가 나오면 정상.
(404는 익명 key 로 root REST 를 호출했을 때 정상 응답)

---

## 3. DB 스키마 & 시드 적용

두 가지 길 중 **편한 쪽 하나만** 고르세요.

### A. 대시보드 GUI (가장 쉬움)

1. Supabase Dashboard → 왼쪽 **SQL Editor** → **+ New query**
2. 로컬의 `supabase/schema.sql` 전체 내용을 복사 → 붙여넣기 → **Run**
   - 성공 시: `Success. No rows returned`
3. (선택) **+ New query** → `supabase/seed.sql` 전체 복사 → 붙여넣기 → **Run**
   - 13개 플리 + 30개 더미 트랙이 생성됨 (audio_url 은 빈 문자열, 시연용 mp3 는 관리자에서 업로드)

### B. Supabase CLI (재현 가능, 권장)

```bash
# 1) CLI 설치 (없으면)
brew install supabase/tap/supabase    # macOS
# 또는 https://supabase.com/docs/guides/cli/install-and-update

# 2) 프로젝트 연결
supabase link --project-ref <YOUR-REF>     # URL의 xxxxxxxx 부분
# DB 비밀번호 입력 (1단계에서 저장한 값)

# 3) 마이그레이션 적용
supabase db push

# 4) (선택) 시드
supabase db seed --file supabase/seed.sql
```

### 적용 확인 SQL

다시 SQL Editor 에서 아래를 실행해서 모두 잘 들어갔는지 한 번에 검증:

```sql
-- 테이블 7개가 모두 보여야 함
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
-- 기대: likes, playlists, playlist_tracks, recent_plays,
--       subscription_requests, tracks, users

-- RPC 함수 존재 확인
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname = 'list_subscription_requests';
-- 기대: list_subscription_requests

-- RLS 정책 13개 이상
select count(*) as policy_count
from pg_policies where schemaname = 'public';
-- 기대: 13 이상 (users 2, tracks 2, playlists 2, playlist_tracks 2,
--                likes 3, recent_plays 2, subscription_requests 3)

-- 시드 적용했다면 13개 플리
select count(*) from public.playlists;
-- 기대: 13 (시드 적용시) / 0 (적용 안 함)
```

---

## 4. Storage 버킷 (audio · covers)

CLI 방식(3-B)을 쓰셨다면 `config.toml` 이 알아서 만들어줍니다. GUI 방식이라면:

1. Supabase Dashboard → 왼쪽 **Storage** → **New bucket**
2. 첫 번째: `audio` — **Public bucket ✅** → Save
3. 두 번째: `covers` — **Public bucket ✅** → Save

> Public 체크가 빠지면 mp3 가 외부에서 재생되지 않습니다.

Storage RLS 정책은 `schema.sql` 에서 이미 자동 적용됩니다.
(public read / authenticated write / admin delete)

### 버킷 동작 확인

```sql
select id, name, public from storage.buckets where id in ('audio','covers');
-- 기대: 두 행 모두 public = true
```

---

## 5. 인증 Provider 설정

### 5-1. 이메일 (기본 ON)

Dashboard → **Authentication → Providers → Email** → 그대로 두기.
초기 베타에는 `Confirm email` 을 꺼두면 가입 즉시 로그인됩니다.

### 5-2. Google OAuth (선택)

1. [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 → **APIs & Services → Credentials**
2. **Create Credentials → OAuth client ID** → Web application
3. **Authorized redirect URIs** 에 추가:
   ```
   https://YOUR-REF.supabase.co/auth/v1/callback
   ```
4. 생성된 Client ID / Secret 복사
5. Supabase Dashboard → **Authentication → Providers → Google** → 토글 ON
6. Client ID / Secret 붙여넣고 **Save**

### 5-3. Redirect URLs (배포 후에도 작동시키려면)

Dashboard → **Authentication → URL Configuration → Redirect URLs** 에 추가:
```
http://localhost:5173
http://localhost:5173/**
https://<your-app>.vercel.app
https://<your-app>.vercel.app/**
```
> Vercel 도메인은 8단계 배포 후 추가해도 됨.

---

## 6. 로컬 검증

```bash
npm run setup        # = install + check-env
npm run lint         # tsc --noEmit
npm run build        # 프로덕션 빌드
npm run dev          # http://localhost:5173
```

브라우저에서 확인:
- [ ] 로그인 페이지가 뜸 (검정 + 보라 그라데이션)
- [ ] 이메일로 가입 → 자동 로그인
- [ ] 홈에 시드 플리 13개 (시드 적용 시) 또는 빈 상태
- [ ] 하단 네비 4개 (홈/보관함/매장/내 정보)
- [ ] 매장 페이지 진입 시 큰 “매장 모드 시작” CTA

---

## 7. 관리자 계정 설정

먼저 본인 이메일로 가입(`freemilesarea@gmail.com`) 한 뒤,
**`supabase/admin.sql`** 의 세 쿼리를 SQL Editor 에 붙여넣고 Run.

```sql
-- 1) user_id 확인
select id, email, created_at
from auth.users
where email = 'freemilesarea@gmail.com';

-- 2) role 변경
update public.users
set role = 'admin'
where id = (
  select id from auth.users where email = 'freemilesarea@gmail.com'
);

-- 3) 적용 확인
select u.id, u.nickname, u.role, u.subscription_type, au.email
from public.users u
join auth.users au on au.id = u.id
where u.role = 'admin';
-- 기대: 1행, role = 'admin'
```

브라우저로 돌아가서 새로고침 → **내 정보** → **관리자 페이지** 메뉴가 노출되면 OK.

`/admin` 진입 시 상단에 **MVP 운영 체크리스트** 가 자동으로 떠 있어요.
실시간으로 무엇이 빠졌는지 알려줍니다.

> 다른 사람을 관리자로 추가할 때는 위 SQL 의 이메일만 바꿔 실행하면 됩니다.

---

## 8. Vercel 배포

### 8-1. GitHub 푸시 확인

이미 `claude/playlist-mvp-development-2JmTJ` 브랜치에 모두 푸시되어 있어요.
main 으로 머지하실 수 있다면 머지 후 main 을 배포 브랜치로 쓰셔도 되고,
당장은 위 브랜치 그대로 배포해도 됩니다.

### 8-2. Vercel Import

1. https://vercel.com/new → **Import** → 저장소 선택
2. **Framework Preset**: Vite (자동 감지됨)
3. **Build Command**: `npm run build` (기본값)
4. **Output Directory**: `dist` (기본값)
5. **Install Command**: `npm install` (기본값)
6. **Root Directory**: 기본값 그대로

### 8-3. 환경 변수 입력 (Vercel)

**Environment Variables** 섹션에 추가:

| Name | Value | Environment |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://YOUR-REF.supabase.co` | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi...` | Production, Preview, Development |
| `VITE_ENABLE_DEMO_MODE` | `false` | Production, Preview |
| `VITE_DEMO_AUDIO_URLS` | (빈 값) | Production, Preview |

> 비밀이 아닌 anon key 라 노출돼도 안전하지만, Vercel 의 변수 저장소에 넣는 게 관리상 좋습니다.

### 8-4. Deploy 클릭

2~3분 후 `https://<project>.vercel.app` 발급.

### 8-5. Supabase Auth 에 배포 도메인 등록

위 5-3 단계로 돌아가 배포된 도메인을 추가:
```
https://<your-app>.vercel.app
https://<your-app>.vercel.app/**
```

---

## 9. 배포 후 점검 체크리스트

배포 URL을 폰에서 접속:

- [ ] 검은 화면 + “스르륵 플리” 로고가 정상 표시
- [ ] 회원가입 → 자동 로그인 → 홈 진입
- [ ] 시드 적용했다면 카테고리별 카드 노출 + “음원 준비중” 배지
- [ ] 매장 페이지 진입 → “지금 [시간대]에 어울리는” 카드
- [ ] 브라우저 메뉴 → **홈 화면에 추가** 가능
- [ ] 추가 후 앱 아이콘으로 실행하면 풀스크린
- [ ] 트랙 1개라도 업로드 (관리자 페이지) → 매장 모드 시작 버튼 활성화

---

## 10. 자주 터지는 문제

| 증상 | 원인 / 해결 |
| --- | --- |
| `ConfigMissingScreen` 이 계속 뜸 | `.env` 의 VITE_ 접두사 누락 또는 Vercel env 미설정 |
| 가입 직후 users 테이블에 row 가 없음 | `on_auth_user_created` 트리거 누락 → schema.sql 다시 실행 |
| 트랙 업로드 시 403 / “new row violates row-level security” | RLS 정책 미적용 → schema.sql 의 Storage 정책 부분 확인 |
| mp3 가 403 으로 안 들림 | `audio` 버킷이 Public 이 아님 → Storage 설정에서 토글 |
| Google 로그인 후 무한 redirect | Supabase Auth → URL Configuration 에 도메인 미등록 |
| 모바일 Safari 에서 첫 재생 무반응 | 자동재생 정책 — 한 번 직접 탭하면 정상 (토스트 안내 자동) |
| `/admin` 진입 시 “권한 필요” | users.role 이 admin 으로 변경 안 됨 → 7단계 SQL 재실행 |
| 구독 신청 탭에 이메일이 안 보임 | `list_subscription_requests` RPC 누락 → schema.sql 마지막 부분 재실행 |
| 매장 모드 ON 인데 화면 꺼짐 | Safari < 16.4 → 단말의 자동잠금을 ‘없음’ 으로 |

---

## 끝.

여기까지 따라오셨다면 시연 가능 상태입니다.
첫 시연 전에 권장:
1. 권리 확보한 mp3 3~5곡 업로드
2. 시드 플리 중 하나 골라 트랙 연결 (드래그 정렬)
3. 폰을 매장에 두고 **매장 모드 시작** 누르면 끝
