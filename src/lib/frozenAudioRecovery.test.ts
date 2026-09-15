// LEGACY-ANDROID-FROZEN-AUDIO-RECOVERY §1 · §11
//
// 2026-09-15 숙대점(Android 10 / Samsung Internet 30) 실기기 장애를 픽스처로 고정한다.
//
//   12:17:16~12:44:16 KST · 27분 · 26곡 연속
//   playing 발생 · paused=false · readyState=4 · networkState=1 · currentTime 0.02 고정
//   L1 nudge 실패 → L2 reload 실패 → L3 skip → 다음 곡도 동일 → 26회 반복
//   hard_reset(L4) 은 **한 번도 실행되지 않았다.**
//
// 왜 못 올라갔는지가 이 파일의 핵심이다: 진행 판정이 `|Δct| >= 0.01` 이었고,
// 새 소스를 물 때 생기는 0 → 0.02 지터가 그 문턱을 넘어 매번 "진행했다" 로 읽혔다.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveStallAction, isEscalation, verifyHardReset,
  FRUITLESS_SKIP_LIMIT, FROZEN_REPORT_MIN_INTERVAL_MS,
  NUDGE_AFTER_MS, RELOAD_AFTER_MS, SKIP_AFTER_MS, HARD_RESET_VERIFY_MS,
  type StallAction,
} from './stallWatchdog';
import {
  isMeaningfulProgress, advanceProgressAnchor, countsAsPlayback,
  MEANINGFUL_PROGRESS_SEC, type ProgressAnchor,
} from './mediaProgress';
import { classifyAudioFreeze, freezeNeedsRecovery, requiresTimerDetection } from './frozenAudioState';

/* ────────────────────────────────────────────────────────────────────────── */
/* §1 실기기 장애 픽스처 — 서버에 남은 값 그대로                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** 2026-09-15 12:17:22 KST 클라이언트가 직접 올린 분류 페이로드. */
const SUKDAE_FROZEN_PAYLOAD = {
  kind: 'FROZEN_AUDIO_STATE',
  paused: false,
  stalledMs: 6000,
  timerOnly: true,
  readyState: 4,
  networkState: 1,
} as const;

/** 얼어붙은 엘리먼트가 새 소스를 물 때 관측된 currentTime. 26곡 전부 이 범위였다. */
const JITTER_CT = [0.02, 0.03, 0.05] as const;

