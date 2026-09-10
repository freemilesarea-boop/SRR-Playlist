import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// pick-jdk.sh 는 Gradle 이 실제로 쓸 수 있는 JDK 만 고른다.
// 맥에서 Android Studio 2026 의 JDK 25 가 JAVA_HOME 에 잡혀 있으면 빌드가
// 'Unsupported class file major version 69' 로 죽는데, 그 상황을 여기서 막는다.

const SCRIPT = resolve(__dirname, 'pick-jdk.sh');
let root: string;

/** `java -version` 이 주어진 버전 문자열을 뱉는 가짜 JDK 홈을 만든다. */
function fakeJdk(name: string, versionLine: string): string {
  const home = join(root, name);
  mkdirSync(join(home, 'bin'), { recursive: true });
  const java = join(home, 'bin', 'java');
  writeFileSync(java, `#!/bin/sh\necho '${versionLine}' >&2\n`);
  chmodSync(java, 0o755);
  return home;
}

/** JAVA_HOME 을 주고 스크립트를 돌린다. 성공하면 고른 JDK 홈, 실패하면 null. */
function run(javaHome: string | null): { ok: boolean; out: string } {
  // 실제 설치본이 후보로 끼어들면 테스트가 환경을 탄다 — 후보 목록을 비워 덮어쓴다.
  const probe = `
    jdk_candidates() { :; }
    ${javaHome === null ? 'unset JAVA_HOME' : `export JAVA_HOME='${javaHome}'`}
    . '${SCRIPT}'
    echo "PICKED=$JAVA_HOME"
  `;
  try {
    const out = execFileSync('bash', ['-c', probe], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { HOME: root, PATH: '/usr/bin:/bin' },
    });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('pick-jdk.sh', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'pickjdk-'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('이미 맞는 JDK 를 잡고 있으면 그대로 쓴다', () => {
    const home = fakeJdk('jdk21', 'openjdk version "21.0.5" 2024-10-15');
    const r = run(home);
    expect(r.ok).toBe(true);
    expect(r.out).toContain(`PICKED=${home}`);
  });

  it('JDK 25(Android Studio 번들)는 거부한다', () => {
    // major 69 = Java 25. Gradle 8.11 이 클래스 파일을 못 읽는다.
    const home = fakeJdk('jdk25', 'openjdk version "25.0.1" 2025-09-16');
    const r = run(home);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('major version 69');
  });

  it('JDK 17 도 거부한다 — Capacitor 가 source 21 을 요구한다', () => {
    const home = fakeJdk('jdk17', 'openjdk version "17.0.12" 2024-07-16');
    const r = run(home);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('invalid source release: 21');
  });

  it('쓸 수 있는 JDK 가 하나도 없으면 설치 방법을 알려준다', () => {
    const r = run(null);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('temurin@21');
  });
});
