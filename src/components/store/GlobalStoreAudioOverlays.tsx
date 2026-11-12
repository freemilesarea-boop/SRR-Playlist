/**
 * GlobalStoreAudioOverlays — AnnouncementOverlay + EmergencyBroadcastOverlay
 * 의 전역 마운트 어댑터.
 *
 * 배경:
 *   기존에는 StorePlayerPage (/business/player) 에서만 두 overlay 가 mount 됐고,
 *   /business, /enterprise/me, / 등 BGM 이 재생 중인 다른 화면에서는 예약
 *   안내음 / 긴급 방송이 발화하지 않았음.
 *   AppShell 의 <Player /> 는 전역이지만 overlay 가 페이지 한정이라
 *   "예약은 등록됐는데 실제 매장에서 음원이 안 나옴" 증상으로 보고됨.
 *
 * 정책:
 *   - 로그인된 사용자 + 매장 후보 (business plan 또는 매장 모드 활성) 에게만 mount
 *   - /admin, /artist, /auth/* 등 관리/작가 화면에서는 자동 발화 금지
 *   - storeId 가 null 이면 overlay 내부에서 자동 no-op (기존 동작 그대로)
 *   - 추가: 진입/언마운트 console.info 항상 출력 (debug flag 무관) — 운영 진단 즉시 가능
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useBusinessStore } from '@/store/businessStore';
import AnnouncementOverlay from './AnnouncementOverlay';
import EmergencyBroadcastOverlay from './EmergencyBroadcastOverlay';
import { getOutputSlot } from '@/lib/outputSlot';
import { usePlayerStore } from '@/store/playerStore';
import { fetchMyAnnouncementStatus } from '@/lib/api/announcementApi';

// 음악/안내를 내보내는 플레이어 화면 — 분리 송출 번호가 없는 창이라도 여기서는 안내를 낸다.
const PLAYER_PATH_PREFIXES = ['/brand/player/', '/brand/announcer/', '/business/player', '/business/announcer'];
function isPlayerPath(pathname: string): boolean {
  return PLAYER_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}
import { normalizeMultiOutputConfig, shouldPlayAnnouncementsHere, slotConfigOf } from '@/lib/multiOutput';

// 자동 발화 금지 라우트 — admin/artist/auth/onboarding.
// 매장 음악이 흐르는 화면 (/business, /enterprise/*, /, /library, /playlists, /search 등) 은 허용.
const BLOCKED_PATH_PREFIXES = [
  '/admin',
  '/artist',
  '/curator',
  '/sales',
  '/sales-partners',
  '/auth',
  '/login',
  '/payment',
];

function isBlockedPath(pathname: string): boolean {
  return BLOCKED_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function GlobalStoreAudioOverlays() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profile = useAuthStore((s) => s.profile);
  const businessMode = useBusinessStore((s) => s.businessMode);
  const location = useLocation();

  // 매장 후보 판정 — business 가입자(account_type/subscription_type) 또는 매장 모드 진입자.
  // 본사(enterprise) 계정은 store_id 매핑이 다른 RPC 체계라 overlay 내부에서 forbidden 응답 → no-op.
  // 관리자(role=admin) 는 별도 화면에서 BGM 들을 수 있으나, 자동 발화는 admin route guard 로 차단.
  // 0551 — 브랜드에 연결된 기기(가맹 매장 계정 · 브랜드 플레이어 세션)는 계정 종류와 무관하게 받는다.
  // 2026-11-12 ming: '개인/무료' 계정으로 브랜드 플레이어를 틀었더니 수신이 아예 꺼져 있었다.
  const onPlayerPath = isPlayerPath(location.pathname);
  const [brandLinked, setBrandLinked] = useState(false);
  // 0553 — 이 계정에 소리 허용된 안내 전용 기기가 살아 있으면 이 창(음악 플레이어)은 안내를 넘긴다.
  const [announcerOnline, setAnnouncerOnline] = useState(false);
  useEffect(() => {
    if (!userId) { setBrandLinked(false); setAnnouncerOnline(false); return; }
    let alive = true;
    let timer = 0;
    // 매장 기기는 1분마다 확인 (안내 전용 기기가 꺼지면 바로 이어받도록), 그 밖은 10분.
    const schedule = (eligible: boolean) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, eligible || onPlayerPath ? 60_000 : 10 * 60_000);
    };
    function check() {
      fetchMyAnnouncementStatus()
        .then((st) => {
          if (!alive) return;
          setBrandLinked(st.eligible);
          setAnnouncerOnline(st.announcer_online);
          schedule(st.eligible);
        })
        .catch(() => { if (alive) schedule(false); /* 실패 시 이전 값 유지 */ });
    }
    check();
    // 브랜드 플레이어 세션은 플레이어 화면 진입 후 만들어지므로 잠시 뒤 한 번 더 확인.
    const t1 = onPlayerPath ? window.setTimeout(check, 5_000) : 0;
    return () => { alive = false; window.clearTimeout(t1); window.clearTimeout(timer); };
  }, [userId, onPlayerPath]);

  const isStoreCandidate = !!userId && (
    profile?.account_type === 'business' ||
    profile?.subscription_type === 'business' ||
    profile?.membership_tier === 'business' ||
    businessMode ||
    brandLinked
  );

  const blockedByRoute = isBlockedPath(location.pathname);
  // 분리 송출 — 점주가 고른 플레이어 창에서만 1회 송출한다(창마다 겹쳐 나가지 않게).
  const outputSlot = getOutputSlot();
  const multiConfig = profile?.multi_output_config ? normalizeMultiOutputConfig(profile.multi_output_config) : null;
  // 분리 송출 번호가 없는 창이라도 음악을 틀고 있는 플레이어라면 안내를 낸다 —
  // 분리 송출을 켜 둔 계정이 브랜드 플레이어를 그냥 열었을 때 안내가 빠지지 않게(2026-11-12 ming).
  const hasTrack = usePlayerStore((st) => !!st.queue[st.index]?.id);
  const announcementHere = shouldPlayAnnouncementsHere({
    enabled: !!profile?.multi_output_enabled,
    config: multiConfig,
    slot: outputSlot,
  }) || (outputSlot === null && (onPlayerPath || hasTrack));
  // 안내방송 전용 창 — 안내가 끝나도 음악을 다시 틀지 않는다.
  const announceOnly = location.pathname.startsWith('/business/announcer') || location.pathname.startsWith('/brand/announcer/') ||
    (!!profile?.multi_output_enabled && slotConfigOf(multiConfig, outputSlot)?.mode === 'announce');
  // 안내 전용 창이 아닌데 같은 계정의 안내 전용 기기가 살아 있으면 넘긴다 (중복 송출 방지).
  const deferToAnnouncer = announcerOnline && !announceOnly;
  const shouldMount = !!userId && isStoreCandidate && !blockedByRoute && announcementHere && !deferToAnnouncer;

  // 진입 / 언마운트 로그 — 운영에서 "예약이 왜 안 도는지" 즉시 판단
  useEffect(() => {
    // console.warn — vite.config 가 production 빌드에서 console.info 를 purge 하므로 warn 사용
    console.warn('[announcement-overlay] mount-decision', {
      path: location.pathname,
      user_id: userId ? `${userId.slice(0, 8)}…` : null,
      profile_role: profile?.role ?? null,
      profile_account_type: (profile as { account_type?: string } | null)?.account_type ?? null,
      business_mode: businessMode,
      is_store_candidate: isStoreCandidate,
      blocked_by_route: blockedByRoute,
      output_slot: outputSlot,
      announcement_here: announcementHere,
      defer_to_announcer: deferToAnnouncer,
      should_mount: shouldMount,
    });
  }, [location.pathname, userId, profile?.role, profile, businessMode, isStoreCandidate, blockedByRoute, outputSlot, announcementHere, deferToAnnouncer, shouldMount]);

  if (!shouldMount) return null;

  // storeId = auth.uid() — 매장은 자기 자신 user.id 가 store_id (X6.84 규약 유지).
  // 본사/관리자 등은 위 isStoreCandidate 에서 false 처리되어 여기 도달 X.
  return (
    <>
      <AnnouncementOverlay storeId={userId} controlBgm={!announceOnly} />
      <EmergencyBroadcastOverlay storeId={userId} />
    </>
  );
}
