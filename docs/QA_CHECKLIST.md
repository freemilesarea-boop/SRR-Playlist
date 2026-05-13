# SRR Playlist QA 체크리스트 (출시 전)

이 문서는 **수동 브라우저 테스트**로만 검증 가능한 시나리오를 담습니다.
정적 분석 / 빌드 / RPC 존재 여부는 `npm run audit` 으로 자동 확인하세요.

## 사전 준비
1. `npm install`
2. `.env` 에 `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` 설정
3. `npm run audit` — RPC/테이블/버킷 모두 ✅ 인지 확인
4. `npm run build && npx vite preview` 또는 https://srr-playlist.vercel.app 사용

각 시나리오:
- **방법** — 정확한 클릭 경로
- **기대** — 정상 동작 시
- **실패 시 콘솔** — DEV 콘솔 로그 단서
- **관련** — 핵심 파일/RPC

---

## 1. 인증
### 1.1 이메일 로그인
- 방법: `/login` → 이메일/비밀번호 입력 → 로그인
- 기대: 홈으로 리다이렉트, `프로필` 아이콘에 닉네임 첫 글자 표시
- 실패: Network 탭의 `/auth/v1/token` 응답
- 관련: `src/store/authStore.ts:64-67`, `src/pages/LoginPage.tsx`

### 1.2 Google OAuth
- 방법: 로그인 페이지 → "Google 로 시작하기"
- 기대: Google 동의 화면 → 홈
- 실패: Supabase 대시보드의 Auth Providers 설정 확인
- 관련: `src/store/authStore.ts:80-86`

### 1.3 admin 권한 확인
- 방법: `freemilesarea@gmail.com` 로 로그인 → `/profile` 하단
- 기대: "관리자 페이지" 링크 표시 → `/admin` 진입 가능
- 실패: `public.users.role` 확인 (`update users set role='admin' where id=...`)
- 관련: `src/components/RequireAdmin.tsx`, `src/store/authStore.ts:54-62`

---

## 2. 음원 업로드
### 2.1 mp3 정상 업로드
- 방법: `/admin` → 콘텐츠 관리 → 트랙 → "트랙 업로드" → 정상 mp3 선택 + 메타 입력
- 기대: "오디오 분석 중" → "업로드 중" → "재생 검증 중" → 성공 토스트. 트랙 목록에 등장
- 실패: DEV 콘솔 `[upload] start` / `[upload] verify` 로그, audio bucket public 여부
- 관련: `src/components/admin/TrackUploader.tsx:222+`, `src/lib/audioValidation.ts`

### 2.2 wav/m4a 자동 변환
- 방법: wav 또는 m4a 업로드
- 기대: "MP3로 변환 중 N%" 진행 표시 → 표준 mp3 로 저장 (`*_standard.mp3`)
- 실패: `[ffmpeg]` 콘솔 로그, ffmpeg-core CDN 접근성
- 관련: `src/lib/audioTranscode.ts`

### 2.3 깨진 mp3 / 손상 파일
- 방법: 의도적으로 깨진 mp3 또는 텍스트 파일 .mp3 확장자
- 기대: "이 파일은 변환할 수 없습니다" 토스트, DB insert 안 됨
- 실패: tracks 테이블에 부적합한 row 가 들어가는지 확인
- 관련: `audioValidation.validateAudioFile`, `audioTranscode.transcodeToStandardMp3`

---

## 3. 플레이어
### 3.1 곡 클릭 즉시 재생
- 방법: 홈에서 아무 트랙 카드 클릭
- 기대: 1초 이내 재생 시작 (mini player 가 보이고 progress bar 진행)
- 실패: 콘솔에 `[audio] error` / `play() rejected` 로그
- 관련: `src/components/player/Player.tsx:163-260`

### 3.2 10초 이상 끊김 없이 재생
- 방법: 정상 트랙 재생 30초 이상 관찰
- 기대: 자동 next 없이 끝까지 재생, currentTime 단조 증가
- 실패: 콘솔의 `crossfade start` 가 currentTime < 10 에서 트리거되면 안 됨
- 관련: `src/components/player/Player.tsx:407-420` (crossfade trigger guard)

### 3.3 crossfade 3s / 5s
- 방법: ProfilePage → 재생 설정 → 크로스페이드 3초/5초 → 트랙 후반부
- 기대: 종료 N초 전에 다음 곡 fade-in
- 실패: `crossfade start` 콘솔 로그 확인

### 3.4 pause/resume
- 방법: 재생 중 mini player 의 ▶/⏸ 버튼
- 기대: 같은 위치에서 즉시 일시정지/재생
- 실패: 콘솔의 `play() resume` 누락 여부

