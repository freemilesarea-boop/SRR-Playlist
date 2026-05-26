# 재생 권한 서버 검증 설계안 — audio_url signed / edge streaming

> 상태: **설계 검토용 (미적용)**. 본 문서는 구현/마이그레이션 전 합의용. 라이브 적용·merge는 별도 승인 후.

## 0. 요약
현재 재생 paywall(무료 25초 / trial / 구독)은 **클라이언트 JS로만 강제**되고, released 트랙의 `audio_url`(공개 버킷 public URL)이 RLS `tracks_public_select`로 anon에 노출된다. 따라서 기술적 사용자는 `audio_url`을 직접 받아 전 released 카탈로그를 무제한 스트리밍 → **구독/trial 우회**(감사 P0-1). 목표: **오디오 접근을 서버가 멤버십/trial 기준으로 검증**하도록 전환하되, 모바일 Safari/PWA/기존 플레이어 영향을 최소화.

## 1. 현재(우회 가능) 구조
- 버킷: `audio` (public). 객체 키 = `artist_uploads/{userId}/{uuid}.mp3` (0153).
- `tracks_public_select` RLS: `approved + released/admin_upload + removed_at null + audio/cover 존재` → released 트랙 row(=audio_url 포함) anon 읽기 가능.
- 플레이어: `<audio src={audio_url}>`. `membership.ts`/`Player.tsx`가 25초/trial/구독을 **브라우저에서** 판정·일시정지.
- 우회: `GET /rest/v1/tracks?select=audio_url&...` 또는 공개 객체 URL 직접 요청 → 게이트 무시.

## 2. 두 가지 접근 비교
| 항목 | (A) Signed URL (private 버킷 + 단기 서명) | (B) Edge Streaming proxy |
|---|---|---|
| 구조 | `audio` 버킷 private화 → 엣지펑션이 멤버십 검증 후 `createSignedUrl(ttl)` 발급 → 클라가 그 URL로 직접 재생 | 엣지펑션이 매 재생 요청을 프록시하며 Range 응답 중계(검증 포함) |
| 서버 부하 | 낮음(발급만, 실제 전송은 Storage/CDN) | 높음(전 오디오 바이트가 펑션 경유) |
| 비용 | 낮음(Storage egress + 소량 함수 호출) | 높음(함수 실행시간 + egress 이중) |
| CDN 캐시 | 서명 URL 쿼리스트링 때문에 캐시 적중률↓(아래 3.4 완화책) | 사실상 캐시 불가 |
| Safari/Range | Storage가 Range 지원 → 정상 | 프록시가 Range/206 정확히 구현해야(까다로움) |
| 구현 난이도 | 중 | 상(스트리밍 엣지 안정화 어려움) |
| 권장 | **채택(A)** | 비권장(특수 케이스만) |

→ **권장: (A) Signed URL**. (B)는 비용/Safari Range/캐시 모두 불리.

## 3. 설계 (Signed URL 방식)

### 3.1 버킷 전환
- `audio` 버킷을 **private**로 전환(신규 객체부터). 기존 객체도 private화.
- 공개 직접 URL(`/object/public/audio/...`) 무효화 → 우회 차단의 핵심.

### 3.2 발급 엣지펑션 `get-playback-url`
입력: `{ track_id }` (+ Authorization: 사용자 JWT).
서버 처리:
1. JWT에서 user 식별(비로그인 = anon).
2. **서버 권한 판정** (단일 진실): `get_my_trial_status()`/멤버십 RPC로 `subscription_status` 산출.
   - `active`(유료) 또는 `trial`(`free_trial_ends_at > now()`) → **full grant**.
   - `free`/`expired`/`anonymous` → **preview grant**(아래 3.3).
3. 트랙이 공개 재생 가능 여부(`tracks_public_select` 동일 기준) 재확인.
4. `storage.from('audio').createSignedUrl(path, ttl)` 발급.
5. 응답: `{ url, ttl, mode: 'full'|'preview', expires_at }`.
- service_role 키는 엣지펑션 내부에서만 사용(클라 노출 X).

### 3.3 무료 25초 preview 처리
서명 URL은 "구간 제한"을 직접 못 건다. 옵션:
- **(권장) preview 파일 분리**: 업로드/검수 시 25초 미리듣기 MP3(`_preview.mp3`)를 생성·저장. `free/expired/anon`에는 preview 객체의 서명 URL 발급 → 서버가 물리적으로 25초만 제공(클라 우회 불가). full은 원본 서명 URL.
  - 생성 시점: transcode 파이프라인(0196)에 preview 컷 추가(ffmpeg `-t 25`).
