package com.deudda.app;

import android.content.Intent;
import android.os.Build;

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
}
