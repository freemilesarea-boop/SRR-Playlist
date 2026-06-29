# Enterprise E2E Checklist

대상: Phase 4-12 / Priority 3-8 에 추가된 Enterprise 기능 전체.
실행 시점: 운영 DB 에 0379–0385 migration 모두 적용 후.

검증 SQL: [`ENTERPRISE_E2E_SANITY.sql`](./ENTERPRISE_E2E_SANITY.sql)

---

## 1. Migration 적용 여부 (§1)

| Migration | Tables | RPCs | Storage | Status |
|---|---|---|---|---|
| 0378 Policy Automation | rules, runs (2) | 9 RPC + 2 helper | — | ☐ |
| 0379 Deployable Playlist | (alter fmp) | 2 new + 1 replace | — | ☐ |
| 0380 CTE scope hotfix | — | 2 replace (signature 보존) | — | ☐ |
| 0381 Announcement Scheduler | assets, schedules, play_logs (3) | 11 RPC + 1 helper | `enterprise-announcements` | ☐ |
| 0382 Billing Invoices | invoices, items (2) | 9 RPC + 2 helper | — | ☐ |
| 0383 Contracts | contracts, files (2) | 9 RPC + 6 helper | `enterprise-contracts` | ☐ |
| 0384 Emergency Broadcast | broadcasts, targets (2) | 9 RPC + 1 helper | (재사용) | ☐ |
| 0385 NOC | settings, channels (2) | 13 RPC + 2 helper | — | ☐ |

**판정 기준**: §1 의 `ok` 컬럼이 모두 `1`.

---

## 2. RLS / Grant (§2-3)

- `rowsecurity = true` 모든 13개 신규 테이블 (§2)
- `authenticated_can_execute = true` 모든 admin RPC (§3)
- store-facing RPC (`store_get_due_announcements`, `store_mark_announcement_played`, `store_get_active_emergency_broadcasts`, `store_mark_emergency_broadcast_status`, `get_my_enterprise_billing_summary`, `get_my_enterprise_contract`) 도 authenticated execute 허용

---

## 3. 테스트 데이터 (§4)

운영 환경 최소 요건:
- enterprise_accounts (active+invited) ≥ 1
- active franchise_stores ≥ 5 (NOC / billing 의미 있는 값 위해 권장)
- playlists ≥ 1 (배포 플레이리스트 등록 가능)
- franchise_music_policies (active/draft) ≥ 1 (자동 스케줄 dropdown 노출)
- enterprise_announcement_assets (active) ≥ 1 (announcement schedule + emergency broadcast 생성 가능)
- enterprise_contracts ≥ 1 (계약 우선순위 로직 검증)
- enterprise_billing_invoices ≥ 1 (HQ summary 검증)

데이터가 0 인 항목이 있으면 해당 시나리오는 N/A 로 표기.

---

## 4. E2E 시나리오 (Admin UI)

### A. 배포 플레이리스트 (Priority 4)
- [ ] `/admin → 프랜차이즈 관리 → 배포 플레이리스트 탭`
- [ ] **기존 플레이리스트에서 등록** 모달 → 음원 풀에서 1개 선택 → 등록
- [ ] `admin_list_deployable_policies` (자동 스케줄 모달) 에 등록 항목 노출 + source_type/곡수 표시 (Priority 4 + 0379)
- [ ] sanity §5 A 결과: `source_playlist_title` 비-null 항목 존재

### B. 자동 음악 스케줄 (Priority 3)
- [ ] `/admin → 자동 음악 스케줄 → 자동 스케줄 생성`
- [ ] 적용할 플레이리스트 dropdown 정상 노출 (Priority 4 결과 반영)
- [ ] `daily:18:00` recurrence 입력 → 저장 → 목록에 active 노출
- [ ] **Preview (dry-run)** 클릭 → 대상 매장 수 표시
- [ ] **지금 음악 배포** 클릭 → 토스트 "음악 배포가 요청되었습니다."
- [ ] 실행 로그 탭 → run row 노출 + deployment_id 연결

### C. 음악 배포 현황 (Priority 2-5/6/7)
- [ ] `/admin → 음악 배포 현황` → 6 KPI + 적용률 progress
- [ ] B 에서 생성된 deployment 가 목록에 노출
- [ ] 실패 매장 탭 → 실패 사유 classifier 노출 (sanity §5 C)
- [ ] DetailModal: 재계산 / 일괄 재시도 / 단건 재시도 동작

### D. 안내/광고 음원 (Priority 5)
- [ ] `/admin → 안내/광고 음원 → 음원 업로드` → 파일 + 제목 → 등록
- [ ] **예약 재생 만들기** → `daily:12:00` → 활성 저장
- [ ] sanity §5 D: 매장 본인이 `store_get_due_announcements()` 호출 시 due 시간대면 row 반환

### E. 긴급 방송 (Priority 7)
- [ ] `/admin → 긴급 방송 → 긴급 방송 생성` (draft)
- [ ] 음원 dropdown + 범위 + interrupt mode → 저장
- [ ] 목록에서 **송출** 클릭 → active + 대상 매장 수 확인
- [ ] /store (player 키오스크) → 5초 내 빨강 띠 + BGM pause + 긴급 음원 재생
- [ ] ended 후 BGM 자동 resume + sessionStorage dedup 확인
- [ ] 상세 모달: pending/playing/played/failed 매장 분포
- [ ] **완료 처리** → 남은 pending → expired

