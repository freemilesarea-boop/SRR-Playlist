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

## 남은 follow-up (이번 PR 범위 밖)

- **아티스트 전용 음원 업로드 UI**: 현재는 admin 의 TrackUploader 만 존재. 아티스트가 본인 음원을 직접 업로드하는 페이지(`/artist/upload` 등) 추가 필요. TrackUploader 로직을 재사용하되:
  - 로그인 사용자가 `artist_approval_status='approved'` 인지 확인
  - INSERT 시 `owner_user_id`, `artist_profile_id`, `uploaded_by_account_type='artist'`, `source_type='artist_upload'`, `visibility_status='pending_review'` 자동 채움
- **아티스트 대시보드**: 본인 음원 목록 + 심사 상태 표시 페이지
- **승인 상태별 강제 라우팅**: pending 상태에서 음원 업로드 시도 시 자동 차단 UI (현재는 admin RLS 가 막아주지만 UX 메시지 부족)
- **승인 알림**: 승인/거절 시 사용자에게 이메일/푸시 알림
- **곡 단위 검수 UI**: admin 의 콘텐츠관리에 `pending_review` 필터 추가 + 곡별 승인/거절 버튼 (현재는 `list_pending_review_tracks` RPC 만 준비됨)
