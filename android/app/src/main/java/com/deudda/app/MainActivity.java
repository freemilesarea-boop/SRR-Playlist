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
        StorePlaybackService.noteActivityCreated();
    }

    @Override
    public void onStart() {
        super.onStart();
        StorePlaybackService.noteActivityForeground(true);
    }

    @Override
    public void onResume() {
        super.onResume();
        StorePlaybackService.noteActivityForeground(true);
    }

    @Override
    public void onStop() {
        // 백그라운드로 갔을 뿐 죽은 것이 아니다. **워치독은 이 플래그로 판단하지 않는다** —
        // 점주가 다른 앱을 오래 쓰는 것은 정상 상태다. 판단은 JS 하트비트가 한다.
        StorePlaybackService.noteActivityForeground(false);
        super.onStop();
    }

    @Override
    public void onDestroy() {
        StorePlaybackService.noteActivityDestroyed();
        super.onDestroy();
    }
}
