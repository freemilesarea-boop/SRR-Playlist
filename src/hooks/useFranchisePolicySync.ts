/**
 * useFranchisePolicySync — X6.89 / B2B Franchise MVP.
 *
 * 매장 플레이어 진입 시 본사 정책을 조회해 자동 적용.
 * 60s 폴링 + 60s heartbeat. 정책 변경 시 다음 곡부터 새 playlist 적용 (현재 곡 강제 중단 X).
 *
 * 회귀 0 보장:
 *   - has_franchise_policy=false 면 아무 행위 안 함 (기존 로직 그대로)
 *   - heartbeat 실패는 silent (재생 중단 X)
 *   - 정책 조회 실패는 silent (기존 큐 유지)
 */
import { useEffect, useRef, useState } from 'react';
import {
  getStoreActiveMusicPolicy,
  type StoreActiveMusicPolicy,
} from '@/lib/api/franchiseApi';
import { fetchPlaylistTracks } from '@/lib/api';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { resolveStoreRuntimeQueue } from '@/lib/aiRuntimeQueueService';
import { usePlayerStore } from '@/store/playerStore';
import type { PlaylistRow } from '@/types/db';

const POLL_INTERVAL_MS = 60_000;
// X6.90 / Phase 1-3 — heartbeat 는 useStoreHeartbeat 에서 처리 (중복 제거).
// 이 hook 은 정책 폴링/스왑 전담.

interface UseFranchisePolicySyncOptions {
  storeId: string | null;
  /** false 면 hook 동작 비활성 (개인 사용자/관리자 페이지 등) */
  enabled: boolean;
}

interface SyncState {
  policy: StoreActiveMusicPolicy | null;
  loading: boolean;
  error: string | null;
  /** 마지막으로 적용한 (policy_id, version_number, slot_id) — 변경 감지용 */
  lastAppliedKey: string | null;
}

function makeKey(p: StoreActiveMusicPolicy | null): string | null {
  if (!p?.has_franchise_policy || !p.policy_id) return null;
  return `${p.policy_id}::v${p.version_number ?? 0}::${p.matched_slot?.id ?? 'none'}`;
}

