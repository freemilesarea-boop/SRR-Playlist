# 아티스트 회원가입 + 음원 검수 가이드

## 추가된 DB 객체 (0017_artist_signup.sql)

| 객체 | 설명 |
|---|---|
| `users.account_type` | CHECK 재정의 → `'individual' | 'business' | 'artist'` |
| `users.artist_approval_status` | `pending` / `approved` / `rejected` / NULL |
| `artist_profiles` | 신규 — `user_id` UNIQUE, `real_name`, `birth_date`, `artist_name`, `phone`, `address`, `email`, `approval_status`, `approved_by`, `approved_at`, `rejected_reason` |
| `tracks.owner_user_id` | 업로더 user_id |
| `tracks.artist_profile_id` | 아티스트 프로필 |
| `tracks.uploaded_by_account_type` | `individual / business / artist / admin` |
| `tracks.visibility_status` | `pending_review / approved / rejected / hidden` (기본 `approved` — legacy 호환) |
| `tracks.source_type` | `admin_upload / artist_upload / import` (기본 `admin_upload`) |

## RLS 요약

| 테이블 | 정책 |
|---|---|
| `artist_profiles` | 본인 SELECT, pending 상태 INSERT/UPDATE, admin ALL |
| `tracks` | 본인 SELECT (owner_user_id 일치), public SELECT (visibility_status='approved'), admin ALL (0001) |

## 추가된 RPC

| RPC | 권한 | 용도 |
|---|---|---|
| `approve_artist_profile(p_user_id uuid)` | admin only | 승인 |
| `reject_artist_profile(p_user_id uuid, p_reason text)` | admin only | 거절 + 사유 |
| `list_pending_artists(p_limit int)` | admin only | 승인 대기 목록 |
| `list_pending_review_tracks(p_limit int)` | admin only | 음원 심사 대기 |

## 가입 / 승인 / 업로드 플로우

```
[1] 회원가입
  /login → 회원가입 → "아티스트 회원" 선택 → ArtistSignupForm 작성 → 신청 완료 화면

[2] 자동 처리
  auth.users 생성 → public.users.account_type='artist' + artist_approval_status='pending'
  artist_profiles INSERT (approval_status='pending')

[3] 관리자 승인
  /admin → "아티스트 승인" 탭 → 승인 또는 거절 (사유 입력 모달)
  - approve_artist_profile RPC → users.artist_approval_status='approved'
  - reject_artist_profile RPC → users.artist_approval_status='rejected' + rejected_reason

[4] 음원 업로드 (승인된 아티스트만)
  본인 음원 업로드 → tracks INSERT:
    owner_user_id = auth.uid()
    artist_profile_id = 본인 artist_profiles.id
    uploaded_by_account_type = 'artist'
    source_type = 'artist_upload'
    visibility_status = 'pending_review'

[5] 관리자 음원 검수
  /admin → 콘텐츠관리 → visibility_status='pending_review' 필터로 확인
  list_pending_review_tracks RPC → 승인/거절/숨김 처리
  approved 가 되면 일반/사업자 사용자에게 노출
```

## 기존 곡 조회 오류 원인 + 수정

**원인**: LibraryPage 의 `useEffect(() => load(), [likedIds])` 가 user.id 변경에 반응하지 않음. 재로그인 시 user.id 가 늦게 들어와도 fetch 가 재실행 안 됨 → "곡 없음" 표시. localStorage / zustand 캐시도 stale.

**수정**:
- 신규 `src/hooks/useFreshFetch.ts`:
  - 마운트 + deps 변경 + window focus + visibilitychange(visible) → 모두 callback 호출
- `LibraryPage` / `ContentManagement` 에 적용
- 재로그인 / 새로고침 / 탭 복귀 시 항상 최신 DB 조회 보장

## 배포 순서

1. **DB**: GitHub Actions 워크플로우 재실행 → `1j` 단계가 0017 자동 적용 (멱등)
2. **프론트**: Vercel 자동 배포 (main 푸시됨)
3. **승인 처리**: `/admin` → "아티스트 승인" 탭 → 가입 신청자 검토
4. **검증 SQL**:
   ```sql
   select count(*) from public.artist_profiles where approval_status='pending';
   select count(*) from public.tracks where visibility_status='pending_review';
   ```

## 검증 시나리오

| 시나리오 | 기대 |
|---|---|
| 일반/사업자/아티스트 3가지 가입 카드 표시 | ✅ |
| 아티스트 가입 → users.account_type='artist' + artist_approval_status='pending' | ✅ |
| 가입 직후 음원 업로드 시도 | ⚠️ 본 PR 범위 밖 — 아티스트 전용 업로드 UI 는 follow-up. 현재는 admin 만 업로드 가능 |
| /admin → 아티스트 승인 탭에서 신청자 표시 | ✅ |
| 승인 → users.artist_approval_status='approved' | ✅ |
| 거절 + 사유 → rejected_reason 저장 | ✅ |
| 재로그인 후 곡 목록 정상 표시 | ✅ (useFreshFetch) |
| 새로고침 후 곡 목록 정상 | ✅ |
| 탭 복귀 시 refetch | ✅ (focus + visibilitychange) |

## 0018 - 아티스트 직접 업로드 + 검수 UI

