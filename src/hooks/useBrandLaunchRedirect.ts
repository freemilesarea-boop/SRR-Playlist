// 설치형 앱 실행 시 브랜드 플레이어 자동 진입.
// 배경: 설치형 앱은 start_url('/') 로 떠서 일반 매장 재생으로 시작한다. 브랜드 매장 PC 에서
// 브랜드 플레이어를 브라우저 탭에 따로 띄워두면 앱이 뜨는 순간 일반 재생이 앞을 차지해
// 브랜드 재생이 끊긴다(숙대점). 이 기기에 brand binding 이 저장돼 있으면 앱 실행 직후
// '/' 에서 브랜드 플레이어로 보낸다. 플레이어가 서버 재검증하고, 실패하면 /brand 로 돌려보낸다.
//
// 범위: 설치형(standalone) 앱의 최초 진입이 '/' 일 때 한 번만. 브라우저 탭·딥링크·
// 앱 안에서 홈으로 돌아오는 경우(예: 플레이어 '나가기')는 건드리지 않는다.
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSavedBrandPlayerPath } from '@/lib/brandSession';
import { isPwaStandalone } from '@/lib/inAppBrowser';

const LAUNCH_PATH = typeof window !== 'undefined' ? window.location.pathname : null;

export function useBrandLaunchRedirect(ready: boolean): void {
  const navigate = useNavigate();
  const doneRef = useRef(false);

  useEffect(() => {
    if (!ready || doneRef.current) return;
    doneRef.current = true;
    if (LAUNCH_PATH !== '/' || window.location.pathname !== '/') return;
    if (!isPwaStandalone()) return;
    const target = getSavedBrandPlayerPath();
    if (target) navigate(target, { replace: true });
  }, [ready, navigate]);
}
