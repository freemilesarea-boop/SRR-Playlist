import { describe, it, expect } from 'vitest';
import {
  resolveMonitoredInstall, describeMonitoredInstall,
  ESTABLISHED_INSTALL_MIN_AGE_HOURS,
} from './monitoredInstall';

/** 2026-09-15 15:5x KST 실측. */
const SUKDAE = [
  { sessionId: '823034d7', ageHours: 151.5, deviceKind: 'mobile' },   // 매장 태블릿
  { sessionId: 'b2e9e765', ageHours: 1.4, deviceKind: 'desktop' },    // 오늘 열린 운영자 탭
];
const HWAJEONG = [
  { sessionId: '1177a528', ageHours: 311.7, deviceKind: 'desktop' },  // 매장 재생기가 데스크톱이다
];

describe('§4 mobile / desktop 을 감시 신원으로 쓰지 않는다', () => {
  it('숙대 — 자리 잡은 install(태블릿)을 고른다', () => {
    expect(resolveMonitoredInstall(SUKDAE)).toEqual({
      kind: 'resolved', sessionId: '823034d7', via: 'established_install',
    });
  });

  it('화정 — 매장 재생기가 desktop 이어도 고른다 ★ mobile 규칙이었으면 여기서 틀렸다', () => {
    expect(resolveMonitoredInstall(HWAJEONG)).toEqual({
      kind: 'resolved', sessionId: '1177a528', via: 'established_install',
    });
  });

  it('deviceKind 를 뒤집어도 결과가 같다 (판정에 쓰지 않는다는 증명)', () => {
    const flipped = SUKDAE.map((s) => ({
      ...s, deviceKind: s.deviceKind === 'mobile' ? 'desktop' : 'mobile',
    }));
    expect(resolveMonitoredInstall(flipped)).toEqual(resolveMonitoredInstall(SUKDAE));
  });

  it('소스에 기기 종류 분기가 없다', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/lib/monitoredInstall.ts'), 'utf-8');
    const exec = src.split('\n').filter((l: string) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*')).join('\n');
    expect(exec).not.toMatch(/deviceKind\s*===|=== 'mobile'|=== 'desktop'/);
  });
});

describe('§5 열린 incident 가 최우선', () => {
  it('incident 가 지목한 세션을 그대로 쓴다', () => {
    expect(resolveMonitoredInstall(SUKDAE, '823034d7')).toEqual({
      kind: 'resolved', sessionId: '823034d7', via: 'open_incident',
    });
  });

  it('★ 싱싱한 다른 기기가 있어도 흔들리지 않는다 (2026-09-15 회귀)', () => {
    // b2e9e765 가 아무리 싱싱해도 incident 대상은 태블릿이다.
    const r = resolveMonitoredInstall(SUKDAE, '823034d7');
    expect(r.kind === 'resolved' && r.sessionId).toBe('823034d7');
  });

  it('incident 세션이 24시간 창 밖으로 빠져도 대상은 그대로다', () => {
    expect(resolveMonitoredInstall([SUKDAE[1]], '823034d7')).toEqual({
      kind: 'resolved', sessionId: '823034d7', via: 'open_incident',
    });
  });
});

describe('§10 FAIL CLOSED — 모르면 고르지 않는다', () => {
  it('자리 잡은 기기가 둘 이상이면 식별 불가', () => {
    const r = resolveMonitoredInstall([
      { sessionId: 'a', ageHours: 100 }, { sessionId: 'b', ageHours: 200 },
    ]);
    expect(r).toEqual({ kind: 'unknown', reason: 'multiple_established_installs' });
    expect(describeMonitoredInstall(r)).toContain('식별 불가');
  });

  it('전부 새 세션이면 식별 불가 — 임의로 최신을 고르지 않는다', () => {
    const r = resolveMonitoredInstall([
      { sessionId: 'a', ageHours: 0.1 }, { sessionId: 'b', ageHours: 2 },
    ]);
    expect(r).toEqual({ kind: 'unknown', reason: 'no_established_install' });
  });

  it('세션이 없으면 식별 불가', () => {
    expect(resolveMonitoredInstall([])).toEqual({ kind: 'unknown', reason: 'no_sessions' });
  });

  it('식별 불가 문구는 전부 "식별 불가" 로 시작하는 사실 진술이다', () => {
    (['no_sessions', 'no_established_install', 'multiple_established_installs'] as const)
      .forEach((reason) => {
        expect(describeMonitoredInstall({ kind: 'unknown', reason })).toContain('대상 매장 재생기 식별 불가');
      });
  });
});

describe('§4 재등록 경로', () => {
  it('토큰/저장소를 지워 새 session 이 생기면, 옛 세션이 24시간 창에서 빠진 뒤 자동 지정된다', () => {
    // 직후: 둘 다 자리 잡음 → 모른다(운영자에게 묻는다)
    expect(resolveMonitoredInstall([
      { sessionId: 'old', ageHours: 200 }, { sessionId: 'new', ageHours: 30 },
    ]).kind).toBe('unknown');
    // 옛 세션이 24시간 이상 조용해 목록에서 빠지면 새 install 이 유일해진다
    expect(resolveMonitoredInstall([{ sessionId: 'new', ageHours: 30 }])).toEqual({
      kind: 'resolved', sessionId: 'new', via: 'established_install',
    });
  });

  it('경계는 이 시스템이 이미 쓰는 24시간 창이다', () => {
    expect(ESTABLISHED_INSTALL_MIN_AGE_HOURS).toBe(24);
  });
});
