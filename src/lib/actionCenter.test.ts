// Phase ADMIN-ACTION-CENTER-1 — Operations Action Center 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  roleRank, getAction, canExecute, hasPermission, isSupported, deriveQueue,
  ACTION_CATALOG, ROLE_ORDER, STATUS_LABEL, STATUS_TONE, SEVERITY_TONE,
} from './actionCenter';

describe('Role 모델', () => {
  it('오름차순 rank', () => {
    expect(roleRank('viewer')).toBe(0);
    expect(roleRank('super_admin')).toBe(4);
    expect(roleRank('admin')).toBeGreaterThan(roleRank('operator'));
  });
  it('5개 role', () => { expect(ROLE_ORDER.length).toBe(5); });
});

describe('Action 카탈로그', () => {
  it('필수 액션 존재', () => {
    for (const id of ['store_resync', 'user_disable', 'user_withdraw', 'qc_bulk_approve', 'qc_bulk_reject']) {
      expect(getAction(id)).toBeTruthy();
    }
  });
  it('위험 작업은 승인 필수', () => {
    for (const a of ACTION_CATALOG.filter((x) => x.danger)) {
      expect(a.requiresApproval).toBe(true);
    }
  });
  it('unsupported 액션은 실행 불가', () => {
    expect(isSupported(getAction('queue_rebuild')!)).toBe(false);
    expect(isSupported(getAction('player_reset')!)).toBe(false);
    expect(isSupported(getAction('store_resync')!)).toBe(true);
  });
});

describe('권한 (canExecute / hasPermission)', () => {
  it('권한 부족 → 실행 불가', () => {
    const disable = getAction('user_disable')!; // minRole admin
    expect(canExecute(disable, 'operator')).toBe(false);
    expect(canExecute(disable, 'manager')).toBe(false);
    expect(canExecute(disable, 'admin')).toBe(true);
    expect(canExecute(disable, 'super_admin')).toBe(true);
  });
  it('super_admin 전용 (withdraw)', () => {
    const w = getAction('user_withdraw')!;
    expect(canExecute(w, 'admin')).toBe(false);
    expect(canExecute(w, 'super_admin')).toBe(true);
  });
  it('권한 충족해도 RPC 없으면 canExecute=false', () => {
    const s = getAction('settlement_generate')!; // link, admin
    expect(hasPermission(s, 'admin')).toBe(true);
    expect(canExecute(s, 'admin')).toBe(false); // reuse.kind !== 'rpc'
  });
  it('operator 는 store_resync 가능', () => {
    expect(canExecute(getAction('store_resync')!, 'operator')).toBe(true);
    expect(canExecute(getAction('store_resync')!, 'viewer')).toBe(false);
  });
});

describe('deriveQueue — 실제 KPI 만, severity 정렬', () => {
  it('Incident/오프라인/QC/정산 → 큐', () => {
    const q = deriveQueue({ todayIncidents: 2, offlinePlayers: 5, qcPending: 10, settlementPending: 3, offlineStores: 0 });
    expect(q[0].severity).toBe('critical'); // incident 우선
    expect(q.map((i) => i.actionId)).toContain('qc_retry');
    expect(q.map((i) => i.actionId)).toContain('settlement_generate');
  });
  it('0/누락 지표는 큐에 없음 (추정 금지)', () => {
    expect(deriveQueue({ offlinePlayers: 0, qcPending: 0 })).toEqual([]);
    expect(deriveQueue({})).toEqual([]);
  });
  it('severity 순 정렬 (critical→warning→info)', () => {
    const q = deriveQueue({ settlementPending: 1, offlinePlayers: 1, todayIncidents: 1 });
    expect(q.map((i) => i.severity)).toEqual(['critical', 'warning', 'info']);
  });
});

describe('상태/severity 표시', () => {
  it('status 라벨/톤', () => {
    expect(STATUS_LABEL.running).toBe('실행중');
    expect(STATUS_LABEL.failed).toBe('실패');
    expect(STATUS_TONE.success).toBe('success');
    expect(STATUS_TONE.failed).toBe('danger');
  });
  it('severity 톤', () => {
    expect(SEVERITY_TONE.critical).toBe('danger');
    expect(SEVERITY_TONE.info).toBe('info');
  });
});