### 3.5 next/prev
- 방법: next/prev 버튼 연타
- 기대: 큐 안에서 정상 이동, 무한 스킵 안 발생
- 실패: `재생 가능한 음원이 없어요` 토스트가 5초 이내 등장 시 = MAX_SKIP_ATTEMPTS 가드 작동

### 3.6 SRC_NOT_SUPPORTED 처리
- 방법: 손상된 트랙 (있다면) 큐에 진입 시
- 기대: `재생 실패 (SRC_NOT_SUPPORTED)` 토스트 1회, 다음 트랙으로 자동 진행, **같은 트랙으로 다시 돌아와도 재시도 안 함**
- 실패: 콘솔 `[audio] error code=4` 후 sessionFailedTrackIds 동작
- 관련: `src/components/player/Player.tsx:578-617`

### 3.7 모바일 Safari 첫 재생
- 방법: iOS Safari 에서 곡 클릭
- 기대: 한 번 ▶ 누르면 재생됨 (NotAllowedError 시 토스트 안내)
- 실패: 자동재생 정책상 NotAllowedError 정상 — toast 만 뜨면 OK

---

## 4. 검색
### 4.1 곡/플리/장르 통합 검색
- 방법: 홈 검색바 또는 `/search` → "재즈" / "비 오는 날" 등 입력
- 기대: 곡 / 플레이리스트 / 장르 / 무드 / 상황 섹션별로 결과
- 실패: 콘솔의 `search_catalog` RPC 응답
- 관련: `src/lib/searchApi.ts`, migration `0004_search.sql`

### 4.2 최근 검색어 / 인기 검색어
- 방법: 검색 후 검색바 다시 포커스
- 기대: 최근 검색어 N개 + 인기 검색어 (top_searches RPC 또는 하드코딩 fallback)
- 실패: localStorage `srr-recent-searches` 키 존재 확인

### 4.3 결과 클릭 재생
- 방법: 검색 결과의 곡 행 클릭
- 기대: 큐에 그 곡 포함 (재생 가능 곡만), 클릭한 곡부터 재생
- 실패: `재생 가능한 음원이 없어요` 토스트면 audio_url 없음 — 정상

---

## 5. 차트
### 5.1 일/주/월 탭
- 방법: `/charts` → 일간/주간/월간 탭 전환
- 기대: 각 기간별 다른 순위 (또는 동일 결과 표시), `get_track_chart(period)` 호출
- 실패: 콘솔 RPC 응답

### 5.2 audio_url 없는 트랙 차트 제외
- 방법: 차트에 깨진 audio_url 트랙이 보이는지
- 기대: 0009 적용 후 audio_url IS NOT NULL 만 반환되므로 차트에 안 보임
- 실패: `npm run audit` 의 0009 적용 여부 확인

### 5.3 장르 차트
- 방법: 장르 탭 → 특정 장르 선택
- 기대: 해당 장르 트랙만 표시 (`get_track_chart_by_genre`)
- 실패: RPC 응답 + `tracks.genre` 컬럼 데이터

---

## 6. 보관함 (Library)
### 6.1 좋아요 토글 + 새로고침 유지
- 방법: 곡의 ♥ → 새로고침 후 `/library` 확인
- 기대: 좋아요 곡 섹션에 표시 유지
- 실패: DB `liked_tracks` + localStorage `srr-liked-tracks` 확인

### 6.2 15초 이상 재생 후 최근 재생
- 방법: 30초 정도 들은 뒤 `/library`
- 기대: "최근 재생" 섹션에 그 곡 등장
- 실패: DB `recently_played_tracks` upsert 확인

### 6.3 새로고침 후 이어듣기 카드
- 방법: 곡 30초+ 재생 → 새로고침 → 홈 상단
- 기대: "이어듣기" 카드 → 클릭 시 같은 위치 근처에서 재생 (자동 X, 클릭 후)
- 실패: localStorage `srr-player-session` + DB `continue_listening`

### 6.4 플리 팔로우
- 방법: 플리 페이지 Hero 의 🔔 팔로우 → `/library` "팔로우한 플레이리스트"
- 기대: 즉시 +1 follower 수, 보관함에 등장
- 실패: DB `playlist_follows` 또는 localStorage `srr-followed-playlists`

---

## 7. 공유 / QR
### 7.1 플리 공유
- 방법: 플리 페이지 → 공유 버튼 → 시스템 공유 시트 또는 링크 복사
- 기대: `/playlist/:id` 형식 링크, 시크릿 창에서도 접근 가능
- 실패: Web Share API 미지원 브라우저는 자동 fallback (클립보드 복사)

### 7.2 곡 공유
- 방법: 재생 중인 곡의 공유 버튼
- 기대: `/track/:id` 링크, `share_events` 에 기록
- 관련: `src/lib/shareApi.ts`, `0006_share.sql`