describe('§1 실기기 장애를 그대로 재현한다', () => {
  it('paused=false · readyState=4 · networkState=1 · 위치 정지 → FROZEN_AUDIO_STATE', () => {
    const kind = classifyAudioFreeze({
      playing: true, suppressed: false, autoplayBlocked: false, crossfading: false,
      paused: SUKDAE_FROZEN_PAYLOAD.paused,
      ended: false,
      readyState: SUKDAE_FROZEN_PAYLOAD.readyState,
      errorCode: null,
      stalledMs: SUKDAE_FROZEN_PAYLOAD.stalledMs,
    });
    expect(kind).toBe(SUKDAE_FROZEN_PAYLOAD.kind);
    expect(requiresTimerDetection(kind)).toBe(SUKDAE_FROZEN_PAYLOAD.timerOnly);
    expect(freezeNeedsRecovery(kind)).toBe(true);
  });

  it('L. 0 → 0.02 초기화 지터는 **진행이 아니다**', () => {
    for (const ct of JITTER_CT) {
      expect(isMeaningfulProgress(0, ct)).toBe(false);
    }
    // 예전 기준(0.01)이었다면 전부 "진행" 으로 읽혔다 — 바로 그것이 사고의 원인이다.
    for (const ct of JITTER_CT) {
      expect(Math.abs(ct - 0) >= 0.01).toBe(true);
    }
  });

  it('정상 재생은 여전히 진행으로 센다 (3초 틱에서 약 3초)', () => {
    expect(isMeaningfulProgress(10.0, 13.0)).toBe(true);
    expect(isMeaningfulProgress(10.0, 10.25)).toBe(true);   // 문턱 정확히
    expect(isMeaningfulProgress(10.0, 10.24)).toBe(false);
  });

  it('되감기는 진행이 아니다', () => {
    expect(isMeaningfulProgress(120, 5)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Player 사다리 상태기계 시뮬레이터                                            */
/*                                                                            */
/* Player.tsx 의 tick 규칙을 그대로 옮긴 것이다(아래 소스 계약 테스트가 두 쪽이  */
/* 같은 함수를 쓰는지 고정한다). 여기서 돌리는 이유는 27분·26곡을 실제 시간으로  */
/* 기다릴 수 없기 때문이다.                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

const TICK_MS = 3_000;   // Player.tsx: startBackgroundTicker(tick, 3_000)

interface SimOptions {
  /** 몇 번째 곡부터 정상 재생으로 돌아오는가. null 이면 끝까지 얼어 있다. */
  recoversAtTrack?: number | null;
  /** 진행 판정 기준. 회귀 증명을 위해 옛 기준(0.01)도 넣을 수 있다. */
  progressThreshold?: number;
  /** hard reset 이 실제로 소리를 되살리는가. */
  hardResetWorks?: boolean;
  maxTicks?: number;
}

interface SimResult {
  actions: StallAction[];
  skips: number;
  maxFruitless: number;
  hardResets: number;
  reloadPages: number;
  tracksVisited: number;
  /** 지터가 "진행했다" 로 읽혀 헛skip 카운터를 0 으로 지운 횟수. */
  fruitlessResets: number;
}

/** 얼어붙은 파이프라인을 태우는 시뮬레이션. */
function simulate(o: SimOptions = {}): SimResult {
  const threshold = o.progressThreshold ?? MEANINGFUL_PROGRESS_SEC;
  const recoversAt = o.recoversAtTrack ?? null;
  const maxTicks = o.maxTicks ?? 2_000;

  let now = 0;
  let trackIdx = 0;
  let ct = 0;
  let frozen = true;
  // Player 의 refs
  let anchorCt = 0;
  let anchorTrack = 0;
  let stallTs = 0;
  let lastAction: StallAction = 'none';
  let fruitless = 0;
  let hardResetDone = false;
  let hardResetAt: number | null = null;

  const out: SimResult = {
    actions: [], skips: 0, maxFruitless: 0, hardResets: 0, reloadPages: 0, tracksVisited: 1,
    fruitlessResets: 0,
  };

  /** 새 곡을 문다 — 얼어 있으면 초기화 지터만 찍고 멈춘다. */
  const loadTrack = () => {
    trackIdx += 1;
    out.tracksVisited += 1;
    frozen = recoversAt === null ? true : trackIdx < recoversAt;
    ct = frozen ? JITTER_CT[trackIdx % JITTER_CT.length] : 0.02;
  };

  for (let i = 0; i < maxTicks; i++) {
    now += TICK_MS;
    if (!frozen) ct += TICK_MS / 1000;   // 정상 재생이면 실시간으로 진행

    // --- Player.tsx tick 전반부 ---
    const progressed = ct - anchorCt >= threshold;
    const trackChanged = anchorTrack !== trackIdx;

    if (hardResetAt !== null) {
      const verdict = verifyHardReset({ msSinceReset: now - hardResetAt, progressed });
      if (verdict === 'success') {
        hardResetAt = null; hardResetDone = false; fruitless = 0;
      } else if (verdict === 'failure') {
        hardResetAt = null;
      }
    }

    if (progressed || trackChanged) {
      if (progressed) {
        if (fruitless > 0) out.fruitlessResets += 1;
        fruitless = 0; hardResetDone = false;
      }
      anchorCt = ct; anchorTrack = trackIdx; stallTs = now;
      lastAction = 'none';
      continue;
    }

    const action = resolveStallAction({
      businessMode: true, playing: true, paused: false, ended: false,
      crossfading: false, suppressed: false, autoplayBlocked: false, subscriptionBlocked: false,
      stalledMs: now - stallTs,
      fruitlessSkips: fruitless,
      hardResetDone,
      hardResetMsAgo: hardResetAt === null ? null : now - hardResetAt,
      online: true,
    });
    if (action === 'none' || !isEscalation(lastAction, action)) continue;
    lastAction = action;
    out.actions.push(action);

    if (action === 'nudge') {
      /* play() 재호출 — 얼어 있으면 아무 일도 없다 */
    } else if (action === 'reload') {
      /* load() + src 재할당 — 같은 엘리먼트라 얼어 있으면 그대로다 */
      if (frozen) ct = JITTER_CT[trackIdx % JITTER_CT.length];
    } else if (action === 'skip') {
      out.skips += 1;
      if (ct < 1) fruitless += 1; else fruitless = 0;
      out.maxFruitless = Math.max(out.maxFruitless, fruitless);
      loadTrack();
    } else if (action === 'hard_reset') {
      out.hardResets += 1;
      hardResetDone = true;
      hardResetAt = now;
      if (o.hardResetWorks) { frozen = false; ct = 0; }
      else ct = JITTER_CT[0];
    } else if (action === 'reload_page' || action === 'offline_hold') {
      out.reloadPages += 1;
      break;   // 문서가 다시 뜬다 — 시뮬레이션 종료
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* §11 A~K — 주입 시나리오                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§11 A~D 사다리가 순서대로 올라간다', () => {
  it('A·B·C. nudge → reload → skip 순서로 escalate 한다', () => {
    const r = simulate({ maxTicks: 30 });
    expect(r.actions.slice(0, 3)).toEqual(['nudge', 'reload', 'skip']);
  });

  it('각 칸의 발동 시각이 설계값과 같다', () => {
    expect(NUDGE_AFTER_MS).toBe(8_000);
    expect(RELOAD_AFTER_MS).toBe(20_000);
    expect(SKIP_AFTER_MS).toBe(35_000);
  });

  it('D. skip 뒤 다음 곡도 얼면 사다리를 다시 탄다', () => {
    const r = simulate({ maxTicks: 60 });
    expect(r.skips).toBeGreaterThanOrEqual(2);
    expect(r.tracksVisited).toBeGreaterThanOrEqual(3);
  });
});

describe('§11 E — 연속 frozen track 이면 fresh element 로 간다 (이번 사고의 회귀)', () => {
  it('세 번째 헛skip 에서 hard_reset 이 실행된다', () => {
    const r = simulate({ maxTicks: 400 });
    expect(r.maxFruitless).toBeGreaterThanOrEqual(FRUITLESS_SKIP_LIMIT);
    expect(r.hardResets).toBeGreaterThan(0);
  });

  it('hard_reset 까지 걸리는 skip 수가 FRUITLESS_SKIP_LIMIT 이다', () => {
    const r = simulate({ maxTicks: 400 });
    const firstHardReset = r.actions.indexOf('hard_reset');
    expect(firstHardReset).toBeGreaterThan(-1);
    const skipsBefore = r.actions.slice(0, firstHardReset).filter((a) => a === 'skip').length;
    expect(skipsBefore).toBe(FRUITLESS_SKIP_LIMIT);
  });

  it('❗옛 기준(0.01)이면 26곡을 넘겨도 hard_reset 에 영영 닿지 못한다', () => {
    // 2026-09-15 실기기에서 실제로 일어난 일. 이 테스트가 통과하지 않으면
    // 수정이 되돌아간 것이다.
    const old = simulate({ progressThreshold: 0.01, maxTicks: 2_000 });
    expect(old.skips).toBeGreaterThanOrEqual(26);
    expect(old.hardResets).toBe(0);
    expect(old.reloadPages).toBe(0);
  });

  it('❗그 이유는 지터가 헛skip 카운터를 반복해서 지웠기 때문이다', () => {
    // 카운터가 한계에 **닿는 순간**이 있어도, 다음 곡의 초기화 지터가 곧바로
    // 0 으로 되돌려 사다리가 그 값을 쓸 기회를 얻지 못한다. 실기기 로그의
    // fruitlessSkips 가 1~2 사이를 오간 것이 이 모습이다.
    const old = simulate({ progressThreshold: 0.01, maxTicks: 2_000 });
    expect(old.fruitlessResets).toBeGreaterThan(0);

    // 새 기준에서는 지터가 카운터를 지우지 못한다.
    const fixed = simulate({ maxTicks: 400 });
    expect(fixed.fruitlessResets).toBe(0);
    expect(fixed.hardResets).toBeGreaterThan(0);
  });

  it('hard_reset 이 소리를 되살리면 거기서 끝난다 (페이지 재시작까지 가지 않는다)', () => {
    const r = simulate({ hardResetWorks: true, maxTicks: 400 });
    expect(r.hardResets).toBe(1);
    expect(r.reloadPages).toBe(0);
  });

  it('hard_reset 도 실패하면 마지막 칸(페이지 재시작)으로 간다', () => {
    const r = simulate({ hardResetWorks: false, maxTicks: 2_000 });
    expect(r.hardResets).toBeGreaterThan(0);
    expect(r.reloadPages).toBeGreaterThan(0);
  });
});

describe('§11 I — 한 번 얼었다 스스로 풀리면 불필요한 hard reset 을 하지 않는다', () => {
  it('두 번째 곡에서 정상 재생이 돌아오면 hard_reset 0회', () => {
    const r = simulate({ recoversAtTrack: 1, maxTicks: 400 });
    expect(r.hardResets).toBe(0);
    expect(r.reloadPages).toBe(0);
  });
});

describe('§11 G·H — hard reset 성공 판정은 오직 실제 진행으로만', () => {
  it('G. 새 엘리먼트가 playing 이어도 위치가 안 움직이면 성공이 아니다', () => {
    expect(verifyHardReset({ msSinceReset: HARD_RESET_VERIFY_MS + 1, progressed: false }))
      .toBe('failure');
    // 검증 창 안에서는 아직 판정하지 않는다.
    expect(verifyHardReset({ msSinceReset: 1_000, progressed: false })).toBe('pending');
  });

  it('H. 실제 진행이 있으면 성공', () => {
    expect(verifyHardReset({ msSinceReset: 1_000, progressed: true })).toBe('success');
  });

  it('그 progressed 는 의미 있는 진행이어야 한다 — 지터로는 성공이 안 된다', () => {
    const jitterProgressed = isMeaningfulProgress(0, 0.02);
    expect(jitterProgressed).toBe(false);
    expect(verifyHardReset({ msSinceReset: HARD_RESET_VERIFY_MS + 1, progressed: jitterProgressed }))
      .toBe('failure');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §9 서버로 가는 진행 시각 — 곡 전환만으로 갱신되지 않는다                     */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§9 last_audio_progress_at 의미론', () => {
  let anchor: ProgressAnchor;
  beforeEach(() => { anchor = { trackId: null, ct: 0 }; });

  it('곡 전환은 기준점만 옮긴다 — 진행이 아니다', () => {
    const v = advanceProgressAnchor(anchor, 'track-A', 0.02);
    expect(v.kind).toBe('track_change');
    expect(countsAsPlayback(v)).toBe(false);
    expect(v.anchor).toEqual({ trackId: 'track-A', ct: 0.02 });
  });

  it('26곡을 건너뛰어도 한 번도 "재생했다" 가 되지 않는다 (실기기 재현)', () => {
    let a: ProgressAnchor = { trackId: null, ct: 0 };
    let counted = 0;
    for (let i = 0; i < 26; i++) {
      const trackId = `frozen-${i}`;
      for (const ct of [0, JITTER_CT[i % JITTER_CT.length]]) {
        const v = advanceProgressAnchor(a, trackId, ct);
        a = v.anchor;
        if (countsAsPlayback(v)) counted += 1;
      }
    }
    expect(counted).toBe(0);
  });

  it('실제로 재생되면 진행으로 센다', () => {
    let v = advanceProgressAnchor(anchor, 'track-A', 0.02);
    v = advanceProgressAnchor(v.anchor, 'track-A', 0.3);
    expect(v.kind).toBe('progress');
    expect(countsAsPlayback(v)).toBe(true);
  });

  it('되감기는 기준점을 내리되 진행으로 세지 않는다', () => {
    let v = advanceProgressAnchor(anchor, 'track-A', 60);
    v = advanceProgressAnchor(v.anchor, 'track-A', 5);
    expect(v.kind).toBe('rewind');
    expect(countsAsPlayback(v)).toBe(false);
    expect(v.anchor.ct).toBe(5);
  });

  it('NaN 은 진행으로 세지 않는다', () => {
    const v = advanceProgressAnchor({ trackId: 'a', ct: 1 }, 'a', Number.NaN);
    expect(v.kind).toBe('idle');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §11 J — 서버 보고가 유계다                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§11 J 얼음 보고 dedupe / rate limit', () => {
  const player = readFileSync(resolve(process.cwd(), 'src/components/player/Player.tsx'), 'utf-8');

  it('정지 구간당 1회 — 분류가 바뀔 때만 보낸다', () => {
    const at = player.indexOf("beaconPlaybackDiagnostic('audio_frozen'");
    expect(at).toBeGreaterThan(-1);
    const before = player.slice(0, at);
    expect(before).toContain('if (freezeKind !== lastFreezeKindRef.current)');
    expect(before).toContain('if (freezeNeedsRecovery(freezeKind))');
  });

  it('최소 간격 바닥이 있다 — 매 tick 서버에 쓰지 않는다', () => {
    expect(player).toContain('now - lastFrozenReportAtRef.current >= FROZEN_REPORT_MIN_INTERVAL_MS');
    expect(player).toContain('lastFrozenReportAtRef.current = now;');
  });

  it('그 간격이 heartbeat 보다 잦지 않다', () => {
    expect(FROZEN_REPORT_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('리로드를 견디는 경로로 보낸다 (얼음 뒤에 페이지 재시작이 올 수 있다)', () => {
    const diag = readFileSync(resolve(process.cwd(), 'src/lib/playbackDiagnostics.ts'), 'utf-8');
    expect(diag).toContain('keepalive: true');
  });

  it('보고에 개인정보가 없다 — 기존 관측값만 싣는다', () => {
    const at = player.indexOf("beaconPlaybackDiagnostic('audio_frozen'");
    const block = player.slice(at, at + 1400);
    for (const banned of ['email', 'userAgent', 'navigator.userAgent', 'name:', 'phone']) {
      expect(block).not.toContain(banned);
    }
    for (const required of ['playerInstanceId', 'audioGeneration', 'currentTime', 'readyState',
                            'networkState', 'stalledMs', 'timerOnly', 'fruitlessSkips']) {
      expect(block).toContain(required);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §5 · §12 소스 계약 — 두 경로가 같은 기준을 쓰는지, 회귀가 없는지            */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§5·§12 소스 계약', () => {
  const player = readFileSync(resolve(process.cwd(), 'src/components/player/Player.tsx'), 'utf-8');

  it('사다리 tick 이 의미 있는 진행을 쓴다', () => {
    expect(player).toContain('const progressed = isMeaningfulProgress(prog.ct, ct);');
    // 옛 기준이 남아 있으면 안 된다.
    expect(player).not.toContain('const progressed = Math.abs(ct - prog.ct) >= 0.01;');
  });

  it('재접속 경로도 같은 함수를 쓴다 (기준이 두 벌로 갈라지지 않는다)', () => {
    expect(player).toContain('isMeaningfulProgress(stallProgressRef.current.ct, ct)');
    expect(player).not.toContain('ct > stallProgressRef.current.ct + 0.25');
  });

  it('서버 보고 진행 시각이 곡 전환으로 갱신되지 않는다', () => {
    const at = player.indexOf('noteAudioProgress(Date.now()');
    expect(at).toBeGreaterThan(-1);
    const before = player.slice(Math.max(0, at - 400), at);
    expect(before).toContain('countsAsPlayback(pv)');
  });

  it('F. fresh element 교체는 React key 로 실제 DOM 을 바꾼다', () => {
    expect(player).toContain('key={`audio-A-${audioGeneration}`}');
    expect(player).toContain('key={`audio-B-${audioGeneration}`}');
    expect(player).toContain('setAudioGeneration((g) => g + 1);');
  });

  it('F. 옛 세대 콜백이 새 엘리먼트를 오염시키지 않는다', () => {
    expect(player).toContain('audioGenerationRef');
    expect(player).toContain("if (m === 'mismatch') return;");
  });

  it('§12 기존 안정화가 그대로 남아 있다', () => {
    for (const keep of [
      'disposeAudioElement',            // 비활성 슬롯 teardown
      'offline_hold',                   // 오프라인 보류
      'classifyAudioFreeze',            // FROZEN_AUDIO_STATE 분류기
      'HARD_RECOVERY_PROGRESS_CONFIRMED',
    ]) {
      expect(player).toContain(keep);
    }
  });
});
