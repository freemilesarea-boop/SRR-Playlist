# 앱 화면 렌더 점검 결과

앱 크기(`.native-shell`)에서 **67개 화면 × 2가지 크기 = 134회**를 실제로 그려서
기계적으로 판정 가능한 것만 뽑았다. 폰 390×844, 태블릿 1280×800.

67개 = 페이지 43개 + 관리자 탭 21개 + 파라미터가 필요한 경로 몇 개.
로그인이 필요한 화면은 역할별(개인·매장·아티스트·본사·관리자) 세션을 넣어서 열었다.

## 이 점검이 볼 수 있는 것 / 없는 것

**본 것** — 가로 넘침, 하단탭에 가려지는 조작부, 손가락으로 누르기 어려운 크기,
JS 예외, 빈 화면, 사이드바 노출.

**못 본 것** — 색 대비, 실제 데이터가 많을 때의 밀도, 스크롤·제스처 느낌, 애니메이션,
실제 기기의 폰트 렌더링. 이건 사람이 기기에서 봐야 한다.

서버 응답은 가짜다(운영 DB 에 닿지 않도록 가짜 호스트로 빌드하고 전부 가로챘다).
따라서 **데이터가 채워진 상태의 레이아웃은 검증되지 않았다.** 빈 상태 기준이다.

---

## 1. JS 예외 — 1개 화면

### `/admin` → 매장 모니터링 (`store-monitoring`)

```
TypeError: Cannot use 'in' operator to search for 'data' in null
```

`src/components/admin/StoreMonitoringPanel.tsx:173`

```ts
setFranchises(Array.isArray(f) ? f : []);   // ← 이 줄은 null 을 막는다
setRegions('data' in r ? r.data : []);      // ← 이 줄은 안 막는다. r 이 null 이면 터진다
```

바로 윗줄은 같은 위험을 `Array.isArray` 로 막고 있는데 아랫줄만 빠졌다. 지역 목록
RPC 가 null 을 돌려주면 패널 전체가 죽는다.

## 2. 가로 넘침 — 1개 화면

| 화면 | 크기 | 넘침 | 범인 |
|---|---|---|---|
| `/admin` → 정산 V2 (`settlement-v2`) | 폰 | **147px** | `div.shrink-0` 안의 버튼 묶음이 안 접힘 |

## 3. 하단탭에 가려 못 누르는 조작부 — 28건 / 27개 화면

하단탭(`z-30`)이 콘텐츠 위에 떠 있는데 그 아래 여백이 모자라서 조작부가 깔린다.

| 화면 | 크기 | 못 누르는 것 |
|---|---|---|
| **관리자 22개 탭 전부** | 폰 | 하단 "Supabase 대시보드" 링크 |
| `/business/player` | 폰·태블릿 | "매장용 앱 설치" |
| `/profile` | 폰 | 알림 설정 "끄기 / 3초 / 5초 / 8초" |
| `/business` | 태블릿 | 스케줄 방식 선택 |
| `/pricing` | 태블릿 | 입력란 + "적용" |
| `/artist` | 태블릿 | 입력란 |

관리자 22건은 원인이 하나다 — 관리자 셸의 하단 여백. 한 곳만 고치면 22개가 같이 없어진다.

## 4. 누르기 어려운 크기 — 100건 / 50개 화면

높이 32px 미만(또는 폭 24px 미만)인 조작부. 권장은 44px.

| 화면 | 개수 | 예시 |
|---|---|---|
| `/admin upload-integrity` | 17 | `Supabase 대시보드(115×17)`, `검수·QC(68×29)` |
| `/admin ai-curation` · `placement-audit` | 13 | 상단 탭 칩 `(72×29)` |
| `/admin business-live` · `payout-intake` | 12 | |
| `/search` | 10 | 추천 칩 `1카페(61×28)` |
| `/enterprise/intel` | 10 | `알림센터(30×30)`, `재시도(51×23)` |
| `/profile` | 9 | `새로고침(59×16)`, `테스트(68×25)` |
| `/sales-partners` | 7 | 업종 칩 `카페(48×28)` |

대부분 **두 가지 공통 원인**이다:

1. 관리자 상단 탭 칩 — 높이 29px. 관리자 화면 거의 전부에 나온다.
2. "Supabase 대시보드" 링크 — 높이 17px. 관리자 화면 전부에 나온다.

이 둘만 키우면 100건 중 60건 이상이 사라진다.

---

## 별건: 본사 계정이 `/enterprise/hq` 를 못 연다

게이트가 두 개인데 서로 다른 테이블을 본다.

- `/enterprise/*` 대부분 → `get_my_enterprise_role()` → `enterprise_accounts.auth_user_id`
- `/enterprise/hq` → `get_my_franchise_admin()` → **`franchise_admins` 행**

테스트용 본사 계정(`demohq@deudda.com`)은 앞쪽만 만족한다. 실제로 DB 에서 확인:

```
get_my_enterprise_role()   → is_hq = true, "Deudda 데모 본사"
get_my_franchise_admin()   → is_franchise_admin = false
```

그래서 `/enterprise/hq` 는 "본사 관리자 계정만 접근할 수 있습니다" 가 뜬다.
위 렌더 점검에서는 이 게이트를 통과시켜 화면 자체는 그려봤다.

기기에서 이 화면을 테스트하려면 `franchise_admins` 에 행을 하나 넣어야 한다.
