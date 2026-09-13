// 0518 — 원격 제어 명령 판정.
//
// heartbeat 응답에 실려 오는 명령을 "실행할지 / 무엇을 할지"만 결정한다.
// 실제 부수효과(reload, play, next)는 훅이 수행한다 — 판정을 순수 함수로 떼어내야
// 무인 매장에서 오작동하지 않는지 테스트로 못 박을 수 있다.
import type { BrandPlayerCommand, BrandPlayerHeartbeatResult } from '@/lib/api/brandPlayerApi';

export type BrandPlayerCommandAction =
  | { kind: 'none' }
  | { kind: 'run'; command: BrandPlayerCommand; commandId: string };

const KNOWN: readonly string[] = ['reload', 'play', 'next'];

/**
 * 명령을 실행할지 판정한다.
 *
 * 실행하지 않는 경우:
 *  - heartbeat 자체가 실패했다 (세션이 죽었을 수 있다 — 아무것도 건드리지 않는다)
 *  - 명령이 없다 (대부분의 heartbeat)
 *  - command_id 가 없다 (중복 방지를 못 하므로 실행하지 않는다)
 *  - 서버가 모르는 명령을 줬다 (구/신 버전 불일치 — 조용히 무시)
 *  - 이미 실행한 command_id 다 (StrictMode 중복 호출·응답 재사용 방어)
 */
export function decideCommandAction(
  res: BrandPlayerHeartbeatResult | null | undefined,
  alreadyDone: ReadonlySet<string>,
): BrandPlayerCommandAction {
  if (!res || res.success !== true) return { kind: 'none' };

  const command = res.command;
  const commandId = res.command_id;
  if (!command || !commandId) return { kind: 'none' };
  if (!KNOWN.includes(command)) return { kind: 'none' };
  if (alreadyDone.has(commandId)) return { kind: 'none' };

  return { kind: 'run', command, commandId };
}
