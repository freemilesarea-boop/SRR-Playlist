# 08 — Store Switching (design)

An enterprise/HQ user may manage multiple stores. Provide a menu on the brand player:

```
현재 매장: {store_label}
  - 플레이어 계속 사용        (no-op / close menu)
  - 다른 매장 코드 입력        → clear current binding ref → /brand
  - 이 기기 연결 해제          → revoke_brand_device_by_token → clear ref → /brand
  - 브랜드 로그아웃            → signOut + clear all binding refs → /login
```

## Switching to another store
1. Stop current playback and clear the current store's queue explicitly (`playerStore.setQueue([], …)` / stop) — prevent cross-store state bleed.
2. Go to `/brand`; enter the new store code → `verify_store_code` (creates/updates the row for the new brand).
3. Load the new brand config; the player queues the new store's playlist.

## Isolation guarantee
Brand A's queue/media/binding must not leak into Brand B. Because the player is keyed by `brandId` and `setQueue` replaces the queue wholesale, switching brands re-initializes queue + visual stage. The binding refs are per-brand (`srr.brand.binding.<brandId>`), so they don't cross-contaminate.

## Playback safety during switch
No new audio element is created; the single global `<Player>` simply receives a new queue. Scheduler/crossfade/heartbeat continue to operate on the active queue only.