### 추가 DB (0018_artist_track_review.sql)

| 객체 | 설명 |
|---|---|
| `tracks.rejected_reason` | 거절 사유 |
| `tracks_artist_insert` RLS | 승인된 아티스트만 본인 owner_user_id 로 pending_review + artist_upload 로만 INSERT |
| `tracks_artist_update_pending` RLS | 본인 pending_review 곡만 UPDATE |
| `tracks_artist_delete_pending` RLS | 본인 pending_review 곡만 DELETE |

### 추가 RPC (4개, admin 3 + 본인 1)
| RPC | 권한 | 용도 |
|---|---|---|
| `approve_artist_track(p_track_id)` | admin only | visibility_status='approved' + rejected_reason 클리어 |
| `reject_artist_track(p_track_id, p_reason)` | admin only | visibility_status='rejected' + 사유 저장 |
| `hide_artist_track(p_track_id)` | admin only | visibility_status='hidden' |
| `list_my_artist_tracks(p_limit)` | authenticated | 본인 업로드 곡 (모든 visibility) |

### 아티스트 업로드 플로우

```
[1] 승인된 아티스트 → /artist (ArtistDashboardPage)
[2] 업로드 폼:
    제목 / 장르 / 분위기 / 오디오 파일 / 커버 이미지
    (mp3 / wav / m4a / flac · 100MB 이하 클라이언트 검증)
[3] uploadArtistTrack():
    a. audio bucket 에 'artist_uploads/{user_id}/{ts}_{filename}' 업로드
    b. cover 있으면 covers bucket 에 동일 패턴
    c. tracks INSERT with:
         owner_user_id = auth.uid()
         artist_profile_id = 본인 artist_profiles.id
         artist = artist_profiles.artist_name
         uploaded_by_account_type = 'artist'
         source_type = 'artist_upload'
         visibility_status = 'pending_review'
    d. RLS 가 모두 통과해야 INSERT 성공
[4] 내 음원 목록에 즉시 표시 (visibility='pending_review')
[5] 본인은 pending_review 상태 곡만 삭제 가능
```

### 관리자 검수 플로우

```
[1] /admin → "음원 검수" 탭 (TrackReviewList)
[2] list_pending_review_tracks RPC → pending_review 곡 목록 + 미리듣기
[3] 행마다 3개 액션:
    - 승인 → visibility='approved' (서비스 화면 노출 시작)
    - 거절 → visibility='rejected' + 사유 prompt
    - 숨김 → visibility='hidden' (운영진 판단)
[4] 사용자 측 ArtistDashboardPage 에 즉시 반영 (useFreshFetch 의 focus refetch)
```

### 새로 추가된 라우트 / 컴포넌트
- `/artist` → `ArtistDashboardPage`
- `/admin` → "음원 검수" 탭 (TrackReviewList)

### Storage 경로
- 오디오: `audio/artist_uploads/{user_id}/{ts}_{filename}`
- 커버: `covers/artist_uploads/{user_id}/{ts}_cover_{filename}`
- 정규 MIME 강제 (mp3 → audio/mpeg 등). 100MB 상한.

### 검증 시나리오 (실제 운영 가능)

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | pending 아티스트 → /artist | "관리자 승인 대기 중" 카드 + 업로드 비활성 |
| 2 | pending 아티스트가 직접 tracks INSERT | RLS 차단 (`tracks_artist_insert` 정책) |
| 3 | rejected 아티스트 → /artist | 거절 사유 표시, 업로드 비활성 |
| 4 | approved 아티스트 → /artist | 업로드 폼 활성 + 내 음원 목록 |
| 5 | 업로드 성공 | tracks.visibility='pending_review', /artist 즉시 반영 |
| 6 | 일반/사업자 → /artist | profile.account_type≠'artist' → / 로 리다이렉트 |
| 7 | admin → /admin "음원 검수" | pending_review 곡 표시 |
| 8 | admin 승인 → visibility='approved' | 일반 사용자 화면 노출 시작 |
| 9 | admin 거절 + 사유 | rejected_reason 저장, 사용자 측 표시 |
| 10 | rejected 곡 일반 사용자 노출 | public select 정책 (visibility='approved') 으로 차단 |
| 11 | 본인이 approved 곡 삭제 시도 | RLS 차단 (`tracks_artist_delete_pending`) |
| 12 | 재로그인 후 /artist | useFreshFetch 가 즉시 refetch |

### 보안 검증

- ✅ 아티스트 INSERT: `owner_user_id = auth.uid()` + 승인 상태 + source_type/visibility 강제
- ✅ 아티스트 UPDATE/DELETE: 본인 + pending_review 만
- ✅ 공개 SELECT: `visibility_status='approved'` 만
- ✅ 본인 SELECT: `owner_user_id = auth.uid()` (모든 visibility)
- ✅ admin: 기존 admin ALL 정책 그대로

## 남은 follow-up

- 아티스트 음원에 가사/외부 유통 링크 컬럼 추가 (현재 tracks 스키마에 없음)
- 승인/거절 시 사용자에게 이메일/푸시 알림 (현재 admin UI 에서만 확인)
- 검수 통과율 / 평균 검수 시간 등 admin 대시보드 통계
- 거절된 곡 재심사 요청 플로우
