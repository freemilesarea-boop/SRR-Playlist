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

    /**
     * WebView(JS) 하트비트가 이만큼 끊기면 플레이어가 죽은 것으로 본다.
     *
     * **Activity 가 백그라운드인 것과 죽은 것은 다르다.** 점주가 다른 앱을 쓰는 동안
     * Activity 는 멀쩡히 살아 있고 WebView 도 계속 음악을 튼다. foreground 여부만 보고
     * 되살리려 들면, 다른 앱을 3분 쓴 것만으로 듣다가 화면을 강제로 띄운다 —
     * 무인 매장이 아니라 사람이 쓰는 태블릿에서는 그게 더 큰 사고다.
     *
     * 그래서 판단 근거를 **JS 하트비트**로 바꾼다. JS 가 돌고 있으면 WebView 는 살아
     * 있는 것이고, foreground 인지 아닌지는 상관없다.
     */
    private static final long WEB_HEARTBEAT_DEAD_MS = 5 * 60 * 1000L;
    /** 소리가 이만큼 끊겨야 개입 후보가 된다. 음악이 나오는 중이면 아무 문제도 없다. */
    private static final long AUDIBLE_DEAD_MS = 5 * 60 * 1000L;
    /** 워치독 점검 주기. */
    private static final long WATCHDOG_INTERVAL_MS = 60 * 1000L;
    /** 되살리기 최소 간격 — 무한 launch 루프 방지. */
    private static final long RELAUNCH_COOLDOWN_MS = 5 * 60 * 1000L;

    /* ── 생존 신호 ───────────────────────────────────────────────────────
     *
     * activityAlive     : onCreate ~ onDestroy. Activity 객체가 존재하는가.
     * activityForeground: 화면에 떠 있는가. **되살리기 판단에는 쓰지 않는다** —
     *                     상태 표시(health)용이다.
     * lastWebHeartbeatAt: JS 가 마지막으로 살아 있음을 알린 시각.
     * lastAudibleAt     : 실제로 소리가 나고 있다고 JS 가 알린 마지막 시각.
     */
    private static volatile boolean activityAlive = false;
    private static volatile boolean activityForeground = false;
    private static volatile long lastWebHeartbeatAt = 0L;
    private static volatile long lastAudibleAt = 0L;

    /** MainActivity.onCreate */
    public static void noteActivityCreated() {
        activityAlive = true;
    }

    /** MainActivity.onDestroy */
    public static void noteActivityDestroyed() {
        activityAlive = false;
        activityForeground = false;
    }

    /** MainActivity.onStart/onResume(true) · onStop(false) */
    public static void noteActivityForeground(boolean foreground) {
        activityForeground = foreground;
        if (foreground) {
            activityAlive = true;
        }
    }

    /**
     * JS 하트비트. WebView 가 코드를 실행하고 있다는 유일한 확실한 증거다.
     *
     * @param audible 지금 실제로 소리가 나고 있는가(재생 위치가 움직이는가)
     */
    public static void noteWebHeartbeat(boolean audible) {
        long now = SystemClock.elapsedRealtime();
        lastWebHeartbeatAt = now;
        if (audible) {
            lastAudibleAt = now;
        }
    }

    public static boolean isActivityAlive() {
        return activityAlive;
    }

    public static boolean isActivityForeground() {
        return activityForeground;
    }

    /** JS 하트비트가 끊긴 시간(ms). 아직 한 번도 받은 적 없으면 -1. */
    public static long webHeartbeatSilentForMs() {
        if (lastWebHeartbeatAt == 0L) {
            return -1L;
        }
        return SystemClock.elapsedRealtime() - lastWebHeartbeatAt;
    }

    /** 소리가 끊긴 시간(ms). 아직 한 번도 소리를 들은 적 없으면 -1. */
    public static long audibleSilentForMs() {
        if (lastAudibleAt == 0L) {
            return -1L;
        }
        return SystemClock.elapsedRealtime() - lastAudibleAt;
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
                if (shouldRelaunch()) {
                    Log.w(TAG, "플레이어가 죽은 것으로 판단 — 되살리기 시도"
                        + " (activityAlive=" + activityAlive
                        + ", webSilentMs=" + webHeartbeatSilentForMs()
                        + ", audibleSilentMs=" + audibleSilentForMs() + ")");
                    relaunchActivity("watchdog", false);
                }
            } catch (Exception e) {
                Log.w(TAG, "watchdog 오류: " + e);
            } finally {
                handler.postDelayed(this, WATCHDOG_INTERVAL_MS);
            }
        }
    };

    /**
     * 지금 Activity/WebView 를 되살려야 하는가.
     *
     * **소리가 나고 있으면 무조건 아니다.** 백그라운드에 있든 화면이 꺼져 있든
     * 음악이 나오는 중이면 아무 문제도 없다 — 그게 이 앱의 목적이다.
     *
     * 개입 조건은 두 가지가 **모두** 성립할 때뿐이다:
     *   (1) 5분 넘게 소리가 없다, 그리고
     *   (2) Activity 가 파괴됐거나 JS 하트비트가 5분 넘게 끊겼다
     *       (= 웹쪽 복구 사다리가 돌 수 없는 상태다)
     *
     * JS 가 살아서 하트비트를 보내고 있는데 소리만 없는 경우는 **웹 워치독의
     * 일이다**(nudge → reload → skip → hard reset). 네이티브가 끼어들면 웹이
     * 복구하려는 중에 Activity 를 다시 만들어 그 시도를 날린다.
     */
    private boolean shouldRelaunch() {
        long audibleSilent = audibleSilentForMs();
        // 소리를 한 번도 들은 적이 없으면(-1) 아직 재생을 시작하지 않은 것 —
        // 되살릴 대상이 아니다. 시작은 사람이 한다.
        if (audibleSilent < 0 || audibleSilent < AUDIBLE_DEAD_MS) {
            return false;
        }
        if (!activityAlive) {
            return true;                       // Activity 자체가 사라졌다
        }
        long webSilent = webHeartbeatSilentForMs();
        // 하트비트를 한 번도 못 받았으면 판단 근거가 없다 — 개입하지 않는다.
        return webSilent >= 0 && webSilent >= WEB_HEARTBEAT_DEAD_MS;
    }

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
