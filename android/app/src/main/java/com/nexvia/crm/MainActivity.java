package com.nexvia.crm;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static final String EXTRA_LAUNCH_PATH = "nexvia_launch_path";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CalendarWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        captureLaunchPath(getIntent());
        scheduleApplyLaunchPath();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureLaunchPath(intent);
        scheduleApplyLaunchPath();
    }

    @Override
    public void onResume() {
        super.onResume();
        scheduleApplyLaunchPath();
    }

    private void captureLaunchPath(Intent intent) {
        if (intent == null) return;
        String path = intent.getStringExtra(EXTRA_LAUNCH_PATH);
        if (path != null && !path.trim().isEmpty()) {
            CalendarWidgetStore.setPendingLaunchPath(this, path.trim());
            intent.removeExtra(EXTRA_LAUNCH_PATH);
        }
    }

    private void scheduleApplyLaunchPath() {
        new Handler(Looper.getMainLooper()).postDelayed(this::applyPendingLaunchPath, 400);
        new Handler(Looper.getMainLooper()).postDelayed(this::applyPendingLaunchPath, 1200);
    }

    private void applyPendingLaunchPath() {
        String path = CalendarWidgetStore.peekPendingLaunchPath(this);
        if (path == null || path.isEmpty()) return;

        Bridge bridge = getBridge();
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;

        String safePath = path.replace("\\", "\\\\").replace("'", "\\'");
        String js =
                "(function(){"
                        + "var p='" + safePath + "';"
                        + "try{"
                        + "if(typeof window.__nexviaNavigate==='function'){window.__nexviaNavigate(p);return true;}"
                        + "if(window.location.pathname!==p){window.history.pushState({},'',p);"
                        + "window.dispatchEvent(new PopStateEvent('popstate'));}"
                        + "return true;"
                        + "}catch(e){try{window.location.assign(p);return true;}catch(_){return false;}}"
                        + "})();";
        webView.post(() -> webView.evaluateJavascript(js, value -> {
            if (value != null && value.contains("true")) {
                CalendarWidgetStore.clearPendingLaunchPath(MainActivity.this);
            }
        }));
    }
}
