package com.deudda.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

/**
 * 매장 음악 백그라운드 재생 유지용 포그라운드 서비스 + WebView 워치독.
 *
 * 안드로이드는 백그라운드 프로세스의 오디오를 언제든 중단시킬 수 있다(메모리 압박·Doze).
 * mediaPlayback 타입의 포그라운드 서비스가 떠 있으면 프로세스가 보호되어
 * 화면이 꺼지거나 앱이 백그라운드로 가도 WebView 재생이 이어진다.
 *
 * 이 서비스는 소리를 직접 내지 않는다 — 재생은 그대로 WebView 의 <audio> 가 담당하고,
 * 여기서는 프로세스를 살려두는 역할만 한다(오디오 파이프라인을 건드리지 않는다).
 *
 * ── 워치독 (HARDENING-13) ──────────────────────────────────────────────────
 * START_STICKY 는 **서비스만** 되살린다. Activity 와 그 안의 WebView 는 되살리지
 * 않는다. 그래서 "서비스는 살아 있는데 플레이어는 죽은" 상태가 생긴다 — 상태바에
 * 재생 중 알림이 떠 있는데 매장은 조용한, 가장 나쁜 조합이다.
 *
 * MainActivity 가 자기 생존을 여기에 보고하고(onStart/onStop), 서비스는 주기적으로
 * 그 신호가 끊겼는지 본다. 끊겼으면 한 번 되살려 본다.
 *
 * **되살리기가 성공한다고 보장하지 않는다.** 안드로이드 10+ 는 백그라운드 Activity
 * 시작을 금지한다. 시도는 하되, 막히면 알림 문구를 바꿔 사람이 한 번 탭하면 되게 한다.
 */
public class StorePlaybackService extends Service {

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_FROM_BOOT = "fromBoot";
    /** 원격 APP_RESTART — WebView/Activity 를 다시 만든다. 기기 재부팅이 아니다. */
    public static final String ACTION_APP_RESTART = "com.deudda.app.APP_RESTART";

    private static final String TAG = "DeuddaPlayback";
    private static final String CHANNEL_ID = "store_playback";
    private static final int NOTIFICATION_ID = 4711;

    /** Activity 생존 신호가 이만큼 끊기면 죽은 것으로 본다. */
    private static final long ACTIVITY_DEAD_AFTER_MS = 3 * 60 * 1000L;
    /** 워치독 점검 주기. */
    private static final long WATCHDOG_INTERVAL_MS = 60 * 1000L;
    /** 되살리기 최소 간격 — 무한 launch 루프 방지. */
    private static final long RELAUNCH_COOLDOWN_MS = 5 * 60 * 1000L;

    /* ── Activity 생존 신호 (MainActivity 가 갱신) ───────────────────────── */
    private static volatile long lastActivitySeenAt = 0L;
    private static volatile boolean activityForeground = false;

    /** MainActivity.onStart / onResume 에서 호출. */
    public static void noteActivityAlive(boolean foreground) {
        lastActivitySeenAt = SystemClock.elapsedRealtime();
        activityForeground = foreground;
    }

    /** MainActivity.onDestroy 에서 호출. */
    public static void noteActivityGone() {
        activityForeground = false;
    }

    public static long activitySilentForMs() {
        if (lastActivitySeenAt == 0L) {
            return -1L;   // 아직 한 번도 본 적 없음
        }
        return SystemClock.elapsedRealtime() - lastActivitySeenAt;
    }

    public static boolean isActivityForeground() {
        return activityForeground;
    }

    /* ── 인스턴스 상태 ──────────────────────────────────────────────────── */
    private static volatile boolean serviceRunning = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastRelaunchAt = 0L;
    private String currentTitle = "매장 음악 재생 중";
    private String currentText = "앱을 닫아도 재생이 계속됩니다.";
    private AudioFocusRequest focusRequest;
    private AudioManager audioManager;

    public static boolean isServiceRunning() {
        return serviceRunning;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_APP_RESTART.equals(intent.getAction())) {
            relaunchActivity("remote_app_restart", true);
            return START_STICKY;
        }

        if (intent != null) {
            if (intent.getStringExtra(EXTRA_TITLE) != null) {
                currentTitle = intent.getStringExtra(EXTRA_TITLE);
            }
            if (intent.getStringExtra(EXTRA_TEXT) != null) {
                currentText = intent.getStringExtra(EXTRA_TEXT);
            }
        }

        createChannel();
        Notification notification = buildNotification(currentTitle, currentText);

        // Android 14(API 34)+ 는 startForeground 에 서비스 타입을 명시해야 한다.
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        serviceRunning = true;
        requestAudioFocus();
        startWatchdog();