- (대안) full 발급 + 클라 25초 정지: 서버 강제력 없음 → paywall 우회 잔존. 비권장.

### 3.4 캐시 전략
- 서명 URL의 TTL을 **재생 세션 단위**(예: 6h)로 잡아 동일 사용자/트랙 재요청 시 같은 URL 재사용(클라 메모리 캐시) → 발급 호출 최소화.
- Storage CDN: 서명 쿼리스트링이 매번 달라지면 캐시 미스 → TTL을 시간 버킷(예: 정시 단위 만료)으로 양자화하면 동일 객체에 대해 동일 서명이 재사용되어 적중률↑(트레이드오프: TTL 정밀도↓).
- preview 객체는 동일 URL 장기 캐시 가능(권한 무관 공개 가능 — 단 25초라 무해).

### 3.5 TTL 전략
- full: 짧게(예: 1~6h) — 만료 후 재발급 시 서버가 trial/구독 재검증(만료 즉시 차단 효과).
- trial 사용자: TTL을 `min(기본TTL, free_trial_ends_at - now())`로 클램프 → trial 종료 시각 이후 URL 자동 무효.

### 3.6 stream_events 연동
- 재생 계측(`record_stream_event_safe`)은 현행 유지(클라가 30초/complete 보고). 단, **발급 시점에 서버가 권한을 이미 검증**하므로, 차후 `eligible_for_payout` 판정에 "발급 mode=full 여부"를 교차검증 신호로 추가 가능(부정 재생 차단 강화). 본 단계에서는 계측 로직 불변(분리 배포).

### 3.7 membership/trial/server validation 흐름
```
Player가 재생 시도
  → get-playback-url(track_id) [JWT]
    → 서버: subscription_status 판정(active/trial/free/expired/anon)
    → full or preview 서명 URL + mode 반환
  → <audio src=signedUrl>
  → (만료 임박/403 시) 재발급 → 서버 재검증
```
클라 `resolveMembership`는 **UI 표시 전용**으로 강등(차단 권한 없음).

## 4. 영향 분석
- **모바일 Safari**: private+서명 URL은 일반 https Range 요청이라 Safari 재생 정상(현행 public과 동일한 Range 동작). preview 분리 파일도 표준 MP3 → iOS 호환.
- **PWA/background**: MediaSession/lock-screen은 src URL만 필요 → 영향 없음. 단 **TTL 만료 중 백그라운드 장시간 재생** 시 다음 트랙 발급이 만료될 수 있음 → 재발급 핸들러 필수(403/만료 시 자동 재요청).
- **기존 플레이어 영향 범위**: `Player.tsx`의 `current.audio_url` 직접 사용처 → 발급 URL 사용으로 교체. 큐 prefetch 시 다음 트랙 URL 선발급 필요. 공유/차트/미리듣기 등 `audio_url` 참조 지점 전수 점검 필요(`grep audio_url`).
- **비용**: 발급 함수 호출(재생/트랙당 1회, 캐시로 절감) + Storage egress(현행과 동일). Edge proxy(B) 대비 현저히 저렴.

## 5. 단계별 rollout (additive, 무중단)
1. **P1 (비파괴)**: preview 파일 생성 파이프라인 추가(0196 transcode에 `_preview.mp3`). 기존 재생 불변.
2. **P2**: `get-playback-url` 엣지펑션 + 클라 발급 경로 추가(피처플래그). public 버킷 유지(병행). 내부 QA.
3. **P3**: 플레이어를 발급 URL 사용으로 전환(플래그 on). 재발급/Safari/PWA 실기기 QA.
4. **P4 (차단 전환)**: `audio` 버킷 private화 + `tracks` RLS에서 `audio_url` 직접노출 축소. → 우회 경로 폐쇄.
5. 롤백: 각 단계 플래그 off / 버킷 public 복귀로 즉시 원복.

## 6. 잔여 리스크 / 결정 필요
- preview 분리 저장 비용·기존 카탈로그 백필(소급 preview 생성) 범위.
- 버킷 private 전환 시 기존 외부 링크/임베드 영향.
- TTL/캐시 양자화 파라미터 튜닝(적중률 vs 만료 정밀도).
- `audio_url` 참조 전수 마이그레이션(공유 페이지/차트 미리듣기 등).

**본 설계는 미적용. P4(차단 전환)는 반드시 실기기 QA + 별도 승인 후.**