### F. 계약 관리 (Phase 4-12)
- [ ] `/admin → 계약 관리 → 계약 등록`
- [ ] 본사/계약번호/계약명/시작일 + 매장당 기준 금액 (예: 5,500원) + 수수료율 → active 로 저장
- [ ] 첨부파일 PDF 업로드 → 다운로드 링크 확인
- [ ] 상세 모달 — computed_status 가 active/expiring/expired 자동 분류
- [ ] sanity §1 0383: `_enterprise_monthly_store_price` body 에 `_enterprise_active_contract` 포함 (Billing helper update 확인)

### G. 본사 청구 (Priority 6)
- [ ] `/admin → 본사 청구 → 청구서 생성` (이번 달, 전체 본사, draft)
- [ ] F 계약이 있는 본사의 invoice `monthly_store_price` 가 **계약값** (5,500원) 으로 반영되는지 확인 (F 미수행 시 4900 fallback)
- [ ] 상세 모달 → **할인/세액 조정** (draft 만) → 총액 재계산
- [ ] **발행** → issued → **입금 완료** (결제 참조/수단 입력)
- [ ] 미납 일괄 전환 (due_date 지난 issued → overdue)

### H. NOC (Phase 8)
- [ ] `/admin → 운영센터 (NOC)` 진입
- [ ] 12 KPI cards 모두 숫자 표시 (loading 단계 후)
- [ ] 헤더 라이브 시각 7초마다 갱신
- [ ] 지역별 카드: online/offline 카운트 + ! errors / ⚠ warnings 표시
- [ ] 실시간 장애: severity badge (critical/major/minor/info) — 클릭 → store detail modal
- [ ] Store Health: color tone (green/yellow/orange/red) + 검색 동작
- [ ] Live Timeline: 최근 24h admin_operation_logs
- [ ] **자동 복구 토글** → setting 저장 + audit log
- [ ] **알림 채널** → Slack/Discord/Email/Webhook CRUD (V1 dummy)
- [ ] StoreDetailModal: now_playing + health breakdown + recent emergency/announcement/policy/logs

---

## 5. HQ /enterprise/me read-only (Priority 1-1 ~ Phase 4-12)

HQ 사용자 (enterprise_accounts.auth_user_id) 로 로그인 후:
- [ ] **본사 정보 카드** — 기본
- [ ] **Settlement preview 카드** — Phase 1-10 (활성 매장 × 매장당 정산금)
- [ ] **월 정산 카드** — Phase 1-11 (Enterprise Monthly Settlement)
- [ ] **계약 정보 카드** — Phase 4-12 (현재 활성 계약 + D-30 경고 + 최근 5건, 수정 불가)
- [ ] **청구 현황 카드** — Priority 6 (이번 달 청구 + 최근 6개월)
- [ ] 모든 카드: 본인 본사만 노출 (RLS 격리 확인 — 다른 본사 데이터 접근 불가)

---

## 6. 정합성 (§6-7)

- [ ] `orphan_broadcast_targets = 0`
- [ ] `negative_count_invoices = 0`
- [ ] `bad_date_contracts = 0`
- [ ] `bad_max_plays = 0`
- [ ] §7 Health Score 분포: total ≥ 1, avg_score 합리적 (정상 매장 ≥ 70 권장)

---

## 7. Storage (§8)

| Bucket | public | size_limit | mime_count | Status |
|---|---|---|---|---|
| `enterprise-announcements` | true | 20971520 (20MB) | 8 (mp3/wav/m4a/aac/mp4 등) | ☐ |
| `enterprise-contracts`     | true | 20971520 (20MB) | 5 (pdf/docx/doc/jpg/png)   | ☐ |

---

## 8. Audit Log 트래픽 (§9)

24시간 내 다음 source 그룹의 이벤트 카운트가 시나리오 수행과 일치하는지 확인:
- `enterprise_billing.invoice.*` (G 시나리오 수행 횟수)
- `enterprise_contract.*` (F)
- `emergency_broadcast.*` (E)
- `enterprise_announcement.*` (D)
- `policy_automation.*` (B)
- `franchise_music_policy.create_from_playlist` (A)
- `noc.*` (H 설정 변경 시)

---

## 결과 표

| # | 항목 | PASS / FAIL / N/A | 원인 / 비고 | 수정 PR |
|---|---|---|---|---|
| 1 | Migration 0378-0385 적용 | ☐ | — | — |
| 2 | RLS 활성화 (13 tables) | ☐ | — | — |
| 3 | RPC grant (전체 admin/store) | ☐ | — | — |
| 4 | 테스트 데이터 최소 요건 | ☐ | — | — |
| A | 배포 플레이리스트 | ☐ | — | — |
| B | 자동 음악 스케줄 | ☐ | — | — |
| C | 음악 배포 현황 | ☐ | — | — |
| D | 안내/광고 음원 | ☐ | — | — |
| E | 긴급 방송 (admin + player) | ☐ | — | — |
| F | 계약 관리 | ☐ | — | — |
| G | 본사 청구 (+ 계약 단가 우선 적용 확인) | ☐ | — | — |
| H | NOC | ☐ | — | — |
| I | HQ /enterprise/me 카드 5종 | ☐ | — | — |
| 정합성 | orphan / negative / bad_date | ☐ | — | — |
| Storage | 2 bucket | ☐ | — | — |
| Audit Log | source 별 trace | ☐ | — | — |

---

## 모든 PASS 시

**Enterprise E2E PASS** 보고 + 본 체크리스트와 sanity 결과 캡처를 공유.
