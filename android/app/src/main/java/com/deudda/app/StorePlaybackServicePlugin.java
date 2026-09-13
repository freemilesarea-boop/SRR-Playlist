package com.deudda.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS ↔ StorePlaybackService 다리.
 *
 * 매장/브랜드 재생이 시작되면 start(), 멈추면 stop() 을 호출해
 * 포그라운드 서비스를 띄우고 내린다. 웹/iOS 에서는 이 플러그인이 없으므로
 * JS 쪽(storePlaybackService.ts)이 호출을 조용히 건너뛴다.
 *
 * HARDENING-13 추가:
 *   • restartApp()                  — 원격 APP_RESTART(WebView/Activity 재생성)
 *   • health()                      — 네이티브 상태 신호(관리자 표시용)
 *   • openBatteryOptimizationSettings() — 사용자를 설정 화면으로 **안내만** 한다
 *
 * 여기서 하지 않는 것:
 *   • 기기 재부팅 — Device Owner 없이는 불가능하다. 시도하지 않는다.
 *   • 배터리 최적화 자동 예외 — 사용자 동의 없이 요청하지 않는다(정책·신뢰 문제).
 */
@CapacitorPlugin(name = "StorePlaybackService")
public class StorePlaybackServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), StorePlaybackService.class);
        intent.putExtra(StorePlaybackService.EXTRA_TITLE, call.getString("title", "매장 음악 재생 중"));
        intent.putExtra(StorePlaybackService.EXTRA_TEXT, call.getString("text", "앱을 닫아도 재생이 계속됩니다."));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), StorePlaybackService.class));
        call.resolve();
    }

    /**
     * 원격 APP_RESTART — **WebView/Activity 재생성**이다. 기기 재부팅이 아니다.
     *
     * 서비스를 경유하는 이유: 호출 시점에 Activity 가 이미 죽어 있을 수 있고,
     * 서비스 쪽에 쿨다운과 로그가 모여 있는 편이 낫다.
     */
    @PluginMethod
    public void restartApp(PluginCall call) {
        Intent intent = new Intent(getContext(), StorePlaybackService.class);
        intent.setAction(StorePlaybackService.ACTION_APP_RESTART);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            JSObject res = new JSObject();
            res.put("started", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("app_restart_failed", e);
        }
    }

    /**
     * JS 하트비트 — **WebView 가 살아 있다는 유일한 확실한 증거.**
     *
     * 워치독은 foreground 여부가 아니라 이 신호로 판단한다. 점주가 다른 앱을
     * 오래 쓰는 것은 정상이고, 그동안에도 WebView 는 음악을 튼다.
     *
     * @param audible 지금 실제로 소리가 나고 있는가(재생 위치가 움직이는가)
     */
    @PluginMethod
    public void heartbeat(PluginCall call) {
        StorePlaybackService.noteWebHeartbeat(Boolean.TRUE.equals(call.getBoolean("audible", false)));
        call.resolve();
    }

    /**
     * 네이티브 상태 신호. **개인정보·기기 시리얼·광고 ID 는 담지 않는다.**
     * 담는 것은 OS 버전, 앱 버전, 서비스 생존, 배터리 최적화 제외 여부뿐이다.
     */
    @PluginMethod
    public void health(PluginCall call) {
        JSObject res = new JSObject();
        res.put("runtime", "android_native");
        res.put("androidSdk", Build.VERSION.SDK_INT);
        res.put("androidRelease", Build.VERSION.RELEASE);
        res.put("serviceRunning", StorePlaybackService.isServiceRunning());
        res.put("activityAlive", StorePlaybackService.isActivityAlive());
        res.put("activityForeground", StorePlaybackService.isActivityForeground());
        res.put("webHeartbeatSilentForMs", StorePlaybackService.webHeartbeatSilentForMs());
        res.put("audibleSilentForMs", StorePlaybackService.audibleSilentForMs());
        res.put("batteryOptimizationIgnored", isIgnoringBatteryOptimizations());

        String versionName = null;
        long versionCode = -1;
        try {
            Context ctx = getContext();
            android.content.pm.PackageInfo info =
                ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            versionName = info.versionName;
            versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
        } catch (Exception ignored) {
            // 버전 조회 실패는 상태 보고를 막지 않는다.
        }
        res.put("appVersion", versionName);
        res.put("appBuild", versionCode);
        call.resolve(res);
    }

    /**
     * 배터리 최적화 예외 여부. Android 6(API 23) 미만은 개념 자체가 없으므로 true.
     * 조회만 한다 — 자동으로 예외를 요청하지 않는다.
     */
    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        try {
            Context ctx = getContext();
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 배터리 최적화 설정 화면으로 **안내**한다.
     *
     * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS(직접 요청 다이얼로그)는 쓰지 않는다 —
     * Play 정책상 정당화가 필요한 권한이고, 매장 운영자가 무엇을 허용하는지 보고
     * 결정하는 편이 낫다. 목록 화면을 열어주고 선택은 사람이 한다.
     */
    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // 일부 제조사 ROM 에는 이 화면이 없다. 앱 상세 설정으로 폴백한다.
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
                fallback.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("settings_unavailable", e2);
            }
        }
    }
}