### 7.3 매장 QR 다운로드
- 방법: 사업자 페이지 → QR 모달 → PNG 다운로드
- 기대: 매장 URL 이 인코딩된 PNG 다운로드
- 실패: `share_events.event_type='qr_download'` 기록

---

## 8. 사업자 (Business)
### 8.1 매장 모드 시작
- 방법: `/business` → 카테고리 선택 → 플리 선택 → "매장 모드 시작"
- 기대: 큐가 셔플+반복 모드로 시작, WakeLock 시도, crossfade 5초 자동 설정 (override 없을 때)
- 실패: `business_profiles` upsert + `business_schedule_events` insert

### 8.2 자동 스케줄러
- 방법: BusinessScheduler 에서 요일/시간 스케줄 등록 → 시간 도달 시
- 기대: 1분마다 tick, 시간 매칭되면 자동으로 큐 교체 + 토스트
- 실패: 콘솔의 BusinessScheduler effect 로그

---

## 9. 큐레이터
### 9.1 큐레이터 프로필 생성
- 방법: `/profile` → "큐레이터 프로필" 폼 → display_name + handle + bio → 저장
- 기대: "큐레이터 프로필이 저장됐어요" + 미리보기 링크 등장
- 실패: handle 중복 체크 동작 + `curator_profiles` insert

### 9.2 /curator/:handle 페이지
- 방법: `/curator/srr-music` 직접 접근
- 기대: Hero (이미지/이름/bio) + 통계 4개 + 플리 그리드
- 실패: `get_curator_profile` RPC 응답 + dev_seed 적용 여부

### 9.3 협업 문의 mailto
- 방법: 큐레이터 페이지 → "협업 문의하기" 버튼
- 기대: 메일 클라이언트 열림, subject 자동 (`스르륵 플리 — {name} 협업 문의`)
- 실패: `contact_email` 비어있으면 버튼 자체 숨김

### 9.4 PlaylistPage 큐레이터 카드
- 방법: 큐레이터 연결된 플리 진입 → Hero 아래
- 기대: "큐레이터" 카드 → 클릭 시 `/curator/:handle` 이동
- 실패: `playlists.created_by_user_id` 값 확인

---

## 10. 관리자
### 10.1 대시보드 통계
- 방법: `/admin` → 대시보드 탭
- 기대: 총 회원/MAU/유료 비율 / 트랙 / 플리 카운트, 7일 그래프
- 실패: `admin_dashboard_stats` / `admin_daily_series` RPC 응답

### 10.2 회원 관리
- 방법: 회원관리 탭 → 검색
- 기대: `admin_member_list` 결과, 클릭 시 상세

### 10.3 콘텐츠 관리 / 큐레이터 연결
- 방법: 콘텐츠 관리 → 새 플리 생성
- 기대: "큐레이터" 드롭다운에 등록된 큐레이터 선택 가능
- 실패: `fetchAllCurators` 응답

---

## 11. PWA / 모바일
### 11.1 홈 화면에 추가
- 방법: 모바일 Safari → 공유 → "홈 화면에 추가"
- 기대: 아이콘이 PWA 로 설치, 풀스크린 모드
- 실패: `dist/manifest.webmanifest` 와 icons 존재 확인

### 11.2 오프라인 fallback
- 방법: 네트워크 차단 후 새로고침
- 기대: 서비스워커가 캐시한 index.html / assets 로 부분 동작
- 실패: dist/sw.js 등록 여부

---

## 12. 테마 / UI
### 12.1 라이트/다크 토글
- 방법: 우상단 테마 토글 → light/dark/system 순환
- 기대: 즉시 색상 전환, 새로고침 후 유지
- 실패: localStorage `srr-theme-mode` 키

### 12.2 시간대별 자동 팔레트
- 방법: `currentTimeSlot` 변경 시 (테스트 어려움 — KST 기준)
- 기대: 새벽/아침/오후/저녁/밤 별로 그라데이션 변화

---

## 발견 시 행동 매뉴얼

| 증상 | 즉시 확인 |
|---|---|
| RPC 404 (`PGRST202`) | `npm run audit` → 어떤 RPC 가 없는지 → 해당 마이그레이션 적용 |
| `재생 실패 (SRC_NOT_SUPPORTED)` | 이전에 잘못된 Content-Type 으로 업로드된 트랙. 재업로드 |
| 새로고침 후 이어듣기 안 됨 | localStorage `srr-player-session` 존재 + DB `continue_listening` 권한 |
| 큐레이터 페이지 404 | handle 정규식 통과 여부 (`/^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/`) |
| 관리자 페이지 접근 거부 | `public.users.role='admin'` 여부 |
| 차트 비어있음 | `stream_events` 데이터 + 0009 의 audio_url 필터 영향 |
