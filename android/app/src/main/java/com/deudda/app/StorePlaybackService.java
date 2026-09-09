package com.deudda.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * 매장 음악 백그라운드 재생 유지용 포그라운드 서비스.
 *
 * 안드로이드는 백그라운드 프로세스의 오디오를 언제든 중단시킬 수 있다(메모리 압박·Doze).
 * mediaPlayback 타입의 포그라운드 서비스가 떠 있으면 프로세스가 보호되어
 * 화면이 꺼지거나 앱이 백그라운드로 가도 WebView 재생이 이어진다.
 *
 * 이 서비스는 소리를 직접 내지 않는다 — 재생은 그대로 WebView 의 <audio> 가 담당하고,
 * 여기서는 프로세스를 살려두는 역할만 한다(오디오 파이프라인을 건드리지 않는다).
 *
 * JS 에서 StorePlaybackServicePlugin 을 통해 매장/브랜드 재생 시작 시 start,
 * 재생 종료 시 stop 한다.
 */
public class StorePlaybackService extends Service {

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";

    private static final String CHANNEL_ID = "store_playback";
    private static final int NOTIFICATION_ID = 4711;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = "매장 음악 재생 중";
        String text = "앱을 닫아도 재생이 계속됩니다.";
        if (intent != null) {
            if (intent.getStringExtra(EXTRA_TITLE) != null) {
                title = intent.getStringExtra(EXTRA_TITLE);
            }
            if (intent.getStringExtra(EXTRA_TEXT) != null) {
                text = intent.getStringExtra(EXTRA_TEXT);
            }
        }

        createChannel();
        Notification notification = buildNotification(title, text);

        // Android 14(API 34)+ 는 startForeground 에 서비스 타입을 명시해야 한다.
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // 시스템이 서비스를 종료해도 다시 살린다 — 무인 매장에서 재생이 끊기지 않도록.
        return START_STICKY;
    }

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
        stopForeground(true);
        super.onDestroy();
    }
}
