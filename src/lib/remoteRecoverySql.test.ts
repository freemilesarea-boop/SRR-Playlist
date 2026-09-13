// 0520 마이그레이션의 보안·호환 계약을 소스 수준에서 고정한다.
//
// 여기 있는 항목들은 프로덕션 DB 에서 실제로 실행해 확인했지만, 그 확인은 세션이
// 끝나면 사라진다. 다음 사람이 무심코 되돌리는 것을 막으려면 테스트로 남아야 한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = (name: string) =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf-8');

const sql0520 = M('0520_realtime_recovery_delivery.sql');
const sql0519 = M('0519_remote_recovery_control.sql');
const sql0521 = M('0521_app_restart_command.sql');

describe('15. Recovery Console 은 관리자만', () => {
  it('admin_brand_player_health 는 role=admin 을 확인하고 아니면 예외', () => {
    expect(sql0520).toMatch(/from public\.users u where u\.id = auth\.uid\(\) and u\.role = 'admin'/);
    expect(sql0520).toContain("raise exception 'unauthorized'");
  });

  it('health / ack 함수에 public·anon EXECUTE 를 주지 않는다', () => {
    expect(sql0520).toContain(
      'revoke all on function public.admin_brand_player_health(integer) from public, anon;');
    expect(sql0520).toContain(
      'revoke all on function public.ack_store_recovery(uuid, text, text, text, text) from public, anon;');
  });

  it('명령 생성(request_store_recovery)은 여전히 admin 전용이고 store 지목이 필수다', () => {
    expect(sql0519).toMatch(/admin only/);
    expect(sql0519).toContain('p_store_user_id');
  });
});

describe('매장 클라이언트 권한 — 읽기만, 자기 것만', () => {
  it('authenticated 에 SELECT 만 준다 (TRUNCATE 포함 나머지는 회수)', () => {
    // TRUNCATE 는 RLS 를 타지 않는다 — 남겨두면 로그인한 아무나 명령 큐를 비울 수 있다.
    expect(sql0520).toContain('revoke all on public.brand_player_commands from authenticated;');
    expect(sql0520).toContain('grant select on public.brand_player_commands to authenticated;');
    const revokeAt = sql0520.indexOf('revoke all on public.brand_player_commands from authenticated;');
    const grantAt = sql0520.indexOf('grant select on public.brand_player_commands to authenticated;');
    expect(revokeAt).toBeLessThan(grantAt);   // 회수가 먼저, 그 다음 SELECT 부여
  });

  it('anon 은 이 테이블에 아무 권한도 없다', () => {
    expect(sql0520).toContain('revoke all on public.brand_player_commands from anon;');
  });

  it('행 범위는 RLS 가 정한다 — 자기 매장만 (0519)', () => {
    expect(sql0519).toContain('using (store_user_id = auth.uid())');
  });
});

describe('17. heartbeat fallback 회귀 없음', () => {
  it('heartbeat 는 그대로 명령을 배달한다', () => {
    expect(sql0520).toContain("'command', v_cmd");
    expect(sql0520).toContain("'command_id', v_cmd_id");
  });

  it('반환 키는 추가만 됐다 — 구버전 클라이언트가 읽던 키가 그대로 있다', () => {
    expect(sql0520).toContain("'success', true");
    expect(sql0520).toContain("'session_id', v_sid");
  });

  it('Realtime 이 먼저 집어간 명령은 heartbeat 가 다시 배달하지 않는다 (무한 리로드 방지)', () => {
    expect(sql0520).toMatch(/and status = 'pending'/);
  });

  it('배달 경로를 각인한다 — Realtime 이 실제로 도는지 사후 판별용', () => {
    expect(sql0520).toContain("delivery_source = coalesce(c.delivery_source, 'heartbeat')");
    expect(sql0520).toContain("delivery_source = coalesce(delivery_source, 'realtime')");
  });

  it('delivery_source 는 두 값만 허용한다', () => {
    expect(sql0520).toMatch(/delivery_source in \('realtime', 'heartbeat'\)/);
  });
});

describe('명령 화이트리스트', () => {
  it('0519 가 app_restart / device_reboot 자리를 만들어 뒀다', () => {
    expect(sql0519).toMatch(/app_restart/);
    expect(sql0519).toMatch(/device_reboot/);
  });

  it('0521 은 app_restart 발행만 열고 device_reboot 는 계속 거부한다', () => {
    expect(sql0521).toContain(
      "if p_command not in ('reload', 'play', 'next', 'hard_recovery', 'app_restart') then");
    // 허용 목록에 device_reboot 가 들어가면 안 된다.
    expect(sql0521).not.toMatch(/not in \([^)]*device_reboot/);
  });

  it('app_restart 쿨다운은 네이티브 워치독과 같은 5분이다', () => {
    expect(sql0521).toContain("when 'app_restart'   then interval '5 minutes'");
  });

  it('0521 도 admin 전용 · broadcast 금지를 유지한다', () => {
    expect(sql0521).toContain('forbidden: admin only');
    expect(sql0521).toContain('store_user_id required — broadcast is not allowed');
    expect(sql0521).toContain(
      'revoke all on function public.request_store_recovery(uuid, text, uuid, text, text) from public, anon;');
  });
});

