// AI-MUSIC-8 — Queue command contract validation. A QueueCommand is a queue-change REQUEST, never a playback
// command. This validates a single command's shape/scope/freshness prerequisites (env/kill-switch/control/
// expiry/session/store/boundary-policy). Pure & deterministic. `IMMEDIATE_UNSAFE_FORBIDDEN` boundary policy is
// always rejected — immediate (mid-playback) application is never allowed.

import { SOURCE_PRIORITY } from './thresholds';
import type { QueueCommand, QueueCommandResult, QueueCommandStatus } from './types';

export interface CommandContext {
  isProductionEnvironment: boolean;
  killSwitch: boolean;
  isControlStore: boolean;
  currentSessionId: string;
  currentStoreId: string;
  nowMs: number;
}

// The priority a command should carry, derived from its source (audited precedence). Callers should set this.
export function priorityForSource(command: QueueCommand): number {
  return SOURCE_PRIORITY[command.source] ?? 0;
}

export function validateCommand(command: QueueCommand, ctx: CommandContext): QueueCommandResult {
  const reasons: string[] = [];
  let status: QueueCommandStatus = 'ACCEPTED';

  // Immediate mid-playback application is never permitted.
  if (command.boundaryPolicy === 'IMMEDIATE_UNSAFE_FORBIDDEN') {
    return { status: 'BLOCKED', reasons: ['즉시(재생 중) Queue 교체 금지 — 안전한 다음 경계만 허용'] };
  }
  // Shape.
  if (!command.commandId || !command.storeId || !command.playerSessionId) return { status: 'INVALID', reasons: ['필수 식별자 누락'] };
  if (command.source === 'UNKNOWN') reasons.push('알 수 없는 source');

  // Scope: must match the current store/session.
  if (command.storeId !== ctx.currentStoreId) return { status: 'INVALID', reasons: ['다른 Store 대상 Command'] };
  if (command.playerSessionId !== ctx.currentSessionId) return { status: 'STALE', reasons: ['다른/이전 Session Command'] };

  // Expiry.
  if (command.expiresAt != null && command.expiresAt <= ctx.nowMs) return { status: 'EXPIRED', reasons: ['Command 만료'] };

  // Pilot preview safety: never in production; never for control stores; invalid under kill switch.
  if (command.source === 'PILOT_PREVIEW') {
    if (ctx.isProductionEnvironment) return { status: 'BLOCKED', reasons: ['Pilot Preview 는 Production 우선권 없음'] };
    if (ctx.isControlStore) return { status: 'BLOCKED', reasons: ['Control Store 에 Pilot Command 불가'] };
    if (ctx.killSwitch) return { status: 'BLOCKED', reasons: ['Kill Switch ON — Pilot Command 무효'] };
  }

  if (reasons.length > 0 && status === 'ACCEPTED') status = 'ACCEPTED'; // warnings don't block a valid command
  return { status, reasons: reasons.length ? reasons : ['유효 Command'] };
}
