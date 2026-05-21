import { useGateStore } from '@/store/gateStore';
import SubscriptionGate from '@/components/player/SubscriptionGate';

/**
 * 전역 로그인/구독 게이트 모달 호스트.
 * Player 가 null 을 렌더하는 상황(큐 없음 등)에서도 게이트가 떠야 하므로
 * App 최상단에 항상 마운트. gateStore 상태를 구독해 SubscriptionGate 렌더.
 */
export default function GlobalGate() {
  const mode = useGateStore((s) => s.mode);
  const close = useGateStore((s) => s.close);
  if (!mode) return null;
  return <SubscriptionGate mode={mode} onClose={close} />;
}
