# SUKDAE-PLAYBACK-RECOVERY-17 — 숙대점 강제 재생 복구 1회 시도

**판정: `CLIENT UNREACHABLE` — PLAYBACK RECOVERED 아님.**
운영자 승인 범위 내에서 명령 1회만 발행했고, 두 번째 명령은 발행하지 않았다.
reload / app_restart 는 실행하지 않았다.

---

## 1. 발행 전 상태 (보존)

DB now: `2026-09-15 05:19:36.470881+00`

### Incident (미해결)
| field | value |
|---|---|
| id | `c3bdc4a1-a385-4796-9148-47c0c473a84a` |
| store_user_id | `1311d900-c451-4b9b-8ced-27f164bdc337` |
| store_label | 르하임스터디카페s 워크라운지 숙대점 |
| brand | 카공시대 `682c08e1-55b7-4324-8572-39afabfe6519` |
| status / detection | `offline` / `silence` |
| opened_at | `2026-09-15 05:09:00.139824+00` |
| down_notified_at | `2026-09-15 05:11:00.123607+00` |
| resolved_at | `NULL` |
| healthy_checks | 0 |

### 마지막 heartbeat / progress timestamp (핵심 baseline)
| field | value |
|---|---|
| session_id | `823034d7-7419-4ea5-92b5-7aa6ac49824c` |
| player_instance_id | `12d7a7b1-72b6-4af8-ba76-dec2331c9811` |
| **last_seen_at (heartbeat)** | **`2026-09-15 05:05:19.930398+00`** |
| **last_audio_progress_at (progress)** | **`2026-09-15 05:05:19.930398+00`** |
| current_track_id | `20c36ba3-4bc0-4bf4-9029-579de3ceffd8` |
| current_track_started_at | `2026-09-15 05:04:00.897465+00` |
| audio_ready_state | 4 (HAVE_ENOUGH_DATA) |
| audio_network_state | 1 (NETWORK_IDLE — 로드는 끝났고 더 안 읽음) |
| visibility / online / wake lock | visible / true / true |
| realtime_status | `SUBSCRIBED` (05:05:19 기준 마지막 보고값) |
| build (page / sw) | `b9c26f5e3aba` / `b9c26f5e3aba`, sw_controlled=true |

heartbeat 와 audio progress 가 **같은 시각에 같이 멈췄다.** 트랙 시작 79초 뒤 정지.

### 직전 이력
- `6641addf` `reload` — 2026-09-14 발행, `received_at` 만 찍히고 `executing`/`succeeded` 없음.
  어제도 배달은 됐으나 실행 보고가 없었다.
- 이 매장에 `play` 명령 이력은 **없었다** → play 쿨다운 해당 없음.
- monitoring_exempt 아님. 03:37 이후 self-heal 활동 없음(04:18 `session_start/fresh_load` 가 마지막).

---

## 2. 발행한 명령 (1회, 이것뿐)

| field | value |
|---|---|
| command_id | `e0aea443-1727-47b7-8153-11c7a6b8abab` |
| command | **`play`** (실행부에서 `deps.play()` 만 부르는 가장 약한 경로) |
| target_player_instance_id | `12d7a7b1-72b6-4af8-ba76-dec2331c9811` (가능한 가장 구체적인 target) |
| session_id | `823034d7-7419-4ea5-92b5-7aa6ac49824c` |
| store_user_id | `1311d900-...` (숙대점 단일 대상, broadcast 아님) |
| issued_at | `2026-09-15 05:23:35.188773+00` |
| expires_at | `2026-09-15 05:25:35.188773+00` |
| **TTL** | **120s — 기존 기본 안전값 그대로, 손대지 않음** |

발행은 `store_user_id` 30분 내 중복 `play` 가 없을 때만 삽입되는 guard 로 감쌌다.
사후 확인: `05:00Z` 이후 이 매장 명령 발행 건수 = **1**.

---

## 3. Command lifecycle 추적 결과

| sampled_at | status | received_at | delivery_source | consumed_at | progress_advanced |
|---|---|---|---|---|---|
| 05:24:50Z | `pending` | NULL | NULL | NULL | false |
| 05:27:23Z (TTL 경과) | `pending` | NULL | NULL | NULL | false |
| 05:28:44Z | `pending` | NULL | NULL | NULL | false |

```
PENDING  →  (RECEIVED 도달 못 함)  →  EXECUTING ✗  →  SUCCEEDED/FAILED ✗
```

TTL 120초 전 구간에서 `RECEIVED` 로 넘어가지 못했다. `delivery_source` 가 끝까지 NULL —
realtime(WebSocket) 경로도, heartbeat(60초 폴링) fallback 경로도 명령을 집어가지 못했다.

## 4. 실제 재생 판정 (command status 무시)

| field | before | after |
|---|---|---|
| last_audio_progress_at | `05:05:19.930398+00` | `05:05:19.930398+00` (변화 없음) |
| last_seen_at | `05:05:19.930398+00` | `05:05:19.930398+00` (변화 없음) |
| current_track_started_at | `05:04:00.897465+00` | 변화 없음 |
| heartbeat age (05:28:44Z 기준) | — | **22분 39초** |
| incident | offline / 미해결 | offline / 미해결 (`last_checked_at` 05:27:00) |

**NEW currentTime progress 없음 → PLAYBACK RECOVERED 아님.**

`play` 실행부는 `deps.play()` 직후 무조건 `succeeded` 로 ACK 하므로
command status 만으로는 재생 복구를 판정할 수 없다. 이번에는 그 ACK 자체가 오지 않았다.

## 5. 결론

heartbeat 가 끊겨 명령이 전달되지 않았다 → **`CLIENT UNREACHABLE`** 로 기록.
지시대로 두 번째 명령은 발행하지 않았다.

- 추가 `reload` / `app_restart` **미실행** — 운영자 승인 대기.
- 화정점(`3caef236-d025-4141-8c96-3eb5067a53e0`) 은 조회 목록에 이름만 스쳤을 뿐
  명령·쓰기 일체 없음.
- service_role impersonation 없음. JWT claim 위조 없음. 클라이언트 ACK 위조 없음
  (`ack_store_recovery` 호출 안 함, `result_code` 손대지 않음).
  결과 기록은 운영자 필드인 `note` 에만 덧붙였다.
- 만료된 `e0aea443` 는 `expire_stale_recovery_commands()` 스윕이 `expired` 로 정리한다.
  꺼져 있던 기기가 나중에 켜져도 TTL 이 지났으므로 뒤늦게 실행되지 않는다.

### 관측된 장애 성격 (참고)
`audio_ready_state=4` + `audio_network_state=1` 은 미디어는 다 로드됐는데 더 진행하지
않는 상태다. 03:17~03:44 사이 `playback_stalled/self_heal` 3회와 `track_cut_short/skip`
연속, `media_error` 1회가 있었고, 04:18 `fresh_load` 로 세션이 새로 뜬 뒤 05:04 트랙
시작 → 05:05:19 에 heartbeat·progress 동시 정지다. 탭/워커가 같이 얼어붙어
heartbeat 조차 못 보내는 양상으로, 명령 배달 경로 자체가 죽어 있다.