export function useFranchisePolicySync({ storeId, enabled }: UseFranchisePolicySyncOptions): SyncState {
  const [state, setState] = useState<SyncState>({
    policy: null, loading: false, error: null, lastAppliedKey: null,
  });
  const lastAppliedKeyRef = useRef<string | null>(null);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);
  const queueLength = usePlayerStore((s) => s.queue.length);

  // 정책 조회 + 변경 시 큐 적용
  useEffect(() => {
    if (!enabled || !storeId) return;
    let cancelled = false;
    let timerId: number | null = null;

    const syncOnce = async () => {
      try {
        setState((s) => ({ ...s, loading: true, error: null }));
        const p = await getStoreActiveMusicPolicy(storeId);
        if (cancelled) return;

        const key = makeKey(p);

        // 변경 감지: 새 정책/슬롯이고 마지막 적용 key 와 다르면 swap
        if (
          p.has_franchise_policy
          && p.matched_slot?.playlist_id
          && key !== lastAppliedKeyRef.current
        ) {
          // 정책 변경: 다음 곡부터 적용 — 현재 곡이 끝날 때까지 기다림
          // MVP: 큐가 비어있거나 첫 진입이면 즉시 적용, 아니면 대기
          const isInitial = lastAppliedKeyRef.current === null || queueLength === 0;
          if (isInitial) {
            await applyPolicyPlaylist(p, setQueue, storeId);
            lastAppliedKeyRef.current = key;
          } else {
            // 다음 곡 변경 시점에 적용되도록 마킹 (아래 별도 effect 에서 처리)
            console.info('[franchise] policy change pending — applying after current track', {
              from: lastAppliedKeyRef.current, to: key,
            });
            // 즉시 lastAppliedKeyRef 를 갱신하지 않음. 아래 currentTrackId 변경 effect 가 swap.
          }
        }

        setState({ policy: p, loading: false, error: null, lastAppliedKey: lastAppliedKeyRef.current });
      } catch (e) {
        // 정책 조회 실패는 silent — 기존 큐 유지
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
        }
      }
    };

    void syncOnce();
    timerId = window.setInterval(() => { void syncOnce(); }, POLL_INTERVAL_MS);

    return () => { cancelled = true; if (timerId !== null) window.clearInterval(timerId); };
  }, [enabled, storeId, setQueue, queueLength]);

  // 트랙 변경 시 정책 swap 체크 (정책 변경이 대기 중이면 다음 곡 시작 시점에 적용)
  const pendingPolicyRef = useRef<StoreActiveMusicPolicy | null>(null);
  useEffect(() => {
    if (!enabled || !storeId) return;
    if (!state.policy?.has_franchise_policy) return;
    const currentKey = makeKey(state.policy);
    if (currentKey && currentKey !== lastAppliedKeyRef.current) {
      pendingPolicyRef.current = state.policy;
    }
    // 트랙이 바뀌었고 pending policy 가 있으면 swap (다음 곡 시점)
    if (pendingPolicyRef.current && currentTrackId) {
      const pending = pendingPolicyRef.current;
      console.info('[franchise] swapping playlist for new policy at next track boundary');
      void applyPolicyPlaylist(pending, setQueue, storeId).then(() => {
        lastAppliedKeyRef.current = makeKey(pending);
        pendingPolicyRef.current = null;
      });
    }
  }, [enabled, storeId, currentTrackId, state.policy, setQueue]);

  // X6.90 / Phase 1-3 — heartbeat 는 useStoreHeartbeat 에서 통합 처리.
  // 이 hook 의 heartbeat 책임 제거 (중복 호출 차단).

  return state;
}

// 정책의 playlist 를 큐로 적용 — 기존 daily seed shuffle / shuffle / repeat 유지
// 0404 (HOTFIX-A): storeId 전달 → store guardrail hard_block 자동 제외
async function applyPolicyPlaylist(
  p: StoreActiveMusicPolicy,
  setQueue: ReturnType<typeof usePlayerStore.getState>['setQueue'],
  storeId: string,
): Promise<void> {
  if (!p.matched_slot?.playlist_id || !p.playlist) return;
  try {
    const tracks = await fetchPlaylistTracks(p.matched_slot.playlist_id, storeId);
    const playable = filterPlayableTracks(tracks).playable;
    if (playable.length === 0) {
      console.warn('[franchise] policy playlist has no playable tracks', { playlistId: p.matched_slot.playlist_id });
      return;
    }
    const playlistRow: PlaylistRow = {
      id: p.playlist.id,
      title: p.playlist.title,
      category: p.playlist.category,
      business_category: p.playlist.business_category,
      thumbnail_url: p.playlist.thumbnail_url,
      description: null,
      is_business_only: true,
      time_slot: null,
      sort_order: 0,
      created_at: new Date().toISOString(),
    };
    // AI-RUNTIME-CONNECTION-1: static queue obtained FIRST; resolver returns it
    // unchanged when AI runtime mode is OFF (default), AI re-rank only for approved
    // PREVIEW stores, immediate static fallback on any failure. Never throws.
    const resolved = await resolveStoreRuntimeQueue({
      storeId,
      playlistId: p.matched_slot.playlist_id,
      staticTracks: playable,
    });
    setQueue(resolved.tracks, 0, playlistRow, null, { dailySeedShuffle: resolved.seedShuffle });
    console.info('[franchise] policy playlist applied', {
      policy: p.policy_name, slot: p.matched_slot.slot_name,
      tracks: resolved.tracks.length, source: resolved.source,
    });
  } catch (e) {
    console.warn('[franchise] failed to apply policy playlist', e);
  }
}
