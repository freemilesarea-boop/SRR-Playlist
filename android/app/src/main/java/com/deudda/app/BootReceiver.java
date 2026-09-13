package com.deudda.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * 재부팅 후 매장 플레이어 복귀.
 *
 * 매장 태블릿은 정전·OS 업데이트로 재부팅된다. 그때마다 사람이 앱을 다시 열어야 하면
 * 무인 운영이 아니다. 이 리시버가 그 간격을 줄인다.
 *
 * ── 할 수 있는 것 / 없는 것 ────────────────────────────────────────────────
 * 안드로이드 10(API 29)부터 백그라운드에서 Activity 를 띄우는 것은 원칙적으로 금지다.
 * 부팅 브로드캐스트에서 곧바로 플레이어 화면을 띄우는 것은 **대부분의 기기에서
 * 차단된다.** 그걸 되는 척하지 않는다.
 *
 * 대신 할 수 있는 것을 한다:
 *   • 포그라운드 서비스를 띄운다. BOOT_COMPLETED 는 Android 12+ 의 FGS 시작 제한에서
 *     면제되는 몇 안 되는 경로다.
 *   • 그 서비스의 상시 알림이 "탭하면 음악을 켠다" 는 한 번의 동작으로 이어진다.
 *     사람이 앱 서랍에서 앱을 찾아 여는 것보다 훨씬 짧다.
 *   • 서비스가 살아 있으면 StorePlaybackService 의 워치독이 Activity 부활을
 *     한 번 시도한다(OS 가 허용하는 기기에서만 성공한다 — 실패해도 알림은 남는다).
 *
 * 즉 이 경로의 보장 수준은 "사람 손 0회" 가 아니라 **"사람 손 1탭"** 이다.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "DeuddaBoot";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (action == null) {
            return;
        }

        boolean isBoot = Intent.ACTION_BOOT_COMPLETED.equals(action)
            || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action)
            || "android.intent.action.QUICKBOOT_POWERON".equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
        if (!isBoot) {
            return;
        }

        Log.i(TAG, "boot event: " + action + " — 매장 재생 서비스 기동 시도");

        Intent svc = new Intent(context, StorePlaybackService.class);
        svc.putExtra(StorePlaybackService.EXTRA_TITLE, "매장 음악 대기 중");
        svc.putExtra(StorePlaybackService.EXTRA_TEXT, "탭하면 음악을 다시 켭니다.");
        svc.putExtra(StorePlaybackService.EXTRA_FROM_BOOT, true);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception e) {
            // Android 12+ 에서 FGS 시작이 거부될 수 있다(ForegroundServiceStartNotAllowedException).
            // 부팅 경로는 면제 대상이지만 제조사 정책이 다를 수 있으므로 삼킨다 —
            // 여기서 죽으면 부팅 자체에 영향을 준다.
            Log.w(TAG, "부팅 후 서비스 기동 실패: " + e);
        }
    }
}