describe('네이티브 쉘 계약 (Android)', () => {
  const A = (name: string) =>
    readFileSync(resolve(process.cwd(), 'android/app/src/main', name), 'utf-8');
  const manifest = A('AndroidManifest.xml');
  const service = A('java/com/deudda/app/StorePlaybackService.java');
  const boot = A('java/com/deudda/app/BootReceiver.java');
  const plugin = A('java/com/deudda/app/StorePlaybackServicePlugin.java');

  it('포그라운드 서비스 타입과 권한이 그대로다', () => {
    expect(manifest).toContain('android:foregroundServiceType="mediaPlayback"');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    expect(service).toContain('FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK');
    expect(service).toContain('return START_STICKY;');
  });

  it('부팅 복귀 리시버가 등록돼 있다', () => {
    expect(manifest).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
    expect(manifest).toContain('android:name=".BootReceiver"');
    expect(manifest).toContain('android.intent.action.BOOT_COMPLETED');
    // 부팅 시 Activity 를 직접 띄우려 하지 않는다(Android 10+ 에서 차단된다).
    expect(boot).not.toContain('startActivity');
  });

  it('워치독 재실행에 5분 쿨다운이 있다 — 무한 launch 루프 금지', () => {
    expect(service).toContain('RELAUNCH_COOLDOWN_MS = 5 * 60 * 1000L');
  });

  it('워치독은 foreground 여부로 판단하지 않는다 — 다른 앱 사용은 정상 상태다', () => {
    // shouldRelaunch 안에서 activityForeground 를 보면 안 된다.
    const fn = service.slice(service.indexOf('private boolean shouldRelaunch()'));
    const body = fn.slice(0, fn.indexOf('\n    }') + 6);
    expect(body).not.toContain('activityForeground');
    // 판단 근거는 소리 + JS 하트비트 + Activity 존재 여부뿐이다.
    expect(body).toContain('audibleSilentForMs');
    expect(body).toContain('webHeartbeatSilentForMs');
    expect(body).toContain('activityAlive');
  });

  it('소리가 나고 있으면 어떤 경우에도 되살리지 않는다', () => {
    const fn = service.slice(service.indexOf('private boolean shouldRelaunch()'));
    const body = fn.slice(0, fn.indexOf('\n    }') + 6);
    // 첫 관문이 "소리가 충분히 오래 끊겼는가" 이고, 아니면 즉시 false 다.
    expect(body).toMatch(/audibleSilent < 0 \|\| audibleSilent < AUDIBLE_DEAD_MS[\s\S]*?return false;/);
  });

  it('JS 하트비트가 살아 있으면 네이티브가 끼어들지 않는다 — 웹 사다리의 몫이다', () => {
    expect(service).toContain('WEB_HEARTBEAT_DEAD_MS = 5 * 60 * 1000L');
    expect(service).toContain('public static void noteWebHeartbeat(boolean audible)');
  });

  it('오디오 포커스를 잃어도 재생을 멈추지 않는다', () => {
    expect(service).toContain('AUDIOFOCUS_LOSS_TRANSIENT');
    expect(service).toContain('setWillPauseWhenDucked(false)');
    // 네이티브가 WebView 오디오를 직접 멈추는 코드가 없어야 한다.
    expect(service).not.toMatch(/webView[^\n]*pause/i);
  });

  it('기기 재부팅을 시도하는 코드가 없다', () => {
    for (const src of [service, boot, plugin]) {
      expect(src).not.toContain('ACTION_REBOOT');
      expect(src).not.toContain('PowerManager.reboot');
      expect(src).not.toMatch(/\.reboot\(/);
    }
  });

  it('배터리 최적화는 조회·안내만 한다 — 자동 예외 요청 없음', () => {
    expect(plugin).toContain('isIgnoringBatteryOptimizations');
    expect(plugin).toContain('ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    // 주석에서 "왜 안 쓰는지" 를 설명하는 것은 괜찮다 — 실제 호출만 없으면 된다.
    expect(plugin).not.toContain('Settings.ACTION_REQUEST_IGNORE');
    // 쓰지 않는 민감 권한을 선언하지도 않는다.
    expect(manifest).not.toContain('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
  });

  it('네이티브 상태 신호에 개인정보·기기 식별자가 없다', () => {
    for (const forbidden of ['getSerial', 'ANDROID_ID', 'advertisingId', 'IMEI', 'getDeviceId']) {
      expect(plugin).not.toContain(forbidden);
    }
  });
});
