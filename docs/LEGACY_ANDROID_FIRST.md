# LEGACY ANDROID FIRST

이 프로젝트의 성능·호환성 baseline 은 **최신 태블릿이 아니라 숙대점 실기기**다.

```
Android 10 · Samsung Internet · 설치형 PWA · 무인 매장 24시간 연속 재생
```

목표는 그 기기에서 **운영자 개입 0** 으로 며칠~몇 주가 이어지는 것이다.
점주가 아침마다 음악을 다시 켜는 구조를 끝내는 것이 최종 기준이다.

## 바꾸려면 증거가 필요하다

다음 변경은 **실기기 증거 없이 하지 않는다.**

- 지원 브라우저/OS 하한을 올리는 것
- "최신 Chrome 에서만", "새 태블릿 필요" 를 전제하는 API 도입
- 기기 교체를 해결책으로 제시하는 것
- Native 전환을 **우선** 해결책으로 제시하는 것

Web/PWA 에서 제거 가능한 failure class 는 끝까지 Web 에서 제거한다.
Native supervisor 는 *브라우저 프로세스가 실제로 죽은* 경우에만 논의하고,
그 경우가 실제로 관측됐다는 증거를 먼저 요구한다.
(2026-09-15 14:05 사건은 edge 로그로 **프로세스 사망이 아님**이 확인됐다.)

## PART 3 — 장기 실행 타이머 inventory

| 타이머 | OWNER | 주기 | CLEANUP | 재생성 조건 | 중복 가능성 |
|---|---|---|---|---|---|
| brand heartbeat | `useBrandPlayerHeartbeat` (BrandPlayerPage) | 60s | effect cleanup + `cancelled` 플래그 | `[enabled, brandId, sessionToken]` 변경 | 없음 — effect 당 1개 |
| stream heartbeat | `Player` (AppShell) | 10s | 재생 종료/언마운트 | 트랙 전환 | 없음 |
| stall watchdog | `Player` → `startBackgroundTicker` (Web Worker) | 3s | `ticker.stop()` + `worker.terminate()` + blob revoke | 언마운트 | 없음 — ref 1개 |
| shell health | `RecoveryControlPlane` (AppShell) | 5s | `window.clearInterval` | 없음(마운트 1회) | 없음 |
| 셸 워치독 (29) | `RecoveryControlPlane` — **기존 5s 틱에 얹음, 타이머 추가 0** | 5s | 위와 동일 | 없음 | 없음 |
| player runtime liveness (29) | `Player` 3s 워커 티커 — 모듈 변수 대입 1줄 | 3s | 티커 stop 과 함께 | 리마운트 | 없음 |
| 저하 폴링 | `RecoveryControlPlane` | 5s, **플레이어 정지 중에만** | `stopped` 플래그 + clearInterval | `[storeUserId]` | 없음 |
| Realtime 구독 | `RecoveryControlPlane` | push | `unsubscribe` + 소유권 반납 | `[storeUserId]` | **`acquireCommandReceiver` 단일 소유권으로 차단** |
| emergency poll | `AnnouncementOverlay` / `EmergencyBroadcastOverlay` (AppShell) | 5s / 15s | `clearInterval` | 라우트·권한 변경 | 없음 |
| SW update | `main.tsx` zero-touch | 배포 감지 | — | — | 없음 |

**0개가 되는 것(정지)도 2개 이상이 되는 것(중복)도 둘 다 금지.**
`legacyAndroidHardening.test.ts` 가 소스 수준에서 짝을 검증한다.

## PART 18 — Failure matrix

`audio continues?` 는 **이미 materialize 된 곡이 있을 때** 기준이다.

