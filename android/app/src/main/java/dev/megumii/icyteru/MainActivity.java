package dev.megumii.icyteru;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile boolean visible = false;

    public static boolean isVisible() {
        return visible;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IcyteruPushPlugin.class);
        registerPlugin(IcyteruDownloadPlugin.class);
        super.onCreate(savedInstanceState);
        handlePushIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        visible = true;
    }

    @Override
    public void onPause() {
        visible = false;
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handlePushIntent(intent);
    }

    private void handlePushIntent(Intent intent) {
        if (intent == null) return;
        String sessionId = intent.getStringExtra("icyteru_session_id");
        if (sessionId == null || sessionId.isEmpty()) return;
        getSharedPreferences(IcyteruMessagingService.PREFS, MODE_PRIVATE)
                .edit()
                .putString(IcyteruMessagingService.SESSION_KEY, sessionId)
                .apply();
        // Warm start: onNewIntent fires while React/the WebView is already
        // running. The event makes the client switch to this session now;
        // the SharedPreferences copy still covers a cold start.
        IcyteruPushPlugin.notifySessionOpened(sessionId);
    }
}
