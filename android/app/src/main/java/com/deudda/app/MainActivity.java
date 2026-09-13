package com.deudda.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * 앱 진입점.
 *
 * HARDENING-13: 서비스 워치독이 "Activity/WebView 가 죽었는지" 를 판단하려면
 * 살아 있다는 신호가 필요하다. START_STICKY 는 서비스만 되살리므로, 이 신호가 없으면
 * 상태바에는 재생 알림이 떠 있는데 매장은 조용한 상태를 서비스가 알 방법이 없다.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 앱 로컬 플러그인은 자동 검색되지 않는다 — super.onCreate 전에 직접 등록.
        registerPlugin(StorePlaybackServicePlugin.class);
        super.onCreate(savedInstanceState);
        StorePlaybackService.noteActivityAlive(false);
    }

    @Override
    public void onStart() {
        super.onStart();
        StorePlaybackService.noteActivityAlive(true);
    }

    @Override
    public void onResume() {
        super.onResume();
        StorePlaybackService.noteActivityAlive(true);
    }

    @Override
    public void onStop() {
        // 백그라운드로 갔을 뿐 죽은 것은 아니다 — 마지막 생존 시각은 갱신하되
        // foreground 플래그만 내린다. 워치독은 3분 무신호일 때만 개입한다.
        StorePlaybackService.noteActivityAlive(false);
        super.onStop();
    }

    @Override
    public void onDestroy() {
        StorePlaybackService.noteActivityGone();
        super.onDestroy();
    }
}
