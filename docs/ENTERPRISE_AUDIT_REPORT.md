# ENTERPRISE / BRAND / HEADQUARTERS(본사) 기능 감사 보고서

> 코드 · DB 기준 감사 (추측 배제). 스크린샷이 아닌 Repository 실제 구현 기준.
> 감사일: 2026-07-24 · 기준 브랜치: `main` (merge #486까지)

---

## 0. 감사 방법 및 요약

- **근거**: `src/pages/*`, `src/components/enterprise/*`, `src/components/brand/*`, `src/lib/api/*`, `supabase/migrations/*` 실제 코드.
- **핵심 사실 1**: "본사(Enterprise HQ)" 는 별도 로그인이 아니다. 일반 Supabase Auth 로그인 후, `enterprise_accounts.auth_user_id = auth.uid()` 매칭으로 HQ 여부가 **서버에서 파생**된다.
- **핵심 사실 2**: 모든 enterprise/brand 데이터 접근은 RLS 차단 + `SECURITY DEFINER` RPC 경유. 권한 게이트는 **서버 RPC 내부**에서만 강제된다 (클라이언트 라우트 가드 없음).
- **핵심 사실 3**: "Brand" 와 "Franchise" 는 서로 다른 두 시스템이다. 혼동 금지.
  - Brand = `brand_accounts` / `brand_music_policies` (본사↔브랜드 1:1, 매장별 차등 없음, 통합 플레이어).
  - Franchise = `franchises` / `franchise_stores` (매장 단위 정책 동기화 · 모니터링).

---

## 1. 현재 구현 완료 기능

### 1-A. Enterprise Account / Role / Dashboard

| 항목 | 상태 | 근거 |
|---|---|---|
| Enterprise 계정 로그인 | ✅ (일반 로그인 + 파생) | `src/store/authStore.ts`, `useEnterpriseSelfRole.ts`, RPC `get_my_enterprise_role()` |
| Enterprise Dashboard | ✅ | `/enterprise/me` `EnterpriseHqMePage.tsx`, RPC `get_my_enterprise_dashboard()` |
| 접근 메뉴 (Ops/Intel/Notifications) | ✅ | `/enterprise/ops`, `/enterprise/intel`, `/enterprise/notifications` (App.tsx:266–270) |
| 온보딩 (초대코드) | ✅ | 0363 — `validate_enterprise_invite`, `claim_enterprise_hq_account`, 코드 회전 |
| 온보딩 (브랜드 레지스트리 + 관리자 승인) | ✅ | 0398 — `claim_brand_registry_enterprise`(status='invited'→관리자 승인 후 active), 초안 계약 자동 생성 |
| 진입 동선 | ✅ | ProfilePage → `EnterpriseHqProfileCard` → `/enterprise/me` → Ops/Intel/Notif CTA |

**Role 값**: `enterprise_accounts.role ∈ (owner, admin, enterprise_manager, viewer)` 컬럼은 **저장만** 됨. `status ∈ (active, invited, suspended, inactive)`. HQ 게이트 = `auth_user_id 일치 AND status in ('active','invited') AND deleted_at IS NULL`.

### 1-B. Brand

| 항목 | 상태 | 근거 |
|---|---|---|
| Brand Dashboard (관리자 CRUD) | ✅ | `src/components/admin/BrandPlayerPanel.tsx` (탭 `brand-player`, superOnly) |
| Brand 플레이어 (매장/사용자) | ✅ | `BrandPage.tsx`(store code 입력) → `BrandPlayerPage.tsx`, RPC `verify_store_code`, `getBrandPlayerConfig` |
| 브랜드 코드 / 레지스트리 관리 | ✅ | 0398 `enterprise_brand_registry` + 10 RPC, `admin_generate_brand_code`, `BrandRegistryPanel.tsx` |
| 플레이어 관리 컴포넌트 | ✅ | `BrandVisualStage / BrandSignage / BrandFullscreenControls / BrandQueueDrawer / BrandPlaybackProgress / BrandVolumeControl` |
| 이미지 관리 (사이니지) | ✅ | 0405 `brand_media_assets` + bucket `brand-media`; 0452 `brand_signage_settings` (전환효과·시계·now playing 토글) |
| 영상 관리 | ✅ | 0453 `brand_media_video_support` — asset_type image/video, mime/thumbnail/duration, 무음 재생 |
| 브랜드 정책 (음악) | ✅ | 0405 `brand_music_policies` (선호/차단 장르·무드, energy, vocal, daypart) → `_brand_generate_playlist` |
| 디바이스 바인딩 | ✅ | 0454 `verify_brand_device_binding`, revoke, `list_my_brand_devices`; 0455 rate-limit |

> ⚠️ 0454/0455 는 마이그레이션 헤더상 **Test 환경 적용** 명시 (Production 미적용).

### 1-C. Headquarters(본사) — 모니터링

기반 테이블: `store_policy_sync_status` (전용 `store_monitoring` 테이블은 **없음**; 0353/0355가 컬럼 확장) + 뷰 `store_monitoring_status`, `store_now_playing`.

| 예시 항목 | 상태 | 근거 |
|---|---|---|
| 가맹점 목록 조회 | ✅ | `admin_list_store_monitoring()`, `get_my_enterprise_ops_stores()` (0401) |
| Online / Offline 상태 | ✅ (계산값, 5분 임계) | `store_monitoring_status.is_online`, `is_idle_*`, `is_offline_24h` |
| 현재 재생중인 곡 | ✅ | `current_track_id` → tracks 조인, `store_now_playing` 뷰, `get_my_enterprise_ops_now_playing()` |
| Heartbeat | ✅ | RPC `store_heartbeat(...)` → `last_seen_at` 갱신 |
| 마지막 접속시간 | ✅ | `last_seen_at` (UI "마지막 heartbeat" 컬럼) |
| Store Health | ✅ | `_noc_store_health_score()` 0–100 + `admin_noc_store_health_list()` (0385) |
| Player 상태 | ✅ | `player_status ∈ playing/paused/stopped/offline/unknown` |
| 버전 정보 | ✅ | `app_version`, `last_player_version`, `has_update_required` (min version 비교) |
| 네트워크 상태 | 🟡 부분 | `connection_type`, `wifi_ssid` 저장만 (품질/지연 지표 없음) |
| 플레이리스트 상태 | 🟡 부분 | 정책 동기화 recency (`last_policy_sync_at`, `active_policy_id/version`)만. 라이브 큐/재생목록 상태 아님 |
| Scheduler 상태 (매장별) | ❌ | 매장 단위 스케줄러 상태 필드 없음 (플랫폼 cron 상태만 존재) |
| **Queue 상태** | ❌ | 큐 테이블/컬럼/RPC 전무. 단일 current track만 추적 |

### 1-D. Billing (본사 → 플랫폼 청구)

테이블 `enterprise_billing_invoices` (0382). 금액 = `활성매장수 × 월 매장단가 − 할인 + 세금`.

| 예시 항목 | 상태 | 근거 |
|---|---|---|
| 구독 상태 | 🟡 부분 (인보이스 status) | `status ∈ draft/issued/paid/overdue/cancelled/failed` (구독 엔티티 아님, 월별 인보이스) |
| 결제 상태 | ✅ | `paid_at`, `payment_reference/method`, `admin_mark_...invoice_paid` |
| 미납 여부 | ✅ | UI: `overdue` → "미납" 매핑 |
| 연체 여부 | ✅ | `admin_mark_enterprise_billing_overdue()` (due_date < today 배치), `is_overdue` 계산 |
| 계약 만료일 | ✅ (계약 테이블) | `enterprise_contracts.end_date` + D-30 경고 배너 (인보이스가 아닌 계약에서) |
| **자동결제 상태** | ❌ | PG/PSP 연동·자동청구 없음. payment 필드는 관리자 수기 입력 |

부가: PDF 생성 (`pdf_url`) · 이메일 발송 이력 (0397), edge fn `generate-enterprise-billing-pdf` 위임. HQ 화면은 **읽기 전용**.

### 1-E. Settlement / Contract (본사 관련)

- **정산** (플랫폼 → 본사 커미션): `enterprise_monthly_settlements` (0372). `pending→approved→paid`(paid 불변). 최소지급 게이트(0399), **다월 이월 엔진**(0400), 계약 연동(0390). UI `EnterpriseHqMonthlySettlementsCard`.
- **계약**: `enterprise_contracts` (0383). status 자동계산(expired/expiring/active), auto_renew, D-30 경고, 비공개 버킷(0394), 계약이 billing·settlement 단가/요율의 **원천**. UI `EnterpriseHqContractCard`.

### 1-F. Franchise Management

| 예시 항목 | 상태 | 근거 |
|---|---|---|
| 신규 가맹/본사 등록 | ✅ | `admin_create_franchise()`, `admin_create_enterprise_account_v2()` |
| Store Code 발급 | ✅ (초대코드 모델) | `hq_invite_code`/`store_invite_code`, `admin_rotate_enterprise_invite_code()` |
| Store 활성/비활성 | ✅ | `admin_link_franchise_store` (active) / `admin_unlink_franchise_store` (inactive) |
| 계약 상태 | ✅ | `enterprise_contracts.status`, `admin_set_enterprise_contract_status()` |
| 주소 | ✅ (본사 단위) | `enterprise_business_profiles.business_address` (매장별 주소 없음) |
| 담당자 | ✅ | `manager_name/email/phone` (+ 사업자 프로필 대표/정산 담당자) |
| 관리자 변경 | ✅ | `admin_update_enterprise_account()` (before/after 감사로그) |
| 업종 | 🟡 부분 | 매장주 `users.business_category` 표시만. 프랜차이즈 단위 업종 필드/세터 없음 |

### 1-G. Monitoring 대시보드

| 기능 | 상태 |
|---|---|
| Fleet Dashboard | ✅ (`admin_store_monitoring_kpi`, `admin_noc_kpi`, `get_my_enterprise_ops_kpi`, EnterpriseHqOpsPage 6 KPI) |
| Store Health | ✅ (NOC health score) |
| Incident | ✅ (`admin_noc_recent_events`, today_incidents/recovered) |
| Alerts | ✅ (`admin_noc_active_alerts` 7종 + `admin_notifications` 영속화 0393) |
| Playback | ✅ (`store_now_playing` + realtime publication + 남은시간 카운트다운) |
| Recovery | 🟡 부분 (수동 resync만; `auto_recovery_enabled` 플래그는 미작동) |
| Scheduler | 🟡 부분 (플랫폼 cron 상태만; 매장 스케줄러 없음) |
| **Streaming Quality** | ❌ (비트레이트/버퍼링/QoS 지표 전무) |
| **Queue** | ❌ |

### 1-H. Analytics / Intel

0402 `enterprise_hq_intel_center` — HQ 스코프 8개 집계 RPC (신규 테이블 없음).

| 통계 항목 | 상태 | 근거 |
|---|---|---|
| 매장 수 | ✅ | `get_my_enterprise_intel_kpi.total_stores` |
| 활성 매장 | ✅ | `active_stores`(online 기준) / dashboard `store_stats.active`(status 기준) — 정의 2종 |
| 장애 통계 | 🟡 부분 | health flag·`admin_operation_logs` 파생 (전용 incident ledger 없음) |
| 월별 사용량 | 🟡 부분 | `get_my_enterprise_intel_trend/monthly_report` = ops 이벤트 + 정산 매출 (청취 분/재생량 아님) |
| **재생량 (playback volume)** | ❌ | stream_events 집계 스코프 밖 명시 (0402) |
| **인기 플레이리스트** | ❌ | RPC/컬럼 없음 |
| **인기 장르** | ❌ | RPC/컬럼 없음 |
| 계약 현황 (본사 전체) | ❌ (intel 내) | `admin_contract_kpi`는 super_admin 전용. HQ는 자기 계약만 조회 |

추가 구현: Brand Health Score, 위험 매장 랭킹, 규칙기반 인사이트(7종), 임원 요약, CSV/JSON/PDF 내보내기.

---

## 2. 현재 미구현 기능 (Missing Features)

**명확히 코드/DB에 없음:**
1. **Queue 상태 모니터링** — 매장별 재생 대기열 추적 전무.
2. **Streaming Quality / QoS** — 비트레이트·버퍼링·지연 지표 없음.
3. **자동결제 (PG 연동)** — 결제/청구 자동화 없음. 전부 관리자 수기.
4. **재생량 / 인기 플레이리스트 / 인기 장르** 통계 — stream_events 집계 미구현.
5. **매장 단위 Scheduler 상태** — 플랫폼 cron만 존재.
6. **전용 장애 원장(Incident ledger)** — health flag·operation log 파생 프록시만.
7. **HQ 세분화 권한(RBAC) 강제** — `role`(owner/admin/viewer) 저장만, 미강제 (모든 HQ 유저 동일 권한).
8. **HQ 라우트 클라이언트 가드** — `RequireAuth`만; 비-HQ 유저도 URL 진입 가능(RPC forbidden으로 에러화면).
9. **멀티유저 HQ / 팀원** — 본사당 auth_user_id 1개, 2번째 클레임 거부.
10. **자동 복구(Auto-recovery)** — 설정 플래그만, 실행 코드 없음.
11. **글로벌 내비 메뉴 노출** — enterprise 진입은 ProfilePage/직접 URL만.
12. **매장별 주소/업종 필드** · **QR 초대 발급**(명시적 차기 연기).

**잠재 결함(발견):** `last_heartbeat_at` 컬럼을 NOC(0385)·region summary가 읽지만 `store_heartbeat`는 이를 쓰지 않음(뷰 alias로 우회). `_noc_store_health_score`는 원본 미기록 컬럼을 읽어 latent correctness gap.

---

## 3. 운영 가능 수준 평가

| 영역 | 평가 | 비고 |
|---|---|---|
| Enterprise 계정/온보딩 | ★★★★☆ | 2종 온보딩 + 관리자 승인 견고. RBAC 미강제·단일유저 한계 |
| Brand 플레이어/사이니지 | ★★★★☆ | 이미지·영상·정책·디바이스 바인딩 완비. 매장별 차등 불가, 일부 Test 한정 |
| 본사 모니터링(Fleet/Health) | ★★★★☆ | Online/NowPlaying/Health/Alert 실사용 가능. Queue·QoS·Scheduler 부재 |
| Billing/Settlement/Contract | ★★★☆☆ | 인보이스·연체·정산·이월·계약 완비하나 **자동결제·자동배치 없음(수기)** |
| Analytics/Intel | ★★★☆☆ | 매장수·헬스·정산추세는 가능. **재생량/인기 콘텐츠 통계 전무** |
| 권한/보안 게이트 | ★★★★☆ | 서버 RPC 게이트 견고(super-admin 우회 차단). 클라 가드·세분 RBAC 부재 |

**종합: ★★★★☆ (관측·관리 강, 자동화·콘텐츠 분석 약)**

---

## 4. 본사 운영 적합성

- **가능**: 본사 로그인 → 가맹점 fleet 실시간 관측(온라인/현재곡/헬스/알림) → 정책·미디어 배포 → 강제 재동기화 → 월 정산/계약/인보이스(연체 포함) 관리. **일상 관제·정산 운영은 실사용 가능한 수준.**
- **제약**: (1) 결제가 수동 — 대량 가맹 청구 자동화 불가. (2) 재생량·인기 콘텐츠 등 **경영 의사결정용 사용량 분석 부재**. (3) Queue·스트리밍 품질 등 딥 운영 관측 부재. (4) 권한 세분화·팀 협업 미지원. (5) 자동 장애 복구 미작동.

**결론: 본사 "관제·정산" 운영은 적합, "빌링 자동화·콘텐츠 애널리틱스·대규모 팀 운영"은 아직 부적합.**

---

## 5. 다음 Phase 제안 — Recommended Next Phase (Top 20, 우선순위순)

1. **자동결제(PG/정기결제) 연동** — 인보이스 자동 청구·수납.
2. **연체/정산 자동 배치(cron 트리거)** — 현재 수동 RPC 자동화.
3. **재생량(stream_events) 본사 집계 RPC** — 매장별/브랜드별 재생량.
4. **인기 플레이리스트·인기 장르 통계** — 콘텐츠 애널리틱스.
5. **HQ RBAC 강제** — owner/admin/viewer 권한 실제 분기.
6. **HQ 라우트 클라이언트 가드** — 비-HQ 리다이렉트(RequireEnterpriseHq).
7. **멀티유저 HQ / 팀원 초대** — 본사 다중 담당자.
8. **Queue 상태 모니터링** — 매장 재생 대기열 가시화.
9. **자동 복구(Auto-recovery) 실행 엔진** — `auto_recovery_enabled` 실동작.
10. **전용 Incident ledger** — 장애 발생/복구 원장 + SLA.
11. **Streaming Quality/QoS 메트릭** — 버퍼링·끊김·비트레이트.
12. **`last_heartbeat_at` 기록 정합성 수정** — heartbeat write 일원화.
13. **매장별 Scheduler 상태** — dayparting 스케줄 실행 상태 노출.
14. **본사 전체 계약현황 대시보드** — intel 내 계약 KPI 노출.
15. **글로벌 내비 Enterprise 진입점** — AppShell 메뉴 노출.
16. **QR 초대 발급** — 매장 온보딩 간소화.
17. **매장별 주소/업종 필드 + 세터** — 운영 마스터데이터.
18. **알림 채널 실발송(Slack/Discord/Email/Webhook)** — 현재 config만(V1 dummy).
19. **Production 디바이스 바인딩/rate-limit 승격** — 0454/0455 Test→Prod.
20. **월별 사용량 리포트에 청취 분(minutes) 지표 추가** — 경영 리포팅.
