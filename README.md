# 스르륵 플리 (SRR Playlist) — MVP

> 상황 기반 감성 플레이리스트 + 자영업자용 매장 BGM PWA

“음악 자체보다 분위기 / 큐레이션” 에 집중한 1주일 MVP입니다.
유튜브보다 편하게, 카페·필라테스·와인바에서 ‘틀어두기만 해도 되는’ 경험을 목표로 합니다.

## 스택

- **Frontend** — React 18 · Vite · TypeScript · TailwindCSS · Zustand
- **Backend** — Supabase (Auth · Postgres · Storage · RLS)
- **PWA** — vite-plugin-pwa (manifest · 오프라인 캐시 · 미디어 캐시)
- **배포** — Vercel

## 주요 기능

| 영역 | 구현 |
| --- | --- |
| 인증 | 이메일/비밀번호 · Google OAuth · 세션 유지 |
| 홈 | 시간대 인사말 · 카테고리별 가로 스크롤 · 최근 들은 |
| 플레이리스트 상세 | 트랙 리스트 · 재생/셔플 · 좋아요 |
| 플레이어 | 하단 고정 미니플레이어 + 풀스크린 오버레이 · 셔플 · 반복 (off/all/one) · 시크바 · 볼륨 · MediaSession (백그라운드 컨트롤) |
| 보관함 | 좋아요 · 최근 들은 |
| 사업자 모드 | 토글 · 화면 꺼짐 방지(WakeLock) · 업종 필터 (카페/PT/필라테스/와인바/네일샵/편집샵) · 시간대 자동 추천 |
| 구독 | 무료 / 일반 4,900원 / 사업자 6,900원 (DB 플래그 전환, PayApp 연동 자리 마련) |
| 관리자 | 플레이리스트 생성/삭제 · 트랙 업로드(mp3 + 커버) · 드래그앤드롭 순서 변경 · 썸네일 변경 |
| PWA | manifest · 홈화면 설치 · 오프라인 캐시 · Supabase Storage 미디어 캐시 (Range 요청 대응) |

## 시작하기

```bash
# 1. 환경 변수 설정
cp .env.example .env
# .env 안 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 입력

# 2. 의존성 설치
npm install

# 3. 개발 서버
npm run dev
```

기본 포트는 `http://localhost:5173`. 모바일에서 확인하려면 같은 LAN 에서
`http://<PC_IP>:5173`으로 접속하면 됩니다.

## Supabase 준비

1. [supabase.com](https://supabase.com) 에서 프로젝트 생성
2. **SQL Editor** 에서 `supabase/schema.sql` 실행 (테이블 + RLS + 트리거)
3. (선택) `supabase/seed.sql` 실행 — UI 확인용 더미 플레이리스트
4. **Storage** 에서 버킷 2개 생성 — 둘 다 **Public**
   - `audio` — mp3 등 음원
   - `covers` — 커버 이미지
5. **Authentication** → Providers 에서 Email, Google 활성화
6. (관리자 페이지 사용) `users` 테이블에서 본인 row 의 `role` 을 `admin` 으로 변경

```sql
update public.users set role = 'admin' where id = 'YOUR-USER-UUID';
```

## 폴더 구조

```
src/
  components/        UI 컴포넌트 (AppShell, BottomNav, PlaylistCard …)
  components/player/ 하단 고정 + 풀스크린 플레이어
  components/admin/  업로드 / 드래그앤드롭 편집기
  pages/             라우트 단위 페이지
  store/             Zustand (auth, player, business)
  lib/               supabase client, api, format, constants
  types/             DB row 타입
  hooks/             useWakeLock 등 커스텀 훅
supabase/
  schema.sql         테이블/RLS/트리거
  seed.sql           시드 데이터
```

## 배포 (Vercel)

1. GitHub 에 push
2. Vercel 에서 import → 빌드 명령 `npm run build`, 출력 디렉토리 `dist`
3. 환경 변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 입력
4. `vercel.json` 에 SPA 폴백 포함 — 그대로 배포

## 의식적으로 제외한 것 (MVP 범위 보호)

- AI 추천, AI DJ
- 실시간 정산
- DRM
- 네이티브 앱
- 복잡한 분석 대시보드
- 채팅 / SNS / 댓글
- 자체 CDN

→ 검증 이후에 붙입니다.

## 다음 단계

- [ ] PayApp 정기결제 연동 (구독 페이지에 자리 마련됨)
- [ ] 푸시 알림 (PWA Web Push)
- [ ] 매장별 재생 통계 (재생 시간 / 인기 트랙)
- [ ] 오프라인 다운로드
