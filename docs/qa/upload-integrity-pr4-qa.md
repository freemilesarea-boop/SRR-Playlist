# PR #4 — 대량 업로드 무결성 실기기 QA 체크리스트

> 목적: "사용자가 올린 파일 = 실제 등록된 곡" 100% 보장 검증. **이 QA 통과 전 PR #4 머지 금지.**
> 본 QA는 사람이 실기기 브라우저에서 직접 수행한다. (Claude는 브라우저/iPhone 실행 불가 → 미실행.)

## ⚠ 사전 조건 (Prerequisite) — 반드시 먼저
PR #4 프론트는 마이그레이션 **0196** 의 RPC/컬럼에 의존:
`record_upload_integrity2`, `get_my_batch_status`, 강화된 `check_batch_integrity`(null_sha_count), `upload_integrity_logs.{original_filesize,final_filesize,transcoding_status}`.
- **0196 이 QA 대상 DB에 적용돼 있어야 함.** (현재 라이브 **미적용** — tx-rollback 검증만 완료.)
- 0196 은 additive(신규 컬럼/함수, drop 없음)이며 데이터 무변경. QA 대상 DB(=라이브)에 0196 적용 후 QA 권장.
- 0196 미적용 상태로 QA 시: 무결성 로깅/복구 배너/integrity_failed 차단이 동작하지 않음(거짓 통과 위험) → **반드시 0196 적용 후 QA.**

## QA 환경 매트릭스
| 환경 | 비고 |
|---|---|
| Chrome 데스크탑 | 기준 |
| Safari 데스크탑 | Range/재생 |
| iPhone Safari | **메모리/선해싱/백그라운드 핵심** |
| 저사양 Windows + Chrome | 성능 하한 |
| 느린 네트워크(throttle) | 끊김/재시도 |

## 시나리오 & 기대 결과 (각 환경에서)
| # | 시나리오 | 조작 | 기대 결과 |
|---|---|---|---|
| 1 | 30곡 WAV | 30개 WAV 선택 → 제출 | 전곡 success, 대조 리스트 파일명↔곡명 1:1, 무결성 경고 없음 |
| 2 | WAV/FLAC/MP3 혼합 | 혼합 선택 → 제출 | 전곡 success, transcode 정상(비-mp3 변환), 매핑 정확 |
| 3 | 동일 콘텐츠·다른 파일명 | 같은 음원을 이름만 바꿔 2개 포함 | **1곡만 success, 나머지 "콘텐츠 중복 차단"** 토스트 + failed |
| 4 | 동일 파일 중복 선택 | 같은 파일 2회 선택 | 선택 단계에서 fingerprint 중복 제외 |
| 5 | 업로드 중 새로고침 | 업로드 진행 중 F5 | beforeunload 경고 → 재진입 시 **복구 배너**(등록 N/미완료 M), 미완료 파일 재선택 안내 |
| 6 | 네트워크 끊김→재시도 | throttle/offline 토글 | 해당 곡 failed(isolated), "실패한 N곡만 재시도"로 성공 |
| 7 | transcode 실패 | 손상/비표준 파일 | 해당 곡만 failed 또는 원본 업로드(transcoding_status='failed'), 나머지 정상 |
| 8 | integrity_failed 차단 | (가능하면) 동일 final sha 유발 | 무결성 경고 배너 + **자동 완료(onUploaded) 차단**(목록 새로고침 안 됨) |
| 9 | 제출된 곡 재업로드 방지 | 성공곡 포함 재제출 | 성공곡은 제외, 미성공만 업로드 |
| 10 | orphan storage | submit RPC 실패 유발(가능 시) | storage 객체 정리 시도(로그 확인), 떠도는 파일 없음 |
| 11 | 관리자 무결성 패널 | 관리자 > 업로드 무결성 | failed/duplicate/null-sha 로그 정상 노출 |

## 반드시 확인 (통과 판정 핵심)
- [ ] **다른 곡으로 잘못 등록 0건** (대조 리스트 파일명↔곡명 전수 일치)
- [ ] final sha 중복 오탐/누락 없음 (정상 30곡은 무결성 OK)
- [ ] integrity_failed 배치는 자동 완료 차단됨
- [ ] failed 곡만 재시도 가능
- [ ] submitted(success) 상태 회귀 없음
- [ ] orphan storage 미발생
- [ ] iPhone Safari 크래시 없음 (30곡, 최소 10곡 이상 안정)
- [ ] 선해싱 지연이 사용 가능한 수준 (체감/측정)
- [ ] 관리자 패널 로그 정상

## 측정/기록 (정직 보고용)
- iPhone: Web Inspector 또는 설정>Safari 메모리, 백그라운드 전환 후 복귀 동작.
- 선해싱: 제출 직후 첫 업로드 시작까지 지연(초). 대용량 다수일 때 특히.

## 결과 표 (그대로 채워 제출)
| 환경 | 파일 수 | 성공 | 소요시간 | 실패 곡 | integrity mismatch | 메모리 문제 | 비고 |
|---|---|---|---|---|---|---|---|
| Chrome (30 WAV) | | | | | | | |
| Chrome (혼합) | | | | | | | |
| Safari (30곡) | | | | | | | |
| iPhone Safari | | | | | | | |
| 저사양 Windows | | | | | | | |
| 동일콘텐츠 다른이름 | | | | | | | |
| 업로드 중 새로고침 | | | | | | | |
| 네트워크 끊김→재시도 | | | | | | | |
| transcode 실패 | | | | | | | |
| 관리자 무결성 패널 | | | | | | | |

## 통과 기준 (전부 충족 시에만 머지)
1. 다른 곡 잘못 등록 0건
2. final sha 중복 오탐/누락 없음
3. submitted 회귀 없음
4. failed 곡만 재시도 가능
5. integrity_failed 배치 제출 차단
6. iPhone Safari 10곡+ 안정
7. Chrome/Safari 30곡 성공

## QA 후 적용 순서 (원칙)
PR → **QA(본 문서)** → 0196 라이브 적용(미적용 시) → 모니터(무결성 대시보드: orphan/duplicate/failed) → PR #4 merge.
QA에서 느림/메모리/mismatch 발견 시 수정 후 재QA.