        // 시스템이 서비스를 종료해도 다시 살린다 — 무인 매장에서 재생이 끊기지 않도록.
        return START_STICKY;
    }

    /* ── 워치독 ─────────────────────────────────────────────────────────── */

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            try {
                long silent = activitySilentForMs();
                if (silent >= 0 && silent > ACTIVITY_DEAD_AFTER_MS && !activityForeground) {
                    Log.w(TAG, "Activity 신호 끊김 " + (silent / 1000) + "s — 되살리기 시도");
                    relaunchActivity("watchdog", false);
                }
            } catch (Exception e) {
                Log.w(TAG, "watchdog 오류: " + e);
            } finally {
                handler.postDelayed(this, WATCHDOG_INTERVAL_MS);
            }
        }
    };

    private void startWatchdog() {
        handler.removeCallbacks(watchdog);
        handler.postDelayed(watchdog, WATCHDOG_INTERVAL_MS);
    }

    /**
     * Activity/WebView 를 다시 만든다.
     *
     * @param force true 면 쿨다운을 건너뛴다(운영자가 명시적으로 요청한 원격 복구).
     */
    private void relaunchActivity(String reason, boolean force) {
        long now = SystemClock.elapsedRealtime();
        if (!force && now - lastRelaunchAt < RELAUNCH_COOLDOWN_MS) {
            Log.i(TAG, "되살리기 쿨다운 중 — 건너뜀 (" + reason + ")");
            return;
        }
        lastRelaunchAt = now;

        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        try {
            startActivity(launch);
            Log.i(TAG, "Activity 되살리기 시도함 (" + reason + ")");
        } catch (Exception e) {
            // Android 10+ 백그라운드 Activity 시작 제한. 예상된 실패다.
            Log.w(TAG, "백그라운드 Activity 시작 거부됨 (" + reason + "): " + e);
        }
        // 성공하든 막히든 알림 문구는 "한 번 탭하면 됨" 으로 바꾼다.
        updateNotification("매장 음악이 멈춰 있습니다", "탭하면 플레이어를 다시 엽니다.");
    }

    /* ── 오디오 포커스 (최소) ───────────────────────────────────────────── */
    //
    // 소리는 WebView 가 낸다. 여기서 포커스를 잡는 이유는 두 가지뿐이다:
    //   1. 매장 BGM 이 "정당한 장시간 미디어 재생" 임을 OS 에 알린다.
    //   2. 다른 앱이 포커스를 가져갔을 때 그 사실을 로그로 남긴다.
    // **포커스 상실을 이유로 WebView 재생을 멈추지 않는다.** 매장 BGM 은 알림음
    // 하나에 꺼지면 안 되고, 네이티브가 WebView 오디오를 직접 제어하려 들면
    // 재생 파이프라인이 두 주인을 갖게 되어 더 위험하다.

    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                // 전화·알림 등 일시적. OS 가 알아서 낮추거나 잠깐 멈춘다 — 우리는 관여하지 않는다.
                Log.i(TAG, "audio focus transient loss (" + change + ") — 재생 유지");
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                // 다른 미디어 앱이 영구 포커스를 가져갔다. 매장 BGM 은 계속 틀어야 하므로
                // 멈추지 않되, 이 사실은 남긴다(운영자가 원인 파악에 쓸 수 있게).
                Log.w(TAG, "audio focus permanent loss — 다른 미디어 앱이 포커스를 가져감");
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                Log.i(TAG, "audio focus gain");
                break;
            default:
                break;
        }
    };

    private void requestAudioFocus() {
        try {
            if (audioManager == null) {
                audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            }
            if (audioManager == null) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setWillPauseWhenDucked(false)
                    .setOnAudioFocusChangeListener(focusListener, handler)
                    .build();
                audioManager.requestAudioFocus(focusRequest);
            } else {
                audioManager.requestAudioFocus(
                    focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            }
        } catch (Exception e) {
            Log.w(TAG, "audio focus 요청 실패: " + e);
        }
    }

    private void abandonAudioFocus() {
        try {
            if (audioManager == null) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest != null) {
                    audioManager.abandonAudioFocusRequest(focusRequest);
                }
            } else {
                audioManager.abandonAudioFocus(focusListener);
            }
        } catch (Exception e) {
            Log.w(TAG, "audio focus 해제 실패: " + e);
        }
    }

    /* ── 알림 ───────────────────────────────────────────────────────────── */

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        // LOW — 소리·헤드업 없이 상태바에만 조용히 표시.
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "매장 음악 재생",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("매장 음악이 백그라운드에서 재생 중일 때 표시됩니다.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private void updateNotification(String title, String text) {
        currentTitle = title;
        currentText = text;
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, buildNotification(title, text));
            }
        } catch (Exception e) {
            Log.w(TAG, "알림 갱신 실패: " + e);
        }
    }

    private Notification buildNotification(String title, String text) {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, launch, flags);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        return builder
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .build();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(watchdog);
        abandonAudioFocus();
        serviceRunning = false;
        stopForeground(true);
        super.onDestroy();
    }
}
