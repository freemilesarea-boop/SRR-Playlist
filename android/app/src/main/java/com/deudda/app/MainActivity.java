package com.deudda.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 앱 로컬 플러그인은 자동 검색되지 않는다 — super.onCreate 전에 직접 등록.
        registerPlugin(StorePlaybackServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
