/**
 * GlobalStoreHeartbeat — 매장 관제 heartbeat(store_heartbeat) 의 전역 마운트 어댑터.
 *
 * 배경:
 *   useStoreHeartbeat 는 StorePlayerPage(/business/player) 에서만 mount 됐다.
 *   실제 매장 기기는 대부분 '/' 등 다른 화면에서 전역 <Player /> 로 BGM 을 튼다.
 *   2026-11-10 뺑스톡 성수점: 매일 08~22시 정상 재생 중인데 store_policy_sync_status
 *   는 10/19 "playing" 에서 21일째 멈춰 있었다 (17개 매장 중 하루 내 갱신 1곳).
 *   관제 화면의 "지금 재생 중" 이 실제와 어긋난 원인.
 *
 * 정책 (GlobalStoreAudioOverlays 와 같은 매장 후보 판정):
 *   - 로그인 + 매장 후보 (business 가입자 또는 매장 모드) 에게만
 *   - /admin, /artist, /auth/* 등 관리/작가 화면에서는 보내지 않음
 *   - 곡이 큐에 올라와 있을 때만 보낸다. 점주가 휴대폰으로 /business 대시보드만
 *     열어도 'stopped' 를 덮어써 매장 기기의 'playing' 을 지우지 않게 하기 위함.
 *     매장 플레이어 화면(/business/player) 은 예전처럼 곡이 없어도 보낸다.
 */
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { useStoreHeartbeat } from '@/hooks/useStoreHeartbeat';
import { shouldSendStoreHeartbeat } from '@/lib/storeHeartbeatGate';

export default function GlobalStoreHeartbeat() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profile = useAuthStore((s) => s.profile);
  const businessMode = useBusinessStore((s) => s.businessMode);
  const hasTrack = usePlayerStore((s) => !!s.queue[s.index]?.id);
  const { pathname } = useLocation();

  const enabled = shouldSendStoreHeartbeat({
    userId,
    accountType: profile?.account_type ?? null,
    subscriptionType: profile?.subscription_type ?? null,
    membershipTier: profile?.membership_tier ?? null,
    businessMode,
    pathname,
    hasTrack,
  });

  // storeId = auth.uid() — 매장은 자기 user.id 가 store_id (X6.84 규약).
  useStoreHeartbeat({ storeId: userId, enabled });
  return null;
}