| | 상황 | audio | self-heal | shell | one-click | 운영자 | 데이터 |
|---|---|---|---|---|---|---|---|
| A | audio stalled | ✗ | ✅ 사다리 nudge→reload→skip→hard_reset | ✅ | ✅ | 불필요 | 없음 |
| B | audio error | ✗ | ✅ + 손상 캐시 폐기 | ✅ | ✅ | 불필요 | 없음 |
| C | next-track RPC 실패 | ✅ | ✅ **28에서 수정** — 추천 RPC 거부에도 `next()` 진행 | ✅ | ✅ | 불필요 | 없음 |
| D | telemetry RPC 실패 | ✅ | 해당 없음 (fire-and-forget) | ✅ | ✅ | 불필요 | 통계 1건 누락 |
| E | stream heartbeat 실패 | ✅ | 해당 없음 | ✅ | ✅ | 불필요 | `verified_seconds` 누락 |
| F | brand heartbeat cleanup | ✅ | — | ✅ | ✅ **27에서 수정** — 수신기가 셸에 있다 | 불필요 | 감지 지연 |
| G | Realtime disconnect | ✅ | ✅ 폴백 폴링 | ✅ | ✅ (≤5s 픽업) | 불필요 | 없음 |
| H | Player unmount | ✗ | — | ✅ | ✅ | 필요 시 1클릭 | 없음 |
| I | Player timer loss | ✗ | ✅ **29에서 닫힘** — 셸 워치독이 감지 → Player subtree 리마운트 → 실패 시 controlled reload | ✅ | ✅ | 불필요(예산 소진 시에만) | 없음 |
| J | Shell alive / Player dead | ✗ | 검토 대상 (PART 13) | ✅ | ✅ | 1클릭 | 없음 |
| K | network offline | ✅ (캐시분) | ✅ `offline_hold` — 오프라인 중 페이지 재시작 보류 | ✅ | ✗ (명령 못 닿음) | 회선 복구 | 없음 |
| L | cache miss | ✅ (네트워크) | ✅ | ✅ | ✅ | 불필요 | 없음 |
| M | cache write 실패 | ✅ | ✅ 삼킴 | ✅ | ✅ | 불필요 | 없음 |
| N | autoplay blocked | ✗ | ✗ **브라우저 정책 — 코드로 못 넘는다** | ✅ | ✗ | **화면 1회 터치 필요** | 없음 |
| O | 중복 복구 명령 | ✅ | ✅ exactly-once | ✅ | ✅ | 불필요 | 없음 |
| P | 같은 계정 다른 기기 | ✅ | — | ✅ | ✅ **28: install 수명으로 target, 모르면 FAIL CLOSED** | 불필요 | 없음 |
| Q | 재생 중 SW 업데이트 | ✅ | ✅ 트랙 경계까지 defer | ✅ | ✅ | 불필요 | 없음 |
| R | transition lock stuck | ✅ | ✅ 매장 모드는 crossfade 자체가 꺼져 있어 해당 없음 | ✅ | ✅ | 불필요 | 없음 |

**I 는 Phase 29 에서 닫혔다.** 플레이어의 3초 티커가 찍는 런타임 생존 신호가
150초(= 티커 50회 연속 결측) 넘게 낡으면, 셸이 Player subtree 를 새 세대로
리마운트한다. 최악 감지 지연은 **155초** — 2026-09-15 의 26분 방치 대비 1/10 이다.

리마운트를 페이지 재시작보다 먼저 쓴다. 문서가 유지되므로 Samsung Internet 의
자동재생 정책을 다시 만나지 않는다.

**다만 원인은 여전히 모른다.** 이 구조는 원인이 다시 와도 자동으로 복구될 뿐,
무엇이 14:06 에 타이머를 멎게 했는지는 증명하지 못한다.

남은 구멍은 **N(autoplay blocked)** 뿐이고, 그건 브라우저 정책이라 코드로 못 넘는다.
그리고 **PLAYER DOWN + SHELL DOWN** 은 웹 자가복구가 보장되지 않는다 —
2026-09-15 는 셸이 살아 있었으므로 그 경우가 아니었다.

## 성공의 정의

복구가 성공했다고 말할 수 있는 조건은 하나뿐이다.

```
TARGET monitored install
+ fresh player health
+ actual currentTime progress #1
+ actual currentTime progress #2
```

다음은 **성공이 아니다**: command issued · command received · reload executed ·
page loaded · heartbeat 만 돌아옴 · **다른 기기 세션의 heartbeat**.
